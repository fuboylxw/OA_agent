import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

type Args = {
  tenantId?: string;
  connectorId?: string;
  name: string;
  baseUrl: string;
  entryUrl: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    name: '西安工程大学统一认证门户',
    baseUrl: 'https://sz.xpu.edu.cn',
    entryUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
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
      case '--name':
        args.name = argv[index + 1] || args.name;
        index += 1;
        break;
      case '--base-url':
        args.baseUrl = argv[index + 1] || args.baseUrl;
        index += 1;
        break;
      case '--entry-url':
        args.entryUrl = argv[index + 1] || args.entryUrl;
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
  const envPath = path.resolve(process.cwd(), '../../.env');
  if (!fs.existsSync(envPath)) {
    return;
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

function buildAuthConfig(baseUrl: string, entryUrl: string) {
  return {
    platformConfig: {
      entryUrl,
      cookieOrigin: baseUrl,
      oaBackendLogin: {
        enabled: true,
        loginUrl: `${baseUrl.replace(/\/+$/, '')}/auth2/api/v1/login`,
        method: 'GET',
        requestMode: 'query',
        accountField: 'username',
        timestampMode: 'millis',
        signDigest: 'sm3',
        signEncoding: 'hex',
        responseSuccessPath: 'status',
        responseSuccessValue: 'success',
        persistBinding: true,
        bindingName: '西工程白名单登录会话',
      },
    },
  };
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

function mergeAuthConfig(existingAuthConfig: unknown, baseUrl: string, entryUrl: string) {
  const generated = buildAuthConfig(baseUrl, entryUrl);
  const existing = asRecord(existingAuthConfig);
  const existingPlatformConfig = asRecord(existing.platformConfig);
  const generatedPlatformConfig = asRecord(generated.platformConfig);

  return {
    ...existing,
    ...generated,
    platformConfig: {
      ...existingPlatformConfig,
      ...generatedPlatformConfig,
      oaBackendLogin: {
        ...asRecord(existingPlatformConfig.oaBackendLogin),
        ...asRecord(generatedPlatformConfig.oaBackendLogin),
      },
    },
  };
}

function buildCapabilityPayload(existingMetadata?: Record<string, any>) {
  return {
    supportsDiscovery: true,
    supportsSchemaSync: true,
    supportsReferenceSync: true,
    supportsStatusPull: true,
    supportsWebhook: false,
    supportsCancel: true,
    supportsUrge: true,
    supportsDelegate: false,
    supportsSupplement: false,
    supportsRealtimePerm: true,
    supportsIdempotency: false,
    syncModes: ['full'],
    metadata: {
      ...(existingMetadata || {}),
      inferredFrom: existingMetadata ? 'xpu_whitelist_connector_update' : 'xpu_whitelist_connector_seed',
      oclLevel: 'OCL3',
      syncPolicy: {
        enabled: true,
        domains: {
          schema: { enabled: true, intervalMinutes: 360 },
          reference: { enabled: true, intervalMinutes: 120 },
          status: { enabled: true, intervalMinutes: 10 },
        },
      },
    },
  };
}

async function resolveTenantId(prisma: PrismaClient, preferred?: string) {
  if (preferred) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: preferred },
      select: { id: true, name: true },
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

async function main() {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const tenantId = await resolveTenantId(prisma, args.tenantId);
    const existing = await prisma.connector.findFirst({
      where: {
        tenantId,
        ...(args.connectorId
          ? { id: args.connectorId }
          : { name: args.name }),
      },
      include: {
        capability: true,
      },
    });

    const authConfig = mergeAuthConfig(existing?.authConfig, args.baseUrl, args.entryUrl);

    const payload = {
      tenantId,
      name: existing?.name || args.name,
      oaType: existing?.oaType || 'hybrid',
      oaVendor: existing?.oaVendor || 'xpu',
      oaVersion: existing?.oaVersion || 'unified-portal',
      baseUrl: args.baseUrl,
      authType: existing?.authType || 'cookie',
      authConfig,
      healthCheckUrl: args.baseUrl,
      oclLevel: existing?.oclLevel || 'OCL3',
      falLevel: existing?.falLevel || 'F2',
      status: 'active',
    } as const;

    if (args.dryRun) {
      console.log(JSON.stringify({
        action: existing ? 'update' : 'create',
        connectorId: existing?.id || null,
        payload,
      }, null, 2));
      return;
    }

    const connector = existing
      ? await prisma.connector.update({
          where: { id: existing.id },
          data: payload,
        })
      : await prisma.connector.create({
          data: payload,
        });

    await prisma.connectorCapability.upsert({
      where: { connectorId: connector.id },
      create: {
        tenantId,
        connectorId: connector.id,
        ...buildCapabilityPayload(),
      },
      update: buildCapabilityPayload(existing?.capability?.metadata as Record<string, any> | undefined),
    });

    console.log(JSON.stringify({
      success: true,
      action: existing ? 'updated' : 'created',
      connectorId: connector.id,
      tenantId,
      name: connector.name,
      baseUrl: connector.baseUrl,
      authType: connector.authType,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
