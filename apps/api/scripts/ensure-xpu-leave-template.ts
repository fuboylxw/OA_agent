import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

type Args = {
  tenantId?: string;
  connectorId?: string;
  processCode: string;
  processName: string;
  processCategory: string;
  templateId: string;
  portalUrl: string;
  oaInfoUrl: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    processCode: 'leave_request',
    processName: '请假申请',
    processCategory: '人事',
    templateId: '-4191060420802230640',
    portalUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
    oaInfoUrl: 'https://sz.xpu.edu.cn/gate/lobby/api/oa/info',
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--tenant-id':
        args.tenantId = argv[index + 1];
        index += 1;
        break;
      case '--connector-id':
        args.connectorId = argv[index + 1];
        index += 1;
        break;
      case '--process-code':
        args.processCode = argv[index + 1] || args.processCode;
        index += 1;
        break;
      case '--process-name':
        args.processName = argv[index + 1] || args.processName;
        index += 1;
        break;
      case '--process-category':
        args.processCategory = argv[index + 1] || args.processCategory;
        index += 1;
        break;
      case '--template-id':
        args.templateId = argv[index + 1] || args.templateId;
        index += 1;
        break;
      case '--portal-url':
        args.portalUrl = argv[index + 1] || args.portalUrl;
        index += 1;
        break;
      case '--oa-info-url':
        args.oaInfoUrl = argv[index + 1] || args.oaInfoUrl;
        index += 1;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        break;
    }
  }

  return args;
}

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

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

function buildXpuLeaveRuntime(existingRuntime: unknown) {
  const runtime = asRecord(existingRuntime);

  return {
    ...runtime,
    executorMode: runtime.executorMode || 'browser',
    browserProvider: runtime.browserProvider || 'playwright',
    preflight: {
      steps: [
        {
          type: 'evaluate',
          builtin: 'capture_form_submit',
          description: '通过通用表单提交捕获插件填充页面并提取保存待发载荷',
          options: {
            frame: {
              name: 'zwIframe',
            },
            fieldMappings: [
              {
                target: { id: 'field0004' },
                sources: ['reason', 'leaveReason', 'content', 'description'],
              },
              {
                target: { id: 'field0005' },
                sources: ['startDate', 'startTime', 'leaveStart', 'beginDate'],
              },
              {
                target: { id: 'field0006' },
                sources: ['endDate', 'endTime', 'leaveEnd', 'finishDate'],
              },
              {
                target: { id: 'field0007' },
                sources: ['location', 'destination', 'place'],
              },
              {
                target: { id: 'field0008' },
                sources: ['contact', 'contactPhone', 'phone', 'mobile'],
              },
              {
                target: { id: 'field0012' },
                sources: ['returnDate', 'cancelDate', '销假日期'],
              },
            ],
            trigger: {
              text: '保存待发',
              exact: true,
              scope: 'root',
            },
            capture: {
              actionPattern: 'collaboration\\.do\\?method=saveDraft',
              timeoutMs: 10000,
            },
            output: {
              captureKey: 'saveDraft',
              fieldsKey: 'saveDraftFields',
              csrfKey: 'csrfToken',
              filledFieldsKey: 'filledFields',
              captureEventCountKey: 'captureEventCount',
            },
          },
        },
      ],
    },
    networkSubmit: {
      url: '{{preflight.saveDraft.action}}',
      method: 'POST',
      bodyMode: 'form',
      successMode: 'http2xx',
      completionKind: 'draft',
      headers: {
        Origin: 'https://oa2023.xpu.edu.cn',
        Referer: '{{jumpUrl}}',
      },
      body: {
        CSRFTOKEN: { source: 'preflight.csrfToken', default: '' },
        _json_params: { source: 'preflight.saveDraft.fields._json_params' },
      },
      responseMapping: {
        messagePath: 'msg',
      },
    },
  };
}

function mergeUiHints(existingUiHints: unknown, args: Args) {
  const existing = asRecord(existingUiHints);
  const existingExecutionModes = asRecord(existing.executionModes);
  const existingRpaDefinition = asRecord(existing.rpaDefinition);
  const existingPlatform = asRecord(existingRpaDefinition.platform);
  const existingSubmitModes = Array.isArray(existingExecutionModes.submit)
    ? existingExecutionModes.submit.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  const existingQueryModes = Array.isArray(existingExecutionModes.queryStatus)
    ? existingExecutionModes.queryStatus.filter((item: unknown): item is string => typeof item === 'string')
    : [];

  return {
    ...existing,
    executionModes: {
      ...existingExecutionModes,
      submit: Array.from(new Set(['url', ...existingSubmitModes])),
      queryStatus: Array.from(new Set(['url', ...existingQueryModes])),
    },
    rpaDefinition: {
      ...existingRpaDefinition,
      processCode: args.processCode,
      processName: args.processName,
      platform: {
        ...existingPlatform,
        entryUrl: args.portalUrl,
        jumpUrlTemplate: `https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=${args.templateId}&showTab=true`,
        portalSsoBridge: {
          ...asRecord(existingPlatform.portalSsoBridge),
          enabled: true,
          mode: 'oa_info',
          portalUrl: args.portalUrl,
          oaInfoUrl: args.oaInfoUrl,
          sourcePath: 'coordinateUrl',
          targetPathTemplate: `/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=${args.templateId}&showTab=true`,
          required: true,
        },
      },
      runtime: {
        ...buildXpuLeaveRuntime(existingRpaDefinition.runtime),
      },
    },
  };
}

async function resolveTenantId(prisma: PrismaClient, preferred?: string) {
  if (preferred) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: preferred },
      select: { id: true },
    });
    if (!tenant) {
      throw new Error(`Tenant ${preferred} not found`);
    }
    return tenant.id;
  }

  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  if (tenants.length === 0) {
    throw new Error('No tenant records found');
  }

  if (tenants.length > 1) {
    throw new Error(`Multiple tenants found, please pass --tenant-id explicitly: ${tenants.map((tenant) => `${tenant.name}(${tenant.id})`).join(', ')}`);
  }

  return tenants[0].id;
}

async function resolveConnectorId(prisma: PrismaClient, tenantId: string, preferred?: string) {
  if (preferred) {
    const connector = await prisma.connector.findFirst({
      where: {
        id: preferred,
        tenantId,
      },
      select: { id: true },
    });
    if (!connector) {
      throw new Error(`Connector ${preferred} not found in tenant ${tenantId}`);
    }
    return connector.id;
  }

  const connector = await prisma.connector.findFirst({
    where: {
      tenantId,
      oaVendor: 'xpu',
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

  if (!connector) {
    throw new Error('No XPU connector found, run ensure-xpu-whitelist-connector.ts first or pass --connector-id');
  }

  return connector.id;
}

async function main() {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const tenantId = await resolveTenantId(prisma, args.tenantId);
    const existing = await prisma.processTemplate.findFirst({
      where: {
        tenantId,
        processCode: args.processCode,
      },
      orderBy: [
        { version: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
    const connectorId = args.connectorId || existing?.connectorId || await resolveConnectorId(prisma, tenantId, args.connectorId);
    const remoteProcessId = existing?.remoteProcessId;
    if (!remoteProcessId) {
      throw new Error(`Existing process template for ${args.processCode} is missing remoteProcessId`);
    }

    const payload = {
      tenantId,
      connectorId,
      remoteProcessId,
      processCode: args.processCode,
      processName: args.processName,
      processCategory: args.processCategory,
      description: existing?.description || 'XPU OA URL 直达请假流程',
      version: existing?.version || 1,
      status: 'published',
      falLevel: existing?.falLevel || 'F2',
      schema: existing?.schema || { fields: [] },
      rules: existing?.rules || null,
      permissions: existing?.permissions || null,
      sourceVersion: existing?.sourceVersion || 'xpu-url-bridge-v1',
      sourceHash: existing?.sourceHash || null,
      uiHints: mergeUiHints(existing?.uiHints, args),
      lastSyncedAt: new Date(),
      publishedAt: existing?.publishedAt || new Date(),
    };

    if (args.dryRun) {
      console.log(JSON.stringify({
        action: existing ? 'update' : 'create',
        templateId: existing?.id || null,
        existingTemplateId: existing?.id || null,
        payload,
      }, null, 2));
      return;
    }

    if (!existing) {
      throw new Error(`No existing process template found for ${args.processCode}; create the template first or pass a matching connector/template context`);
    }

    const template = await prisma.processTemplate.update({
      where: { id: existing.id },
      data: payload,
    });

    console.log(JSON.stringify({
      success: true,
      templateId: template.id,
      remoteProcessId,
      connectorId,
      processCode: template.processCode,
      processName: template.processName,
      status: template.status,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
