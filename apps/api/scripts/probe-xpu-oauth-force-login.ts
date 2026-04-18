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
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (process.env[key] !== undefined) {
        continue;
      }

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
  if (!clientId) {
    throw new Error('Missing AUTH_OAUTH2_CLIENT_ID');
  }
  if (!privateKey) {
    throw new Error('Missing AUTH_OAUTH2_PRIVATE_KEY');
  }

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
    if (key === 'path' && value) {
      cookie.path = value;
    }
    if (key === 'secure') {
      cookie.secure = true;
    }
    if (key === 'httponly') {
      cookie.httpOnly = true;
    }
  }

  return cookie;
}

async function readBodyPreview(page: any) {
  return page.evaluate(() =>
    (document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600),
  ).catch(() => '');
}

async function runScenario(
  browser: any,
  account: string,
  name: string,
  extraParams: Record<string, string>,
) {
  const cookieHeaders = await requestLoginCookie(account);
  const context = await browser.newContext();
  await context.addCookies(cookieHeaders.map(parseSetCookie));
  const page = await context.newPage();

  const clientId = String(process.env.AUTH_OAUTH2_CLIENT_ID || '').trim();
  const baseUrl = String(process.env.AUTH_OAUTH2_BASE_URL || 'https://sz.xpu.edu.cn').replace(/\/+$/, '');
  const authorizeUrl = new URL(`${baseUrl}/auth2/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', 'http://202.200.206.250/login/callback');
  authorizeUrl.searchParams.set('scope', 'client');
  authorizeUrl.searchParams.set('state', `probe-${name}-${Date.now()}`);
  for (const [key, value] of Object.entries(extraParams)) {
    authorizeUrl.searchParams.set(key, value);
  }

  await page.goto(authorizeUrl.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(2000);

  const bodyPreview = await readBodyPreview(page);
  const title = await page.title().catch(() => '');

  const result = {
    name,
    requestedUrl: authorizeUrl.toString(),
    finalUrl: page.url(),
    title,
    bodyPreview,
    looksLikeLogin: /账号|密码|统一身份认证|登录/.test(`${title} ${bodyPreview}`),
    looksLikeAuthorize: /用户信息授权|同意\/授权/.test(`${title} ${bodyPreview}`),
  };

  await context.close();
  return result;
}

async function main() {
  loadRootEnv();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const browser = await chromium.launch({ headless: true });

  try {
    const scenarios = [
      { name: 'baseline', extraParams: {} },
      { name: 'prompt_login', extraParams: { prompt: 'login' } },
      { name: 'max_age_0', extraParams: { max_age: '0' } },
      { name: 'prompt_login_max_age_0', extraParams: { prompt: 'login', max_age: '0' } },
      { name: 'forceAuthn_true', extraParams: { forceAuthn: 'true' } },
      { name: 'reauth_true', extraParams: { reauth: 'true' } },
    ];

    const results = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(browser, account, scenario.name, scenario.extraParams));
    }

    const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `probe-xpu-oauth-force-login-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({ account, results }, null, 2));
    console.log(JSON.stringify({ outputPath, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
