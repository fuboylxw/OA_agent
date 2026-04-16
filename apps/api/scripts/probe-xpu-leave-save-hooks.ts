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

async function installHooks(page: any) {
  await page.addInitScript(() => {
    const captured: Array<Record<string, any>> = [];
    const snapshotForms = () => Array.from(document.forms).map((form, index) => ({
      index,
      id: form.id || `form-${index + 1}`,
      action: form.getAttribute('action') || '',
      method: form.getAttribute('method') || '',
      fields: Array.from(new FormData(form).entries()).map(([key, value]) => [key, typeof value === 'string' ? value : value.name]),
    }));

    (window as any).__captureHooks = captured;
    (window as any).__captureFormSnapshot = snapshotForms;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      captured.push({
        type: 'fetch',
        url,
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body.slice(0, 5000) : undefined,
      });
      if (/collaboration\.do\?method=send/i.test(url)) {
        return new Response('', { status: 204 });
      }
      return originalFetch(input, init);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL) {
      (this as any).__captureRequestMeta = {
        method,
        url: String(url),
      };
      return originalOpen.apply(this, arguments as any);
    };
    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = (this as any).__captureRequestMeta || {};
      captured.push({
        type: 'xhr',
        url: meta.url || '',
        method: meta.method || 'GET',
        body: typeof body === 'string' ? body.slice(0, 5000) : undefined,
      });
      if (/collaboration\.do\?method=send/i.test(String(meta.url || ''))) {
        try {
          this.abort();
        } catch {}
        return undefined as any;
      }
      return originalSend.apply(this, arguments as any);
    };

    const wrapFunction = (name: string) => {
      const target = (window as any)[name];
      if (typeof target !== 'function') {
        return;
      }
      (window as any)[name] = function (...args: any[]) {
        captured.push({
          type: 'function',
          name,
          args: args.map((arg) => {
            if (arg === undefined || arg === null) return arg;
            if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') return arg;
            return Object.prototype.toString.call(arg);
          }),
          forms: snapshotForms(),
        });
        return undefined;
      };
    };

    [
      'saveDraft',
      '_saveDraft',
      'sendCollaboration',
      '_sendCollaboration',
      'handleAndSubmit',
      'beforeSubmit',
      '__preSubmitFormContent',
      'saveWaitSendSuccessTip',
    ].forEach(wrapFunction);

    const originalSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      captured.push({
        type: 'form.submit',
        action: this.getAttribute('action') || '',
        method: this.getAttribute('method') || '',
        fields: Array.from(new FormData(this).entries()).map(([key, value]) => [key, typeof value === 'string' ? value : value.name]),
      });
      return undefined as any;
    };

    (window as any).__restoreSubmit = () => {
      HTMLFormElement.prototype.submit = originalSubmit;
    };
  });
}

async function main() {
  loadRootEnv();
  const account = getArg('--account', 'cloudcam');
  const portalUrl = getArg('--portal-url', 'https://sz.xpu.edu.cn/#/home?component=thirdScreen');
  const actionLabel = getArg('--action-label', '保存待发');
  const targetTourl = getArg(
    '--tourl',
    '/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true',
  );
  const cookies = await requestLoginCookie(String(account));
  if (cookies.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookies.map(parseSetCookie));
    const page = await context.newPage();
    const networkEvents: Array<Record<string, any>> = [];
    await installHooks(page);
    page.on('response', async (response) => {
      const url = response.url();
      if (!/ajax\.do|collaboration\.do|WFAjax|colManager/i.test(url)) {
        return;
      }
      try {
        const contentType = response.headers()['content-type'] || '';
        let body: any = undefined;
        if (contentType.includes('application/json') || contentType.includes('text/json')) {
          body = await response.json();
        } else if (contentType.includes('text') || contentType.includes('xml') || contentType.includes('html')) {
          body = (await response.text()).slice(0, 5000);
        }
        networkEvents.push({
          url,
          status: response.status(),
          contentType,
          body,
        });
      } catch (error: any) {
        networkEvents.push({
          url,
          status: response.status(),
          error: error?.message || String(error),
        });
      }
    });

    const ssoSource = await captureSsoUrl(page, portalUrl);
    const ssoUrl = new URL(ssoSource);
    ssoUrl.searchParams.set('tourl', targetTourl);
    await page.goto(ssoUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const contentFrame = page.frame({ name: 'zwIframe' });
    if (!contentFrame) {
      throw new Error('zwIframe not found');
    }

    await contentFrame.evaluate(() => {
      const values: Record<string, string> = {
        field0004: '出差开会',
        field0005: '2026-04-20',
        field0006: '2026-04-21',
        field0007: '西安',
        field0008: '18291622202',
        field0012: '2026-04-22',
      };

      for (const [id, value] of Object.entries(values)) {
        const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!input) {
          continue;
        }
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const actionButton = page.getByText(actionLabel, { exact: true }).first();
    await actionButton.click({ force: true, timeout: 5000 }).catch(async () => {
      await actionButton.dispatchEvent('click');
    });
    await page.waitForTimeout(3000);

    const hookData = await page.evaluate(() => ({
      hooks: (window as any).__captureHooks || [],
      forms: (window as any).__captureFormSnapshot ? (window as any).__captureFormSnapshot() : [],
    }));

    const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `xpu-leave-save-hooks-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({
      account,
      portalUrl,
      targetTourl,
      resolvedSsoUrl: ssoUrl.toString(),
      hookData,
      networkEvents,
    }, null, 2));

    console.log(JSON.stringify({
      outputPath,
      actionLabel,
      hookCount: hookData.hooks.length,
      formCount: hookData.forms.length,
      networkEventCount: networkEvents.length,
      hooks: hookData.hooks.slice(0, 10),
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
