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

const INSPECT_FRAME_SCRIPT = String.raw`
(() => {
  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const truncate = (value, max = 400) => {
    const normalized = normalizeText(value);
    return normalized.length > max ? normalized.slice(0, max) + '...' : normalized;
  };
  const isHidden = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display === 'none'
      || style.visibility === 'hidden'
      || (rect.width === 0 && rect.height === 0);
  };
  const readLabel = (element) => {
    const explicit = element.id
      ? document.querySelector('label[for="' + element.id + '"]')
      : null;
    const closest = element.closest('label');
    const container = element.closest('.cap4-form-item, .ant-form-item, .el-form-item, td, tr, li, div');
    return normalizeText(
      (explicit && explicit.textContent)
      || (closest && closest.textContent)
      || (container && container.querySelector('label, .cap4-form-label, .form-label, .title, .fieldLabel')?.textContent)
      || element.getAttribute('aria-label')
      || element.getAttribute('title')
      || element.getAttribute('placeholder')
      || element.getAttribute('name')
      || element.getAttribute('id')
      || '',
    );
  };
  const readChoiceAliases = (element) => Array.from(new Set([
    normalizeText(element.getAttribute('value')),
    normalizeText(element.getAttribute('title')),
    normalizeText(element.getAttribute('aria-label')),
    normalizeText(element.nextElementSibling ? element.nextElementSibling.textContent : ''),
    normalizeText(element.previousElementSibling ? element.previousElementSibling.textContent : ''),
    readLabel(element),
  ].filter(Boolean)));
  const readDataset = (element) => {
    const entries = Object.entries(element.dataset || {}).filter(([, value]) => normalizeText(value));
    return Object.fromEntries(entries.slice(0, 20));
  };
  const controls = Array.from(document.querySelectorAll('input, textarea, select')).map((node, index) => {
    const element = node;
    const tagName = normalizeText(element.tagName).toLowerCase();
    const type = tagName === 'input'
      ? normalizeText(element.type || element.getAttribute('type') || 'text').toLowerCase()
      : tagName;
    const cell = element.closest('td, th');
    const row = element.closest('tr');
    const container = element.closest('[class*="field"], [class*="item"], [class*="cell"], [class*="row"], td, tr, div');
    const optionValues = tagName === 'select'
      ? Array.from(element.options || []).map((option) => ({
          label: normalizeText(option.textContent || option.label),
          value: normalizeText(option.value),
          selected: option.selected,
        })).filter((option) => option.label || option.value)
      : [];
    return {
      index,
      tagName,
      type,
      id: normalizeText(element.id),
      name: normalizeText(element.getAttribute('name')),
      className: normalizeText(element.className || ''),
      label: readLabel(element),
      placeholder: normalizeText(element.getAttribute('placeholder')),
      title: normalizeText(element.getAttribute('title')),
      ariaLabel: normalizeText(element.getAttribute('aria-label')),
      value: type === 'file' ? '' : normalizeText(element.value),
      checked: 'checked' in element ? Boolean(element.checked) : undefined,
      required: ('required' in element && Boolean(element.required))
        || element.getAttribute('required') !== null,
      multiple: ('multiple' in element && Boolean(element.multiple))
        || element.getAttribute('multiple') !== null,
      hidden: isHidden(element),
      dataAttrs: readDataset(element),
      nearbyText: normalizeText(element.parentElement ? element.parentElement.textContent : '').slice(0, 300),
      cellText: truncate(cell ? cell.textContent : '', 500),
      rowText: truncate(row ? row.textContent : '', 800),
      containerText: truncate(container ? container.textContent : '', 500),
      parentHtml: truncate(element.parentElement ? element.parentElement.outerHTML : '', 1000),
      elementHtml: truncate(element.outerHTML || '', 1000),
      choiceAliases: (type === 'checkbox' || type === 'radio') ? readChoiceAliases(element) : [],
      options: optionValues,
    };
  });
  const targetKeywords = [
    '文件类型、名称及份数',
    '用印附件',
    '用印类型',
    '党委公章',
    '学校公章',
    '书记签名章',
    '校长签名章',
    '单位介绍信',
    '事业单位法人证书',
    '校学术委员会主任章',
    '法人身份证复印件',
    '保存待发',
  ];
  const keywordMatches = Array.from(document.querySelectorAll('body *'))
    .map((node) => {
      const text = normalizeText(node.textContent);
      if (!text) {
        return null;
      }
      const matchedKeyword = targetKeywords.find((keyword) => text.includes(keyword));
      if (!matchedKeyword) {
        return null;
      }
      const element = node;
      const cell = element.closest('td, th');
      const row = element.closest('tr');
      return {
        keyword: matchedKeyword,
        tagName: normalizeText(element.tagName).toLowerCase(),
        id: normalizeText(element.id),
        className: normalizeText(element.className || ''),
        role: normalizeText(element.getAttribute('role')),
        name: normalizeText(element.getAttribute('name')),
        type: normalizeText(element.getAttribute('type')),
        title: normalizeText(element.getAttribute('title')),
        ariaLabel: normalizeText(element.getAttribute('aria-label')),
        ariaChecked: normalizeText(element.getAttribute('aria-checked')),
        dataAttrs: readDataset(element),
        hidden: isHidden(element),
        text: truncate(text, 500),
        cellText: truncate(cell ? cell.textContent : '', 500),
        rowText: truncate(row ? row.textContent : '', 1000),
        html: truncate(element.outerHTML || '', 1200),
      };
    })
    .filter(Boolean)
    .slice(0, 200);
  const groupedChoiceMap = new Map();
  controls
    .filter((control) => control.type === 'checkbox' || control.type === 'radio')
    .forEach((control) => {
      const key = [control.type, control.name || control.label || control.id || String(control.index)].join(':');
      const items = groupedChoiceMap.get(key) || [];
      items.push(control);
      groupedChoiceMap.set(key, items);
    });
  const groupedChoices = Array.from(groupedChoiceMap.entries()).map(([groupKey, items]) => ({
    groupKey,
    items: items.map((item) => ({
      label: item.label,
      id: item.id,
      name: item.name,
      value: item.value,
      checked: item.checked,
      choiceAliases: item.choiceAliases,
    })),
  }));
  const labels = Array.from(document.querySelectorAll('label'))
    .map((node) => normalizeText(node.textContent))
    .filter(Boolean)
    .slice(0, 80);
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((node) => ({
    id: node.id || '',
    name: node.name || '',
    className: node.className || '',
    ariaLabel: node.getAttribute('aria-label') || '',
    title: node.getAttribute('title') || '',
    hidden: isHidden(node),
  }));
  const attachmentTexts = Array.from(document.querySelectorAll('body *'))
    .map((node) => normalizeText(node.textContent))
    .filter((text) => text.includes('附件') || text.includes('上传') || text.includes('用印'))
    .slice(0, 80);
  return {
    url: window.location.href,
    title: document.title,
    labels,
    fileInputs,
    controls: controls.slice(0, 400),
    groupedChoices: groupedChoices.slice(0, 120),
    keywordMatches,
    attachmentTexts,
    bodyPreview: normalizeText(document.body ? document.body.textContent : '').slice(0, 2000),
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

async function main() {
  loadRootEnv();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const portalUrl = 'https://sz.xpu.edu.cn/#/home?component=thirdScreen';
  const targetTourl = '/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=9155715239054624993&showTab=true';

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

    const frames = page.frames();
    const report = {
      finalUrl: page.url(),
      title: await page.title().catch(() => ''),
      frameCount: frames.length,
      frames: [] as Array<Record<string, unknown>>,
    };

    for (const frame of frames) {
      const info = await frame.evaluate(INSPECT_FRAME_SCRIPT).catch((error: any) => ({
        url: frame.url(),
        error: error?.message || String(error),
      })) as Record<string, unknown>;

      (report.frames as Array<Record<string, unknown>>).push(info);
    }

    const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `inspect-xpu-seal-form-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ outputPath, report }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
