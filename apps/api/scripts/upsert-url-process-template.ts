import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

type Args = {
  configPath?: string;
  tenantId?: string;
  connectorId?: string;
  remoteProcessId?: string;
  oaVendor?: string;
  dryRun: boolean;
};

type UrlProcessTemplateConfig = {
  tenantId?: string;
  connectorId?: string;
  remoteProcessId?: string;
  oaVendor?: string;
  processCode: string;
  processName: string;
  processCategory?: string;
  description?: string;
  status?: string;
  falLevel?: string;
  version?: number;
  sourceVersion?: string;
  sourceHash?: string | null;
  schema?: Record<string, any>;
  rules?: Record<string, any> | null;
  permissions?: Record<string, any> | null;
  executionModes?: {
    submit?: string[];
    queryStatus?: string[];
  };
  platform?: Record<string, any>;
  runtime?: Record<string, any>;
};

function resolveScriptDir() {
  if (typeof __dirname === 'string' && __dirname.trim()) {
    return __dirname;
  }
  return process.cwd();
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--config':
        args.configPath = argv[index + 1];
        index += 1;
        break;
      case '--tenant-id':
        args.tenantId = argv[index + 1];
        index += 1;
        break;
      case '--connector-id':
        args.connectorId = argv[index + 1];
        index += 1;
        break;
      case '--remote-process-id':
        args.remoteProcessId = argv[index + 1];
        index += 1;
        break;
      case '--oa-vendor':
        args.oaVendor = argv[index + 1];
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

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function uniqueModes(...groups: Array<unknown>) {
  return Array.from(new Set(groups.flatMap((group) => asStringArray(group))));
}

function computeSourceHash(config: UrlProcessTemplateConfig) {
  return JSON.stringify({
    processCode: config.processCode,
    processName: config.processName,
    executionModes: config.executionModes || null,
    platform: config.platform || null,
    runtime: config.runtime || null,
    schema: config.schema || null,
  });
}

function resolveConfigPath(configPath: string) {
  const scriptDir = resolveScriptDir();
  const candidates = [
    path.resolve(process.cwd(), configPath),
    path.resolve(scriptDir, configPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Config file not found: ${configPath}`);
}

function loadConfig(configPath: string): UrlProcessTemplateConfig {
  const resolvedPath = resolveConfigPath(configPath);
  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as UrlProcessTemplateConfig;

  if (!raw.processCode?.trim()) {
    throw new Error(`Invalid config ${resolvedPath}: processCode is required`);
  }
  if (!raw.processName?.trim()) {
    throw new Error(`Invalid config ${resolvedPath}: processName is required`);
  }

  return raw;
}

function mergeUiHints(existingUiHints: unknown, config: UrlProcessTemplateConfig) {
  const existing = asRecord(existingUiHints);
  const existingExecutionModes = asRecord(existing.executionModes);
  const existingRpaDefinition = asRecord(existing.rpaDefinition);
  const existingPlatform = asRecord(existingRpaDefinition.platform);
  const existingRuntime = asRecord(existingRpaDefinition.runtime);
  const requestedExecutionModes = asRecord(config.executionModes);
  const schemaFields = Array.isArray(config.schema?.fields)
    ? config.schema.fields
    : Array.isArray(existingRpaDefinition.fields)
      ? existingRpaDefinition.fields
      : [];

  const submitModes = uniqueModes(
    ['url'],
    requestedExecutionModes.submit,
    existingExecutionModes.submit,
  );
  const queryModes = uniqueModes(
    requestedExecutionModes.queryStatus,
    existingExecutionModes.queryStatus,
  );

  return {
    ...existing,
    executionModes: {
      ...existingExecutionModes,
      submit: submitModes,
      ...(queryModes.length > 0 ? { queryStatus: queryModes } : {}),
    },
    rpaDefinition: {
      ...existingRpaDefinition,
      processCode: config.processCode,
      processName: config.processName,
      fields: schemaFields,
      platform: {
        ...existingPlatform,
        ...asRecord(config.platform),
      },
      runtime: {
        ...existingRuntime,
        ...asRecord(config.runtime),
      },
    },
    endpoints: [],
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

async function resolveConnectorId(
  prisma: PrismaClient,
  tenantId: string,
  input: {
    preferred?: string;
    oaVendor?: string;
  },
) {
  if (input.preferred) {
    const connector = await prisma.connector.findFirst({
      where: {
        id: input.preferred,
        tenantId,
      },
      select: { id: true },
    });
    if (!connector) {
      throw new Error(`Connector ${input.preferred} not found in tenant ${tenantId}`);
    }
    return connector.id;
  }

  const connectors = await prisma.connector.findMany({
    where: {
      tenantId,
      ...(input.oaVendor?.trim() ? { oaVendor: input.oaVendor.trim() } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, oaVendor: true },
  });

  if (connectors.length === 0) {
    throw new Error(input.oaVendor
      ? `No connector found for oaVendor=${input.oaVendor} in tenant ${tenantId}; pass --connector-id explicitly`
      : `No connector found in tenant ${tenantId}; pass --connector-id explicitly`);
  }

  if (connectors.length > 1) {
    throw new Error(`Multiple connectors matched, please pass --connector-id explicitly: ${connectors.map((connector) => `${connector.name}(${connector.id}, ${connector.oaVendor || 'unknown'})`).join(', ')}`);
  }

  return connectors[0].id;
}

async function main() {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.configPath) {
    throw new Error('Missing --config <path>');
  }

  const config = loadConfig(args.configPath);
  const prisma = new PrismaClient();

  try {
    const tenantId = await resolveTenantId(prisma, args.tenantId || config.tenantId);
    const existing = await prisma.processTemplate.findFirst({
      where: {
        tenantId,
        processCode: config.processCode,
      },
      orderBy: [
        { version: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    const connectorId = args.connectorId
      || config.connectorId
      || existing?.connectorId
      || await resolveConnectorId(prisma, tenantId, {
        preferred: undefined,
        oaVendor: args.oaVendor || config.oaVendor,
      });
    const remoteProcessLookupId = args.remoteProcessId
      || config.remoteProcessId
      || existing?.remoteProcessId;
    const remoteProcessSourceId = String(config.remoteProcessId || config.processCode).trim();
    if (!remoteProcessSourceId) {
      throw new Error(`Missing remoteProcessId/processCode for ${config.processCode}`);
    }

    const sourceHash = config.sourceHash !== undefined
      ? config.sourceHash
      : computeSourceHash(config);

    let remoteProcess = remoteProcessLookupId
      ? await prisma.remoteProcess.findFirst({
          where: {
            id: remoteProcessLookupId,
            tenantId,
            connectorId,
          },
        })
      : null;

    if (!remoteProcess) {
      remoteProcess = await prisma.remoteProcess.upsert({
        where: {
          connectorId_remoteProcessId: {
            connectorId,
            remoteProcessId: remoteProcessSourceId,
          },
        },
        create: {
          tenantId,
          connectorId,
          remoteProcessId: remoteProcessSourceId,
          remoteProcessCode: config.processCode,
          remoteProcessName: config.processName,
          processCategory: config.processCategory || existing?.processCategory || '未分类',
          sourceVersion: config.sourceVersion || existing?.sourceVersion || 'url-bridge-config-v1',
          sourceHash: sourceHash || computeSourceHash(config),
          status: 'active',
          metadata: {
            source: 'url_process_template_upsert',
            processCode: config.processCode,
            processName: config.processName,
          },
          lastSchemaSyncAt: new Date(),
        },
        update: {
          remoteProcessCode: config.processCode,
          remoteProcessName: config.processName,
          processCategory: config.processCategory || existing?.processCategory || '未分类',
          sourceVersion: config.sourceVersion || existing?.sourceVersion || 'url-bridge-config-v1',
          sourceHash: sourceHash || computeSourceHash(config),
          status: 'active',
          metadata: {
            source: 'url_process_template_upsert',
            processCode: config.processCode,
            processName: config.processName,
          },
          lastSchemaSyncAt: new Date(),
        },
      });
    }

    const payload = {
      tenantId,
      connectorId,
      remoteProcessId: remoteProcess.id,
      processCode: config.processCode,
      processName: config.processName,
      processCategory: config.processCategory || existing?.processCategory || '未分类',
      description: config.description || existing?.description || `${config.processName} URL 直达流程`,
      version: config.version || existing?.version || 1,
      status: config.status || existing?.status || 'published',
      falLevel: config.falLevel || existing?.falLevel || 'F2',
      schema: config.schema || existing?.schema || { fields: [] },
      rules: config.rules !== undefined ? config.rules : existing?.rules || null,
      permissions: config.permissions !== undefined ? config.permissions : existing?.permissions || null,
      sourceVersion: config.sourceVersion || existing?.sourceVersion || 'url-bridge-config-v1',
      sourceHash: sourceHash !== undefined ? sourceHash : existing?.sourceHash || null,
      uiHints: mergeUiHints(existing?.uiHints, config),
      lastSyncedAt: new Date(),
      publishedAt: existing?.publishedAt || new Date(),
    };

    if (args.dryRun) {
      console.log(JSON.stringify({
        action: existing ? 'update' : 'create',
        templateId: existing?.id || null,
        configPath: resolveConfigPath(args.configPath),
        payload,
      }, null, 2));
      return;
    }

    const template = existing
      ? await prisma.processTemplate.update({
          where: { id: existing.id },
          data: payload,
        })
      : await prisma.processTemplate.create({
          data: payload as any,
        });

    await prisma.remoteProcess.update({
      where: { id: remoteProcess.id },
      data: {
        latestTemplateId: template.id,
        sourceVersion: payload.sourceVersion,
        sourceHash: payload.sourceHash,
      },
    });

    console.log(JSON.stringify({
      success: true,
      action: existing ? 'update' : 'create',
      templateId: template.id,
      remoteProcessId: remoteProcess.id,
      remoteProcessSourceId: remoteProcess.remoteProcessId,
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
