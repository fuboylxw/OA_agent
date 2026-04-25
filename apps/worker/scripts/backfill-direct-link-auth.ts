import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { BootstrapProcessor } from '../src/processors/bootstrap.processor';

type Args = {
  tenantId?: string;
  jobId?: string;
  connectorId?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--tenant-id':
        args.tenantId = argv[index + 1];
        index += 1;
        break;
      case '--job-id':
        args.jobId = argv[index + 1];
        index += 1;
        break;
      case '--connector-id':
        args.connectorId = argv[index + 1];
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

function deepMerge(base: unknown, patch: unknown): Record<string, any> {
  const left = asRecord(base);
  const right = asRecord(patch);
  const result: Record<string, any> = { ...left };

  for (const [key, value] of Object.entries(right)) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && left[key]
      && typeof left[key] === 'object'
      && !Array.isArray(left[key])
    ) {
      result[key] = deepMerge(left[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function normalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForCompare(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForCompare(item)]),
    );
  }

  return value;
}

function stableStringify(value: unknown) {
  return JSON.stringify(normalizeForCompare(value));
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

async function main() {
  loadRootEnv();
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const tenantId = await resolveTenantId(prisma, args.tenantId);
    const processor = new BootstrapProcessor(prisma as any);
    const jobs = await prisma.bootstrapJob.findMany({
      where: {
        tenantId,
        ...(args.jobId ? { id: args.jobId } : {}),
        ...(args.connectorId ? { connectorId: args.connectorId } : {}),
        status: {
          in: ['PUBLISHED', 'PARTIALLY_PUBLISHED'],
        },
      },
      include: {
        sources: true,
        connector: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const results: Array<Record<string, any>> = [];

    for (const job of jobs) {
      const connectorAuthConfig = asRecord(job.connector?.authConfig);
      const bootstrapAuthConfig = asRecord(job.authConfig);
      const mergedBootstrapJob = {
        ...job,
        authConfig: deepMerge(connectorAuthConfig, bootstrapAuthConfig),
      };

      const rpaDefinitions = (processor as any).getRpaDefinitions(mergedBootstrapJob);
      const directLinkDefinitions = rpaDefinitions.filter((definition: any) =>
        (processor as any).isDirectLinkDefinition(definition),
      );
      if (directLinkDefinitions.length === 0) {
        continue;
      }

      const resolvedBaseUrl = (processor as any).resolveBaseUrl(mergedBootstrapJob);
      const inferredAuthConfig = (processor as any).inferBootstrapExecutionAuthConfig({
        bootstrapJob: mergedBootstrapJob,
        rpaDefinitions,
        resolvedBaseUrl,
      });

      const nextBootstrapAuthConfig = deepMerge(bootstrapAuthConfig, inferredAuthConfig);
      const nextConnectorAuthConfig = deepMerge(connectorAuthConfig, inferredAuthConfig);
      const nextConnectorAuthType = String((nextConnectorAuthConfig as Record<string, any>).authType || job.connector?.authType || 'cookie').trim() || 'cookie';
      const nextConnectorBaseUrl = resolvedBaseUrl || job.connector?.baseUrl || job.oaUrl || null;

      const bootstrapChanged = stableStringify(bootstrapAuthConfig) !== stableStringify(nextBootstrapAuthConfig);
      const connectorChanged = stableStringify(connectorAuthConfig) !== stableStringify(nextConnectorAuthConfig)
        || nextConnectorAuthType !== (job.connector?.authType || '')
        || (nextConnectorBaseUrl || '') !== (job.connector?.baseUrl || '');

      results.push({
        jobId: job.id,
        connectorId: job.connectorId,
        connectorName: job.connector?.name || null,
        directLinkProcessCount: directLinkDefinitions.length,
        resolvedBaseUrl,
        bootstrapChanged,
        connectorChanged,
        nextBootstrapAuthConfig,
        nextConnectorAuthConfig,
        nextConnectorAuthType,
        nextConnectorBaseUrl,
      });

      if (args.dryRun || (!bootstrapChanged && !connectorChanged)) {
        continue;
      }

      await prisma.$transaction(async (tx) => {
        if (bootstrapChanged) {
          await tx.bootstrapJob.update({
            where: { id: job.id },
            data: {
              authConfig: nextBootstrapAuthConfig as any,
            },
          });
        }

        if (job.connectorId && connectorChanged) {
          await tx.connector.update({
            where: { id: job.connectorId },
            data: {
              authType: nextConnectorAuthType,
              ...(nextConnectorBaseUrl ? { baseUrl: nextConnectorBaseUrl } : {}),
              authConfig: nextConnectorAuthConfig as any,
            },
          });
        }
      });
    }

    console.log(JSON.stringify({
      tenantId,
      dryRun: args.dryRun,
      matchedJobs: results.length,
      updatedJobs: results.filter((item) => item.bootstrapChanged).length,
      updatedConnectors: results.filter((item) => item.connectorChanged).length,
      results,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
