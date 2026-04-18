import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { chromium, type Page } from 'playwright';
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

async function readBodyPreview(page: Page) {
  return page.evaluate(() =>
    (document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400),
  ).catch(() => '');
}

async function maybeAcceptAuthorize(page: Page) {
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
      if (!count) {
        continue;
      }
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

async function waitForLoggedIn(page: Page) {
  for (let index = 0; index < 12; index += 1) {
    await maybeAcceptAuthorize(page);
    if (/\/chat(?:[?#]|$)/.test(page.url())) {
      return;
    }
    await page.waitForTimeout(1500);
  }

  throw new Error(`Expected to reach /chat, got ${page.url()}`);
}

async function waitForLoginPrompt(page: Page) {
  for (let index = 0; index < 12; index += 1) {
    const title = await page.title().catch(() => '');
    const bodyPreview = await readBodyPreview(page);
    if (/账号登录|扫码登录|忘记密码|账号为工号或学号|密码/.test(`${title} ${bodyPreview}`)) {
      return;
    }
    await page.waitForTimeout(1000);
  }

  throw new Error(`Expected to reach provider login prompt, got ${page.url()}`);
}

async function main() {
  loadRootEnv();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const webBaseUrl = String(
    getArg('--web-base-url', process.env.PUBLIC_WEB_BASE_URL || 'http://202.200.206.250'),
  ).trim().replace(/\/+$/, '');
  const returnTo = String(getArg('--return-to', '/chat') || '/chat').trim() || '/chat';

  const cookieHeaders = await requestLoginCookie(account);
  if (cookieHeaders.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const networkEvents: Array<Record<string, unknown>> = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    page.on('request', (request) => {
      const url = request.url();
      if (
        /\/logout|\/login(?:\?|$)|\/api\/session|\/api\/v1\/auth\/oauth2\/(?:logout|start)|\/login\/callback|sz\.xpu\.edu\.cn\/auth2\/(?:login|oauth\/authorize)/i.test(url)
      ) {
        networkEvents.push({
          type: 'request',
          method: request.method(),
          url,
        });
      }
    });
    page.on('response', (response) => {
      const url = response.url();
      if (
        /\/logout|\/login(?:\?|$)|\/api\/session|\/api\/v1\/auth\/oauth2\/(?:logout|start)|\/login\/callback|sz\.xpu\.edu\.cn\/auth2\/(?:login|oauth\/authorize)/i.test(url)
      ) {
        networkEvents.push({
          type: 'response',
          status: response.status(),
          url,
        });
      }
    });
    const report: Record<string, unknown> = {
      account,
      webBaseUrl,
      returnTo,
      steps: [] as unknown[],
    };

    const pushStep = async (step: string) => {
      (report.steps as Array<Record<string, unknown>>).push({
        step,
        url: page.url(),
        title: await page.title().catch(() => ''),
        bodyPreview: await readBodyPreview(page),
      });
    };

    await page.goto(`${webBaseUrl}/login?returnTo=${encodeURIComponent(returnTo)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    await pushStep('after_open_login');

    await waitForLoggedIn(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await pushStep('after_login');

    const headerButton = page.locator('header button').first();
    await headerButton.click();
    await page.waitForTimeout(300);

    const logoutButton = page.getByRole('button', { name: '退出登录', exact: true });
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    const logoutFlowEventStartIndex = networkEvents.length;
    await logoutButton.click();
    const popup = await popupPromise;

    await page.waitForTimeout(3500);
    report.afterLogoutClick = {
      url: page.url(),
      title: await page.title().catch(() => ''),
      bodyPreview: await readBodyPreview(page),
    };
    await pushStep('after_logout_redirect_start');

    if (popup) {
      await popup.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
      if (!popup.isClosed()) {
        await popup.waitForTimeout(1000).catch(() => undefined);
      }
      report.logoutPopup = {
        finalUrl: popup.url(),
        closedAfterBridge: popup.isClosed(),
        title: await popup.title().catch(() => ''),
        bodyPreview: await readBodyPreview(popup),
      };
    } else {
      report.logoutPopup = {
        finalUrl: null,
        closedAfterBridge: null,
        title: null,
        bodyPreview: null,
      };
    }

    await waitForLoginPrompt(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await pushStep('after_logout_login_prompt');

    const promptText = `${await page.title().catch(() => '')} ${await readBodyPreview(page)}`;
    const sawLoginPromptAfterLogout = /账号登录|扫码登录|忘记密码|账号为工号或学号|密码/.test(promptText);
    report.sawLoginPromptAfterLogout = sawLoginPromptAfterLogout;

    const finalCookies = await context.cookies();
    const logoutFlowEvents = networkEvents.slice(logoutFlowEventStartIndex);
    const sawAutoReauth = logoutFlowEvents.some((event) => {
      const url = typeof event.url === 'string' ? event.url : '';
      return /\/api\/v1\/auth\/oauth2\/start|\/login\/callback|sz\.xpu\.edu\.cn\/auth2\/(?:login|oauth\/authorize)/i.test(url);
    });
    report.logoutFlowEvents = logoutFlowEvents;
    report.sawAutoReauth = sawAutoReauth;
    report.success = sawLoginPromptAfterLogout && sawAutoReauth;
    report.finalUrl = page.url();
    report.authSessionCookieCount = finalCookies.filter((cookie) => cookie.name === 'auth_session').length;

    const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `verify-xpu-frontend-logout-return-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    console.log(JSON.stringify({
      outputPath,
      success: report.success,
      finalUrl: report.finalUrl,
      logoutPopup: report.logoutPopup,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
