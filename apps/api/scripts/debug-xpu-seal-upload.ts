import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { sm2 } from 'sm-crypto';
import { PlaywrightBrowserEngineAdapter } from '../src/modules/browser-runtime/playwright-browser-engine';

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
  const candidatePaths = [
    path.resolve('/root/BPM_Agent/.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env'),
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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function extractSm2PrivateKeyHex(rawKey: string) {
  const exported = Buffer.from(rawKey.trim(), 'base64').toString('hex');
  const match = exported.match(/0201010420([0-9a-f]{64})/i);
  if (!match) throw new Error('Unable to extract SM2 private scalar');
  return match[1];
}

function buildSignedPayload(account: string) {
  const clientId = String(process.env.AUTH_OAUTH2_CLIENT_ID || '').trim();
  const privateKey = String(process.env.AUTH_OAUTH2_PRIVATE_KEY || '').trim();
  if (!clientId || !privateKey) throw new Error('Missing oauth env');
  const payload: Record<string, string> = {
    clientId,
    account,
    timestamp: String(Date.now()),
    nonceStr: crypto.randomBytes(10).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10),
  };
  const signSource = Object.entries(payload)
    .sort(([l], [r]) => l.localeCompare(r))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  payload.sign = sm2.doSignature(signSource, extractSm2PrivateKeyHex(privateKey), { der: true, hash: true });
  return payload;
}

async function requestLoginCookie(account: string) {
  const payload = buildSignedPayload(account);
  const pathWithQuery = `/auth2/api/v1/login?${new URLSearchParams(payload).toString()}`;
  return new Promise<string[]>((resolve, reject) => {
    const request = https.request({ hostname: 'sz.xpu.edu.cn', port: 443, method: 'GET', path: pathWithQuery }, (response) => {
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

async function captureSsoUrl(page: any, portalUrl: string) {
  const bridgePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for oa/info response')), 30000);
    page.on('response', async (response: any) => {
      try {
        if (!response.url().includes('/gate/lobby/api/oa/info')) return;
        const payload = await response.json();
        const source = String(payload?.data?.coordinateUrl || payload?.data?.workUrl || '').trim();
        if (!source) throw new Error('oa/info did not return coordinateUrl/workUrl');
        clearTimeout(timeout);
        resolve(source);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return bridgePromise;
}

async function describeLocator(locator: any) {
  const count = await locator.count().catch(() => 0);
  const items = [] as any[];
  for (let i = 0; i < count; i += 1) {
    const info = await locator.nth(i).evaluate((node: any) => ({
      tag: node.tagName,
      id: node.id || '',
      name: node.name || '',
      className: node.className || '',
      title: node.getAttribute?.('title') || '',
      ariaLabel: node.getAttribute?.('aria-label') || '',
      hidden: (node.offsetWidth === 0 && node.offsetHeight === 0)
        || getComputedStyle(node).display === 'none'
        || getComputedStyle(node).visibility === 'hidden',
      text: (node.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    })).catch((error: any) => ({ error: error?.message || String(error) }));
    items.push(info);
  }
  return { count, items };
}

function matchesUploadUrl(rawUrl: string) {
  return /fileupload\.do|attachment|upload|filemanager|v3xfile/i.test(String(rawUrl || ''));
}

function sanitizeRequestBody(rawBody: string | null | undefined) {
  if (!rawBody) {
    return null;
  }
  return String(rawBody).replace(/\s+/g, ' ').trim().slice(0, 1000);
}

async function readResponsePreview(response: any) {
  try {
    const headers = await response.allHeaders?.().catch(() => ({})) || {};
    const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
    if (contentType.includes('application/json') || contentType.includes('text/')) {
      const text = await response.text();
      return text.replace(/\s+/g, ' ').trim().slice(0, 800);
    }
  } catch {
    return null;
  }
  return null;
}

async function main() {
  loadRootEnv();
  const account = 'cloudcam';
  const portalUrl = 'https://sz.xpu.edu.cn/#/home?component=thirdScreen';
  const targetTourl = '/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=9155715239054624993&showTab=true';
  const uploadFile = '/root/BPM_Agent/uploads/attachments/raw/ef579753-62ca-4dfa-9eab-107b1add69d3.pdf';

  const cookieHeaders = await requestLoginCookie(account);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();
    const ssoUrl = await captureSsoUrl(page, portalUrl);
    const bridgedUrl = new URL(ssoUrl);
    bridgedUrl.searchParams.set('tourl', targetTourl);
    await page.goto(bridgedUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(5000);

    const frames = page.frames();
    const frameData = [] as any[];
    for (const frame of frames) {
      const inputs = await describeLocator(frame.locator('input[type="file"]'));
      frameData.push({
        url: frame.url(),
        title: await frame.title().catch(() => ''),
        inputs,
      });
    }

    const pageInputs = await describeLocator(page.locator('input[type="file"]'));
    const uploadTraffic: any[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!matchesUploadUrl(url)) {
        return;
      }
      uploadTraffic.push({
        type: 'request',
        method: request.method(),
        url,
        resourceType: request.resourceType(),
        postDataPreview: sanitizeRequestBody(request.postData()),
      });
    });
    page.on('response', async (response) => {
      const url = response.url();
      if (!matchesUploadUrl(url)) {
        return;
      }
      uploadTraffic.push({
        type: 'response',
        status: response.status(),
        url,
        preview: await readResponsePreview(response),
      });
    });

    const engine = new PlaywrightBrowserEngineAdapter();
    (engine as any).sessions.set('debug-upload', { browser, context, page });
    const tab: any = { uploads: [], extractedValues: {}, artifacts: {}, formValues: {} };
    let uploadError: string | null = null;
    try {
      await engine.upload(
        { sessionId: 'debug-upload' } as any,
        tab,
        { ref: 'upload-1', role: 'upload', fieldKey: 'field_2', label: '用印附件' } as any,
        uploadFile,
      );
    } catch (error: any) {
      uploadError = error?.message || String(error);
    }
    await page.waitForTimeout(5000);

    const pageStateAfterUpload = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('body *'))
        .map((node) => ((node.textContent || '').replace(/\s+/g, ' ').trim()))
        .filter(Boolean)
        .filter((text) => text.includes('.pdf') || text.includes('附件') || text.includes('上传'))
        .slice(0, 120);
      return {
        url: window.location.href,
        title: document.title,
        texts,
        bodyPreview: (document.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
      };
    }).catch((error: any) => ({
      error: error?.message || String(error),
    }));

    console.log(JSON.stringify({
      pageInputs,
      frameData,
      uploadError,
      uploadTraffic,
      pageStateAfterUpload,
      tab,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
