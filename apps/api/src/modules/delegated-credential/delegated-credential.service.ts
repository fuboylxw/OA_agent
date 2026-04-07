import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import {
  getSchemaObjectAvailability,
  isMissingSchemaError,
  logSchemaCompatibilityFallback,
  logSchemaCompatibilityUnavailable,
  SchemaAvailabilitySnapshot,
} from '../common/prisma-schema-compat';
import {
  decryptDelegatedCredentialPayload,
  encryptDelegatedCredentialPayload,
} from './delegated-credential-crypto';

interface ResolveExecutionDelegatedAuthInput {
  tenantId: string;
  connectorId: string;
  userId?: string;
  authType: string;
  baseAuthConfig: Record<string, any>;
}

interface DelegatedAuthSettings {
  enabled: boolean;
  mode: 'mock' | 'real_b';
  headerName?: string;
  headerPrefix?: string;
  scope?: string;
  expiresInSeconds: number;
}

interface DelegatedCredentialRow {
  id: string;
  providerType: string;
  status: string;
  encryptedAccessToken: string | null;
  accessTokenExpiresAt: Date | null;
}

const DELEGATED_CREDENTIAL_SCHEMA_OBJECTS = ['user_delegated_credentials'];
const SCHEMA_AVAILABILITY_TTL_MS = 30_000;

@Injectable()
export class DelegatedCredentialService {
  private readonly logger = new Logger(DelegatedCredentialService.name);
  private readonly schemaWarnings = new Set<string>();
  private credentialSchemaSnapshot?: SchemaAvailabilitySnapshot;

  constructor(private readonly prisma: PrismaService) {}

  async seedMockCredentialsForUser(input: { tenantId: string; userId: string }) {
    if (!(await this.hasCredentialSchemaSupport('seedMockCredentialsForUser'))) {
      return 0;
    }

    const connectors = await this.prisma.connector.findMany({
      where: {
        tenantId: input.tenantId,
        status: 'active',
      },
      select: {
        id: true,
        authType: true,
        authConfig: true,
      },
    });

    let seeded = 0;
    for (const connector of connectors) {
      const settings = this.readDelegatedAuthSettings(
        connector.authConfig as Record<string, any> | null | undefined,
      );
      if (!settings.enabled || settings.mode !== 'mock') {
        continue;
      }

      await this.upsertMockCredential({
        tenantId: input.tenantId,
        userId: input.userId,
        connectorId: connector.id,
        authType: connector.authType,
        settings,
      });
      seeded += 1;
    }

    return seeded;
  }

  async resolveExecutionAuthConfig(input: ResolveExecutionDelegatedAuthInput) {
    const settings = this.readDelegatedAuthSettings(input.baseAuthConfig);
    if (!settings.enabled || !input.userId) {
      return null;
    }

    let credential = await this.loadCredential(
      input.tenantId,
      input.userId,
      input.connectorId,
    );

    if ((!credential || credential.status !== 'active') && settings.mode === 'mock') {
      credential = await this.upsertMockCredential({
        tenantId: input.tenantId,
        userId: input.userId,
        connectorId: input.connectorId,
        authType: input.authType,
        settings,
      });
    }

    if (!credential || credential.status !== 'active' || !credential.encryptedAccessToken) {
      return null;
    }

    if (credential.accessTokenExpiresAt && credential.accessTokenExpiresAt.getTime() <= Date.now()) {
      if (settings.mode !== 'mock') {
        return null;
      }

      credential = await this.upsertMockCredential({
        tenantId: input.tenantId,
        userId: input.userId,
        connectorId: input.connectorId,
        authType: input.authType,
        settings,
      });
    }

    const token = decryptDelegatedCredentialPayload<string>(credential.encryptedAccessToken);
    if (await this.hasCredentialSchemaSupport('touchCredential')) {
      await this.prisma.$executeRaw`
        UPDATE "user_delegated_credentials"
        SET "lastUsedAt" = ${new Date()}, "updatedAt" = ${new Date()}
        WHERE "id" = ${credential.id}
      `.catch(() => undefined);
    }

    return {
      providerType: credential.providerType,
      authConfig: {
        token,
        accessToken: token,
        headerName: settings.headerName,
        headerPrefix: settings.headerPrefix,
      },
    };
  }

  private async upsertMockCredential(input: {
    tenantId: string;
    userId: string;
    connectorId: string;
    authType: string;
    settings: DelegatedAuthSettings;
  }) {
    if (!(await this.hasCredentialSchemaSupport('upsertMockCredential'))) {
      return this.buildEphemeralMockCredential(input);
    }

    return this.withCredentialSchemaFallback(
      'upsertMockCredential',
      () => this.buildEphemeralMockCredential(input),
      async () => {
        const expiresAt = new Date(Date.now() + input.settings.expiresInSeconds * 1000);
        const token = this.buildMockToken(input);
        const encryptedToken = encryptDelegatedCredentialPayload(token);

        const rows = await this.prisma.$queryRaw<DelegatedCredentialRow[]>`
          INSERT INTO "user_delegated_credentials" (
            "id",
            "tenantId",
            "userId",
            "connectorId",
            "providerType",
            "subject",
            "status",
            "encryptedAccessToken",
            "accessTokenExpiresAt",
            "scope",
            "createdAt",
            "updatedAt"
          )
          VALUES (
            ${randomUUID()},
            ${input.tenantId},
            ${input.userId},
            ${input.connectorId},
            ${'mock'},
            ${input.userId},
            ${'active'},
            ${encryptedToken},
            ${expiresAt},
            ${input.settings.scope || `${input.connectorId}:delegated`},
            ${new Date()},
            ${new Date()}
          )
          ON CONFLICT ("tenantId", "userId", "connectorId")
          DO UPDATE SET
            "providerType" = EXCLUDED."providerType",
            "subject" = EXCLUDED."subject",
            "status" = EXCLUDED."status",
            "encryptedAccessToken" = EXCLUDED."encryptedAccessToken",
            "accessTokenExpiresAt" = EXCLUDED."accessTokenExpiresAt",
            "scope" = EXCLUDED."scope",
            "updatedAt" = EXCLUDED."updatedAt"
          RETURNING
            "id",
            "providerType",
            "status",
            "encryptedAccessToken",
            "accessTokenExpiresAt"
        `;

        return rows[0];
      },
    );
  }

  private readDelegatedAuthSettings(authConfig: Record<string, any> | null | undefined): DelegatedAuthSettings {
    const raw = (
      authConfig?.delegatedAuth
      && typeof authConfig.delegatedAuth === 'object'
      && !Array.isArray(authConfig.delegatedAuth)
    )
      ? authConfig.delegatedAuth as Record<string, any>
      : {};

    const mode = String(raw.mode || 'mock').toLowerCase() === 'real_b' ? 'real_b' : 'mock';
    const expiresInSeconds = Number(raw.expiresInSeconds);

    return {
      enabled: raw.enabled === true,
      mode,
      headerName: typeof raw.headerName === 'string' && raw.headerName.trim()
        ? raw.headerName.trim()
        : undefined,
      headerPrefix: typeof raw.headerPrefix === 'string'
        ? raw.headerPrefix
        : undefined,
      scope: typeof raw.scope === 'string' && raw.scope.trim()
        ? raw.scope.trim()
        : undefined,
      expiresInSeconds: Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? Math.floor(expiresInSeconds)
        : 60 * 60,
    };
  }

  private buildMockToken(input: { tenantId: string; userId: string; connectorId: string; authType: string }) {
    const tokenId = randomUUID().replace(/-/g, '');
    return [
      'mock',
      input.tenantId,
      input.userId,
      input.connectorId,
      input.authType,
      tokenId,
    ].join('.');
  }

  private async loadCredential(tenantId: string, userId: string, connectorId: string) {
    if (!(await this.hasCredentialSchemaSupport('loadCredential'))) {
      return null;
    }

    return this.withCredentialSchemaFallback('loadCredential', null, async () => {
      const rows = await this.prisma.$queryRaw<DelegatedCredentialRow[]>`
        SELECT
          "id",
          "providerType",
          "status",
          "encryptedAccessToken",
          "accessTokenExpiresAt"
        FROM "user_delegated_credentials"
        WHERE "tenantId" = ${tenantId}
          AND "userId" = ${userId}
          AND "connectorId" = ${connectorId}
        LIMIT 1
      `;

      return rows[0] || null;
    });
  }

  private buildEphemeralMockCredential(input: {
    tenantId: string;
    userId: string;
    connectorId: string;
    authType: string;
    settings: DelegatedAuthSettings;
  }): DelegatedCredentialRow {
    const expiresAt = new Date(Date.now() + input.settings.expiresInSeconds * 1000);
    const token = this.buildMockToken(input);
    return {
      id: randomUUID(),
      providerType: 'mock',
      status: 'active',
      encryptedAccessToken: encryptDelegatedCredentialPayload(token),
      accessTokenExpiresAt: expiresAt,
    };
  }

  private async withCredentialSchemaFallback<T>(
    operation: string,
    fallback: T | (() => Promise<T> | T),
    task: () => Promise<T>,
  ): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (!isMissingSchemaError(error, DELEGATED_CREDENTIAL_SCHEMA_OBJECTS)) {
        throw error;
      }

      logSchemaCompatibilityFallback({
        logger: this.logger,
        warningCache: this.schemaWarnings,
        featureKey: 'delegated-credential',
        identifiers: DELEGATED_CREDENTIAL_SCHEMA_OBJECTS,
        operation,
        error,
      });

      return typeof fallback === 'function'
        ? await (fallback as (() => Promise<T> | T))()
        : fallback;
    }
  }

  private async hasCredentialSchemaSupport(operation: string) {
    const snapshot = await getSchemaObjectAvailability({
      prisma: this.prisma,
      identifiers: DELEGATED_CREDENTIAL_SCHEMA_OBJECTS,
      cache: this.credentialSchemaSnapshot,
      ttlMs: SCHEMA_AVAILABILITY_TTL_MS,
    });
    this.credentialSchemaSnapshot = snapshot;
    if (snapshot.available) {
      return true;
    }

    logSchemaCompatibilityUnavailable({
      logger: this.logger,
      warningCache: this.schemaWarnings,
      featureKey: 'delegated-credential',
      identifiers: snapshot.missing,
      operation,
    });
    return false;
  }
}
