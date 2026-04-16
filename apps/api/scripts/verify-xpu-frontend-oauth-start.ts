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

type ScenarioResult = {
  name: string;
  success: boolean;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  bodyPreview: string;
  authSessionCookies: string[];
  portalCookies: string[];
  steps: Array<{
    step: string;
    finalUrl: string;
    title: string;
    bodyPreview: string;
    acceptedAuthorize: boolean;
  }>;
  networkTrace: Array<{
    type: 'request' | 'response';
    method?: string;
    url: string;
    status?: number;
  }>;
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

async function maybeAcceptAuthorize(page: any) {
  let accepted = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const title = await page.title().catch(() => '');
    const bodyPreview = await readBodyPreview(page);
    const needsAuthorize = /用户信息授权|同意\/授权/.test(`${title} ${bodyPreview}`);
    if (!needsAuthorize) {
      break;
    }

    const candidates = [
      page.getByRole('button', { name: '同意/授权', exact: true }),
      page.getByText('同意/授权', { exact: true }),
      page.locator('text=同意/授权'),
    ];

    let clicked = false;
    for (const locator of candidates) {
      const count = await locator.count().catch(() => 0);
      if (!count) {
        continue;
      }
      try {
        await locator.first().click({ force: true, timeout: 5000 });
        clicked = true;
        accepted = true;
        break;
      } catch {
        try {
          await locator.first().dispatchEvent('click');
          clicked = true;
          accepted = true;
          break;
        } catch {
          continue;
        }
      }
    }

    if (!clicked) {
      break;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
  }

  return accepted;
}

async function captureStep(step: string, page: any, acceptedAuthorize: boolean) {
  return {
    step,
    finalUrl: page.url(),
    title: await page.title().catch(() => ''),
    bodyPreview: await readBodyPreview(page),
    acceptedAuthorize,
  };
}

async function runScenario(input: {
  name: string;
  account: string;
  requestedUrl: string;
}) : Promise<ScenarioResult> {
  const cookieHeaders = await requestLoginCookie(input.account);
  if (cookieHeaders.length === 0) {
    throw new Error(`No cookies returned from whitelist login for scenario ${input.name}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();
    const networkTrace: ScenarioResult['networkTrace'] = [];
    const steps: ScenarioResult['steps'] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (!/202\.200\.206\.250|sz\.xpu\.edu\.cn|\/api\/v1\/auth\/oauth2\/(start|exchange)|\/api\/session/i.test(url)) {
        return;
      }
      networkTrace.push({
        type: 'request',
        method: request.method(),
        url,
      });
    });

    page.on('response', (response) => {
      const url = response.url();
      if (!/202\.200\.206\.250|sz\.xpu\.edu\.cn|\/api\/v1\/auth\/oauth2\/(start|exchange)|\/api\/session/i.test(url)) {
        return;
      }
      networkTrace.push({
        type: 'response',
        url,
        status: response.status(),
      });
    });

    await page.goto(input.requestedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    steps.push(await captureStep('after_initial_open', page, false));

    const acceptedAuthorize = await maybeAcceptAuthorize(page);
    steps.push(await captureStep('after_authorize', page, acceptedAuthorize));

    for (let index = 0; index < 6; index += 1) {
      if (/\/chat(?:[?#]|$)/.test(page.url()) || /\/login\/callback(?:[?#]|$)/.test(page.url()) === false) {
        if (/\/chat(?:[?#]|$)/.test(page.url())) {
          break;
        }
      }
      await page.waitForTimeout(1500);
      if (/\/chat(?:[?#]|$)/.test(page.url()) || !/\/login\/callback(?:[?#]|$)/.test(page.url())) {
        break;
      }
    }

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    const title = await page.title().catch(() => '');
    const bodyPreview = await readBodyPreview(page);
    const allCookies = await context.cookies();
    const authSessionCookies = allCookies
      .filter((cookie) => String(cookie.name || '') === 'auth_session')
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    const portalCookies = allCookies
      .filter((cookie) => String(cookie.domain || '').includes('sz.xpu.edu.cn'))
      .map((cookie) => `${cookie.name}=${cookie.value}`);

    return {
      name: input.name,
      success: authSessionCookies.length > 0 && /\/chat(?:[?#]|$)/.test(page.url()),
      requestedUrl: input.requestedUrl,
      finalUrl: page.url(),
      title,
      bodyPreview,
      authSessionCookies,
      portalCookies,
      steps,
      networkTrace,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  loadRootEnv();
  const account = getArg('--account', 'cloudcam') || 'cloudcam';
  const webBaseUrl = String(
    getArg('--web-base-url', process.env.PUBLIC_WEB_BASE_URL || 'http://202.200.206.250'),
  ).trim().replace(/\/+$/, '');
  const returnTo = getArg('--return-to', '/chat') || '/chat';

  const scenarios = [
    await runScenario({
      name: 'login_page_auto_start',
      account,
      requestedUrl: `${webBaseUrl}/login?returnTo=${encodeURIComponent(returnTo)}`,
    }),
    await runScenario({
      name: 'oauth_start_direct',
      account,
      requestedUrl: `${webBaseUrl}/api/v1/auth/oauth2/start?returnTo=${encodeURIComponent(returnTo)}`,
    }),
  ];

  const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `verify-xpu-frontend-oauth-start-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({
    account,
    webBaseUrl,
    returnTo,
    generatedAt: new Date().toISOString(),
    scenarios,
  }, null, 2));

  console.log(JSON.stringify({
    outputPath,
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      success: scenario.success,
      finalUrl: scenario.finalUrl,
      title: scenario.title,
      authSessionCookieCount: scenario.authSessionCookies.length,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
