import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const PRISMA_MISSING_SCHEMA_CODES = new Set(['P2021', 'P2022']);
const RAW_QUERY_MISSING_SCHEMA_CODES = new Set(['42P01', '42703']);
const DEFAULT_SCHEMA_CACHE_TTL_MS = 30_000;

export interface SchemaAvailabilitySnapshot {
  available: boolean;
  missing: string[];
  checkedAt: number;
}

export function isMissingSchemaError(error: unknown, identifiers: string[] = []): boolean {
  const normalizedIdentifiers = identifiers
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const normalizedMessage = normalizeText(extractErrorMessage(error));
  const matchesIdentifier = normalizedIdentifiers.length === 0
    || normalizedIdentifiers.some((identifier) =>
      normalizedMessage.includes(identifier)
      || normalizedMessage.includes(`public.${identifier}`),
    );

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (PRISMA_MISSING_SCHEMA_CODES.has(error.code)) {
      return matchesIdentifier;
    }

    if (error.code === 'P2010') {
      const meta = (error.meta && typeof error.meta === 'object')
        ? error.meta as Record<string, unknown>
        : undefined;
      const databaseCode = String(meta?.code || meta?.dbCode || '').trim();
      if (RAW_QUERY_MISSING_SCHEMA_CODES.has(databaseCode)) {
        return matchesIdentifier;
      }
    }
  }

  if (!matchesIdentifier) {
    return false;
  }

  return normalizedMessage.includes('does not exist in the current database')
    || (normalizedMessage.includes('relation') && normalizedMessage.includes('does not exist'))
    || (normalizedMessage.includes('column') && normalizedMessage.includes('does not exist'))
    || (normalizedMessage.includes('table') && normalizedMessage.includes('does not exist'));
}

export function logSchemaCompatibilityFallback(input: {
  logger: Logger;
  warningCache: Set<string>;
  featureKey: string;
  identifiers: string[];
  operation: string;
  error: unknown;
}) {
  const warningKey = `${input.featureKey}:${input.operation}`;
  if (input.warningCache.has(warningKey)) {
    return;
  }
  input.warningCache.add(warningKey);

  const identifiersText = input.identifiers.length > 0
    ? input.identifiers.join(', ')
    : 'schema objects';
  const detail = extractErrorMessage(input.error).split(/\r?\n/, 1)[0];

  input.logger.warn(
    `Schema compatibility fallback for ${input.featureKey}.${input.operation}: `
      + `missing ${identifiersText}. ${detail}`,
  );
}

export function logSchemaCompatibilityUnavailable(input: {
  logger: Logger;
  warningCache: Set<string>;
  featureKey: string;
  identifiers: string[];
  operation: string;
}) {
  const warningKey = `${input.featureKey}:${input.operation}`;
  if (input.warningCache.has(warningKey)) {
    return;
  }
  input.warningCache.add(warningKey);

  const identifiersText = input.identifiers.length > 0
    ? input.identifiers.join(', ')
    : 'schema objects';

  input.logger.warn(
    `Schema compatibility skip for ${input.featureKey}.${input.operation}: `
      + `missing ${identifiersText}.`,
  );
}

export async function getSchemaObjectAvailability(input: {
  prisma: {
    $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
  };
  identifiers: string[];
  cache?: SchemaAvailabilitySnapshot;
  ttlMs?: number;
}): Promise<SchemaAvailabilitySnapshot> {
  const ttlMs = Number.isFinite(input.ttlMs) && Number(input.ttlMs) > 0
    ? Number(input.ttlMs)
    : DEFAULT_SCHEMA_CACHE_TTL_MS;
  const now = Date.now();

  if (input.cache && now - input.cache.checkedAt < ttlMs) {
    return input.cache;
  }

  const identifiers = Array.from(new Set(
    input.identifiers
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
  if (identifiers.length === 0) {
    return {
      available: true,
      missing: [],
      checkedAt: now,
    };
  }

  const rows = await input.prisma.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN (${Prisma.join(identifiers.map((identifier) => Prisma.sql`${identifier}`))})
  `);
  const present = new Set(
    rows
      .map((row) => String(row.table_name || '').trim())
      .filter(Boolean),
  );
  const missing = identifiers.filter((identifier) => !present.has(identifier));

  return {
    available: missing.length === 0,
    missing,
    checkedAt: now,
  };
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.toString();
  }

  return String(error || '');
}

function normalizeText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`"]/g, '')
    .trim();
}
