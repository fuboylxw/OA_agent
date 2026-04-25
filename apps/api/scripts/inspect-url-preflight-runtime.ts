import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
import { sm2 } from 'sm-crypto';
import { parseRpaFlowDefinitions, type RpaFlowDefinition } from '@uniflow/shared-types';
import { BrowserTaskRuntime } from '../src/modules/browser-runtime/browser-task-runtime';

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

async function captureSsoUrl(page: any, portalUrl: string, oaInfoUrl?: string) {
  const targetPath = String(oaInfoUrl || '').trim() || '/gate/lobby/api/oa/info';
  const bridgePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${targetPath}`)), 30000);
    page.on('response', async (response: any) => {
      try {
        const responseUrl = String(response.url() || '');
        if (!responseUrl.includes(targetPath)) {
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

async function loadFlow(prisma: PrismaClient, connectorId: string, processCode: string) {
  const template = await prisma.processTemplate.findFirst({
    where: {
      connectorId,
      processCode,
      status: 'published',
    },
    select: {
      id: true,
      processCode: true,
      processName: true,
      uiHints: true,
    },
    orderBy: [
      { version: 'desc' },
      { updatedAt: 'desc' },
    ],
  });

  if (!template) {
    throw new Error(`No published template found for ${processCode}`);
  }

  const uiHints = (template.uiHints as Record<string, any> | null) || {};
  const flow = parseRpaFlowDefinitions(uiHints.rpaDefinition ? [uiHints.rpaDefinition] : [])[0];
  if (!flow) {
    throw new Error(`Template ${template.id} does not contain a valid rpaDefinition`);
  }

  return {
    templateId: template.id,
    flow,
  };
}

function resolveTargetTourl(flow: RpaFlowDefinition) {
  const explicit = String(flow.platform?.portalSsoBridge?.targetPathTemplate || '').trim();
  if (explicit) {
    return explicit;
  }

  const jumpUrlTemplate = String(flow.platform?.jumpUrlTemplate || '').trim();
  if (!jumpUrlTemplate) {
    throw new Error('Missing platform.jumpUrlTemplate / portalSsoBridge.targetPathTemplate');
  }

  const parsed = new URL(jumpUrlTemplate);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function buildAuthenticatedState(input: {
  account: string;
  portalUrl: string;
  oaInfoUrl?: string;
  targetTourl: string;
}) {
  const cookies = await requestLoginCookie(input.account);
  if (cookies.length === 0) {
    throw new Error('No cookies returned from whitelist login');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(cookies.map(parseSetCookie));
    const page = await context.newPage();
    const ssoSource = await captureSsoUrl(page, input.portalUrl, input.oaInfoUrl);
    const ssoUrl = new URL(ssoSource);
    ssoUrl.searchParams.set('tourl', input.targetTourl);
    await page.goto(ssoUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(2000);

    return {
      sourceUrl: ssoSource,
      resolvedSsoUrl: ssoUrl.toString(),
      finalUrl: page.url(),
      title: await page.title().catch(() => ''),
      storageState: await context.storageState(),
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  loadRootEnv();
  const connectorId = String(getArg('--connector-id', '') || '').trim();
  const processCode = String(getArg('--process-code', '') || '').trim();
  const processName = String(getArg('--process-name', '') || '').trim();
  const account = String(getArg('--account', 'cloudcam') || 'cloudcam').trim();
  const uploadFile = String(getArg('--upload-file', '') || '').trim();
  const prisma = new PrismaClient();

  try {
    const loaded = await loadFlow(prisma, connectorId, processCode);
    const flow = loaded.flow;
    const portalUrl = String(
      getArg('--portal-url', String(flow.platform?.portalSsoBridge?.portalUrl || flow.platform?.entryUrl || '')) || '',
    ).trim();
    const oaInfoUrl = String(
      getArg('--oa-info-url', String(flow.platform?.portalSsoBridge?.oaInfoUrl || 'https://sz.xpu.edu.cn/gate/lobby/api/oa/info')) || '',
    ).trim();
    const targetTourl = String(getArg('--tourl', resolveTargetTourl(flow)) || '').trim();
    const authState = await buildAuthenticatedState({
      account,
      portalUrl,
      oaInfoUrl,
      targetTourl,
    });

    const runtime = new BrowserTaskRuntime();
    const formData: Record<string, any> = {
      field_1: '后勤管理处拟招引校内服务保障类项目涉及房屋、场地租金评估材料：事业单位法人证书1份，产权承诺书1份，承诺函5份，申报表1份',
      field_3: ['党委公章', '学校公章'],
    };
    if (uploadFile) {
      formData.field_2 = uploadFile;
    }

    const attachments = uploadFile
      ? [
          {
            fieldKey: 'field_2',
            filename: path.basename(uploadFile),
            mimeType: 'application/pdf',
            content: fs.readFileSync(uploadFile),
          },
        ]
      : [];

    const preflight = flow.runtime?.preflight;
    if (!preflight?.steps?.length) {
      throw new Error('Current flow runtime does not contain preflight steps');
    }

    const result = await runtime.run({
      action: 'submit',
      flow: {
        ...flow,
        processName: processName || flow.processName,
        actions: {
          submit: preflight,
        },
      },
      runtime: {
        ...(flow.runtime || {}),
        executorMode: 'browser',
        browserProvider: 'playwright',
        headless: true,
      },
      payload: {
        formData,
        attachments,
        auth: {
          platformConfig: {
            storageState: authState.storageState,
            cookieOrigin: authState.finalUrl,
          },
        },
      },
      ticket: {
        jumpUrl: authState.finalUrl,
      },
    });

    const outputDir = path.resolve(process.cwd(), '.logs/xpu-inspect');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `inspect-url-preflight-runtime-${Date.now()}.json`);
    const extractedValues = result.extractedValues || {};
    const output = {
      templateId: loaded.templateId,
      connectorId,
      processCode,
      processName: processName || flow.processName,
      account,
      portalUrl,
      oaInfoUrl,
      targetTourl,
      authState: {
        sourceUrl: authState.sourceUrl,
        resolvedSsoUrl: authState.resolvedSsoUrl,
        finalUrl: authState.finalUrl,
        title: authState.title,
      },
      formData,
      attachments: attachments.map((item) => ({
        fieldKey: item.fieldKey,
        filename: item.filename,
        mimeType: item.mimeType,
      })),
      result: {
        success: result.success,
        errorMessage: result.errorMessage,
        extractedValues,
        executedSteps: result.executedSteps,
        snapshots: result.snapshots.map((snapshot) => ({
          snapshotId: snapshot.snapshotId,
          title: snapshot.title,
          url: snapshot.url,
        })),
      },
    };
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(JSON.stringify({
      outputPath,
      success: result.success,
      errorMessage: result.errorMessage,
      filledFields: extractedValues.filledFields || {},
      attachmentFieldMap: extractedValues.attachmentFieldMap || {},
      resolvedFieldBindings: extractedValues.resolvedFieldBindings || [],
      resolvedFieldMappings: extractedValues.resolvedFieldMappings || [],
      submitCapture: extractedValues.submitCapture || extractedValues.saveDraft || null,
      submitFields: extractedValues.submitFields || extractedValues.saveDraftFields || null,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
