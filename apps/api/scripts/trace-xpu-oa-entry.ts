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

async function clickText(page: any, text: string) {
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
      try {
        await target.scrollIntoViewIfNeeded().catch(() => undefined);
        await target.click({ timeout: 5000, force: true });
        return true;
      } catch {
        try {
          await target.dispatchEvent('click');
          return true;
        } catch {
          continue;
        }
      }
    }
  }

  return false;
}

async function main() {
  loadRootEnv();
  const account = getArg('--account', 'cloudcam');
  const portalUrl = getArg('--portal-url', 'https://sz.xpu.edu.cn/#/home?component=thirdScreen');
  const clickSequence = (getArg('--click-sequence', '服务篇,OA办公') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const cookies = await requestLoginCookie(String(account));
  if (cookies.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookies.map(parseSetCookie));
    const page = await context.newPage();
    const trace: Array<{ type: string; url?: string; method?: string; status?: number; text?: string }> = [];

    const recordUrl = (url: string) => /oa2023|seeyon|auth2|sz\.xpu/i.test(url);
    page.on('request', (request) => {
      const url = request.url();
      if (recordUrl(url)) {
        trace.push({ type: 'request', method: request.method(), url });
      }
    });
    page.on('response', (response) => {
      const url = response.url();
      if (recordUrl(url)) {
        trace.push({ type: 'response', status: response.status(), url });
      }
    });
    page.on('popup', (popup) => {
      trace.push({ type: 'popup', url: popup.url() });
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        if (recordUrl(url)) {
          trace.push({ type: 'navigate', url });
        }
      }
    });

    await page.goto(String(portalUrl), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(8000);

    const anchorsBeforeClick = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .map((anchor) => ({
        text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        href: anchor.getAttribute('href') || '',
      }))
      .filter((item) => item.text || item.href)
      .filter((item) => /oa|办公|seeyon|xpu/i.test(item.text) || /oa2023|seeyon/i.test(item.href))
      .slice(0, 200));

    const clickResults: Array<{ text: string; clicked: boolean; url: string; title: string }> = [];
    for (const text of clickSequence) {
      const clicked = await clickText(page, text);
      await page.waitForTimeout(5000);
      clickResults.push({
        text,
        clicked,
        url: page.url(),
        title: await page.title().catch(() => ''),
      });
    }

    const anchorsAfterClick = await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .map((anchor) => ({
        text: (anchor.textContent || '').replace(/\s+/g, ' ').trim(),
        href: anchor.getAttribute('href') || '',
      }))
      .filter((item) => item.text || item.href)
      .filter((item) => /oa|办公|seeyon|xpu/i.test(item.text) || /oa2023|seeyon/i.test(item.href))
      .slice(0, 200));

    const outputDir = path.resolve(process.cwd(), '../../.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const screenshotPath = path.join(outputDir, `trace-xpu-oa-entry-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(JSON.stringify({
      account,
      portalUrl,
      finalUrl: page.url(),
      title: await page.title(),
      anchorsBeforeClick,
      clickResults,
      anchorsAfterClick,
      trace: trace.slice(-200),
      screenshotPath,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
