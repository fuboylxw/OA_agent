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

type JsonRecord = Record<string, any>;

const TERMINAL_JOB_STATUSES = new Set([
  'PUBLISHED',
  'PARTIALLY_PUBLISHED',
  'FAILED',
  'VALIDATION_FAILED',
  'MANUAL_REVIEW',
]);

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
  if (!clientId) throw new Error('Missing AUTH_OAUTH2_CLIENT_ID');
  if (!privateKey) throw new Error('Missing AUTH_OAUTH2_PRIVATE_KEY');

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
    if (key === 'path' && value) cookie.path = value;
    if (key === 'secure') cookie.secure = true;
    if (key === 'httponly') cookie.httpOnly = true;
  }

  return cookie;
}

async function readBodyPreview(page: any, limit = 1500) {
  return page.evaluate((inputLimit: number) => {
    return (document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, inputLimit);
  }, limit).catch(() => '');
}

async function maybeAcceptAuthorize(page: any) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const title = await page.title().catch(() => '');
    const bodyPreview = await readBodyPreview(page, 1200);
    if (!/用户信息授权|同意\/授权/.test(`${title} ${bodyPreview}`)) {
      return false;
    }

    const candidates = [
      page.getByRole('button', { name: '同意/授权', exact: true }),
      page.getByText('同意/授权', { exact: true }),
      page.locator('text=同意/授权'),
    ];

    for (const locator of candidates) {
      const count = await locator.count().catch(() => 0);
      if (!count) continue;
      try {
        await locator.first().click({ force: true, timeout: 5000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
        await page.waitForTimeout(2000);
        return true;
      } catch {
        continue;
      }
    }
  }

  return false;
}

async function ensureFrontendSession(context: any, page: any, webBaseUrl: string, returnTo: string) {
  await page.goto(`${webBaseUrl}/login?returnTo=${encodeURIComponent(returnTo)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(2000);
  await maybeAcceptAuthorize(page);
  if (/\/login(?:[?#]|$)/.test(page.url())) {
    await page.goto(`${webBaseUrl}/api/v1/auth/oauth2/start?returnTo=${encodeURIComponent(returnTo)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    await maybeAcceptAuthorize(page);
  }

  for (let index = 0; index < 12; index += 1) {
    const currentUrl = page.url();
    if (currentUrl.includes(returnTo) || /\/chat(?:[?#]|$)/.test(currentUrl)) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  const authSession = (await context.cookies()).find((cookie: any) => cookie.name === 'auth_session');
  const sessionToken = await page.evaluate(() => {
    try {
      return localStorage.getItem('sessionToken') || '';
    } catch {
      return '';
    }
  }).catch(() => '');
  if (!authSession && !sessionToken) {
    throw new Error(`Frontend session was not established (missing auth_session cookie and sessionToken). Current URL: ${page.url()}`);
  }
}

function extractExpectedProcessNamesFromGuide(content: string) {
  const lines = content.split(/\r?\n/);
  const names: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(?:##\s*)?流程\s*[:：]\s*(.+?)\s*$/);
    if (!match) continue;
    const name = match[1].trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  return names;
}

async function fetchJson(url: string, sessionToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });

  return {
    status: response.status,
    data: await response.json().catch(() => null),
  };
}

async function waitForBootstrapJobResult(input: {
  apiBaseUrl: string;
  sessionToken: string;
  jobId: string;
}) {
  const deadline = Date.now() + 300000;
  let lastJob: JsonRecord | null = null;
  let lastReport: JsonRecord | null = null;

  while (Date.now() < deadline) {
    const jobResponse = await fetchJson(`${input.apiBaseUrl}/bootstrap/jobs/${input.jobId}`, input.sessionToken);
    lastJob = jobResponse.data && typeof jobResponse.data === 'object'
      ? jobResponse.data as JsonRecord
      : null;

    const reportResponse = await fetchJson(`${input.apiBaseUrl}/bootstrap/jobs/${input.jobId}/report`, input.sessionToken);
    lastReport = reportResponse.data && typeof reportResponse.data === 'object'
      ? reportResponse.data as JsonRecord
      : null;

    if (lastJob?.status && TERMINAL_JOB_STATUSES.has(String(lastJob.status))) {
      return {
        job: lastJob,
        report: lastReport,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return {
    job: lastJob,
    report: lastReport,
  };
}

async function waitForPublishedProcesses(input: {
  apiBaseUrl: string;
  sessionToken: string;
  connectorId: string;
  processNames: string[];
}) {
  const deadline = Date.now() + 180000;
  let latestList: any[] = [];

  while (Date.now() < deadline) {
    const response = await fetchJson(`${input.apiBaseUrl}/process-library`, input.sessionToken);
    latestList = Array.isArray(response.data) ? response.data : [];
    const matched = latestList.filter((item) =>
      item?.connector?.id === input.connectorId
      && input.processNames.includes(String(item?.processName || '')),
    );

    if (matched.length >= input.processNames.length) {
      return matched;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return latestList.filter((item) =>
    item?.connector?.id === input.connectorId
    && input.processNames.includes(String(item?.processName || '')),
  );
}

async function countExactText(page: any, value: string) {
  return page.getByText(value, { exact: true }).count().catch(() => 0);
}

async function main() {
  loadRootEnv();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const webBaseUrl = String(
    getArg('--web-base-url', process.env.PUBLIC_WEB_BASE_URL || 'http://202.200.206.250'),
  ).trim().replace(/\/+$/, '');
  const apiBaseUrl = `${webBaseUrl}/api/v1`;
  const exampleFile = path.resolve(
    process.cwd(),
    String(getArg('--example-file', '/root/BPM_Agent/url_example.txt') || '/root/BPM_Agent/url_example.txt').trim(),
  );
  const connectorName = String(
    getArg('--connector-name', `URL示例前端验收-${Date.now()}`) || `URL示例前端验收-${Date.now()}`,
  ).trim();
  const connectorBaseUrl = String(
    getArg('--oa-url', 'https://oa2023.xpu.edu.cn/') || 'https://oa2023.xpu.edu.cn/',
  ).trim();

  if (!fs.existsSync(exampleFile)) {
    throw new Error(`Example file not found: ${exampleFile}`);
  }

  const exampleContent = fs.readFileSync(exampleFile, 'utf8');
  const expectedProcessNames = extractExpectedProcessNamesFromGuide(exampleContent);
  if (expectedProcessNames.length === 0) {
    throw new Error(`Could not extract any process names from example file: ${exampleFile}`);
  }

  const report: JsonRecord = {
    generatedAt: new Date().toISOString(),
    account,
    webBaseUrl,
    apiBaseUrl,
    exampleFile,
    connectorName,
    connectorBaseUrl,
    expectedProcessNames,
    steps: {},
    assertions: {},
    success: false,
  };

  const cookieHeaders = await requestLoginCookie(account);
  if (cookieHeaders.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();

    await ensureFrontendSession(context, page, webBaseUrl, '/bootstrap');
    await page.goto(`${webBaseUrl}/bootstrap`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);

    const sessionToken = String(await page.evaluate(() => localStorage.getItem('sessionToken') || ''));
    if (!sessionToken) {
      throw new Error('Frontend sessionToken is missing from localStorage');
    }

    report.steps.bootstrapPage = {
      url: page.url(),
      bodyPreview: await readBodyPreview(page),
    };

    await page.getByRole('button', { name: /新建任务/ }).click();
    await page.getByText('新建初始化任务', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    report.steps.createModal = {
      bodyPreview: await readBodyPreview(page),
    };

    await page.getByRole('button', { name: /链接直达接入/ }).click();
    await page.locator('label:has-text("系统名称（选填）") + input').fill(connectorName);
    await page.locator('label:has-text("系统网址（必填）") + input').fill(connectorBaseUrl);
    await page.locator('label:has-text("适用身份范围（必填）") + select').selectOption('both');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(exampleFile);

    const flowTextarea = page.locator('textarea').first();
    await page.waitForFunction((expectedNames: string[]) => {
      const textarea = document.querySelector('textarea');
      const value = textarea ? (textarea as HTMLTextAreaElement).value : '';
      return Boolean(
        textarea
        && expectedNames.every((name) => value.includes(name)),
      );
    }, expectedProcessNames, { timeout: 15000 });

    const textareaValue = await flowTextarea.inputValue();
    report.steps.modalFilled = {
      connectorName,
      connectorBaseUrl,
      textareaPreview: textareaValue.slice(0, 600),
      textareaLength: textareaValue.length,
    };

    const createResponsePromise = page.waitForResponse(
      (response: any) =>
        response.url().startsWith(`${webBaseUrl}/api/v1/bootstrap/jobs`)
        && response.request().method() === 'POST',
      { timeout: 90000 },
    );

    await page.getByRole('button', { name: '创建任务', exact: true }).click();

    const createResponse = await createResponsePromise;
    const createData = await createResponse.json().catch(() => null);
    report.steps.createJob = {
      status: createResponse.status(),
      data: createData,
    };

    if (!createData?.id) {
      throw new Error(`Bootstrap create did not return job id: ${JSON.stringify(createData)}`);
    }

    const jobResult = await waitForBootstrapJobResult({
      apiBaseUrl,
      sessionToken,
      jobId: String(createData.id),
    });

    const connectorId = String(jobResult.job?.connectorId || '').trim();
    if (!connectorId) {
      throw new Error(`Bootstrap job did not publish a connector. Job: ${JSON.stringify(jobResult.job)}`);
    }

    const publishedProcesses = await waitForPublishedProcesses({
      apiBaseUrl,
      sessionToken,
      connectorId,
      processNames: expectedProcessNames,
    });

    report.steps.bootstrapJob = {
      job: jobResult.job,
      report: jobResult.report,
      publishedProcesses,
    };

    await page.goto(`${webBaseUrl}/processes`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    const processSearch = page.getByPlaceholder('搜索流程名称或代码...');
    await processSearch.fill(connectorName);
    await page.waitForTimeout(1500);
    const processesPagePreview = await readBodyPreview(page);

    await page.goto(`${webBaseUrl}/process-library`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    await page.getByPlaceholder(/搜索流程/).fill(expectedProcessNames[0]);
    await page.waitForTimeout(1500);
    const processLibraryPreview = await readBodyPreview(page);

    await page.goto(`${webBaseUrl}/connectors/${connectorId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    const connectorDetailPreview = await readBodyPreview(page);

    report.steps.pages = {
      connectorDetail: {
        url: page.url(),
        bodyPreview: connectorDetailPreview,
      },
      processesPage: {
        bodyPreview: processesPagePreview,
      },
      processLibraryPage: {
        bodyPreview: processLibraryPreview,
      },
    };

    const publishedProcessNames = publishedProcesses.map((item) => String(item?.processName || ''));
    const publishedProcessCodes = publishedProcesses.map((item) => String(item?.processCode || ''));

    report.assertions = {
      modalLoadedExampleFile: expectedProcessNames.every((name) => textareaValue.includes(name)),
      createRequestSucceeded: createResponse.status() >= 200 && createResponse.status() < 300,
      bootstrapPublished: ['PUBLISHED', 'PARTIALLY_PUBLISHED'].includes(String(jobResult.job?.status || '')),
      connectorPublished: Boolean(connectorId),
      expectedProcessesPublished: expectedProcessNames.every((name) => publishedProcessNames.includes(name)),
      generatedProcessCodes: publishedProcessCodes,
      processesPageShowsExpectedProcess: expectedProcessNames.some((name) => processesPagePreview.includes(name)),
      connectorDetailShowsUrlMode: /链接直达接入|URL 直达|链接直达/.test(connectorDetailPreview),
      connectorDetailShowsExpectedFlows: expectedProcessNames.every((name) => connectorDetailPreview.includes(name)),
      processLibraryShowsExpectedFlow: expectedProcessNames.some((name) => processLibraryPreview.includes(name)),
      processesPageShowsConnectorName: processesPagePreview.includes(connectorName),
    };

    report.success = Boolean(
      report.assertions.modalLoadedExampleFile
      && report.assertions.createRequestSucceeded
      && report.assertions.bootstrapPublished
      && report.assertions.connectorPublished
      && report.assertions.expectedProcessesPublished
      && report.assertions.processesPageShowsExpectedProcess
      && report.assertions.connectorDetailShowsUrlMode
      && report.assertions.connectorDetailShowsExpectedFlows
      && report.assertions.processLibraryShowsExpectedFlow
      && report.assertions.processesPageShowsConnectorName
    );
  } catch (error: any) {
    report.error = {
      message: error?.message || String(error),
      stack: error?.stack || null,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }

  const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `verify-frontend-url-bootstrap-example-${Date.now()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    outputPath,
    success: report.success,
    connectorName: report.connectorName,
    connectorId: report.steps?.bootstrapJob?.job?.connectorId || null,
    jobId: report.steps?.createJob?.data?.id || null,
    jobStatus: report.steps?.bootstrapJob?.job?.status || null,
    processes: Array.isArray(report.steps?.bootstrapJob?.publishedProcesses)
      ? report.steps.bootstrapJob.publishedProcesses.map((item: any) => ({
          processName: item?.processName,
          processCode: item?.processCode,
        }))
      : [],
    assertions: report.assertions,
    error: report.error || null,
  }, null, 2));

  if (!report.success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
