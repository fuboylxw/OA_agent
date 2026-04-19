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

async function main() {
  loadRootEnv();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const portalUrl = 'https://sz.xpu.edu.cn/#/home?component=thirdScreen';
  const targetTourl = '/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=9155715239054624993&showTab=true';

  const cookies = await requestLoginCookie(account);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    await context.addCookies(cookies.map(parseSetCookie));
    const page = await context.newPage();

    const ssoUrl = await captureSsoUrl(page, portalUrl);
    const bridgedUrl = new URL(ssoUrl);
    bridgedUrl.searchParams.set('tourl', targetTourl);

    await page.goto(bridgedUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(3000);

    const output = await page.evaluate(String.raw`(() => {
      var pickFunction = function (name) {
        var fn = window[name];
        return typeof fn === 'function' ? String(fn) : null;
      };
      var pickInputValue = function (id) {
        var element = document.getElementById(id);
        return element && typeof element.value === 'string' ? element.value : '';
      };
      var draftNames = Object.keys(window)
        .filter(function (key) { return /draft|save/i.test(key); })
        .sort()
        .slice(0, 120);
      return {
        url: window.location.href,
        title: document.title,
        functions: {
          toolbarsaveDraft_aClick: pickFunction('toolbarsaveDraft_aClick'),
          endSaveDraft: pickFunction('endSaveDraft'),
          saveWaitSendSuccessTip: pickFunction('saveWaitSendSuccessTip'),
          saveDraft: pickFunction('saveDraft'),
          _saveDraft: pickFunction('_saveDraft')
        },
        hiddenValues: {
          id: pickInputValue('id'),
          tId: pickInputValue('tId'),
          curTemId: pickInputValue('curTemId'),
          contentSaveId: pickInputValue('contentSaveId'),
          contentZWID: pickInputValue('contentZWID'),
          parentSummaryId: pickInputValue('parentSummaryId'),
          summaryId: pickInputValue('summaryId'),
          moduleId: pickInputValue('moduleId')
        },
        draftRelatedGlobals: draftNames
      };
    })()`);

    const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `probe-xpu-seal-draft-functions-${Date.now()}.json`);
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
