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

type ScenarioResult = {
  name: string;
  success: boolean;
  finalUrl: string;
  title: string;
  bodyPreview: string;
  zwIframe?: {
    url: string;
    bodyPreview: string;
  };
  oaCookies: string[];
  portalCookies: string[];
  matchedSignals: {
    titleIncludesNewPage: boolean;
    bodyHasSend: boolean;
    bodyHasSaveDraft: boolean;
    frameHasReasonField: boolean;
  };
  steps: Array<{
    step: string;
    requestedUrl: string;
    finalUrl: string;
    title: string;
    bodyPreview: string;
    acceptedAuthorize: boolean;
    portalCookies: string[];
    oaCookies: string[];
    xpuSessions: string[];
    sourceUrl?: string;
    resolvedSsoUrl?: string;
  }>;
  networkTrace: Array<{
    type: 'request' | 'response';
    method?: string;
    url: string;
    status?: number;
  }>;
};

type PreVisitStep = string | {
  kind: 'portal_oa_info_bridge';
  portalUrl: string;
  oaInfoUrl?: string;
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

function buildOauthAuthorizeUrl() {
  const baseUrl = String(process.env.AUTH_OAUTH2_BASE_URL || 'https://sz.xpu.edu.cn').trim().replace(/\/+$/, '');
  const clientId = String(process.env.AUTH_OAUTH2_CLIENT_ID || '').trim();
  const redirectUri = String(process.env.AUTH_OAUTH2_REDIRECT_URI || '').trim() || 'http://202.200.206.250/login/callback';
  const scope = String(process.env.AUTH_OAUTH2_SCOPE || 'client').trim() || 'client';
  if (!clientId) {
    throw new Error('Missing AUTH_OAUTH2_CLIENT_ID');
  }

  const authorizeUrl = new URL(`${baseUrl}/auth2/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', `codex-test-${Date.now()}`);
  return authorizeUrl.toString();
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

async function readBodyPreview(pageOrFrame: any) {
  return pageOrFrame.evaluate(() =>
    (document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600),
  ).catch(() => '');
}

async function maybeAcceptAuthorize(page: any) {
  let accepted = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const title = await page.title().catch(() => '');
    const bodyPreview = await readBodyPreview(page);
    const needsAuthorize = /用户信息授权|同意\/授权/.test(`${title} ${bodyPreview}`);
    if (!needsAuthorize) {
      break;
    }

    const candidates = [
      page.getByRole('button', { name: '同意/授权', exact: true }),
      page.getByText('同意/授权', { exact: true }),
      page.locator('text=同意/授权'),
    ];

    let clicked = false;
    for (const locator of candidates) {
      const count = await locator.count().catch(() => 0);
      if (!count) {
        continue;
      }
      try {
        await locator.first().click({ force: true, timeout: 5000 });
        clicked = true;
        accepted = true;
        break;
      } catch {
        try {
          await locator.first().dispatchEvent('click');
          clicked = true;
          accepted = true;
          break;
        } catch {
          continue;
        }
      }
    }

    if (!clicked) {
      break;
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
  }

  return accepted;
}

async function collectCookieState(context: any) {
  const allCookies = await context.cookies();
  const oaCookies = allCookies
    .filter((cookie: any) => String(cookie.domain || '').includes('oa2023.xpu.edu.cn'))
    .map((cookie: any) => `${cookie.name}=${cookie.value}`);
  const portalCookies = allCookies
    .filter((cookie: any) => String(cookie.domain || '').includes('sz.xpu.edu.cn'))
    .map((cookie: any) => `${cookie.name}=${cookie.value}`);
  const xpuSessions = portalCookies.filter((cookie: string) => cookie.startsWith('XPU-SESSION='));

  return {
    allCookies,
    oaCookies,
    portalCookies,
    xpuSessions,
  };
}

async function captureStepSnapshot(input: {
  step: string;
  requestedUrl: string;
  page: any;
  context: any;
  acceptedAuthorize: boolean;
  sourceUrl?: string;
  resolvedSsoUrl?: string;
}) {
  const cookies = await collectCookieState(input.context);

  return {
    step: input.step,
    requestedUrl: input.requestedUrl,
    finalUrl: input.page.url(),
    title: await input.page.title().catch(() => ''),
    bodyPreview: await readBodyPreview(input.page),
    acceptedAuthorize: input.acceptedAuthorize,
    portalCookies: cookies.portalCookies,
    oaCookies: cookies.oaCookies,
    xpuSessions: cookies.xpuSessions,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.resolvedSsoUrl ? { resolvedSsoUrl: input.resolvedSsoUrl } : {}),
  };
}

function toRelativeTarget(targetUrl: string, sourceUrl: string) {
  try {
    const target = new URL(targetUrl);
    const source = new URL(sourceUrl);
    if (target.origin === source.origin) {
      return `${target.pathname}${target.search}${target.hash}`;
    }
    return target.toString();
  } catch {
    return targetUrl;
  }
}

async function runGotoStep(input: {
  page: any;
  context: any;
  step: string;
  url: string;
}) {
  await input.page.goto(input.url, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await input.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
  await input.page.waitForTimeout(2500);
  const acceptedAuthorize = await maybeAcceptAuthorize(input.page);

  return captureStepSnapshot({
    step: input.step,
    requestedUrl: input.url,
    page: input.page,
    context: input.context,
    acceptedAuthorize,
  });
}

async function runPortalBridgeStep(input: {
  page: any;
  context: any;
  portalUrl: string;
  targetUrl: string;
  oaInfoUrl?: string;
  steps: ScenarioResult['steps'];
}) {
  const oaInfoPath = String(input.oaInfoUrl || '').trim() || '/gate/lobby/api/oa/info';
  const oaInfoPromise = input.page.waitForResponse(
    (response: any) => String(response?.url?.() || '').includes(oaInfoPath),
    { timeout: 30000 },
  );

  const portalSnapshot = await runGotoStep({
    page: input.page,
    context: input.context,
    step: 'portal_bridge_portal',
    url: input.portalUrl,
  });
  input.steps.push(portalSnapshot);

  const oaInfoResponse = await oaInfoPromise;
  const oaInfo = await oaInfoResponse.json().catch(() => null);
  const sourceUrl = String(
    oaInfo?.data?.coordinateUrl
    || oaInfo?.data?.workUrl
    || oaInfo?.coordinateUrl
    || oaInfo?.workUrl
    || '',
  ).trim();
  if (!sourceUrl) {
    throw new Error(`Portal OA info did not contain coordinateUrl/workUrl: ${JSON.stringify(oaInfo)}`);
  }

  const resolvedSsoUrl = new URL(sourceUrl);
  resolvedSsoUrl.searchParams.set('tourl', toRelativeTarget(input.targetUrl, sourceUrl));
  const ssoSnapshot = await runGotoStep({
    page: input.page,
    context: input.context,
    step: 'portal_bridge_sso',
    url: resolvedSsoUrl.toString(),
  });
  input.steps.push({
    ...ssoSnapshot,
    sourceUrl,
    resolvedSsoUrl: resolvedSsoUrl.toString(),
  });
}

async function runScenario(input: {
  name: string;
  account: string;
  targetUrl: string;
  preVisitUrls?: PreVisitStep[];
}) : Promise<ScenarioResult> {
  const cookieHeaders = await requestLoginCookie(String(input.account));
  if (cookieHeaders.length === 0) {
    throw new Error(`No cookies returned from whitelist login for scenario ${input.name}`);
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();
    const networkTrace: ScenarioResult['networkTrace'] = [];
    const steps: ScenarioResult['steps'] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (!/sz\.xpu\.edu\.cn|oa2023\.xpu\.edu\.cn|seeyon\/login\/sso/i.test(url)) {
        return;
      }
      networkTrace.push({
        type: 'request',
        method: request.method(),
        url,
      });
    });

    page.on('response', (response) => {
      const url = response.url();
      if (!/sz\.xpu\.edu\.cn|oa2023\.xpu\.edu\.cn|seeyon\/login\/sso/i.test(url)) {
        return;
      }
      networkTrace.push({
        type: 'response',
        url,
        status: response.status(),
      });
    });

    for (const [index, preVisitStep] of (input.preVisitUrls || []).entries()) {
      if (typeof preVisitStep === 'string') {
        steps.push(await runGotoStep({
          page,
          context,
          step: `previsit_${index + 1}`,
          url: preVisitStep,
        }));
        continue;
      }

      if (preVisitStep.kind === 'portal_oa_info_bridge') {
        await runPortalBridgeStep({
          page,
          context,
          portalUrl: preVisitStep.portalUrl,
          targetUrl: input.targetUrl,
          oaInfoUrl: preVisitStep.oaInfoUrl,
          steps,
        });
      }
    }

    steps.push(await runGotoStep({
      page,
      context,
      step: 'target',
      url: input.targetUrl,
    }));

    const title = await page.title().catch(() => '');
    const bodyPreview = await readBodyPreview(page);
    const zwIframe = page.frame({ name: 'zwIframe' });
    const zwIframeBody = zwIframe ? await readBodyPreview(zwIframe) : '';
    const frameUrl = zwIframe?.url() || '';
    const cookies = await collectCookieState(context);

    const matchedSignals = {
      titleIncludesNewPage: title.includes('新建页面'),
      bodyHasSend: bodyPreview.includes('发送'),
      bodyHasSaveDraft: bodyPreview.includes('保存待发'),
      frameHasReasonField: /请假事由|field0004/.test(zwIframeBody),
    };

    return {
      name: input.name,
      success: matchedSignals.titleIncludesNewPage
        || matchedSignals.bodyHasSend
        || matchedSignals.bodyHasSaveDraft
        || matchedSignals.frameHasReasonField,
      finalUrl: page.url(),
      title,
      bodyPreview,
      zwIframe: zwIframe
        ? {
            url: frameUrl,
            bodyPreview: zwIframeBody,
          }
        : undefined,
      oaCookies: cookies.oaCookies,
      portalCookies: cookies.portalCookies,
      matchedSignals,
      steps,
      networkTrace,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  loadRootEnv();
  const account = getArg('--account', 'cloudcam');
  const portalUrl = getArg('--portal-url', 'https://sz.xpu.edu.cn/');
  const targetUrl = getArg(
    '--target-url',
    'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true',
  );
  const authorizeUrl = buildOauthAuthorizeUrl();

  const scenarios = [
    await runScenario({
      name: 'cookie_only_direct',
      account: String(account),
      targetUrl,
      preVisitUrls: [],
    }),
    await runScenario({
      name: 'portal_then_direct',
      account: String(account),
      targetUrl,
      preVisitUrls: [portalUrl],
    }),
    await runScenario({
      name: 'portal_then_oa_home_then_direct',
      account: String(account),
      targetUrl,
      preVisitUrls: [
        portalUrl,
        'https://oa2023.xpu.edu.cn/',
      ],
    }),
    await runScenario({
      name: 'oauth_authorize_then_direct',
      account: String(account),
      targetUrl,
      preVisitUrls: [authorizeUrl],
    }),
    await runScenario({
      name: 'portal_then_oauth_authorize_then_direct',
      account: String(account),
      targetUrl,
      preVisitUrls: [portalUrl, authorizeUrl],
    }),
    await runScenario({
      name: 'portal_bridge_then_direct',
      account: String(account),
      targetUrl,
      preVisitUrls: [{
        kind: 'portal_oa_info_bridge',
        portalUrl,
      }],
    }),
  ];

  const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `verify-xpu-frontend-direct-url-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({
    account,
    portalUrl,
    targetUrl,
    authorizeUrl,
    generatedAt: new Date().toISOString(),
    scenarios,
  }, null, 2));

  console.log(JSON.stringify({
    outputPath,
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      success: scenario.success,
      finalUrl: scenario.finalUrl,
      title: scenario.title,
      matchedSignals: scenario.matchedSignals,
      oaCookies: scenario.oaCookies,
      zwIframeUrl: scenario.zwIframe?.url,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
