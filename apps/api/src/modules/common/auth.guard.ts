import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { verifyAuthSessionToken } from '@uniflow/shared-types';
import { getAuthSessionSecret } from './auth-session-secret';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionBlacklistService } from './session-blacklist.service';

@Injectable()
export class GlobalAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionBlacklist: SessionBlacklistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('未提供认证凭证，请登录');
    }

    const claims = verifyAuthSessionToken(token, getAuthSessionSecret());
    if (!claims) {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }

    // Check token blacklist (revoked sessions)
    if (await this.sessionBlacklist.isRevoked(token)) {
      throw new UnauthorizedException('会话已被撤销，请重新登录');
    }

    // Attach claims to request for downstream use
    (request as any).authClaims = claims;
    (request as any).sessionToken = token;
    return true;
  }

  private extractToken(req: Request): string {
    const authorization = req.header('authorization') || req.header('Authorization');
    if (authorization) {
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match?.[1]) {
        throw new UnauthorizedException('Authorization 头格式无效');
      }
      return match[1].trim();
    }

    // SSE connections can't set headers — allow query param token
    const queryToken = req.query?.['token'];
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.trim();
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
}
