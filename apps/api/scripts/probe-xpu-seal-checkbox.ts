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

async function captureSsoUrl(page: any, portalUrl: string) {
  const bridgePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for oa/info response')), 30000);
    page.on('response', async (response: any) => {
      try {
        if (!response.url().includes('/gate/lobby/api/oa/info')) {
          return;
        }
        const payload = await response.json();
        const source = String(payload?.data?.coordinateUrl || payload?.data?.workUrl || '').trim();
        if (!source) {
          throw new Error('oa/info did not return coordinateUrl/workUrl');
        }
        clearTimeout(timeout);
        resolve(source);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });

  await page.goto(portalUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  return bridgePromise;
}

async function inspectCheckbox(frame: any, fieldId: string) {
  return frame.evaluate((inputFieldId: string) => {
    const root = document.getElementById(inputFieldId);
    const section = root?.querySelector?.('.cap4-checkbox') || root?.querySelector?.('section') || root;
    const icon = root?.querySelector?.('.cap4-checkbox__icon .icon') || root?.querySelector?.('.cap4-checkbox__icon') || null;
    const clickable = root?.querySelector?.(
      '.cap4-checkbox__icon, .cap4-checkbox__cnt, .field-content, .field-content-wrapper, .cap4-checkbox, .cap4-checkbox__left',
    ) || root;
    return {
      fieldId: inputFieldId,
      rootHtml: root?.outerHTML || '',
      sectionClass: section?.getAttribute?.('class') || '',
      sectionText: String(section?.textContent || '').replace(/\s+/g, ' ').trim(),
      sectionAriaChecked: section?.getAttribute?.('aria-checked') || '',
      iconClass: icon?.getAttribute?.('class') || '',
      iconStyle: icon?.getAttribute?.('style') || '',
      clickableTag: clickable?.tagName || '',
      clickableClass: clickable?.getAttribute?.('class') || '',
      clickableText: String(clickable?.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  }, fieldId);
}

async function clickCheckbox(frame: any, fieldId: string, selector?: string) {
  if (selector) {
    await frame.locator(selector).click({ force: true, timeout: 5000 });
    return;
  }

  const locator = frame.locator(
    `#${fieldId} .cap4-checkbox__icon, #${fieldId} .cap4-checkbox__cnt, #${fieldId} .field-content, #${fieldId} .field-content-wrapper, #${fieldId} .cap4-checkbox, #${fieldId} .cap4-checkbox__left`,
  ).first();
  await locator.click({ force: true, timeout: 5000 });
}

async function waitForCap4Frame(page: any, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const frame = page.frames().find((item) =>
      item.url().includes('/common/cap4/template/display/pc/form/dist/index.html'));
    if (frame) {
      return frame;
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function main() {
  loadRootEnv();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const fieldId = String(getArg('--field-id', 'field0053_id') || 'field0053_id').trim();
  const selector = getArg('--selector');
  const skipClick = String(getArg('--skip-click', 'false') || 'false').trim().toLowerCase() === 'true';
  const portalUrl = 'https://sz.xpu.edu.cn/#/home?component=thirdScreen';
  const targetTourl = String(
    getArg(
      '--tourl',
      '/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=9155715239054624993&showTab=true',
    ) || '',
  ).trim();

  const cookieHeaders = await requestLoginCookie(account);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();

    const ssoUrl = await captureSsoUrl(page, portalUrl);
    const bridgedUrl = new URL(ssoUrl);
    bridgedUrl.searchParams.set('tourl', targetTourl);

    await page.goto(bridgedUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(5000);

    const frame = await waitForCap4Frame(page);
    if (!frame) {
      throw new Error('CAP4 frame not found');
    }

    const before = await inspectCheckbox(frame, fieldId);
    let after = before;
    let afterSecondClick = before;
    if (!skipClick) {
      await clickCheckbox(frame, fieldId, selector);
      await page.waitForTimeout(1000);
      after = await inspectCheckbox(frame, fieldId);
      await clickCheckbox(frame, fieldId, selector);
      await page.waitForTimeout(1000);
      afterSecondClick = await inspectCheckbox(frame, fieldId);
    }

    const output = {
      fieldId,
      selector: selector || null,
      skipClick,
      pageUrl: page.url(),
      frameUrl: frame.url(),
      before,
      after,
      afterSecondClick,
    };

    const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `probe-xpu-seal-checkbox-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ outputPath, output }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
