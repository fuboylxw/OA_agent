const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { sm2 } = require('sm-crypto');

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

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function readJsonSafe(value) {
  return value && typeof value === 'object' ? value : null;
}

function extractSm2PrivateKeyHex(rawKey) {
  const exported = Buffer.from(rawKey.trim(), 'base64').toString('hex');
  const match = exported.match(/0201010420([0-9a-f]{64})/i);
  if (!match) {
    throw new Error('Unable to extract SM2 private scalar from AUTH_OAUTH2_PRIVATE_KEY');
  }
  return match[1];
}

function buildSignedPayload(account) {
  const clientId = String(process.env.AUTH_OAUTH2_CLIENT_ID || '').trim();
  const privateKey = String(process.env.AUTH_OAUTH2_PRIVATE_KEY || '').trim();
  if (!clientId) throw new Error('Missing AUTH_OAUTH2_CLIENT_ID');
  if (!privateKey) throw new Error('Missing AUTH_OAUTH2_PRIVATE_KEY');

  const payload = {
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

async function requestLoginCookie(account) {
  const payload = buildSignedPayload(account);
  const pathWithQuery = `/auth2/api/v1/login?${new URLSearchParams(payload).toString()}`;

  return new Promise((resolve, reject) => {
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

function parseSetCookie(header) {
  const parts = header.split(';').map((part) => part.trim()).filter(Boolean);
  const [nameValue, ...attributes] = parts;
  const separatorIndex = nameValue.indexOf('=');
  const cookie = {
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

async function readBodyPreview(page) {
  return page.evaluate(() =>
    (document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200),
  ).catch(() => '');
}

async function maybeAcceptAuthorize(page) {
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

async function ensureFrontendSession(context, page, webBaseUrl, returnTo) {
  await page.goto(`${webBaseUrl}/login?returnTo=${encodeURIComponent(returnTo)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(2000);
  await maybeAcceptAuthorize(page);

  for (let index = 0; index < 12; index += 1) {
    const currentUrl = page.url();
    if (currentUrl.includes(returnTo) || /\/chat(?:[?#]|$)/.test(currentUrl)) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  const authSession = (await context.cookies()).find((cookie) => cookie.name === 'auth_session');
  if (!authSession) {
    throw new Error('Frontend auth_session cookie was not established');
  }
}

async function waitForChatComposerReady(page) {
  await page.waitForFunction(() => window.location.pathname === '/chat', null, {
    timeout: 30000,
  });
  await page.locator('textarea').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => {
    const textarea = document.querySelector('textarea');
    return Boolean(textarea && !textarea.disabled);
  }, null, { timeout: 30000 });
}

async function waitForAssistantResponse(page, webBaseUrl, trigger) {
  const responsePromise = page.waitForResponse(
    (response) =>
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

async function latestAssistantBubbleText(page) {
  const locator = page.locator('main div.flex.justify-start p.whitespace-pre-wrap');
  const count = await locator.count();
  if (count === 0) {
    return '';
  }
  return String(await locator.nth(count - 1).innerText()).replace(/\s+/g, ' ').trim();
}

async function waitForDeleteResponse(page, sessionId) {
  return page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/assistant/sessions/${sessionId}`)
      && response.request().method() === 'DELETE',
    { timeout: 30000 },
  );
}

async function waitForRestoreResponse(page) {
  return page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/assistant/sessions/restore')
      && response.request().method() === 'POST',
    { timeout: 30000 },
  );
}

async function fetchJson(url, sessionToken) {
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

async function main() {
  loadRootEnv();

  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const webBaseUrl = String(
    getArg('--web-base-url', process.env.PUBLIC_WEB_BASE_URL || 'http://202.200.206.250'),
  ).trim().replace(/\/+$/, '');
  const processCode = String(getArg('--process-code', 'leave_request') || 'leave_request').trim();
  const processName = String(getArg('--process-name', '请假申请') || '请假申请').trim();
  const detailPrompt = String(
    getArg(
      '--detail-prompt',
      '请假事由是外出旅游，开始日期是2026-04-19，结束日期是2026-04-21，外出地点是西安，联系电话是13800138000',
    ) || '',
  ).trim();
  const apiBaseUrl = `${webBaseUrl}/api/v1`;
  const logDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
  fs.mkdirSync(logDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    account,
    webBaseUrl,
    apiBaseUrl,
    processCode,
    processName,
    detailPrompt,
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
    const context = await browser.newContext({
      viewport: {
        width: 1440,
        height: 1100,
      },
    });
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();
    const consoleErrors = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await ensureFrontendSession(context, page, webBaseUrl, '/processes');
    const sessionToken = String(await page.evaluate(() => localStorage.getItem('sessionToken') || ''));
    if (!sessionToken) {
      throw new Error('Frontend sessionToken is missing from localStorage');
    }

    await page.goto(`${webBaseUrl}/processes`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);

    report.steps.processes = {
      url: page.url(),
      bodyPreview: await readBodyPreview(page),
    };

    const bootstrapResponsePromise = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${webBaseUrl}/api/v1/assistant/chat`)
        && response.request().method() === 'POST',
      { timeout: 90000 },
    );

    const processLink = page.locator(`a[href="/chat?flow=${processCode}"]`).first();
    if (await processLink.count()) {
      await processLink.click();
    } else {
      await page.goto(`${webBaseUrl}/chat?flow=${encodeURIComponent(processCode)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }

    await waitForChatComposerReady(page);
    const bootstrapResponse = await bootstrapResponsePromise;
    const bootstrapData = await bootstrapResponse.json().catch(() => null);

    report.steps.bootstrap = {
      status: bootstrapResponse.status(),
      url: page.url(),
      response: bootstrapData,
      domAssistantMessage: await latestAssistantBubbleText(page),
      consoleErrors,
    };

    const detailTurn = await waitForAssistantResponse(page, webBaseUrl, async () => {
      await page.locator('textarea').fill(detailPrompt);
      await page.getByRole('button', { name: '发送' }).click();
    });

    const activeSessionId = String(detailTurn.data?.sessionId || bootstrapData?.sessionId || '').trim();
    if (!activeSessionId) {
      throw new Error('Could not determine active sessionId');
    }

    const confirmButton = page.getByRole('button', { name: '确认提交' }).last();
    await confirmButton.waitFor({ state: 'visible', timeout: 30000 });

    const sessionsBeforeDelete = await fetchJson(`${apiBaseUrl}/assistant/sessions`, sessionToken);
    const activeSessionsBeforeDelete = Array.isArray(sessionsBeforeDelete.data) ? sessionsBeforeDelete.data : [];
    const activeSessionBeforeDelete = activeSessionsBeforeDelete.find((item) => item && item.id === activeSessionId) || null;

    const workbenchBeforeDelete = await fetchJson(`${apiBaseUrl}/submissions`, sessionToken);
    const workbenchItemsBeforeDelete = Array.isArray(workbenchBeforeDelete.data) ? workbenchBeforeDelete.data : [];
    const matchingDraftItem = workbenchItemsBeforeDelete.find((item) =>
      item
      && item.sourceType === 'draft'
      && (item.sessionId === activeSessionId || item.processName === processName),
    ) || null;

    report.steps.beforeDelete = {
      sessionId: activeSessionId,
      detailTurn,
      activeSessionBeforeDelete,
      draftItem: matchingDraftItem,
    };

    await page.getByRole('button', { name: '历史对话' }).click();
    const firstDeleteButton = page.locator('aside button[title="从历史中移除，可在我的申请中恢复"]').first();
    await firstDeleteButton.waitFor({ state: 'visible', timeout: 30000 });

    const deleteResponsePromise = waitForDeleteResponse(page, activeSessionId);
    await firstDeleteButton.click();
    const deleteResponse = await deleteResponsePromise;
    const deleteData = await deleteResponse.json().catch(() => null);

    await page.waitForTimeout(2000);
    const sessionsAfterDelete = await fetchJson(`${apiBaseUrl}/assistant/sessions`, sessionToken);
    const activeSessionsAfterDelete = Array.isArray(sessionsAfterDelete.data) ? sessionsAfterDelete.data : [];
    const sessionStillVisible = activeSessionsAfterDelete.some((item) => item && item.id === activeSessionId);

    report.steps.afterDelete = {
      responseStatus: deleteResponse.status(),
      response: deleteData,
      activeSessionCount: activeSessionsAfterDelete.length,
      sessionStillVisible,
    };

    await page.goto(`${webBaseUrl}/submissions`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);

    const workbenchAfterDelete = await fetchJson(`${apiBaseUrl}/submissions`, sessionToken);
    const workbenchItemsAfterDelete = Array.isArray(workbenchAfterDelete.data) ? workbenchAfterDelete.data : [];
    const draftItemAfterDelete = workbenchItemsAfterDelete.find((item) =>
      item
      && item.sourceType === 'draft'
      && (item.sessionId === activeSessionId || item.processName === processName),
    ) || null;

    const firstRow = page.locator('tbody tr').first();
    const firstRowText = (await firstRow.textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();
    const firstRestoreButton = page.getByRole('button', { name: '恢复对话' }).first();
    await firstRestoreButton.waitFor({ state: 'visible', timeout: 30000 });

    const restoreResponsePromise = waitForRestoreResponse(page);
    await firstRestoreButton.click();
    const restoreResponse = await restoreResponsePromise;
    const restoreData = await restoreResponse.json().catch(() => null);
    const restoredSessionId = String(
      restoreData?.session?.id
      || restoreData?.sessionId
      || draftItemAfterDelete?.sessionId
      || '',
    ).trim();

    await page.waitForURL((url) => url.pathname === '/chat', { timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: '确认提交' }).last().waitFor({
      state: 'visible',
      timeout: 30000,
    });

    const sessionsAfterRestore = await fetchJson(`${apiBaseUrl}/assistant/sessions`, sessionToken);
    const activeSessionsAfterRestore = Array.isArray(sessionsAfterRestore.data) ? sessionsAfterRestore.data : [];
    const restoredSessionVisible = activeSessionsAfterRestore.some((item) => item && item.id === restoredSessionId);
    const activeBannerText = (await page.locator('text=正在继续办理：').first().textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();

    report.steps.afterRestore = {
      responseStatus: restoreResponse.status(),
      response: restoreData,
      restoredSessionId,
      chatUrl: page.url(),
      firstRowText,
      activeBannerText,
      restoredSessionVisible,
    };

    report.assertions = {
      bootstrapStartedFlow: Boolean(bootstrapData?.sessionId),
      confirmationReached: Boolean(activeSessionId),
      historySessionHasBusinessRecord: Boolean(activeSessionBeforeDelete?.hasBusinessRecord),
      workbenchContainsDraftBeforeDelete: Boolean(matchingDraftItem?.id),
      deleteArchivedSession: deleteData?.mode === 'archive',
      archivedSessionHiddenFromHistory: sessionStillVisible === false,
      workbenchStillContainsDraftAfterDelete: Boolean(draftItemAfterDelete?.id),
      workbenchDraftRestorable: Boolean(draftItemAfterDelete?.canRestoreConversation),
      submissionsPageShowsExpectedRow: firstRowText.includes(processName),
      restoreReturnedSession: Boolean(restoredSessionId),
      restoredSessionBackInHistory: restoredSessionVisible,
      restoredChatShowsBanner: activeBannerText.includes(processName),
      restoredChatHasConfirmButton: true,
    };

    report.success = Object.values(report.assertions).every(Boolean);
  } catch (error) {
    report.error = {
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : null,
    };
  } finally {
    await browser.close();
  }

  const outputPath = path.join(logDir, `verify-frontend-chat-history-recovery-${Date.now()}.json`);
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
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
