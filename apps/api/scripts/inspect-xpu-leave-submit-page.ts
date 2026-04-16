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
  const envPath = path.resolve(process.cwd(), '../../.env');
  if (!fs.existsSync(envPath)) {
    return;
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

function getArg(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

async function clickText(
  page: Awaited<ReturnType<typeof chromium.launch>> extends never ? never : any,
  text: string,
) {
  const candidates = [
    page.getByRole('button', { name: text, exact: true }),
    page.getByRole('link', { name: text, exact: true }),
    page.getByText(text, { exact: true }),
    page.locator(`text=${text}`),
  ];

  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 3); index += 1) {
      const target = locator.nth(index);
      const popupPromise = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);

      try {
        await target.scrollIntoViewIfNeeded().catch(() => undefined);
        await target.click({ timeout: 5000, force: true });
      } catch {
        try {
          await target.dispatchEvent('click');
        } catch {
          continue;
        }
      }

      const popup = await popupPromise;
      const nextPage = popup || page;
      await nextPage.waitForLoadState('domcontentloaded').catch(() => undefined);
      await nextPage.waitForTimeout(3000);
      return nextPage;
    }
  }

  return page;
}

async function main() {
  loadRootEnv();
  const account = getArg('--account', 'cloudcam');
  const targetUrl = getArg('--url', 'https://sz.xpu.edu.cn/#/home?component=thirdScreen');
  const cookies = await requestLoginCookie(String(account));
  if (cookies.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookies.map(parseSetCookie));
    const page = await context.newPage();
    await page.goto(String(targetUrl), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(8000);

    let currentPage = page;
    currentPage = await clickText(currentPage, '服务篇');
    currentPage = await clickText(currentPage, 'OA办公');
    currentPage = await clickText(currentPage, '网信处科长请假审批单');
    await currentPage.waitForTimeout(8000);

    const outputDir = path.resolve(process.cwd(), '../../.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const screenshotPath = path.join(outputDir, `leave-submit-${Date.now()}.png`);
    await currentPage.screenshot({ path: screenshotPath, fullPage: true });

    const buttonTexts = await currentPage.locator('button, a, [role="button"], .ant-btn, .el-button').allInnerTexts().catch(() => []);
    const importantTexts = await currentPage.locator('h1, h2, h3, .title, .ant-page-header-heading-title, .ant-tabs-tab, .el-tabs__item, .ant-alert-message, .ant-message-notice-content, .el-message').allInnerTexts().catch(() => []);
    const bodyPreview = (await currentPage.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 4000);

    const pageInfo = {
      title: await currentPage.title(),
      url: currentPage.url(),
      visibleButtons: [...new Set(buttonTexts.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 80),
      importantTexts: [...new Set(importantTexts.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 120),
      bodyPreview,
    };

    console.log(JSON.stringify({
      account,
      screenshotPath,
      ...pageInfo,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
