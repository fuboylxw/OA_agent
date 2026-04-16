import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { sm2 } from 'sm-crypto';

type BrowserCookie = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

function loadRootEnv() {
  const scriptDir = typeof __dirname === 'string'
    ? __dirname
    : path.dirname(process.argv[1] ? path.resolve(process.argv[1]) : process.cwd());
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(scriptDir, '../../../.env'),
  ];

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) continue;
      const key = line.slice(0, separatorIndex).trim();
      if (process.env[key] !== undefined) continue;
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function getArg(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function extractSm2PrivateKeyHex(rawKey: string) {
  const exported = Buffer.from(rawKey.trim(), 'base64').toString('hex');
  const match = exported.match(/0201010420([0-9a-f]{64})/i);
  if (!match) {
    throw new Error('Unable to extract SM2 private scalar from AUTH_OAUTH2_PRIVATE_KEY');
  }
  return match[1];
}

function buildSignedPayload(account: string) {
  const clientId = String(process.env.AUTH_OAUTH2_CLIENT_ID || '').trim();
  const privateKey = String(process.env.AUTH_OAUTH2_PRIVATE_KEY || '').trim();
  if (!clientId) throw new Error('Missing AUTH_OAUTH2_CLIENT_ID');
  if (!privateKey) throw new Error('Missing AUTH_OAUTH2_PRIVATE_KEY');

  const payload: Record<string, string> = {
    clientId,
    account,
    timestamp: String(Date.now()),
    nonceStr: crypto.randomBytes(10).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10),
  };
  const signSource = Object.entries(payload)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  payload.sign = sm2.doSignature(signSource, extractSm2PrivateKeyHex(privateKey), {
    der: true,
    hash: true,
  });
  return payload;
}

async function requestLoginCookie(account: string) {
  const payload = buildSignedPayload(account);
  const pathWithQuery = `/auth2/api/v1/login?${new URLSearchParams(payload).toString()}`;

  return new Promise<string[]>((resolve, reject) => {
    const request = https.request({
      hostname: 'sz.xpu.edu.cn',
      port: 443,
      method: 'GET',
      path: pathWithQuery,
    }, (response) => {
      response.resume();
      response.on('end', () => {
        resolve(Array.isArray(response.headers['set-cookie'])
          ? response.headers['set-cookie'].map(String)
          : response.headers['set-cookie']
            ? [String(response.headers['set-cookie'])]
            : []);
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function parseSetCookie(header: string): BrowserCookie {
  const parts = header.split(';').map((part) => part.trim()).filter(Boolean);
  const [nameValue, ...attributes] = parts;
  const separatorIndex = nameValue.indexOf('=');
  const cookie: BrowserCookie = {
    name: nameValue.slice(0, separatorIndex),
    value: nameValue.slice(separatorIndex + 1),
    path: '/',
    url: 'https://sz.xpu.edu.cn',
  };

  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = rawKey.toLowerCase();
    const value = rest.join('=');
    if (key === 'domain' && value) {
      delete cookie.url;
      cookie.domain = value;
    }
    if (key === 'path' && value) cookie.path = value;
    if (key === 'secure') cookie.secure = true;
    if (key === 'httponly') cookie.httpOnly = true;
  }

  return cookie;
}

async function readBodyPreview(page: any) {
  return page.evaluate(() =>
    (document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000),
  ).catch(() => '');
}

async function maybeAcceptAuthorize(page: any) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const title = await page.title().catch(() => '');
    const bodyPreview = await readBodyPreview(page);
    if (!/用户信息授权|同意\/授权/.test(`${title} ${bodyPreview}`)) {
      return false;
    }

    const candidates = [
      page.getByRole('button', { name: '同意/授权', exact: true }),
      page.getByText('同意/授权', { exact: true }),
      page.locator('text=同意/授权'),
    ];

    for (const locator of candidates) {
      const count = await locator.count().catch(() => 0);
      if (!count) continue;
      try {
        await locator.first().click({ force: true, timeout: 5000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
        await page.waitForTimeout(2000);
        return true;
      } catch {
        continue;
      }
    }
  }

  return false;
}

async function ensureFrontendSession(context: any, page: any, webBaseUrl: string) {
  await page.goto(`${webBaseUrl}/login?returnTo=${encodeURIComponent('/connectors')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(2000);
  await maybeAcceptAuthorize(page);

  for (let index = 0; index < 8; index += 1) {
    const currentUrl = page.url();
    if (/\/connectors(?:[?#]|$)/.test(currentUrl) || /\/chat(?:[?#]|$)/.test(currentUrl)) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  const cookies = await context.cookies();
  const authSession = cookies.find((cookie: any) => cookie.name === 'auth_session');
  if (!authSession) {
    throw new Error('Frontend auth_session cookie was not established');
  }
}

async function main() {
  loadRootEnv();
  const account = getArg('--account', 'cloudcam') || 'cloudcam';
  const webBaseUrl = String(
    getArg('--web-base-url', process.env.PUBLIC_WEB_BASE_URL || 'http://202.200.206.250'),
  ).trim().replace(/\/+$/, '');
  const connectorId = getArg('--connector-id', '358cf4b1-5dba-4d80-b808-7b4f4f6f1978') || '358cf4b1-5dba-4d80-b808-7b4f4f6f1978';

  const cookieHeaders = await requestLoginCookie(account);
  if (cookieHeaders.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();

    await ensureFrontendSession(context, page, webBaseUrl);

    await page.goto(`${webBaseUrl}/connectors`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    const connectorsPageUrl = page.url();
    const connectorsBody = await readBodyPreview(page);

    await page.goto(`${webBaseUrl}/connectors/${connectorId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    const connectorDetailPageUrl = page.url();
    const connectorDetailBody = await readBodyPreview(page);

    await page.goto(`${webBaseUrl}/processes`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    const processesPageUrl = page.url();
    const processesBody = await readBodyPreview(page);

    await page.goto(`${webBaseUrl}/process-library`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    const processLibraryPageUrl = page.url();
    const processLibraryBody = await readBodyPreview(page);

    const result = {
      generatedAt: new Date().toISOString(),
      account,
      webBaseUrl,
      connectorId,
      connectorsPage: {
        url: connectorsPageUrl,
        bodyIncludesUrlMode: /链接直达接入（URL）|链接直达接入|链接直达/.test(connectorsBody),
        bodyIncludesLeaveFlow: /请假申请/.test(connectorsBody),
        bodyPreview: connectorsBody,
      },
      connectorDetailPage: {
        url: connectorDetailPageUrl,
        bodyIncludesUrlMode: /链接直达接入（URL）|链接直达接入|链接直达/.test(connectorDetailBody),
        bodyIncludesExecutionMode: /URL 直达|提交：URL 直达/.test(connectorDetailBody),
        bodyIncludesLeaveFlow: /请假申请/.test(connectorDetailBody),
        bodyPreview: connectorDetailBody,
      },
      processesPage: {
        url: processesPageUrl,
        bodyIncludesLeaveFlow: /请假申请/.test(processesBody),
        bodyIncludesProcessCode: /leave_request/.test(processesBody),
        bodyPreview: processesBody,
      },
      processLibraryPage: {
        url: processLibraryPageUrl,
        bodyIncludesLeaveFlow: /请假申请/.test(processLibraryBody),
        bodyIncludesConnectorWord: /所属连接器|请选择连接器|单个添加流程/.test(processLibraryBody),
        bodyIncludesConnectorName: /西安工程大学OA系统/.test(processLibraryBody),
        bodyPreview: processLibraryBody,
      },
    };

    const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `verify-xpu-frontend-url-management-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({ outputPath, ...result }, null, 2));

    console.log(JSON.stringify({
      outputPath,
      connectorsPage: result.connectorsPage,
      connectorDetailPage: result.connectorDetailPage,
      processesPage: result.processesPage,
      processLibraryPage: result.processLibraryPage,
    }, null, 2));
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
