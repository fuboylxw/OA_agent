import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright';
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

type TemplateLink = {
  name: string;
  href: string;
  absoluteUrl: string;
  templateId: string;
};

type TemplateMoreAccess = {
  fragmentId: string;
  ordinal: string;
  relativeUrl: string;
  absoluteUrl: string;
};

type FieldSpec = {
  name: string;
  required: boolean;
  description?: string;
  example?: string;
  upload?: boolean;
  multiple?: boolean;
  options?: string[];
  sourceKinds?: string[];
};

type TemplateSpec = {
  template: TemplateLink;
  bodyPreview: string;
  fields: FieldSpec[];
};

const FIELD_SCAN_SCRIPT = String.raw`
(() => {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const clip = (value, max = 500) => {
    const text = normalize(value);
    return text.length > max ? text.slice(0, max) + '...' : text;
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && !(rect.width === 0 && rect.height === 0);
  };
  const labelFor = (element) => {
    const explicit = element.id ? document.querySelector('label[for="' + element.id + '"]') : null;
    const cell = element.closest('td, th');
    const row = element.closest('tr');
    const prevCell = cell && cell.previousElementSibling;
    const nextCell = cell && cell.nextElementSibling;
    const container = element.closest('.cap4-form-item, .ant-form-item, .el-form-item, [class*=field], [class*=item], [class*=cell], [class*=row], td, tr, div');
    const candidates = [
      explicit ? explicit.textContent : '',
      element.closest('label')?.textContent || '',
      container?.querySelector('label, .cap4-form-label, .fieldLabel, .form-label, .title')?.textContent || '',
      prevCell?.textContent || '',
      nextCell?.textContent || '',
      row?.querySelector('th, td')?.textContent || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.getAttribute('placeholder') || '',
      element.getAttribute('name') || '',
      element.id || '',
    ];
    const value = candidates.map(normalize).find(Boolean) || '';
    return value.replace(/[:：*＊]\s*$/g, '').trim();
  };
  const controls = Array.from(document.querySelectorAll('input, textarea, select'))
    .map((node, index) => {
      const element = node;
      const tagName = normalize(element.tagName).toLowerCase();
      const type = tagName === 'input'
        ? normalize(element.type || element.getAttribute('type') || 'text').toLowerCase()
        : tagName;
      const row = element.closest('tr');
      const cell = element.closest('td, th');
      const container = element.closest('.cap4-form-item, .ant-form-item, .el-form-item, [class*=field], [class*=item], [class*=cell], [class*=row], td, tr, div');
      const choiceText = [
        normalize(element.getAttribute('value')),
        normalize(element.nextElementSibling?.textContent),
        normalize(element.previousElementSibling?.textContent),
        normalize(cell?.textContent),
        normalize(row?.textContent),
      ].filter(Boolean);
      return {
        index,
        tagName,
        type,
        id: normalize(element.id),
        name: normalize(element.getAttribute('name')),
        label: labelFor(element),
        required: Boolean(('required' in element && element.required) || element.getAttribute('required') !== null),
        multiple: Boolean(('multiple' in element && element.multiple) || element.getAttribute('multiple') !== null),
        hidden: !visible(element),
        rowText: clip(row?.textContent || '', 1200),
        cellText: clip(cell?.textContent || '', 600),
        containerText: clip(container?.textContent || '', 800),
        options: tagName === 'select'
          ? Array.from(element.options || []).map((option) => normalize(option.textContent || option.label)).filter(Boolean)
          : [],
        choiceText,
      };
    });

  const titleCandidates = Array.from(document.querySelectorAll('h1,h2,h3,.cap4-title,.title,.form-title,.fieldTitle,legend,b,strong'))
    .map((node) => normalize(node.textContent))
    .filter(Boolean)
    .slice(0, 80);
  const rows = Array.from(document.querySelectorAll('tr'))
    .map((node) => clip(node.textContent || '', 1200))
    .filter(Boolean)
    .slice(0, 400);
  const customChoices = [
    ...Array.from(document.querySelectorAll('.cap4-checkbox__left')).map((node) => ({
      type: 'checkbox',
      text: normalize(node.textContent),
      rowText: clip(node.closest('tr')?.textContent || '', 1200),
      cellText: clip(node.closest('td,th')?.textContent || '', 600),
    })),
    ...Array.from(document.querySelectorAll('.cap4-radio__left')).map((node) => ({
      type: 'radio',
      text: normalize(node.textContent),
      rowText: clip(node.closest('tr')?.textContent || '', 1200),
      cellText: clip(node.closest('td,th')?.textContent || '', 600),
    })),
  ].filter((item) => item.text);

  return {
    url: window.location.href,
    title: document.title,
    titleCandidates,
    bodyPreview: normalize(document.body?.innerText || '').slice(0, 4000),
    controls: controls.slice(0, 500),
    rows,
    customChoices,
  };
})()
`;

const MAIN_PAGE_SCAN_SCRIPT = String.raw`
(() => {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const simplifyNav = (item) => {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const menuItems = Array.isArray(item.menu?.items)
      ? item.menu.items.map(simplifyNav).filter(Boolean)
      : [];
    const directItems = Array.isArray(item.items)
      ? item.items.map(simplifyNav).filter(Boolean)
      : [];
    return {
      id: item.id || '',
      navName: normalize(item.navName || ''),
      name: normalize(item.name || ''),
      url: normalize(item.url || item.menu?.url || ''),
      target: normalize(item.target || item.menu?.target || ''),
      resourceCode: normalize(item.resourceCode || ''),
      items: menuItems.length > 0 ? menuItems : directItems,
    };
  };
  const nodes = Array.from(document.querySelectorAll('*'))
    .map((element) => {
      const href = element.getAttribute('href') || '';
      const onclick = element.getAttribute('onclick') || '';
      const dataUrl = element.getAttribute('data-url') || '';
      const src = element.getAttribute('src') || '';
      const text = normalize(element.textContent);
      const title = normalize(element.getAttribute('title'));
      const outer = normalize(element.outerHTML);
      return {
        tagName: (element.tagName || '').toLowerCase(),
        text,
        href,
        onclick,
        dataUrl,
        src,
        title,
        outer: outer.slice(0, 800),
      };
    })
    .filter((item) => item.text || item.href || item.onclick || item.dataUrl || item.src);
  return {
    title: document.title,
    url: window.location.href,
    bodyPreview: normalize(document.body?.innerText || '').slice(0, 5000),
    htmlPreview: normalize(document.documentElement?.outerHTML || '').slice(0, 20000),
    nodes: nodes.slice(0, 20000),
    portalNavList: Array.isArray(window.vPortal?.portalNavList)
      ? window.vPortal.portalNavList.map(simplifyNav).filter(Boolean)
      : [],
  };
})()
`;

const MORE_PAGE_SCAN_SCRIPT = String.raw`
(() => {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  return {
    url: window.location.href,
    title: document.title,
    bodyPreview: normalize(document.body?.innerText || '').slice(0, 4000),
    htmlPreview: normalize(document.documentElement?.outerHTML || '').slice(0, 20000),
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

async function captureSsoUrl(page: Page, portalUrl: string) {
  const bridgePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for oa/info response')), 30000);
    page.on('response', async (response) => {
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

async function buildContext(account: string) {
  const cookies = await requestLoginCookie(account);
  if (cookies.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookies.map(parseSetCookie));
  return { browser, context };
}

async function openOaPage(context: BrowserContext, tourl: string) {
  const page = await context.newPage();
  const ssoSource = await captureSsoUrl(page, 'https://sz.xpu.edu.cn/#/home?component=thirdScreen');
  const ssoUrl = new URL(ssoSource);
  ssoUrl.searchParams.set('tourl', tourl);
  await page.goto(ssoUrl.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  return page;
}

async function openOaDirectPage(context: BrowserContext, url: string) {
  const page = await context.newPage();
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  return page;
}

async function captureMainPage(context: BrowserContext) {
  const page = await openOaPage(context, '/seeyon/main.do?method=main');
  const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
  fs.mkdirSync(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, `xpu-my-templates-main-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

  const info = await page.evaluate(MAIN_PAGE_SCAN_SCRIPT);

  return { page, screenshotPath, info };
}

function dedupe<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function scoreTemplateCandidate(item: TemplateLink) {
  let score = 0;
  const name = String(item.name || '').trim();
  const href = String(item.href || '').trim();
  if (href) {
    score += 20;
  }
  if (name && name.length <= 30) {
    score += 10;
  }
  if (name && !/\s/.test(name) && !name.includes('templateId=')) {
    score += 10;
  }
  if (/from=templateNewColl|from=bizconfig/i.test(item.absoluteUrl)) {
    score += 20;
  }
  if (!/网信处科长请假审批单 西安工程大学用印申请单/.test(name)) {
    score += 10;
  }
  return score;
}

function normalizeOaUrl(base: string, rawUrl: string) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return '';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('/seeyon/')) {
    return `${base}${trimmed}`;
  }
  if (trimmed.startsWith('/')) {
    return `${base}/seeyon${trimmed}`;
  }
  return `${base}/seeyon/${trimmed.replace(/^\/+/, '')}`;
}

function normalizeOaTourl(rawUrl: string) {
  const trimmed = String(rawUrl || '').trim().replace(/&amp;/g, '&');
  if (!trimmed) {
    return '';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith('/seeyon/')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `/seeyon${trimmed}`;
  }
  return `/seeyon/${trimmed.replace(/^\/+/, '')}`;
}

function extractTemplateMoreAccess(pageInfo: any): TemplateMoreAccess | null {
  const base = 'https://oa2023.xpu.edu.cn';
  const sources: string[] = [];

  const nodes = Array.isArray(pageInfo?.nodes) ? pageInfo.nodes : [];
  for (const node of nodes) {
    sources.push(
      String(node?.href || ''),
      String(node?.onclick || ''),
      String(node?.dataUrl || ''),
      String(node?.src || ''),
      String(node?.outer || ''),
    );
  }
  sources.push(String(pageInfo?.htmlPreview || ''));

  for (const source of sources) {
    if (!/\/common\/template\/dist\/index\.html/i.test(source)) {
      continue;
    }
    if (!/我的模板|templeteSection/i.test(source)) {
      continue;
    }

    const match = source.replace(/&amp;/g, '&').match(/\/common\/template\/dist\/index\.html\?[^'" )<>]+/i);
    if (!match) {
      continue;
    }

    const rawUrl = match[0];
    const fragmentId = rawUrl.match(/[?&]fragmentId=([^&#]+)/i)?.[1] || '';
    const ordinal = rawUrl.match(/[?&]ordinal=([^&#]+)/i)?.[1] || '0';
    if (!fragmentId) {
      continue;
    }

    const relativeUrl = normalizeOaTourl(rawUrl);
    return {
      fragmentId,
      ordinal,
      relativeUrl,
      absoluteUrl: normalizeOaUrl(base, rawUrl),
    };
  }

  return null;
}

async function readJsonResponse(page: Page, url: string, referer: string) {
  const response = await page.request.get(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Referer: referer,
    },
  });
  return {
    status: response.status(),
    body: await response.json().catch(async () => response.text()),
  };
}

function countTemplateCatalogItems(item: any) {
  if (Array.isArray(item?.allTemplateList) && item.allTemplateList.length > 0) {
    return item.allTemplateList.length;
  }
  if (Array.isArray(item?.templateList) && item.templateList.length > 0) {
    return item.templateList.length;
  }
  const explicit = Number(item?.templateTotalCount || item?.templateCount || 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const children = Array.isArray(item?.childCategoryList) ? item.childCategoryList : [];
  return children.reduce((total: number, child: any) => total + countTemplateCatalogItems(child), 0);
}

function parseTemplatesFromMoreResponse(payload: any) {
  const base = 'https://oa2023.xpu.edu.cn';
  const resultList = Array.isArray(payload?.data?.resultList) ? payload.data.resultList : [];
  const preferredRoot = resultList.find((item) => String(item?.name || '').trim() === '公共模板')
    || [...resultList].sort((left, right) => countTemplateCatalogItems(right) - countTemplateCatalogItems(left))[0];

  const templateItems = Array.isArray(preferredRoot?.allTemplateList) && preferredRoot.allTemplateList.length > 0
    ? preferredRoot.allTemplateList
    : (Array.isArray(preferredRoot?.childCategoryList) ? preferredRoot.childCategoryList : []).flatMap((child: any) => {
      if (Array.isArray(child?.allTemplateList) && child.allTemplateList.length > 0) {
        return child.allTemplateList;
      }
      return Array.isArray(child?.templateList) ? child.templateList : [];
    });

  return dedupe(templateItems
    .map((item: any) => {
      const templateId = String(item?.id || '').trim();
      if (!templateId) {
        return null;
      }
      const name = String(item?.subject || item?.tapSubject || item?.name || `模板${templateId}`)
        .replace(/\s+/g, ' ')
        .trim();
      return {
        name,
        href: '',
        absoluteUrl: `${base}/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=${encodeURIComponent(templateId)}&showTab=true`,
        templateId,
      } satisfies TemplateLink;
    })
    .filter((item: TemplateLink | null): item is TemplateLink => Boolean(item)), (item) => item.templateId);
}

async function fetchTemplatesFromMorePage(context: BrowserContext, access: TemplateMoreAccess) {
  const page = await openOaDirectPage(context, access.absoluteUrl);
  try {
    const pageInfo = await page.evaluate(MORE_PAGE_SCAN_SCRIPT);
    const endpoints = {
      configInfo: `${access.absoluteUrl.replace(/\/common\/template\/dist\/index\.html\?.*$/i, '')}/rest/template/myTemplate/config/info`,
      menu: `https://oa2023.xpu.edu.cn/seeyon/rest/template/myTemplate/menu?option.n_a_s=1&fragmentId=${encodeURIComponent(access.fragmentId)}&ordinal=${encodeURIComponent(access.ordinal)}`,
      templates: `https://oa2023.xpu.edu.cn/seeyon/rest/template/myTemplate?option.n_a_s=1&fragmentId=${encodeURIComponent(access.fragmentId)}&ordinal=${encodeURIComponent(access.ordinal)}`,
    };

    const [configInfo, menu, templatesResponse] = await Promise.all([
      readJsonResponse(page, endpoints.configInfo, access.absoluteUrl),
      readJsonResponse(page, endpoints.menu, access.absoluteUrl),
      readJsonResponse(page, endpoints.templates, access.absoluteUrl),
    ]);

    const templates = parseTemplatesFromMoreResponse(templatesResponse.body);
    return {
      access,
      pageInfo,
      responseStatuses: {
        configInfo: configInfo.status,
        menu: menu.status,
        templates: templatesResponse.status,
      },
      templates,
      templateCount: templates.length,
      categorySummary: Array.isArray((templatesResponse.body as any)?.data?.resultList)
        ? ((templatesResponse.body as any).data.resultList as any[])
          .map((item) => ({
            id: String(item?.id || ''),
            name: String(item?.name || ''),
            templateCount: countTemplateCatalogItems(item),
          }))
        : [],
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

function parseTemplatesFromPage(pageInfo: any) {
  const base = 'https://oa2023.xpu.edu.cn';
  const candidates: TemplateLink[] = [];
  const templateIdPattern = /templateId=([-0-9]+)/i;
  const jsPattern = /templateId['"]?\s*[:=]\s*['"]?([-0-9]+)/i;
  const sectionNamePattern = /sectionName['"]?\s*[:=]\s*['"]([^'"]+)['"]/i;
  const nodes = Array.isArray(pageInfo?.nodes) ? pageInfo.nodes : [];

  for (const node of nodes) {
    const href = String(node?.href || '');
    const onclick = String(node?.onclick || '');
    const dataUrl = String(node?.dataUrl || '');
    const src = String(node?.src || '');
    const text = String(node?.text || '').trim();
    const title = String(node?.title || '').trim();
    const source = [href, onclick, dataUrl, src, String(node?.outer || '')].join(' ');
    const hrefId = source.match(templateIdPattern)?.[1] || source.match(jsPattern)?.[1] || '';
    if (!hrefId) {
      continue;
    }

    const sectionName = source.match(sectionNamePattern)?.[1] || '';
    const name = sectionName || text || title || `模板${hrefId}`;
    const absoluteUrl = `${base}/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=${hrefId}&showTab=true`;
    candidates.push({
      name,
      href: href || onclick || dataUrl || src,
      absoluteUrl,
      templateId: hrefId,
    });
  }

  const htmlPreview = String(pageInfo?.htmlPreview || '');
  const matches = htmlPreview.match(/sectionName['"]?\s*[:=]\s*['"]([^'"]+)['"][^<>]{0,500}?templateId=([-0-9]+)/ig) || [];
  for (const item of matches) {
    const name = item.match(/sectionName['"]?\s*[:=]\s*['"]([^'"]+)['"]/i)?.[1] || '';
    const templateId = item.match(/templateId=([-0-9]+)/i)?.[1] || '';
    if (!templateId) {
      continue;
    }
    candidates.push({
      name: name || `模板${templateId}`,
      href: item,
      absoluteUrl: `${base}/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=${templateId}&showTab=true`,
      templateId,
    });
  }

  const walkNav = (item: any, chain: string[] = []) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const currentName = cleanFieldName(String(item.name || item.navName || ''));
    const nextChain = currentName ? [...chain, currentName] : chain;
    const url = String(item.url || '').trim();
    if (/\/collaboration\/collaboration\.do\?method=newColl/i.test(url)) {
      const absoluteUrl = normalizeOaUrl(base, url);
      const templateId = absoluteUrl.match(templateIdPattern)?.[1] || '';
      if (templateId) {
        candidates.push({
          name: currentName || nextChain[nextChain.length - 1] || `模板${templateId}`,
          href: url,
          absoluteUrl,
          templateId,
        });
      }
    }
    const items = Array.isArray(item.items) ? item.items : [];
    for (const child of items) {
      walkNav(child, nextChain);
    }
  };

  for (const item of Array.isArray(pageInfo?.portalNavList) ? pageInfo.portalNavList : []) {
    walkNav(item);
  }

  const merged = new Map<string, TemplateLink>();
  for (const candidate of candidates) {
    const key = candidate.templateId;
    if (!key) {
      continue;
    }
    const existing = merged.get(key);
    if (!existing || scoreTemplateCandidate(candidate) > scoreTemplateCandidate(existing)) {
      merged.set(key, candidate);
    }
  }

  const values = Array.from(merged.values());
  const bodyPreview = String(pageInfo?.bodyPreview || '');
  const myTemplateBlock = bodyPreview.match(/我的模板\s+(.+?)\s+我的收藏/);
  const myTemplateNames = myTemplateBlock
    ? myTemplateBlock[1].split(/\s+/).map((item) => item.trim()).filter(Boolean)
    : [];
  const myTemplateIdsInOrder = [
    '-9201641132331154753',
    '9155715239054624993',
    '-4191060420802230640',
    '6220489984720979478',
    '-5697409718530912999',
    '3006928887087450798',
    '7254305397930608847',
    '-2068759618606380036',
    '-4239229584131404859',
  ];
  const myTemplateNameMap = new Map<string, string>();
  for (let index = 0; index < Math.min(myTemplateIdsInOrder.length, myTemplateNames.length); index += 1) {
    myTemplateNameMap.set(myTemplateIdsInOrder[index], myTemplateNames[index]);
  }

  for (const item of values) {
    const recovered = myTemplateNameMap.get(item.templateId);
    if (recovered && (!item.name || /^模板-?\d+$/.test(item.name) || item.name.includes('templateId'))) {
      item.name = recovered;
    }
  }

  return values;
}

function cleanFieldName(input: string) {
  let normalized = input
    .replace(/^[A-Z]?\d+(?:\.\d+)+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[:：]/g, '')
    .replace(/[（(]\s*请勾选[^)）]*[)）]/g, '')
    .replace(/[（(].*?必填.*?[)）]/g, '')
    .replace(/\*+/g, '')
    .replace(/^[#№.\-_/\\\s]+/, '')
    .replace(/[#№.\-_/\\\s]+$/, '')
    .trim();

  const collapseRepeatedWhole = (value: string) => {
    let current = value;
    for (let index = 0; index < 4; index += 1) {
      const match = current.match(/^(.{2,30})\1$/);
      if (!match) {
        break;
      }
      current = match[1].trim();
    }
    return current;
  };

  normalized = collapseRepeatedWhole(normalized)
    .replace(/(.{2,20})\1/g, '$1')
    .replace(/\b([A-Za-z0-9\u4e00-\u9fa5\/、.\-]{2,20})\s+\1\b/g, '$1')
    .trim();

  if (/使用说明|审批意见|领导审批/.test(normalized)) {
    return '';
  }

  const attachmentParts = normalized.match(/[A-Za-z0-9\u4e00-\u9fa5\/、.\-]{2,20}(?:附件|资料|文档)/g);
  if (attachmentParts?.length) {
    const unique = dedupe(attachmentParts.map((item) => item.trim()), (item) => item);
    if (unique.length === 1) {
      normalized = unique[0];
    }
  }

  return normalized;
}

function isIgnoredFieldName(name: string, templateName: string) {
  const normalized = cleanFieldName(name);
  if (!normalized) {
    return true;
  }
  if (normalized.length < 2 || normalized.length > 40) {
    return true;
  }
  if (/^[-—–~]+$/.test(normalized)) {
    return true;
  }
  if (/^\d+$/.test(normalized)) {
    return true;
  }
  const ignoreNames = new Set([
    templateName,
    '标题',
    '关联项目',
    '流程',
    '预归档到',
    '跟踪',
    '允许操作',
    '态度',
    '意见',
    '流程期限',
    '提前提醒',
    '超期后重复提醒',
    '督办人员',
    '督办期限',
    '督办主题',
    '基本信息',
    '登记信息',
    '信访内容',
    '办理信息',
    '事项信息',
    '执行人员',
    '任务信息',
    '督办内容',
    '结项说明',
    '结项评审',
    '结项信息',
    '申请信息',
    '审批意见',
    '领导审批',
    '责任人员',
    '新建',
    '复制',
    '删除',
    '删除全部',
    '导入数据',
    '序号',
    '计划',
    '实际',
    '普通',
    '重要',
    '非常重要',
    '无',
    '查看流程',
    '发起人',
    '申请人',
    '登记人',
    '编制人',
    '姓名',
    '部门',
    '单位',
  ]);
  return ignoreNames.has(normalized);
}

function upsertField(
  map: Map<string, FieldSpec>,
  name: string,
  patch: Partial<FieldSpec> & { sourceKind?: string },
  templateName: string,
) {
  const normalized = cleanFieldName(name);
  if (isIgnoredFieldName(normalized, templateName)) {
    return;
  }

  const existing = map.get(normalized) || {
    name: normalized,
    required: false,
    options: [],
    sourceKinds: [],
  };
  existing.required = existing.required || Boolean(patch.required);
  existing.upload = existing.upload || Boolean(patch.upload) || /附件|资料|文档/.test(normalized);
  existing.multiple = existing.multiple || Boolean(patch.multiple);
  if (patch.description) {
    existing.description = patch.description;
  }
  if (patch.example) {
    existing.example = patch.example;
  }
  if (Array.isArray(patch.options) && patch.options.length > 0) {
    existing.options = dedupe(
      [...(existing.options || []), ...patch.options.map((item) => cleanFieldName(String(item || ''))).filter(Boolean)],
      (item) => item,
    );
  }
  if (patch.sourceKind) {
    existing.sourceKinds = dedupe([...(existing.sourceKinds || []), patch.sourceKind], (item) => item);
  }

  map.set(normalized, existing);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferFieldSpecs(report: any, templateName: string): FieldSpec[] {
  const controls = Array.isArray(report?.controls) ? report.controls : [];
  const bodyPreview = String(report?.bodyPreview || '');
  const rows = Array.isArray(report?.rows) ? report.rows.map((item: unknown) => String(item || '')) : [];
  const customChoices = Array.isArray(report?.customChoices) ? report.customChoices : [];
  const map = new Map<string, FieldSpec>();

  for (const control of controls) {
    const type = String(control?.type || '').toLowerCase();
    if (['hidden', 'button', 'submit', 'reset'].includes(type)) {
      continue;
    }
    const hidden = Boolean(control?.hidden);
    if (hidden && type !== 'file') {
      continue;
    }

    const rawLabel = cleanFieldName(String(control?.label || ''));
    if (!rawLabel || isIgnoredFieldName(rawLabel, templateName)) {
      continue;
    }

    if (type === 'checkbox' || type === 'radio') {
      const choiceText = Array.isArray(control?.choiceText) ? control.choiceText : [];
      const source = [
        String(control?.cellText || ''),
        String(control?.rowText || ''),
        String(control?.containerText || ''),
        ...choiceText.map((item: unknown) => String(item || '')),
      ].join(' ');
      const options = source
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => item !== rawLabel && !/^(是|否|男|女)$/.test(item))
        .filter((item) => item.length <= 20);
      upsertField(map, rawLabel, {
        required: Boolean(control?.required),
        upload: type === 'file',
        multiple: type === 'checkbox' || Boolean(control?.multiple),
        options,
        sourceKind: 'control',
      }, templateName);
      continue;
    }

    if (type === 'select') {
      const options = Array.isArray(control?.options)
        ? control.options.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [];
      upsertField(map, rawLabel, {
        required: Boolean(control?.required),
        upload: type === 'file',
        multiple: Boolean(control?.multiple),
        options: options.filter((item) => !/^请选择/.test(item)),
        sourceKind: 'control',
      }, templateName);
      continue;
    }

    upsertField(map, rawLabel, {
      required: Boolean(control?.required),
      upload: type === 'file',
      multiple: Boolean(control?.multiple),
      sourceKind: 'control',
    }, templateName);
  }

  const groupedCustomChoices = new Map<string, { type: string; rowText: string; options: string[] }>();
  for (const choice of customChoices) {
    const rowText = String(choice?.rowText || '').trim();
    const text = cleanFieldName(String(choice?.text || ''));
    const type = String(choice?.type || 'checkbox');
    if (!rowText || !text) {
      continue;
    }

    const key = `${type}::${rowText}`;
    const existing = groupedCustomChoices.get(key) || {
      type,
      rowText,
      options: [],
    };
    existing.options.push(text);
    groupedCustomChoices.set(key, existing);
  }

  for (const group of groupedCustomChoices.values()) {
    const options = dedupe(group.options, (item) => item);
    if (options.length === 0) {
      continue;
    }
    let labelText = group.rowText;
    const firstOption = options.find((item) => group.rowText.includes(item));
    if (firstOption) {
      labelText = group.rowText.slice(0, group.rowText.indexOf(firstOption));
    }
    labelText = cleanFieldName(labelText);
    if (!labelText) {
      continue;
    }
    upsertField(map, labelText, {
      options,
      multiple: group.type === 'checkbox' || /勾选|多选/.test(group.rowText),
      sourceKind: 'choice',
    }, templateName);
  }

  const colonLabels = Array.from(bodyPreview.matchAll(/([A-Za-z0-9\u4e00-\u9fa5\/、.\-]{2,30})[:：]/g))
    .map((match) => cleanFieldName(match[1]))
    .filter(Boolean);
  for (const label of colonLabels) {
    upsertField(map, label, { sourceKind: 'text' }, templateName);
  }

  const uploadMatches = Array.from(bodyPreview.matchAll(/([A-Za-z0-9\u4e00-\u9fa5\/、.\-]{2,30}(?:附件|资料|文档))/g))
    .map((match) => cleanFieldName(match[1]))
    .filter(Boolean);
  for (const label of uploadMatches) {
    upsertField(map, label, {
      upload: true,
      multiple: /附件|资料/.test(label),
      sourceKind: 'text',
    }, templateName);
  }

  for (const row of rows) {
    const trimmed = cleanFieldName(row);
    if (!trimmed || trimmed.length > 30) {
      continue;
    }
    if (/(附件|资料|文档)$/.test(trimmed)) {
      upsertField(map, trimmed, {
        upload: true,
        multiple: true,
        sourceKind: 'text',
      }, templateName);
    }
  }

  const fields = Array.from(map.values())
    .filter((item) => item.name.length >= 2)
    .filter((item) => !item.name.includes(templateName))
    .filter((item) => !isIgnoredFieldName(item.name, templateName))
    .filter((item) => !(item.name === '备注' && !item.sourceKinds?.includes('control')))
    .filter((item) => !(item.name === '岗位职务' && !item.sourceKinds?.includes('control')))
    .filter((item) => !(item.name === '评价等级' && item.options?.includes('是否通过')))
    .filter((item) => !(item.name === '事项' && !item.sourceKinds?.includes('control')))
    .filter((item) => !(item.name === '过程材料' && !item.sourceKinds?.includes('control')))
    .filter((item) => !(item.name === '参评人员' && !item.sourceKinds?.includes('control')));

  for (const field of fields) {
    if ((field.name.startsWith('是否') || /是否/.test(field.name)) && (!field.options || field.options.length === 0)) {
      const pattern = new RegExp(`${escapeRegExp(field.name)}\\s*[:：]?\\s*是\\s+否`);
      if (pattern.test(bodyPreview)) {
        field.options = ['是', '否'];
      }
    }
    field.description = field.upload
      ? `上传${field.name}对应的文件`
      : `填写${field.name}`;
    if (field.upload) {
      field.example = `${field.name}.pdf`;
    } else if (field.options?.length) {
      field.example = field.options.slice(0, Math.min(2, field.options.length)).join('、');
    } else if (/日期|时间/.test(field.name)) {
      field.example = '2026-04-25';
    } else if (/电话|手机|联系方式/.test(field.name)) {
      field.example = '13800000000';
    } else if (/地点|地址/.test(field.name)) {
      field.example = '西安市雁塔区';
    } else if (/原因|事由|内容|说明|名称/.test(field.name)) {
      field.example = `${field.name}示例`;
    } else {
      field.example = `${field.name}示例`;
    }
    if (!field.required && bodyPreview.includes(`${field.name}${field.name}`)) {
      field.required = true;
    }
  }

  return fields.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
}

async function extractTemplate(context: BrowserContext, template: TemplateLink): Promise<TemplateSpec> {
  const page = await openOaDirectPage(context, template.absoluteUrl);

  const targetFrame = page.frame({ name: 'zwIframe' }) || page.frames().find((frame) => /content\/content\.do/.test(frame.url())) || page.mainFrame();
  const report = await targetFrame.evaluate(FIELD_SCAN_SCRIPT).catch(async () => page.evaluate(FIELD_SCAN_SCRIPT));
  await page.close().catch(() => undefined);

  return {
    template,
    bodyPreview: String(report?.bodyPreview || ''),
    fields: inferFieldSpecs(report, template.name),
  };
}

function formatField(field: FieldSpec) {
  const parts = [
    `- ${field.name}`,
    field.required ? '必填' : '选填',
  ];
  if (field.description) {
    parts.push(`说明: ${field.description}`);
  }
  if (field.example) {
    parts.push(`示例: ${field.example}`);
  }
  if (field.upload) {
    parts.push('上传要求: 支持上传文件，未上传视为信息缺失');
  }
  if (field.options?.length) {
    parts.push(`可选值: ${field.options.join('、')}`);
  }
  if (field.multiple) {
    parts.push('可多选');
  }
  return parts.join(' | ');
}

function inferAction(field: FieldSpec) {
  if (field.upload) {
    return `上传 ${field.name}`;
  }
  if (field.options?.length && field.multiple) {
    return `勾选 ${field.name}`;
  }
  if (field.options?.length) {
    return `选择 ${field.name}`;
  }
  return `输入 ${field.name}`;
}

function buildOutput(templates: TemplateSpec[]) {
  const lines: string[] = [];
  lines.push('# 系统基本信息');
  lines.push('系统名称: 西安工程大学 OA');
  lines.push('认证入口: https://sz.xpu.edu.cn/');
  lines.push('系统网址: https://oa2023.xpu.edu.cn/');
  lines.push('适用对象: 老师和学生');
  lines.push('登录说明: 统一认证登录');
  lines.push('办理完成标志: 看到 保存待发成功 就结束');
  lines.push('');
  lines.push('# 共享步骤');
  lines.push('- 访问 https://sz.xpu.edu.cn/');
  lines.push('- 访问 https://oa2023.xpu.edu.cn/');
  lines.push('');

  for (const item of templates) {
    lines.push(`## 流程: ${item.template.name}`);
    lines.push(`描述: ${item.template.name}`);
    lines.push(`流程页面: ${item.template.absoluteUrl}`);
    lines.push('用户办理时需要补充的信息:');
    if (item.fields.length === 0) {
      lines.push('- 无法从当前页面自动稳定识别字段，建议人工补充');
    } else {
      for (const field of item.fields) {
        lines.push(formatField(field));
      }
    }
    lines.push('办理步骤:');
    lines.push(`- 访问 ${item.template.absoluteUrl}`);
    for (const field of item.fields) {
      lines.push(`- ${inferAction(field)}`);
    }
    lines.push('- 点击 保存待发');
    lines.push('- 看到 保存待发成功 就结束');
    lines.push('测试样例:');
    if (item.fields.length === 0) {
      lines.push('- 无');
    } else {
      for (const field of item.fields) {
        lines.push(`- ${field.name}: ${field.example || `${field.name}示例`}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

async function main() {
  loadRootEnv();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const mainOnly = String(getArg('--main-only', '') || '').trim() === 'true';
  const outputPath = path.resolve(
    process.cwd(),
    getArg('--output', '../../xpu_my_templates_url_example.txt') || '../../xpu_my_templates_url_example.txt',
  );

  const { browser, context } = await buildContext(account);
  try {
    const { page, screenshotPath, info } = await captureMainPage(context);
    const mainPageTemplates = parseTemplatesFromPage(info);
    const moreAccess = extractTemplateMoreAccess(info);
    const moreTemplates = moreAccess
      ? await fetchTemplatesFromMorePage(context, moreAccess)
      : null;
    const templates = moreTemplates?.templates?.length
      ? moreTemplates.templates
      : mainPageTemplates;
    const debugDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(debugDir, { recursive: true });
    const mainInfoPath = path.join(debugDir, `xpu-main-page-info-${Date.now()}.json`);
    fs.writeFileSync(mainInfoPath, JSON.stringify({
      account,
      screenshotPath,
      mainPageTemplateCount: mainPageTemplates.length,
      templateCount: templates.length,
      moreAccess,
      moreTemplates,
      templateCount: templates.length,
      templates,
      mainPageTemplates,
      info,
    }, null, 2));

    if (templates.length === 0) {
      throw new Error(`No template links detected from OA main page. Debug saved to ${mainInfoPath}`);
    }

    if (mainOnly) {
      await page.close().catch(() => undefined);
      console.log(JSON.stringify({
        account,
        templateCount: templates.length,
        moreAccess,
        mainInfoPath,
        templateNames: templates.map((item) => item.name),
      }, null, 2));
      return;
    }

    await page.close().catch(() => undefined);

    const results: TemplateSpec[] = [];
    for (const template of templates) {
      const spec = await extractTemplate(context, template);
      results.push(spec);
    }

    const content = buildOutput(results);
    fs.writeFileSync(outputPath, content, 'utf8');

    const debugPath = path.join(debugDir, `xpu-my-templates-export-${Date.now()}.json`);
    fs.writeFileSync(debugPath, JSON.stringify({
      account,
      templateCount: results.length,
      outputPath,
      mainInfoPath,
      templates: results,
    }, null, 2));

    console.log(JSON.stringify({
      account,
      templateCount: results.length,
      outputPath,
      mainInfoPath,
      debugPath,
      templateNames: results.map((item) => item.template.name),
    }, null, 2));
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
