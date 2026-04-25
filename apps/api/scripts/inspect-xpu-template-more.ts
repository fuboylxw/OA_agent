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

const PAGE_SCAN_SCRIPT = String.raw`
(() => {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const links = Array.from(document.querySelectorAll('a'))
    .map((node) => ({
      text: normalize(node.textContent),
      href: node.getAttribute('href') || '',
      onclick: node.getAttribute('onclick') || '',
    }))
    .filter((item) => item.text || item.href || item.onclick)
    .slice(0, 300);
  return {
    url: window.location.href,
    title: document.title,
    bodyPreview: normalize(document.body?.innerText || '').slice(0, 4000),
    htmlPreview: normalize(document.documentElement?.outerHTML || '').slice(0, 20000),
    links,
  };
})()
`;

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

function tryParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function main() {
  loadRootEnv();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const fragmentId = String(getArg('--fragment-id', '4811300162721368479') || '4811300162721368479').trim();
  const ordinal = String(getArg('--ordinal', '0') || '0').trim();
  const portalUrl = 'https://sz.xpu.edu.cn/#/home?component=thirdScreen';
  const targetTourl = `/seeyon/common/template/dist/index.html?fragmentId=${encodeURIComponent(fragmentId)}&ordinal=${encodeURIComponent(ordinal)}`;

  const cookies = await requestLoginCookie(account);
  if (cookies.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    await context.addCookies(cookies.map(parseSetCookie));
    const page = await context.newPage();

    const sourceUrl = await captureSsoUrl(page, portalUrl);
    const bridgedUrl = new URL(sourceUrl);
    bridgedUrl.searchParams.set('tourl', targetTourl);
    await page.goto(bridgedUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(4000);

    const pageInfo = await page.evaluate(PAGE_SCAN_SCRIPT);

    const request = page.request;
    const endpoints = {
      configInfo: 'https://oa2023.xpu.edu.cn/seeyon/rest/template/myTemplate/config/info',
      menu: `https://oa2023.xpu.edu.cn/seeyon/rest/template/myTemplate/menu?option.n_a_s=1&fragmentId=${encodeURIComponent(fragmentId)}&ordinal=${encodeURIComponent(ordinal)}`,
      templates: `https://oa2023.xpu.edu.cn/seeyon/rest/template/myTemplate?option.n_a_s=1&fragmentId=${encodeURIComponent(fragmentId)}&ordinal=${encodeURIComponent(ordinal)}`,
    };

    const responses: Record<string, unknown> = {};
    for (const [key, url] of Object.entries(endpoints)) {
      const response = await request.get(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: `https://oa2023.xpu.edu.cn/seeyon/common/template/dist/index.html?fragmentId=${encodeURIComponent(fragmentId)}&ordinal=${encodeURIComponent(ordinal)}`,
        },
      });
      const bodyText = await response.text();
      responses[key] = {
        url,
        status: response.status(),
        body: tryParseJson(bodyText),
      };
    }

    const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `inspect-xpu-template-more-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({
      account,
      fragmentId,
      ordinal,
      sourceUrl,
      bridgedUrl: bridgedUrl.toString(),
      pageInfo,
      responses,
    }, null, 2));

    console.log(JSON.stringify({
      outputPath,
      pageUrl: pageInfo.url,
      title: pageInfo.title,
      bodyPreview: pageInfo.bodyPreview,
      responseStatuses: Object.fromEntries(
        Object.entries(responses).map(([key, value]) => [key, (value as any)?.status ?? null]),
      ),
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
