import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AuthSessionClaims,
  verifyAuthSessionToken,
} from '@uniflow/shared-types';
import { TenantUserResolverService } from './tenant-user-resolver.service';
import { getAuthSessionSecret } from './auth-session-secret';

export interface ResolvedRequestAuth {
  tenantId: string;
  userId?: string;
  roles: string[];
  username?: string;
  displayName?: string;
  identityType?: string;
  sessionToken?: string;
  source: 'session' | 'request';
}

@Injectable()
export class RequestAuthService {
  constructor(
    private readonly tenantUserResolver: TenantUserResolverService,
  ) {}

  resolveTenant(
    req: Request,
    explicitTenantId?: string | null,
  ): Pick<ResolvedRequestAuth, 'tenantId' | 'roles' | 'username' | 'displayName' | 'identityType' | 'sessionToken' | 'source'> {
    const session = this.resolveSession(req);
    if (session) {
      return {
        tenantId: session.claims.tenantId,
        roles: session.claims.roles,
        username: session.claims.username,
        displayName: session.claims.displayName,
        identityType: session.claims.identityType,
        sessionToken: session.token,
        source: 'session',
      };
    }

    const tenantId = (
      explicitTenantId
      || this.readRequestValue(req, 'tenantId')
      || process.env.DEFAULT_TENANT_ID
      || ''
    ).trim();

    if (!tenantId) {
      throw new BadRequestException('缺少租户标识');
    }

    return {
      tenantId,
      roles: [],
      source: 'request',
    };
  }

  async resolveUser(
    req: Request,
    options?: {
      tenantId?: string | null;
      userId?: string | null;
      allowUserFallback?: boolean;
      requireUser?: boolean;
    },
  ): Promise<ResolvedRequestAuth> {
    const session = this.resolveSession(req);
    if (session) {
      return {
        tenantId: session.claims.tenantId,
        userId: session.claims.userId,
        roles: session.claims.roles,
        username: session.claims.username,
        displayName: session.claims.displayName,
        identityType: session.claims.identityType,
        sessionToken: session.token,
        source: 'session',
      };
    }

    const base = this.resolveTenant(req, options?.tenantId);
    const requestedUserId = (
      options?.userId
      || this.readRequestValue(req, 'userId')
      || ''
    ).trim();
    const allowUserFallback = Boolean(options?.allowUserFallback);
    const requireUser = options?.requireUser !== false;

    if (!requestedUserId && !allowUserFallback) {
      if (requireUser) {
        throw new BadRequestException('缺少用户身份，请重新登录');
      }

      return {
        ...base,
        source: 'request',
      };
    }

    const user = await this.tenantUserResolver.resolve({
      tenantId: base.tenantId,
      userId: requestedUserId || undefined,
      allowFallback: allowUserFallback,
    });

    return {
      ...base,
      userId: user.id,
      roles: this.parseRoles(user.roles),
      username: user.username,
      displayName: user.displayName,
      identityType: typeof user.identityType === 'string' ? user.identityType : undefined,
      source: 'request',
    };
  }

  private resolveSession(req: Request): { token: string; claims: AuthSessionClaims } | null {
    const token = this.readSessionToken(req);
    if (!token) {
      return null;
    }

    const claims = verifyAuthSessionToken(token, getAuthSessionSecret());
    if (!claims) {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }

    return { token, claims };
  }

  private readSessionToken(req: Request) {
    const authorization = req.header('authorization') || req.header('Authorization');
    if (authorization) {
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match?.[1]) {
        throw new UnauthorizedException('Authorization 头格式无效');
      }
      return match[1].trim();
    }

    // Support token via query param for SSE connections (EventSource can't set headers)
    const queryToken = this.pickFirstValue((req.query || {})['token']);
    if (queryToken) {
      return queryToken;
    }

    const cookieHeader = req.header('cookie');
    if (!cookieHeader) {
      return '';
    }

    const target = cookieHeader
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('auth_session='));
    if (!target) {
      return '';
    }

    const value = target.slice('auth_session='.length);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private readRequestValue(req: Request, key: string) {
    const bodyValue = this.pickFirstValue((req.body || {})[key]);
    if (bodyValue) {
      return bodyValue;
    }

    const queryValue = this.pickFirstValue((req.query || {})[key]);
    if (queryValue) {
      return queryValue;
    }

    return this.pickFirstValue((req.params || {})[key]);
  }

  private pickFirstValue(value: unknown) {
    if (Array.isArray(value)) {
      return value.find((item) => typeof item === 'string')?.trim() || '';
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    return '';
  }

  private parseRoles(roles: unknown): string[] {
    if (Array.isArray(roles)) {
      return roles.filter((item): item is string => typeof item === 'string');
    }

    if (typeof roles === 'string') {
      try {
        const parsed = JSON.parse(roles);
        return Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === 'string')
          : [];
      } catch {
        return [];
      }
    }

    return [];
  }
}
