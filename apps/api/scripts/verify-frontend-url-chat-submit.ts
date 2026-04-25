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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function readBodyPreview(page: any) {
  return page.evaluate(() =>
    (document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200),
  ).catch(() => '');
}

async function maybeAcceptAuthorize(page: any) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const title = await page.title().catch(() => '');
    const bodyPreview = await readBodyPreview(page);
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
        await page.waitForTimeout(2500);
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

async function waitForChatComposerReady(page: any) {
  await page.waitForFunction(() => window.location.pathname === '/chat', null, {
    timeout: 30000,
  });
  await page.locator('textarea').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => {
    const textarea = document.querySelector('textarea');
    return Boolean(textarea && !(textarea as HTMLTextAreaElement).disabled);
  }, null, { timeout: 30000 });
}

async function latestAssistantBubbleText(page: any) {
  const locator = page.locator('main div.flex.justify-start p.whitespace-pre-wrap');
  const count = await locator.count();
  if (count === 0) {
    return '';
  }
  return String(await locator.nth(count - 1).innerText()).replace(/\s+/g, ' ').trim();
}

async function uploadAttachmentFromChat(input: {
  page: any;
  uploadFile: string;
  uploadFieldLabel?: string;
}) {
  const { page, uploadFile, uploadFieldLabel } = input;
  const fileName = path.basename(uploadFile);
  if (!fs.existsSync(uploadFile)) {
    throw new Error(`Upload file not found: ${uploadFile}`);
  }

  const candidates = uploadFieldLabel
    ? [
      page.getByRole('button', { name: `上传${uploadFieldLabel}`, exact: true }),
      page.getByText(`上传${uploadFieldLabel}`, { exact: true }),
      page.locator('button', { hasText: `上传${uploadFieldLabel}` }).first(),
      page.locator(`button[title="上传${uploadFieldLabel}"]`).first(),
    ]
    : [
      page.getByRole('button', { name: '上传附件', exact: true }),
      page.getByText('上传附件', { exact: true }),
      page.locator('button[title="上传附件"]').first(),
    ];

  let clicked = false;
  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    if (!count) {
      continue;
    }
    try {
      await locator.first().click({ timeout: 5000 });
      clicked = true;
      break;
    } catch {
      continue;
    }
  }

  if (!clicked) {
    const bodyPreview = await readBodyPreview(page);
    throw new Error(`Could not find upload button${uploadFieldLabel ? ` for field ${uploadFieldLabel}` : ''}. Body preview: ${bodyPreview.slice(0, 400)}`);
  }

  const inputLocator = page.locator('input[type="file"]').first();
  await inputLocator.setInputFiles(uploadFile, { timeout: 15000 });
  await page.locator(`text=${fileName}`).first().waitFor({
    state: 'visible',
    timeout: 30000,
  });

  if (uploadFieldLabel) {
    const escaped = escapeRegExp(uploadFieldLabel);
    await page.getByText(new RegExp(escaped)).first().waitFor({
      state: 'visible',
      timeout: 10000,
    }).catch(() => undefined);
  }

  await page.waitForTimeout(1500);
}

async function latestUserBubbleText(page: any) {
  const locator = page.locator('main div.flex.justify-end p.whitespace-pre-wrap');
  const count = await locator.count();
  if (count === 0) {
    return '';
  }
  return String(await locator.nth(count - 1).innerText()).replace(/\s+/g, ' ').trim();
}

async function waitForAssistantResponse(page: any, webBaseUrl: string, trigger: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response: any) =>
      response.url().startsWith(`${webBaseUrl}/api/v1/assistant/chat`)
      && response.request().method() === 'POST',
    { timeout: 90000 },
  );

  await trigger();
  const response = await responsePromise;
  const data = await response.json().catch(() => null);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1500);
  return {
    status: response.status(),
    data,
  };
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

async function pollForSubmission(input: {
  apiBaseUrl: string;
  sessionToken: string;
  processCode: string;
  beforeIds: Set<string>;
  startedAt: number;
  timeoutMs: number;
}) {
  const deadline = Date.now() + Math.max(1000, input.timeoutMs);
  let latestList: any[] = [];

  while (Date.now() < deadline) {
    const listResponse = await fetchJson(`${input.apiBaseUrl}/submissions`, input.sessionToken);
    latestList = Array.isArray(listResponse.data) ? listResponse.data : [];

    const candidate = latestList.find((item) => {
      const createdAt = Date.parse(String(item?.createdAt || ''));
      return !input.beforeIds.has(String(item?.id || ''))
        && item?.processCode === input.processCode
        && Number.isFinite(createdAt)
        && createdAt >= input.startedAt - 10000;
    });

    if (candidate?.id) {
      const detailDeadline = Date.now() + Math.max(1000, input.timeoutMs);
      let latestDetail: JsonRecord | null = null;

      while (Date.now() < detailDeadline) {
        const detailResponse = await fetchJson(
          `${input.apiBaseUrl}/submissions/${candidate.id}`,
          input.sessionToken,
        );
        latestDetail = (detailResponse.data && typeof detailResponse.data === 'object')
          ? detailResponse.data as JsonRecord
          : null;

        if (
          latestDetail?.submitResult
          || latestDetail?.status === 'failed'
          || latestDetail?.status === 'submitted'
          || latestDetail?.status === 'draft_saved'
        ) {
          return {
            list: latestList,
            detail: latestDetail,
          };
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      return {
        list: latestList,
        detail: latestDetail,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return {
    list: latestList,
    detail: null,
  };
}

function findLatestAssistantProcessMessage(messages: any[]) {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && (message?.processCard || String(message?.content || '').trim())) {
      return message;
    }
  }

  return null;
}

function getExpectedFinalChatPresentation(status: string) {
  const normalized = String(status || '').trim().toLowerCase();
  switch (normalized) {
    case 'draft_saved':
      return {
        statusText: '已保存待发',
        messagePattern: /已保存到\s*OA\s*待发箱|尚未正式送审/u,
      };
    case 'submitted':
      return {
        statusText: '审批中',
        messagePattern: /已提交成功|审批中/u,
      };
    case 'failed':
      return {
        statusText: '处理失败',
        messagePattern: /处理失败/u,
      };
    case 'completed':
      return {
        statusText: '已完成',
        messagePattern: /审批通过|已完成/u,
      };
    case 'cancelled':
      return {
        statusText: '已取消',
        messagePattern: /已取消|撤回/u,
      };
    case 'rework_required':
      return {
        statusText: '驳回待处理',
        messagePattern: /退回|驳回/u,
      };
    default:
      return null;
  }
}

async function waitForChatFinalReflection(input: {
  page: any;
  apiBaseUrl: string;
  sessionToken: string;
  sessionId: string;
  expectedStatus: string;
  timeoutMs: number;
}) {
  const expectation = getExpectedFinalChatPresentation(input.expectedStatus);
  if (!expectation) {
    return {
      reflected: false,
      reason: `unsupported_status:${input.expectedStatus || 'unknown'}`,
      sessionMessage: null,
      domAssistantMessage: await latestAssistantBubbleText(input.page),
      bodyPreview: await readBodyPreview(input.page),
    };
  }

  const deadline = Date.now() + Math.max(3000, input.timeoutMs);
  let latestSessionMessage: any = null;
  let domAssistantMessage = '';
  let bodyPreview = '';

  while (Date.now() < deadline) {
    const sessionResponse = await fetchJson(
      `${input.apiBaseUrl}/assistant/sessions/${encodeURIComponent(input.sessionId)}/messages`,
      input.sessionToken,
    );
    const sessionData = toPlainObject(sessionResponse.data);
    latestSessionMessage = findLatestAssistantProcessMessage(Array.isArray(sessionData.messages) ? sessionData.messages : []);
    domAssistantMessage = await latestAssistantBubbleText(input.page);
    bodyPreview = await readBodyPreview(input.page);

    const processCard = toPlainObject(latestSessionMessage?.processCard);
    const sessionStatusText = String(processCard.statusText || '').trim();
    const sessionProcessStatus = String(processCard.processStatus || latestSessionMessage?.processStatus || '').trim();
    const normalizedDomMessage = String(domAssistantMessage || '').replace(/\s+/g, ' ').trim();

    const reflected = sessionStatusText === expectation.statusText
      && sessionProcessStatus === input.expectedStatus
      && expectation.messagePattern.test(normalizedDomMessage);

    if (reflected) {
      return {
        reflected: true,
        sessionMessage: latestSessionMessage,
        domAssistantMessage: normalizedDomMessage,
        bodyPreview,
      };
    }

    await input.page.waitForTimeout(1500);
  }

  return {
    reflected: false,
    sessionMessage: latestSessionMessage,
    domAssistantMessage,
    bodyPreview,
  };
}

function toPlainObject(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

async function main() {
  loadRootEnv();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const webBaseUrl = String(
    getArg('--web-base-url', process.env.PUBLIC_WEB_BASE_URL || 'http://202.200.206.250'),
  ).trim().replace(/\/+$/, '');
  const apiBaseUrl = `${webBaseUrl}/api/v1`;
  const processCode = String(getArg('--process-code', process.env.E2E_PROCESS_CODE || '') || '').trim();
  const processName = String(getArg('--process-name', process.env.E2E_PROCESS_NAME || '') || '').trim();
  const templateId = String(getArg('--template-id', process.env.E2E_TEMPLATE_ID || '') || '').trim();
  const connectorId = String(getArg('--connector-id', process.env.E2E_CONNECTOR_ID || '') || '').trim();
  const detailPrompt = String(getArg('--detail-prompt', process.env.E2E_DETAIL_PROMPT || '') || '').trim();
  const uploadFileArg = String(getArg('--upload-file', process.env.E2E_UPLOAD_FILE || '') || '').trim();
  const uploadFieldLabel = String(getArg('--upload-field-label', process.env.E2E_UPLOAD_FIELD_LABEL || '') || '').trim();
  const uploadFile = uploadFileArg
    ? path.resolve(process.cwd(), uploadFileArg)
    : '';
  const submissionTimeoutMs = Math.max(
    1000,
    parseInt(
      String(getArg('--submission-timeout-ms', process.env.E2E_SUBMISSION_TIMEOUT_MS || '300000') || '300000'),
      10,
    ) || 300000,
  );
  if (!processCode) {
    throw new Error('Missing --process-code');
  }
  if (!processName) {
    throw new Error('Missing --process-name');
  }
  if (!detailPrompt) {
    throw new Error('Missing --detail-prompt');
  }
  const logDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
  fs.mkdirSync(logDir, { recursive: true });
  const startedAt = Date.now();

  const cookieHeaders = await requestLoginCookie(account);
  if (cookieHeaders.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });
  const report: JsonRecord = {
    generatedAt: new Date().toISOString(),
    account,
    webBaseUrl,
    apiBaseUrl,
    processCode,
    processName,
    templateId: templateId || null,
    connectorId: connectorId || null,
    detailPrompt,
    uploadFile: uploadFile || null,
    uploadFieldLabel: uploadFieldLabel || null,
    submissionTimeoutMs,
    steps: {},
    assertions: {},
    success: false,
  };

  try {
    const context = await browser.newContext();
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();

    await ensureFrontendSession(context, page, webBaseUrl, '/processes');
    await page.goto(`${webBaseUrl}/processes`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);

    const sessionToken = String(await page.evaluate(() => localStorage.getItem('sessionToken') || ''));
    if (!sessionToken) {
      throw new Error('Frontend sessionToken is missing from localStorage');
    }

    const beforeSubmissionsResponse = await fetchJson(`${apiBaseUrl}/submissions`, sessionToken);
    const beforeSubmissions = Array.isArray(beforeSubmissionsResponse.data) ? beforeSubmissionsResponse.data : [];
    const beforeIds = new Set(beforeSubmissions.map((item: any) => String(item?.id || '')));

    const processesBody = await readBodyPreview(page);
    report.steps.processes = {
      url: page.url(),
      bodyPreview: processesBody,
      beforeSubmissionCount: beforeSubmissions.length,
    };

    const bootstrapResponsePromise = page.waitForResponse(
      (response: any) =>
        response.url().startsWith(`${webBaseUrl}/api/v1/assistant/chat`)
        && response.request().method() === 'POST',
      { timeout: 90000 },
    );

    const chatQuery = new URLSearchParams({
      flow: processCode,
      ...(templateId ? { templateId } : {}),
      ...(connectorId ? { connectorId } : {}),
    });
    const chatHref = `/chat?${chatQuery.toString()}`;
    const processLink = page.locator(`a[href="${chatHref}"]`).first();
    if (await processLink.count()) {
      await processLink.click();
    } else {
      await page.goto(`${webBaseUrl}${chatHref}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }

    const bootstrapResponse = await bootstrapResponsePromise;
    const bootstrapData = await bootstrapResponse.json().catch(() => null);
    await waitForChatComposerReady(page);

    report.steps.bootstrap = {
      status: bootstrapResponse.status(),
      url: page.url(),
      response: bootstrapData,
      domAssistantMessage: await latestAssistantBubbleText(page),
    };

    if (uploadFile) {
      await uploadAttachmentFromChat({
        page,
        uploadFile,
        uploadFieldLabel: uploadFieldLabel || undefined,
      });

      report.steps.upload = {
        uploadFile,
        uploadFieldLabel: uploadFieldLabel || null,
        pendingFilesText: await readBodyPreview(page),
      };
    }

    const detailTurn = await waitForAssistantResponse(page, webBaseUrl, async () => {
      await page.locator('textarea').fill(detailPrompt);
      await page.getByRole('button', { name: '发送' }).click();
    });

    const confirmButton = page.getByRole('button', { name: '确认提交' }).last();
    await confirmButton.waitFor({ state: 'visible', timeout: 30000 });

    report.steps.detailTurn = {
      status: detailTurn.status,
      response: detailTurn.data,
      domUserMessage: await latestUserBubbleText(page),
      domAssistantMessage: await latestAssistantBubbleText(page),
      confirmButtonVisible: await confirmButton.isVisible(),
    };

    const confirmTurn = await waitForAssistantResponse(page, webBaseUrl, async () => {
      await confirmButton.click();
    });

    report.steps.confirmTurn = {
      status: confirmTurn.status,
      response: confirmTurn.data,
      domAssistantMessage: await latestAssistantBubbleText(page),
    };

    const submissionResult = await pollForSubmission({
      apiBaseUrl,
      sessionToken,
      processCode,
      beforeIds,
      startedAt,
      timeoutMs: submissionTimeoutMs,
    });

    const submissionDetail = toPlainObject(submissionResult.detail);
    const submitResult = toPlainObject(submissionDetail.submitResult);
    const submitMetadata = toPlainObject(submitResult.metadata);
    const submitRequest = toPlainObject(submitMetadata.request);
    const sessionId = String(
      bootstrapData?.sessionId
      || detailTurn.data?.sessionId
      || confirmTurn.data?.sessionId
      || '',
    ).trim();

    report.steps.submission = {
      listCount: Array.isArray(submissionResult.list) ? submissionResult.list.length : 0,
      detail: submissionDetail,
    };

    const finalChatReflection = sessionId
      ? await waitForChatFinalReflection({
          page,
          apiBaseUrl,
          sessionToken,
          sessionId,
          expectedStatus: String(submissionDetail.status || ''),
          timeoutMs: Math.min(Math.max(15000, Math.floor(submissionTimeoutMs / 6)), 60000),
        })
      : null;

    report.steps.finalChatReflection = finalChatReflection;

    report.assertions = {
      processesPageContainsProcess: processesBody.includes(processName) && processesBody.includes(processCode),
      bootstrapAskedForMissingFields: Array.isArray(bootstrapData?.missingFields) && bootstrapData.missingFields.length > 0,
      uploadCompleted: uploadFile ? Boolean(report.steps.upload) : true,
      detailTurnReadyForConfirmation: Boolean(detailTurn.data?.processCard) && Array.isArray(detailTurn.data?.actionButtons),
      confirmTurnAccepted: confirmTurn.status >= 200 && confirmTurn.status < 300,
      confirmTurnShowsAcceptedState: /受理|提交/.test(String(report.steps.confirmTurn?.domAssistantMessage || '')),
      submissionCreated: Boolean(submissionDetail.id),
      submissionFinished: Boolean(submissionDetail.submitResult),
      deliveryPathIsUrl: submitMetadata.deliveryPath === 'url',
      requestTargetsSaveDraft: /method=saveDraft/i.test(String(submitRequest.url || '')),
      requestContainsUrlMode: submitMetadata.mode === 'url-network',
      confirmTurnReflectsDraftSaved: confirmTurn.data?.processStatus === 'draft_saved'
        && confirmTurn.data?.processCard?.statusText === '已保存待发',
      chatPollReflectsFinalStatus: Boolean(finalChatReflection?.reflected),
      finalStatusIsDraftSaved: submissionDetail.status === 'draft_saved',
      finalStatus: submissionDetail.status || null,
    };

    report.success = Boolean(
      report.assertions.processesPageContainsProcess
      && report.assertions.bootstrapAskedForMissingFields
      && report.assertions.uploadCompleted
      && report.assertions.detailTurnReadyForConfirmation
      && report.assertions.confirmTurnAccepted
      && report.assertions.confirmTurnShowsAcceptedState
      && report.assertions.submissionCreated
      && report.assertions.submissionFinished
      && report.assertions.deliveryPathIsUrl
      && report.assertions.requestTargetsSaveDraft
      && report.assertions.requestContainsUrlMode
      && report.assertions.chatPollReflectsFinalStatus
      && report.assertions.finalStatusIsDraftSaved,
    );
  } catch (error: any) {
    report.error = {
      message: error?.message || String(error),
      stack: error?.stack || null,
    };
  } finally {
    await browser.close();
  }

  const outputPath = path.join(logDir, `verify-frontend-url-chat-submit-${Date.now()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    success: report.success,
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
