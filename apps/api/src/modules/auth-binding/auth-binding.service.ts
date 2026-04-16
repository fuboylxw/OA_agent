import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import {
  createHash,
  randomBytes,
  randomUUID,
} from 'crypto';
import { PrismaService } from '../common/prisma.service';
import {
  getSchemaObjectAvailability,
  isMissingSchemaError,
  logSchemaCompatibilityFallback,
  logSchemaCompatibilityUnavailable,
  SchemaAvailabilitySnapshot,
} from '../common/prisma-schema-compat';
import { decryptAuthBindingPayload, encryptAuthBindingPayload } from './auth-binding-crypto';
import { CreateAuthBindingDto, UpsertAuthSessionAssetDto } from './dto';

const PRIVILEGED_ROLES = new Set(['admin', 'flow_manager']);
const AUTH_BINDING_SCHEMA_OBJECTS = ['auth_bindings', 'auth_session_assets'];
const SCHEMA_AVAILABILITY_TTL_MS = 30_000;

interface BindingActor {
  tenantId: string;
  userId?: string;
  roles: string[];
}

interface ResolveExecutionAuthInput {
  tenantId: string;
  connectorId: string;
  userId?: string;
  authBindingId?: string | null;
}

interface DelegatedAuthActor extends BindingActor {}

interface DelegatedAuthConfig {
  enabled: boolean;
  provider: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  redirectUri?: string;
  clientId?: string;
  clientSecret?: string;
  scopes: string[];
  audience?: string;
  resource?: string;
  authorizeParams?: Record<string, string>;
  prompt?: string;
  callbackPath?: string;
  exchange?: {
    enabled: boolean;
    tokenUrl?: string;
    clientId?: string;
    clientSecret?: string;
    audience?: string;
    resource?: string;
    scope?: string;
    grantType?: string;
    subjectTokenType?: string;
    requestedTokenType?: string;
    applyToPlatformServiceToken?: boolean;
    extraParams?: Record<string, string>;
  };
}

interface PendingDelegatedAuthChallenge {
  challengeId: string;
  connectorId: string;
  connectorName?: string;
  processCode?: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  state: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  startedAt: string;
  expiresAt: string;
  errorMessage?: string;
  completedAt?: string;
  bindingId?: string;
}

interface DelegatedAuthBindingStatus {
  authorized: boolean;
  bindingId?: string;
  bindingName?: string | null;
  lastBoundAt?: string | null;
}

interface BeginDelegatedAuthInput {
  connectorId: string;
  sessionId: string;
  requestBaseUrl: string;
  processCode?: string;
}

interface BeginDelegatedAuthResult {
  redirectUrl?: string;
  alreadyAuthorized: boolean;
  statusUrl: string;
  connectorName: string;
}

export interface DelegatedAuthStatusResult {
  connectorId: string;
  connectorName: string;
  status: 'bound' | 'pending' | 'expired' | 'failed' | 'not_bound';
  bindingId?: string;
  lastBoundAt?: string | null;
  errorMessage?: string;
  authRequired: boolean;
}

interface CompleteDelegatedAuthInput {
  connectorId: string;
  state?: string | null;
  code?: string | null;
  error?: string | null;
  errorDescription?: string | null;
  requestBaseUrl: string;
}

interface CompleteDelegatedAuthResult {
  success: boolean;
  sessionId?: string;
  connectorId: string;
  connectorName?: string;
  message: string;
  statusUrl?: string;
}

interface DelegatedTokenSetPayload {
  provider?: string;
  subject?: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  audience?: string;
  resource?: string;
}

@Injectable()
export class AuthBindingService {
  private readonly logger = new Logger(AuthBindingService.name);
  private readonly schemaWarnings = new Set<string>();
  private bindingSchemaSnapshot?: SchemaAvailabilitySnapshot;

  constructor(private readonly prisma: PrismaService) {}

  async createBinding(actor: BindingActor, dto: CreateAuthBindingDto) {
    await this.assertConnectorAccessible(dto.connectorId, actor.tenantId);

    const ownerType = dto.ownerType || 'user';
    const targetUserId = this.resolveTargetUserId(actor, ownerType, dto.userId);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.authBinding.updateMany({
          where: {
            tenantId: actor.tenantId,
            connectorId: dto.connectorId,
            ownerType,
            ...(targetUserId ? { userId: targetUserId } : { userId: null }),
          },
          data: {
            isDefault: false,
          },
        });
      }

      const created = await tx.authBinding.create({
        data: {
          tenantId: actor.tenantId,
          connectorId: dto.connectorId,
          userId: targetUserId || null,
          bindingName: dto.bindingName?.trim() || null,
          ownerType,
          authType: dto.authType,
          authMode: dto.authMode,
          status: 'active',
          isDefault: Boolean(dto.isDefault),
          metadata: dto.metadata || undefined,
        },
        include: {
          sessionAssets: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      return this.sanitizeBinding(created);
    });
  }

  async listBindings(
    actor: BindingActor,
    options?: {
      connectorId?: string;
      includeAllUsers?: boolean;
    },
  ) {
    if (!(await this.hasBindingSchemaSupport('listBindings'))) {
      return [];
    }

    return this.withBindingSchemaFallback('listBindings', [], async () => {
      const includeAllUsers = Boolean(options?.includeAllUsers && this.isPrivileged(actor.roles));

      const bindings = await this.prisma.authBinding.findMany({
        where: {
          tenantId: actor.tenantId,
          ...(options?.connectorId ? { connectorId: options.connectorId } : {}),
          ...(includeAllUsers
            ? {}
            : { userId: actor.userId || '__missing_user__' }),
        },
        include: {
          sessionAssets: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
        orderBy: [
          { isDefault: 'desc' },
          { updatedAt: 'desc' },
        ],
      });

      return bindings.map((binding) => this.sanitizeBinding(binding));
    });
  }

  async getBinding(actor: BindingActor, id: string) {
    const binding = await this.loadBindingOrThrow(id, actor.tenantId);
    this.assertBindingAccess(binding, actor, 'read');
    return this.sanitizeBinding(binding);
  }

  async markDefault(actor: BindingActor, id: string) {
    const binding = await this.loadBindingOrThrow(id, actor.tenantId);
    this.assertBindingAccess(binding, actor, 'write');

    return this.prisma.$transaction(async (tx) => {
      await tx.authBinding.updateMany({
        where: {
          tenantId: binding.tenantId,
          connectorId: binding.connectorId,
          ownerType: binding.ownerType,
          ...(binding.userId ? { userId: binding.userId } : { userId: null }),
        },
        data: {
          isDefault: false,
        },
      });

      const updated = await tx.authBinding.update({
        where: { id: binding.id },
        data: {
          isDefault: true,
          status: 'active',
        },
        include: {
          sessionAssets: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      return this.sanitizeBinding(updated);
    });
  }

  async upsertSessionAsset(actor: BindingActor, bindingId: string, dto: UpsertAuthSessionAssetDto) {
    const binding = await this.loadBindingOrThrow(bindingId, actor.tenantId);
    this.assertBindingAccess(binding, actor, 'write');

    if (dto.payload === undefined) {
      throw new BadRequestException('Sensitive session payload is required');
    }

    return this.prisma.$transaction(async (tx) => {
      if ((dto.status || 'active') === 'active') {
        await tx.authSessionAsset.updateMany({
          where: {
            authBindingId: binding.id,
            assetType: dto.assetType,
            status: 'active',
          },
          data: {
            status: 'stale',
          },
        });
      }

      await tx.authSessionAsset.create({
        data: {
          tenantId: binding.tenantId,
          authBindingId: binding.id,
          assetType: dto.assetType,
          status: dto.status || 'active',
          encryptedPayload: encryptAuthBindingPayload(dto.payload),
          issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : new Date(),
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
          metadata: dto.metadata || undefined,
        },
      });

      const updated = await tx.authBinding.update({
        where: { id: binding.id },
        data: {
          lastBoundAt: new Date(),
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : binding.expiresAt,
          status: dto.status === 'revoked' ? 'inactive' : 'active',
        },
        include: {
          sessionAssets: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      return this.sanitizeBinding(updated);
    });
  }

  async hasUsableBinding(input: {
    tenantId: string;
    connectorId: string;
    userId?: string;
    authBindingId?: string | null;
  }): Promise<DelegatedAuthBindingStatus> {
    if (!(await this.hasBindingSchemaSupport('hasUsableBinding'))) {
      return { authorized: false };
    }

    return this.withBindingSchemaFallback('hasUsableBinding', { authorized: false }, async () => {
      const binding = await this.resolveBindingForExecution(input);
      if (!binding) {
        return { authorized: false };
      }

      const assetCount = await this.prisma.authSessionAsset.count({
        where: {
          tenantId: input.tenantId,
          authBindingId: binding.id,
          status: 'active',
        },
      });

      return {
        authorized: assetCount > 0,
        bindingId: binding.id,
        bindingName: binding.bindingName || null,
        lastBoundAt: binding.lastBoundAt ? binding.lastBoundAt.toISOString() : null,
      };
    });
  }

  async beginDelegatedAuth(actor: DelegatedAuthActor, input: BeginDelegatedAuthInput): Promise<BeginDelegatedAuthResult> {
    const connector = await this.loadDelegatedConnectorOrThrow(input.connectorId, actor.tenantId);
    const delegatedAuth = this.readDelegatedAuthConfig(
      connector.authConfig as Record<string, any> | null | undefined,
    );
    const session = await this.loadChatSessionOrThrow(input.sessionId, actor.tenantId, actor.userId);

    const existingBinding = await this.hasUsableBinding({
      tenantId: actor.tenantId,
      connectorId: input.connectorId,
      userId: actor.userId,
    });
    const statusUrl = this.buildDelegatedAuthStatusUrl(input.connectorId, input.sessionId);

    if (existingBinding.authorized) {
      await this.updateDelegatedChallengeState(session.id, {
        connectorId: input.connectorId,
        connectorName: connector.name,
        processCode: input.processCode,
        status: 'completed',
        bindingId: existingBinding.bindingId,
      });
      return {
        alreadyAuthorized: true,
        statusUrl,
        connectorName: connector.name,
      };
    }

    const challengeId = randomUUID();
    const codeVerifier = this.generatePkceVerifier();
    const nonce = randomUUID();
    const state = this.encodeDelegatedAuthState({
      sessionId: session.id,
      challengeId,
    });
    const redirectUri = delegatedAuth.redirectUri
      || this.buildDelegatedCallbackUrl(input.requestBaseUrl, input.connectorId, delegatedAuth.callbackPath);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const challenge: PendingDelegatedAuthChallenge = {
      challengeId,
      connectorId: input.connectorId,
      connectorName: connector.name,
      processCode: input.processCode,
      status: 'pending',
      state,
      codeVerifier,
      nonce,
      redirectUri,
      startedAt: new Date().toISOString(),
      expiresAt,
    };

    await this.writeDelegatedChallenge(session.id, challenge);

    return {
      redirectUrl: this.buildDelegatedAuthorizeUrl(delegatedAuth, {
        state,
        redirectUri,
        codeChallenge: this.buildPkceChallenge(codeVerifier),
        nonce,
      }),
      alreadyAuthorized: false,
      statusUrl,
      connectorName: connector.name,
    };
  }

  async getDelegatedAuthStatus(
    actor: DelegatedAuthActor,
    input: { connectorId: string; sessionId: string },
  ): Promise<DelegatedAuthStatusResult> {
    const connector = await this.loadDelegatedConnectorOrThrow(input.connectorId, actor.tenantId);
    const session = await this.loadChatSessionOrThrow(input.sessionId, actor.tenantId, actor.userId);
    const existingBinding = await this.hasUsableBinding({
      tenantId: actor.tenantId,
      connectorId: input.connectorId,
      userId: actor.userId,
    });

    if (existingBinding.authorized) {
      return {
        connectorId: input.connectorId,
        connectorName: connector.name,
        status: 'bound',
        bindingId: existingBinding.bindingId,
        lastBoundAt: existingBinding.lastBoundAt,
        authRequired: false,
      };
    }

    const challenge = this.readDelegatedChallenge(session.metadata, input.connectorId);
    if (!challenge) {
      return {
        connectorId: input.connectorId,
        connectorName: connector.name,
        status: 'not_bound',
        authRequired: true,
      };
    }

    const expired = new Date(challenge.expiresAt).getTime() <= Date.now();
    if (expired && challenge.status === 'pending') {
      await this.updateDelegatedChallengeState(session.id, {
        connectorId: input.connectorId,
        status: 'expired',
      });
      return {
        connectorId: input.connectorId,
        connectorName: connector.name,
        status: 'expired',
        authRequired: true,
      };
    }

    return {
      connectorId: input.connectorId,
      connectorName: connector.name,
      status: challenge.status === 'completed'
        ? 'bound'
        : challenge.status === 'failed'
          ? 'failed'
          : challenge.status === 'expired'
            ? 'expired'
            : 'pending',
      bindingId: challenge.bindingId,
      errorMessage: challenge.errorMessage,
      authRequired: challenge.status !== 'completed',
    };
  }

  async completeDelegatedAuth(input: CompleteDelegatedAuthInput): Promise<CompleteDelegatedAuthResult> {
    const parsedState = this.decodeDelegatedAuthState(input.state || '');
    if (!parsedState?.sessionId || !parsedState.challengeId) {
      return {
        success: false,
        connectorId: input.connectorId,
        message: 'Invalid delegated auth state',
      };
    }

    const session = await this.prisma.chatSession.findUnique({
      where: { id: parsedState.sessionId },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        metadata: true,
      },
    });
    if (!session) {
      return {
        success: false,
        connectorId: input.connectorId,
        message: 'Delegated auth session not found',
      };
    }

    const connector = await this.loadDelegatedConnectorOrThrow(input.connectorId, session.tenantId);
    const delegatedAuth = this.readDelegatedAuthConfig(
      connector.authConfig as Record<string, any> | null | undefined,
    );
    const challenge = this.readDelegatedChallenge(session.metadata, input.connectorId);
    const statusUrl = this.buildDelegatedAuthStatusUrl(input.connectorId, session.id);

    if (!challenge || challenge.challengeId !== parsedState.challengeId) {
      return {
        success: false,
        sessionId: session.id,
        connectorId: input.connectorId,
        connectorName: connector.name,
        message: 'Delegated auth challenge not found or already replaced',
        statusUrl,
      };
    }

    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      await this.updateDelegatedChallengeState(session.id, {
        connectorId: input.connectorId,
        status: 'expired',
      });
      return {
        success: false,
        sessionId: session.id,
        connectorId: input.connectorId,
        connectorName: connector.name,
        message: 'Delegated auth challenge has expired',
        statusUrl,
      };
    }

    if (input.error) {
      await this.updateDelegatedChallengeState(session.id, {
        connectorId: input.connectorId,
        status: 'failed',
        errorMessage: input.errorDescription || input.error,
      });
      return {
        success: false,
        sessionId: session.id,
        connectorId: input.connectorId,
        connectorName: connector.name,
        message: input.errorDescription || input.error,
        statusUrl,
      };
    }

    if (!input.code) {
      await this.updateDelegatedChallengeState(session.id, {
        connectorId: input.connectorId,
        status: 'failed',
        errorMessage: 'Missing authorization code',
      });
      return {
        success: false,
        sessionId: session.id,
        connectorId: input.connectorId,
        connectorName: connector.name,
        message: 'Missing authorization code',
        statusUrl,
      };
    }

    const tokenSet = await this.exchangeAuthorizationCodeForToken(delegatedAuth, {
      code: input.code,
      codeVerifier: challenge.codeVerifier,
      redirectUri: challenge.redirectUri,
    });
    const idTokenClaims = this.decodeJwtPayload(tokenSet.id_token);
    if (challenge.nonce && idTokenClaims?.nonce && idTokenClaims.nonce !== challenge.nonce) {
      await this.updateDelegatedChallengeState(session.id, {
        connectorId: input.connectorId,
        status: 'failed',
        errorMessage: 'Invalid delegated auth nonce',
      });
      return {
        success: false,
        sessionId: session.id,
        connectorId: input.connectorId,
        connectorName: connector.name,
        message: 'Invalid delegated auth nonce',
        statusUrl,
      };
    }

    const accessTokenExpiresAt = this.resolveTokenExpiry(tokenSet.expires_in);
    const refreshTokenExpiresAt = this.resolveTokenExpiry(tokenSet.refresh_expires_in);
    if (!(await this.hasBindingSchemaSupport('completeDelegatedAuth'))) {
      await this.updateDelegatedChallengeState(session.id, {
        connectorId: input.connectorId,
        connectorName: connector.name,
        status: 'failed',
        errorMessage: 'Delegated auth storage is unavailable',
      });
      return {
        success: false,
        sessionId: session.id,
        connectorId: input.connectorId,
        connectorName: connector.name,
        message: 'Delegated auth storage is unavailable',
        statusUrl,
      };
    }

    let binding: { id: string };
    try {
      binding = await this.upsertDelegatedBinding({
        tenantId: session.tenantId,
        userId: session.userId,
        connectorId: connector.id,
        connectorName: connector.name,
        authType: connector.authType,
        provider: delegatedAuth.provider,
      });

      await this.replaceBindingAsset(binding.id, session.tenantId, 'auth_payload', {
        provider: delegatedAuth.provider,
        subject: idTokenClaims?.sub || tokenSet.subject,
        idToken: tokenSet.id_token,
        accessToken: tokenSet.access_token,
        refreshToken: tokenSet.refresh_token,
        tokenType: tokenSet.token_type,
        scope: tokenSet.scope,
        accessTokenExpiresAt: accessTokenExpiresAt?.toISOString(),
        refreshTokenExpiresAt: refreshTokenExpiresAt?.toISOString(),
        audience: delegatedAuth.audience,
        resource: delegatedAuth.resource,
      }, {
        provider: delegatedAuth.provider,
        source: 'oauth_callback',
        connectorName: connector.name,
      });
    } catch (error) {
      if (!this.isBindingSchemaError(error)) {
        throw error;
      }

      this.logBindingSchemaFallback('completeDelegatedAuth', error);
      await this.updateDelegatedChallengeState(session.id, {
        connectorId: input.connectorId,
        connectorName: connector.name,
        status: 'failed',
        errorMessage: 'Delegated auth storage is unavailable',
      });
      return {
        success: false,
        sessionId: session.id,
        connectorId: input.connectorId,
        connectorName: connector.name,
        message: 'Delegated auth storage is unavailable',
        statusUrl,
      };
    }

    await this.updateDelegatedChallengeState(session.id, {
      connectorId: input.connectorId,
      connectorName: connector.name,
      status: 'completed',
      bindingId: binding.id,
      completedAt: new Date().toISOString(),
    });

    return {
      success: true,
      sessionId: session.id,
      connectorId: input.connectorId,
      connectorName: connector.name,
      message: `${connector.name} delegated authorization completed`,
      statusUrl,
    };
  }

  async resolveExecutionAuthConfig(input: ResolveExecutionAuthInput) {
    if (!(await this.hasBindingSchemaSupport('resolveExecutionAuthConfig'))) {
      return null;
    }

    return this.withBindingSchemaFallback('resolveExecutionAuthConfig', null, async () => {
      const binding = await this.resolveBindingForExecution(input);
      if (!binding) {
        return null;
      }

      const connector = await this.prisma.connector.findFirst({
        where: {
          id: input.connectorId,
          tenantId: input.tenantId,
        },
        select: {
          authConfig: true,
          authType: true,
          name: true,
        },
      });

      const assets = await this.prisma.authSessionAsset.findMany({
        where: {
          tenantId: input.tenantId,
          authBindingId: binding.id,
          status: 'active',
        },
        orderBy: { createdAt: 'desc' },
      });

      const latestByType = new Map<string, typeof assets[number]>();
      for (const asset of assets) {
        if (!latestByType.has(asset.assetType)) {
          latestByType.set(asset.assetType, asset);
        }
      }

      let authPayload = this.extractLatestAuthPayload(latestByType);
      const delegatedAuth = this.readDelegatedAuthConfig(
        connector?.authConfig as Record<string, any> | null | undefined,
        false,
      );

      if (authPayload && this.isTokenSetExpiring(authPayload) && authPayload.refreshToken && delegatedAuth.tokenUrl) {
        authPayload = await this.refreshDelegatedTokenSet(delegatedAuth, authPayload);
        await this.replaceBindingAsset(binding.id, input.tenantId, 'auth_payload', authPayload, {
          provider: delegatedAuth.provider,
          source: 'oauth_refresh',
          connectorName: connector?.name || undefined,
        });
      }

      const mergedAuthConfig: Record<string, any> = {};
      for (const [assetType, asset] of latestByType.entries()) {
        const decryptedPayload = assetType === 'auth_payload' && authPayload
          ? authPayload
          : decryptAuthBindingPayload(asset.encryptedPayload);
        const fragment = this.normalizeExecutionAsset(assetType, decryptedPayload);
        this.mergeAuthConfig(mergedAuthConfig, fragment);
      }

      const sourceAccessToken = authPayload?.accessToken || mergedAuthConfig.accessToken || mergedAuthConfig.token;
      if (delegatedAuth.exchange?.enabled && sourceAccessToken) {
        const exchangedToken = await this.exchangeDelegatedAccessToken(
          delegatedAuth,
          sourceAccessToken,
        );
        if (exchangedToken) {
          mergedAuthConfig.accessToken = exchangedToken;
          mergedAuthConfig.token = exchangedToken;
          mergedAuthConfig.platformConfig = {
            ...((mergedAuthConfig.platformConfig as Record<string, any> | undefined) || {}),
            ...(delegatedAuth.exchange?.applyToPlatformServiceToken === false
              ? {}
              : { serviceToken: exchangedToken }),
          };
        }
      }

      await this.prisma.authBinding.update({
        where: { id: binding.id },
        data: {
          lastUsedAt: new Date(),
        },
      }).catch(() => undefined);

      return {
        authBindingId: binding.id,
        authType: binding.authType,
        authMode: binding.authMode,
        authConfig: mergedAuthConfig,
      };
    });
  }

  private async resolveBindingForExecution(input: ResolveExecutionAuthInput) {
    if (input.authBindingId) {
      const explicit = await this.prisma.authBinding.findFirst({
        where: {
          id: input.authBindingId,
          tenantId: input.tenantId,
          connectorId: input.connectorId,
          status: 'active',
          OR: [
            ...(input.userId ? [{ userId: input.userId }] : []),
            { ownerType: 'service', userId: null },
          ],
        },
      });
      if (explicit) {
        return explicit;
      }
    }

    if (input.userId) {
      const userDefault = await this.prisma.authBinding.findFirst({
        where: {
          tenantId: input.tenantId,
          connectorId: input.connectorId,
          userId: input.userId,
          status: 'active',
          isDefault: true,
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (userDefault) {
        return userDefault;
      }

      const userLatest = await this.prisma.authBinding.findFirst({
        where: {
          tenantId: input.tenantId,
          connectorId: input.connectorId,
          userId: input.userId,
          status: 'active',
        },
        orderBy: [
          { lastBoundAt: 'desc' },
          { updatedAt: 'desc' },
        ],
      });
      if (userLatest) {
        return userLatest;
      }
    }

    return this.prisma.authBinding.findFirst({
      where: {
        tenantId: input.tenantId,
        connectorId: input.connectorId,
        ownerType: 'service',
        userId: null,
        status: 'active',
      },
      orderBy: [
        { isDefault: 'desc' },
        { lastBoundAt: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
  }

  private async loadDelegatedConnectorOrThrow(connectorId: string, tenantId: string) {
    const connector = await this.prisma.connector.findFirst({
      where: {
        id: connectorId,
        tenantId,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        authType: true,
        authConfig: true,
      },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    this.readDelegatedAuthConfig(connector.authConfig as Record<string, any> | null | undefined);
    return connector;
  }

  private async loadChatSessionOrThrow(sessionId: string, tenantId: string, userId?: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        tenantId,
        ...(userId ? { userId } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        metadata: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    return session;
  }

  private readDelegatedAuthConfig(
    authConfig: Record<string, any> | null | undefined,
    requireEnabled = true,
  ): DelegatedAuthConfig {
    const raw = (
      authConfig?.delegatedAuth
      && typeof authConfig.delegatedAuth === 'object'
      && !Array.isArray(authConfig.delegatedAuth)
    )
      ? authConfig.delegatedAuth as Record<string, any>
      : {};

    const enabled = raw.enabled === true;
    if (requireEnabled && !enabled) {
      throw new BadRequestException('Delegated auth is not enabled for this connector');
    }

    const scopes = Array.isArray(raw.scopes)
      ? raw.scopes.map((value) => String(value || '').trim()).filter(Boolean)
      : String(raw.scope || raw.scopes || '')
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);

    const exchangeRaw = (
      raw.exchange
      && typeof raw.exchange === 'object'
      && !Array.isArray(raw.exchange)
    )
      ? raw.exchange as Record<string, any>
      : {};

    return {
      enabled,
      provider: String(raw.provider || 'delegated_oauth2').trim() || 'delegated_oauth2',
      authorizationUrl: typeof raw.authorizationUrl === 'string' ? raw.authorizationUrl.trim() : undefined,
      tokenUrl: typeof raw.tokenUrl === 'string' ? raw.tokenUrl.trim() : undefined,
      redirectUri: typeof raw.redirectUri === 'string' ? raw.redirectUri.trim() : undefined,
      clientId: typeof raw.clientId === 'string' ? raw.clientId.trim() : undefined,
      clientSecret: this.resolveConfigSecret(raw.clientSecret),
      scopes,
      audience: typeof raw.audience === 'string' ? raw.audience.trim() : undefined,
      resource: typeof raw.resource === 'string' ? raw.resource.trim() : undefined,
      authorizeParams: this.normalizeStringMap(raw.authorizeParams || raw.extraAuthorizeParams),
      prompt: typeof raw.prompt === 'string' ? raw.prompt.trim() : undefined,
      callbackPath: typeof raw.callbackPath === 'string' ? raw.callbackPath.trim() : undefined,
      exchange: {
        enabled: exchangeRaw.enabled === true,
        tokenUrl: typeof exchangeRaw.tokenUrl === 'string'
          ? exchangeRaw.tokenUrl.trim()
          : (typeof raw.tokenUrl === 'string' ? raw.tokenUrl.trim() : undefined),
        clientId: typeof exchangeRaw.clientId === 'string' ? exchangeRaw.clientId.trim() : undefined,
        clientSecret: this.resolveConfigSecret(exchangeRaw.clientSecret),
        audience: typeof exchangeRaw.audience === 'string' ? exchangeRaw.audience.trim() : undefined,
        resource: typeof exchangeRaw.resource === 'string' ? exchangeRaw.resource.trim() : undefined,
        scope: typeof exchangeRaw.scope === 'string' ? exchangeRaw.scope.trim() : undefined,
        grantType: typeof exchangeRaw.grantType === 'string' && exchangeRaw.grantType.trim()
          ? exchangeRaw.grantType.trim()
          : 'urn:ietf:params:oauth:grant-type:token-exchange',
        subjectTokenType: typeof exchangeRaw.subjectTokenType === 'string' && exchangeRaw.subjectTokenType.trim()
          ? exchangeRaw.subjectTokenType.trim()
          : 'urn:ietf:params:oauth:token-type:access_token',
        requestedTokenType: typeof exchangeRaw.requestedTokenType === 'string'
          ? exchangeRaw.requestedTokenType.trim()
          : undefined,
        applyToPlatformServiceToken: exchangeRaw.applyToPlatformServiceToken !== false,
        extraParams: this.normalizeStringMap(exchangeRaw.extraParams),
      },
    };
  }

  private normalizeStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, any>)
        .filter(([, item]) => item !== undefined && item !== null && item !== '')
        .map(([key, item]) => [key, String(item)]),
    );
  }

  private resolveConfigSecret(value: unknown) {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (trimmed.startsWith('env:')) {
      const envName = trimmed.slice(4).trim();
      return envName ? process.env[envName]?.trim() || undefined : undefined;
    }

    return trimmed;
  }

  private buildDelegatedCallbackUrl(baseUrl: string, connectorId: string, callbackPath?: string) {
    if (callbackPath) {
      if (/^https?:\/\//i.test(callbackPath)) {
        return callbackPath;
      }
      return `${baseUrl.replace(/\/+$/, '')}/${callbackPath.replace(/^\/+/, '')}`;
    }

    return `${baseUrl.replace(/\/+$/, '')}/api/v1/connectors/${connectorId}/delegated-auth/callback`;
  }

  private buildDelegatedAuthStatusUrl(connectorId: string, sessionId: string) {
    return `/api/v1/connectors/${connectorId}/delegated-auth/status?sessionId=${encodeURIComponent(sessionId)}`;
  }

  private generatePkceVerifier() {
    return randomBytes(48).toString('base64url');
  }

  private buildPkceChallenge(codeVerifier: string) {
    return createHash('sha256').update(codeVerifier).digest('base64url');
  }

  private encodeDelegatedAuthState(input: { sessionId: string; challengeId: string }) {
    return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
  }

  private decodeDelegatedAuthState(state: string) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      return {
        sessionId: typeof decoded?.sessionId === 'string' ? decoded.sessionId : '',
        challengeId: typeof decoded?.challengeId === 'string' ? decoded.challengeId : '',
      };
    } catch {
      return null;
    }
  }

  private buildDelegatedAuthorizeUrl(
    delegatedAuth: DelegatedAuthConfig,
    input: {
      state: string;
      redirectUri: string;
      codeChallenge: string;
      nonce: string;
    },
  ) {
    if (!delegatedAuth.authorizationUrl || !delegatedAuth.clientId) {
      throw new BadRequestException('Delegated auth is missing authorizationUrl or clientId');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: delegatedAuth.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      nonce: input.nonce,
    });

    if (delegatedAuth.scopes.length > 0) {
      params.set('scope', delegatedAuth.scopes.join(' '));
    }
    if (delegatedAuth.audience) {
      params.set('audience', delegatedAuth.audience);
    }
    if (delegatedAuth.resource) {
      params.set('resource', delegatedAuth.resource);
    }
    if (delegatedAuth.prompt) {
      params.set('prompt', delegatedAuth.prompt);
    }
    for (const [key, value] of Object.entries(delegatedAuth.authorizeParams || {})) {
      params.set(key, value);
    }

    const separator = delegatedAuth.authorizationUrl.includes('?') ? '&' : '?';
    return `${delegatedAuth.authorizationUrl}${separator}${params.toString()}`;
  }

  private readDelegatedChallenge(metadata: unknown, connectorId?: string) {
    const sessionMetadata = (
      metadata
      && typeof metadata === 'object'
      && !Array.isArray(metadata)
    )
      ? metadata as Record<string, any>
      : {};

    const challenge = (
      sessionMetadata.pendingDelegatedAuth
      && typeof sessionMetadata.pendingDelegatedAuth === 'object'
      && !Array.isArray(sessionMetadata.pendingDelegatedAuth)
    )
      ? sessionMetadata.pendingDelegatedAuth as PendingDelegatedAuthChallenge
      : null;

    if (!challenge) {
      return null;
    }

    if (connectorId && challenge.connectorId !== connectorId) {
      return null;
    }

    return challenge;
  }

  private async writeDelegatedChallenge(sessionId: string, challenge: PendingDelegatedAuthChallenge) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    const metadata = (
      session?.metadata
      && typeof session.metadata === 'object'
      && !Array.isArray(session.metadata)
    )
      ? session.metadata as Record<string, any>
      : {};

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        metadata: {
          ...metadata,
          pendingDelegatedAuth: challenge,
        } as any,
      },
    });
  }

  private async updateDelegatedChallengeState(
    sessionId: string,
    patch: Partial<PendingDelegatedAuthChallenge> & { connectorId: string },
  ) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    const metadata = (
      session?.metadata
      && typeof session.metadata === 'object'
      && !Array.isArray(session.metadata)
    )
      ? session.metadata as Record<string, any>
      : {};
    const current = this.readDelegatedChallenge(metadata, patch.connectorId);

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        metadata: {
          ...metadata,
          pendingDelegatedAuth: {
            ...(current || {}),
            ...patch,
          },
        } as any,
      },
    });
  }

  private async upsertDelegatedBinding(input: {
    tenantId: string;
    userId: string;
    connectorId: string;
    connectorName: string;
    authType: string;
    provider: string;
  }) {
    const existing = await this.prisma.authBinding.findFirst({
      where: {
        tenantId: input.tenantId,
        connectorId: input.connectorId,
        userId: input.userId,
        ownerType: 'user',
      },
      orderBy: [
        { isDefault: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    if (existing) {
      await this.prisma.authBinding.updateMany({
        where: {
          tenantId: input.tenantId,
          connectorId: input.connectorId,
          userId: input.userId,
          ownerType: 'user',
        },
        data: {
          isDefault: false,
        },
      });

      return this.prisma.authBinding.update({
        where: { id: existing.id },
        data: {
          bindingName: existing.bindingName || `${input.connectorName} delegated auth`,
          authType: input.authType,
          authMode: 'api_token',
          status: 'active',
          isDefault: true,
          ownerType: 'user',
          lastBoundAt: new Date(),
          metadata: {
            ...((existing.metadata as Record<string, any> | undefined) || {}),
            delegatedProvider: input.provider,
          },
        },
      });
    }

    return this.prisma.authBinding.create({
      data: {
        tenantId: input.tenantId,
        connectorId: input.connectorId,
        userId: input.userId,
        bindingName: `${input.connectorName} delegated auth`,
        ownerType: 'user',
        authType: input.authType,
        authMode: 'api_token',
        status: 'active',
        isDefault: true,
        lastBoundAt: new Date(),
        metadata: {
          delegatedProvider: input.provider,
        },
      },
    });
  }

  private async replaceBindingAsset(
    bindingId: string,
    tenantId: string,
    assetType: string,
    payload: any,
    metadata?: Record<string, any>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.authSessionAsset.updateMany({
        where: {
          authBindingId: bindingId,
          assetType,
          status: 'active',
        },
        data: {
          status: 'stale',
        },
      });

      await tx.authSessionAsset.create({
        data: {
          tenantId,
          authBindingId: bindingId,
          assetType,
          status: 'active',
          encryptedPayload: encryptAuthBindingPayload(payload),
          issuedAt: new Date(),
          metadata: metadata || undefined,
        },
      });
    });
  }

  private extractLatestAuthPayload(
    latestByType: Map<string, { encryptedPayload: string }>,
  ): DelegatedTokenSetPayload | null {
    const candidate = latestByType.get('auth_payload');
    if (!candidate) {
      return null;
    }

    const payload = decryptAuthBindingPayload(candidate.encryptedPayload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    return payload as DelegatedTokenSetPayload;
  }

  private isTokenSetExpiring(payload: DelegatedTokenSetPayload) {
    if (!payload.accessTokenExpiresAt) {
      return false;
    }

    const expiresAt = new Date(payload.accessTokenExpiresAt).getTime();
    if (!Number.isFinite(expiresAt)) {
      return false;
    }

    return expiresAt <= Date.now() + 60 * 1000;
  }

  private async refreshDelegatedTokenSet(
    delegatedAuth: DelegatedAuthConfig,
    payload: DelegatedTokenSetPayload,
  ): Promise<DelegatedTokenSetPayload> {
    if (!delegatedAuth.tokenUrl || !payload.refreshToken) {
      return payload;
    }

    const response = await axios.post(
      delegatedAuth.tokenUrl,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: payload.refreshToken,
        ...(delegatedAuth.clientId ? { client_id: delegatedAuth.clientId } : {}),
        ...(delegatedAuth.clientSecret ? { client_secret: delegatedAuth.clientSecret } : {}),
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      },
    );

    const refreshed = response.data as Record<string, any>;
    const accessTokenExpiresAt = this.resolveTokenExpiry(refreshed.expires_in);
    const refreshTokenExpiresAt = this.resolveTokenExpiry(refreshed.refresh_expires_in);

    return {
      ...payload,
      accessToken: String(refreshed.access_token || payload.accessToken || ''),
      refreshToken: String(refreshed.refresh_token || payload.refreshToken || ''),
      idToken: typeof refreshed.id_token === 'string' ? refreshed.id_token : payload.idToken,
      tokenType: typeof refreshed.token_type === 'string' ? refreshed.token_type : payload.tokenType,
      scope: typeof refreshed.scope === 'string' ? refreshed.scope : payload.scope,
      accessTokenExpiresAt: accessTokenExpiresAt?.toISOString(),
      refreshTokenExpiresAt: refreshTokenExpiresAt?.toISOString() || payload.refreshTokenExpiresAt,
    };
  }

  private async exchangeDelegatedAccessToken(
    delegatedAuth: DelegatedAuthConfig,
    accessToken: string,
  ) {
    if (!delegatedAuth.exchange?.enabled || !delegatedAuth.exchange.tokenUrl) {
      return undefined;
    }

    const params = new URLSearchParams({
      grant_type: delegatedAuth.exchange.grantType || 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: accessToken,
      subject_token_type: delegatedAuth.exchange.subjectTokenType || 'urn:ietf:params:oauth:token-type:access_token',
      ...(delegatedAuth.exchange.clientId ? { client_id: delegatedAuth.exchange.clientId } : {}),
      ...(delegatedAuth.exchange.clientSecret ? { client_secret: delegatedAuth.exchange.clientSecret } : {}),
      ...(delegatedAuth.exchange.audience ? { audience: delegatedAuth.exchange.audience } : {}),
      ...(delegatedAuth.exchange.resource ? { resource: delegatedAuth.exchange.resource } : {}),
      ...(delegatedAuth.exchange.scope ? { scope: delegatedAuth.exchange.scope } : {}),
      ...(delegatedAuth.exchange.requestedTokenType ? { requested_token_type: delegatedAuth.exchange.requestedTokenType } : {}),
    });
    for (const [key, value] of Object.entries(delegatedAuth.exchange.extraParams || {})) {
      params.set(key, value);
    }

    const response = await axios.post(
      delegatedAuth.exchange.tokenUrl,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      },
    );

    const exchanged = response.data as Record<string, any>;
    return typeof exchanged.access_token === 'string' && exchanged.access_token
      ? exchanged.access_token
      : undefined;
  }

  private async exchangeAuthorizationCodeForToken(
    delegatedAuth: DelegatedAuthConfig,
    input: { code: string; codeVerifier: string; redirectUri: string },
  ) {
    if (!delegatedAuth.tokenUrl || !delegatedAuth.clientId) {
      throw new BadRequestException('Delegated auth is missing tokenUrl or clientId');
    }

    const response = await axios.post(
      delegatedAuth.tokenUrl,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
        client_id: delegatedAuth.clientId,
        ...(delegatedAuth.clientSecret ? { client_secret: delegatedAuth.clientSecret } : {}),
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      },
    );

    return response.data as Record<string, any>;
  }

  private resolveTokenExpiry(expiresIn: unknown) {
    const seconds = Number(expiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return undefined;
    }

    return new Date(Date.now() + Math.floor(seconds) * 1000);
  }

  private decodeJwtPayload(token?: string) {
    if (!token) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }

    try {
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, any>;
    } catch {
      return null;
    }
  }

  private normalizeExecutionAsset(assetType: string, payload: any) {
    switch (assetType) {
      case 'auth_payload':
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const payloadRecord = payload as Record<string, any>;
          const accessToken = payloadRecord.accessToken || payloadRecord.access_token || payloadRecord.token;
          const refreshToken = payloadRecord.refreshToken || payloadRecord.refresh_token;
          return {
            ...payloadRecord,
            ...(accessToken ? { accessToken, token: accessToken } : {}),
            ...(refreshToken ? { refreshToken } : {}),
          };
        }
        return {};
      case 'api_token':
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          return payload as Record<string, any>;
        }
        if (typeof payload === 'string') {
          return { accessToken: payload, token: payload };
        }
        return {};
      case 'cookie_session':
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          return payload as Record<string, any>;
        }
        if (typeof payload === 'string') {
          return { cookie: payload, sessionCookie: payload };
        }
        return {};
      case 'browser_session':
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const payloadRecord = payload as Record<string, any>;
          return {
            platformConfig: {
              storageState: Object.prototype.hasOwnProperty.call(payloadRecord, 'storageState')
                ? payloadRecord.storageState
                : payloadRecord,
            },
          };
        }
        if (typeof payload !== 'string') {
          return {};
        }
        return {
          platformConfig: {
            storageState: payload,
          },
        };
      case 'jump_ticket':
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const payloadRecord = payload as Record<string, any>;
          if (
            payloadRecord.platformConfig
            && typeof payloadRecord.platformConfig === 'object'
            && !Array.isArray(payloadRecord.platformConfig)
          ) {
            return payloadRecord;
          }
          if (typeof payloadRecord.jumpUrl === 'string') {
            return {
              platformConfig: {
                jumpUrl: payloadRecord.jumpUrl,
              },
            };
          }
          return {};
        }
        if (typeof payload !== 'string') {
          return {};
        }
        return {
          platformConfig: {
            jumpUrl: payload,
          },
        };
      default:
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          return payload as Record<string, any>;
        }
        return {};
    }
  }

  private mergeAuthConfig(target: Record<string, any>, fragment: Record<string, any>) {
    const existingPlatformConfig = (
      target.platformConfig
      && typeof target.platformConfig === 'object'
      && !Array.isArray(target.platformConfig)
    )
      ? { ...(target.platformConfig as Record<string, any>) }
      : undefined;

    Object.assign(target, fragment);

    const targetPlatformConfig = existingPlatformConfig;
    const fragmentPlatformConfig = fragment.platformConfig;
    if (
      (targetPlatformConfig || fragmentPlatformConfig)
      && fragmentPlatformConfig
      && typeof fragmentPlatformConfig === 'object'
      && !Array.isArray(fragmentPlatformConfig)
    ) {
      target.platformConfig = {
        ...(targetPlatformConfig || {}),
        ...fragmentPlatformConfig,
      };
    }
  }

  private async loadBindingOrThrow(id: string, tenantId: string) {
    const binding = await this.prisma.authBinding.findFirst({
      where: { id, tenantId },
      include: {
        sessionAssets: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!binding) {
      throw new NotFoundException('Auth binding not found');
    }

    return binding;
  }

  private sanitizeBinding(binding: {
    id: string;
    tenantId: string;
    connectorId: string;
    userId: string | null;
    bindingName: string | null;
    ownerType: string;
    authType: string;
    authMode: string;
    status: string;
    isDefault: boolean;
    lastBoundAt: Date | null;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    metadata: any;
    createdAt: Date;
    updatedAt: Date;
    sessionAssets?: Array<{
      id: string;
      assetType: string;
      status: string;
      issuedAt: Date | null;
      expiresAt: Date | null;
      lastValidatedAt: Date | null;
      metadata: any;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }) {
    return {
      id: binding.id,
      tenantId: binding.tenantId,
      connectorId: binding.connectorId,
      userId: binding.userId,
      bindingName: binding.bindingName,
      ownerType: binding.ownerType,
      authType: binding.authType,
      authMode: binding.authMode,
      status: binding.status,
      isDefault: binding.isDefault,
      lastBoundAt: binding.lastBoundAt,
      lastUsedAt: binding.lastUsedAt,
      expiresAt: binding.expiresAt,
      metadata: binding.metadata,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
      sessionAssets: (binding.sessionAssets || []).map((asset) => ({
        id: asset.id,
        assetType: asset.assetType,
        status: asset.status,
        issuedAt: asset.issuedAt,
        expiresAt: asset.expiresAt,
        lastValidatedAt: asset.lastValidatedAt,
        metadata: asset.metadata,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
      })),
    };
  }

  private async assertConnectorAccessible(connectorId: string, tenantId: string) {
    const connector = await this.prisma.connector.findFirst({
      where: { id: connectorId, tenantId },
      select: { id: true },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }
  }

  private resolveTargetUserId(
    actor: BindingActor,
    ownerType: 'user' | 'service',
    requestedUserId?: string,
  ) {
    if (ownerType === 'service') {
      if (!this.isPrivileged(actor.roles)) {
        throw new ForbiddenException('Only admin or flow_manager can manage service bindings');
      }
      return null;
    }

    if (requestedUserId && requestedUserId !== actor.userId && !this.isPrivileged(actor.roles)) {
      throw new ForbiddenException('Cannot manage another user\'s auth binding');
    }

    const userId = requestedUserId || actor.userId;
    if (!userId) {
      throw new BadRequestException('User-scoped auth binding requires a user identity');
    }
    return userId;
  }

  private assertBindingAccess(
    binding: { ownerType: string; userId: string | null },
    actor: BindingActor,
    action: 'read' | 'write',
  ) {
    if (binding.ownerType === 'service') {
      if (!this.isPrivileged(actor.roles)) {
        throw new ForbiddenException(`Only admin or flow_manager can ${action} service auth bindings`);
      }
      return;
    }

    if (!actor.userId || binding.userId !== actor.userId) {
      if (!this.isPrivileged(actor.roles)) {
        throw new ForbiddenException(`Cannot ${action} another user's auth binding`);
      }
    }
  }

  private isPrivileged(roles: string[]) {
    return roles.some((role) => PRIVILEGED_ROLES.has(role));
  }

  private async withBindingSchemaFallback<T>(
    operation: string,
    fallback: T | (() => Promise<T> | T),
    task: () => Promise<T>,
  ): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (!this.isBindingSchemaError(error)) {
        throw error;
      }

      this.logBindingSchemaFallback(operation, error);
      return typeof fallback === 'function'
        ? await (fallback as (() => Promise<T> | T))()
        : fallback;
    }
  }

  private isBindingSchemaError(error: unknown) {
    return isMissingSchemaError(error, AUTH_BINDING_SCHEMA_OBJECTS);
  }

  private async hasBindingSchemaSupport(operation: string) {
    const snapshot = await getSchemaObjectAvailability({
      prisma: this.prisma,
      identifiers: AUTH_BINDING_SCHEMA_OBJECTS,
      cache: this.bindingSchemaSnapshot,
      ttlMs: SCHEMA_AVAILABILITY_TTL_MS,
    });
    this.bindingSchemaSnapshot = snapshot;
    if (snapshot.available) {
      return true;
    }

    logSchemaCompatibilityUnavailable({
      logger: this.logger,
      warningCache: this.schemaWarnings,
      featureKey: 'auth-binding',
      identifiers: snapshot.missing,
      operation,
    });
    return false;
  }

  private logBindingSchemaFallback(operation: string, error: unknown) {
    logSchemaCompatibilityFallback({
      logger: this.logger,
      warningCache: this.schemaWarnings,
      featureKey: 'auth-binding',
      identifiers: AUTH_BINDING_SCHEMA_OBJECTS,
      operation,
      error,
    });
  }
}
