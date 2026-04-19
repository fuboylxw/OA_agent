const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { sm2 } = require('sm-crypto');

function loadRootEnv() {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(__dirname, '../../../.env'),
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
    if (currentUrl.includes(returnTo) || /\/(chat|submissions)(?:[?#]|$)/.test(currentUrl)) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  const authSession = (await context.cookies()).find((cookie) => cookie.name === 'auth_session');
  if (!authSession) {
    throw new Error('Frontend auth_session cookie was not established');
  }
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

async function waitForPromptVisible(page, promptTitle) {
  await page.getByText(promptTitle, { exact: false }).first().waitFor({
    state: 'visible',
    timeout: 30000,
  });
}

async function waitForPromptHidden(page, promptTitle) {
  await page.getByText(promptTitle, { exact: false }).first().waitFor({
    state: 'hidden',
    timeout: 30000,
  });
}

async function openRestorePrompt(page, webBaseUrl) {
  await page.goto(`${webBaseUrl}/submissions`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  const restoreButton = page.getByRole('button', { name: '恢复对话' }).first();
  await restoreButton.waitFor({ state: 'visible', timeout: 30000 });
  const restoreResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/assistant/sessions/restore')
      && response.request().method() === 'POST',
    { timeout: 30000 },
  );

  await restoreButton.click();
  const restoreResponse = await restoreResponsePromise;
  const restoreData = await restoreResponse.json().catch(() => null);
  await page.waitForURL((url) => url.pathname === '/chat', { timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  return {
    status: restoreResponse.status(),
    data: restoreData,
    url: page.url(),
  };
}

async function clickResetPrompt(page, promptTitle) {
  const resetResponsePromise = page.waitForResponse(
    (response) =>
      /\/api\/v1\/assistant\/sessions\/[^/]+\/reset$/.test(response.url())
      && response.request().method() === 'POST',
    { timeout: 30000 },
  );

  await page.getByRole('button', { name: '重置上下文', exact: true }).click();
  const resetResponse = await resetResponsePromise;
  const resetData = await resetResponse.json().catch(() => null);
  await waitForPromptHidden(page, promptTitle);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  return {
    status: resetResponse.status(),
    data: resetData,
    url: page.url(),
  };
}

async function main() {
  loadRootEnv();

  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const webBaseUrl = String(
    getArg('--web-base-url', process.env.PUBLIC_WEB_BASE_URL || 'http://202.200.206.250'),
  ).trim().replace(/\/+$/, '');
  const promptTitle = '检测到您是从“我的申请”回到本次对话';
  const apiBaseUrl = `${webBaseUrl}/api/v1`;
  const logDir = path.resolve(process.cwd(), '.logs/chat-resume-reset-check');
  fs.mkdirSync(logDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    account,
    webBaseUrl,
    apiBaseUrl,
    promptTitle,
    submission: {},
    desktop: {},
    mobile: {},
    resetState: {},
    success: false,
  };

  const cookieHeaders = await requestLoginCookie(account);
  if (cookieHeaders.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    await context.addCookies(cookieHeaders.map(parseSetCookie));
    const page = await context.newPage();

    await ensureFrontendSession(context, page, webBaseUrl, '/submissions');
    const sessionToken = String(await page.evaluate(() => localStorage.getItem('sessionToken') || ''));
    if (!sessionToken) {
      throw new Error('Frontend sessionToken is missing from localStorage');
    }

    const submissionsResponse = await fetchJson(`${apiBaseUrl}/submissions`, sessionToken);
    const submissions = Array.isArray(submissionsResponse.data) ? submissionsResponse.data : [];
    const restorable = submissions.filter((item) => item && item.canRestoreConversation && item.sessionId);
    if (!restorable.length) {
      throw new Error('No restorable submission with sessionId found');
    }

    const target = restorable[0];
    report.submission = {
      total: submissions.length,
      restorableCount: restorable.length,
      id: target.id,
      sourceType: target.sourceType,
      processName: target.processName,
      sessionId: target.sessionId,
      status: target.status,
      statusText: target.statusText,
    };

    const restoreDesktop = await openRestorePrompt(page, webBaseUrl);
    await waitForPromptVisible(page, promptTitle);
    const desktopPromptScreenshot = path.join(logDir, `desktop-prompt-${Date.now()}.png`);
    await page.screenshot({ path: desktopPromptScreenshot, fullPage: true });
    await page.getByRole('button', { name: '继续办理', exact: true }).click();
    await waitForPromptHidden(page, promptTitle);
    await page.waitForTimeout(1000);

    report.desktop = {
      restoreStatus: restoreDesktop.status,
      restoreUrl: restoreDesktop.url,
      continuedUrl: page.url(),
      promptShown: restoreDesktop.url.includes('resumePrompt=1'),
      promptHiddenAfterContinue: !page.url().includes('resumePrompt=1'),
      screenshot: desktopPromptScreenshot,
    };

    await page.goto(`${webBaseUrl}/chat?sessionId=${encodeURIComponent(target.sessionId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const promptCountOnDirectOpen = await page.getByText(promptTitle, { exact: false }).count();
    report.desktop.promptHiddenOnDirectSessionOpen = promptCountOnDirectOpen === 0;

    await page.setViewportSize({ width: 390, height: 844 });
    const restoreMobile = await openRestorePrompt(page, webBaseUrl);
    await waitForPromptVisible(page, promptTitle);
    const mobilePromptScreenshot = path.join(logDir, `mobile-prompt-${Date.now()}.png`);
    await page.screenshot({ path: mobilePromptScreenshot, fullPage: true });

    const resetMobile = await clickResetPrompt(page, promptTitle);
    report.mobile = {
      restoreStatus: restoreMobile.status,
      restoreUrl: restoreMobile.url,
      resetStatus: resetMobile.status,
      resetUrl: resetMobile.url,
      promptShown: restoreMobile.url.includes('resumePrompt=1'),
      promptHiddenAfterReset: !resetMobile.url.includes('resumePrompt=1'),
      screenshot: mobilePromptScreenshot,
    };

    const messagesAfterReset = await fetchJson(
      `${apiBaseUrl}/assistant/sessions/${encodeURIComponent(target.sessionId)}/messages`,
      sessionToken,
    );
    const sessionState = messagesAfterReset.data?.session?.sessionState || null;
    const messageCount = Array.isArray(messagesAfterReset.data?.messages)
      ? messagesAfterReset.data.messages.length
      : 0;

    report.resetState = {
      fetchStatus: messagesAfterReset.status,
      messageCount,
      hasActiveProcess: Boolean(sessionState?.hasActiveProcess),
      activeProcessCard: sessionState?.activeProcessCard || null,
      processCode: sessionState?.processCode || null,
      processName: sessionState?.processName || null,
      historyPreserved: messageCount > 0,
    };

    const restoreDesktopOk = report.desktop.restoreStatus >= 200 && report.desktop.restoreStatus < 300;
    const restoreMobileOk = report.mobile.restoreStatus >= 200 && report.mobile.restoreStatus < 300;
    const resetMobileOk = report.mobile.resetStatus >= 200 && report.mobile.resetStatus < 300;

    report.success = Boolean(
      submissionsResponse.status === 200
      && report.submission.restorableCount > 0
      && restoreDesktopOk
      && report.desktop.promptShown
      && report.desktop.promptHiddenAfterContinue
      && report.desktop.promptHiddenOnDirectSessionOpen
      && restoreMobileOk
      && resetMobileOk
      && report.mobile.promptShown
      && report.mobile.promptHiddenAfterReset
      && report.resetState.fetchStatus === 200
      && report.resetState.hasActiveProcess === false
      && report.resetState.activeProcessCard === null
      && report.resetState.historyPreserved,
    );
  } finally {
    await browser.close();
  }

  const outputPath = path.join(logDir, `verify-frontend-chat-resume-reset-${Date.now()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    success: report.success,
    submission: report.submission,
    desktop: report.desktop,
    mobile: report.mobile,
    resetState: report.resetState,
  }, null, 2));

  if (!report.success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
