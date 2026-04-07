import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { issueAuthSessionToken } from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { getAuthSessionSecret } from '../common/auth-session-secret';
import { DelegatedCredentialService } from '../delegated-credential/delegated-credential.service';

const scryptAsync = promisify(scrypt);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delegatedCredentialService: DelegatedCredentialService,
  ) {}

  private parseRoles(roles: unknown): string[] {
    if (Array.isArray(roles)) {
      return roles.filter((item): item is string => typeof item === 'string');
    }

    if (typeof roles === 'string') {
      try {
        const parsed = JSON.parse(roles);
        return Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === 'string')
          : ['user'];
      } catch {
        return ['user'];
      }
    }

    return ['user'];
  }

  async login(username: string, password: string, tenantId?: string) {
    let user;
    try {
      user = await this.resolveLoginUser(username, tenantId);
    } catch (error) {
      if (this.isDatabaseUnavailable(error)) {
        throw new ServiceUnavailableException('数据库未启动，当前无法登录');
      }
      throw error;
    }

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (!(await this.verifyPassword(password, user.tenantId, user.username))) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const roles = this.parseRoles(user.roles);
    const sessionSecret = this.getSessionSecret();
    const sessionTtlSeconds = this.getSessionTtlSeconds();
    const { token, claims } = issueAuthSessionToken({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roles,
      tenantId: user.tenantId,
    }, sessionSecret, sessionTtlSeconds);

    await this.delegatedCredentialService.seedMockCredentialsForUser({
      tenantId: user.tenantId,
      userId: user.id,
    }).catch((error: any) => {
      this.logger.warn(`Failed to seed delegated credentials for ${user.id}: ${error.message}`);
    });

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roles,
      tenantId: user.tenantId,
      sessionToken: token,
      sessionExpiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }

  private async resolveLoginUser(username: string, tenantId?: string) {
    const normalizedUsername = username.trim();
    const explicitTenantId = tenantId?.trim();

    if (explicitTenantId) {
      return this.prisma.user.findFirst({
        where: { username: normalizedUsername, tenantId: explicitTenantId, status: 'active' },
      });
    }

    const defaultTenantId = (process.env.DEFAULT_TENANT_ID || '').trim();
    if (defaultTenantId) {
      const defaultTenantUser = await this.prisma.user.findFirst({
        where: { username: normalizedUsername, tenantId: defaultTenantId, status: 'active' },
      });
      if (defaultTenantUser) {
        return defaultTenantUser;
      }
    }

    const matches = await this.prisma.user.findMany({
      where: { username: normalizedUsername, status: 'active' },
      orderBy: { createdAt: 'asc' },
      take: 2,
    });

    if (matches.length === 1) {
      return matches[0];
    }

    if (matches.length > 1) {
      throw new UnauthorizedException('该用户名匹配到多个租户，请联系管理员');
    }

    return null;
  }

  async getUserInfo(userId: string) {
    const normalizedUserId = userId?.trim();
    if (!normalizedUserId) {
      throw new UnauthorizedException('缺少用户身份，请重新登录');
    }

    let user;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: normalizedUserId },
      });
    } catch (error) {
      if (this.isDatabaseUnavailable(error)) {
        throw new ServiceUnavailableException('数据库未启动，当前无法获取用户信息');
      }
      throw error;
    }

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roles: this.parseRoles(user.roles),
      tenantId: user.tenantId,
    };
  }

  private async verifyPassword(password: string, tenantId: string, username: string): Promise<boolean> {
    const configuredCredential = this.getConfiguredPasswordCredential(tenantId, username);
    if (configuredCredential) {
      return this.verifyConfiguredCredential(password, configuredCredential);
    }

    // Legacy password mode: accept password === username when enabled
    const legacyAllowed = process.env.AUTH_ALLOW_LEGACY_PASSWORDS === 'true';
    if (legacyAllowed) {
      return password === username;
    }

    return false;
  }

  private getConfiguredPasswordCredential(tenantId: string, username: string): string | null {
    const raw = process.env.AUTH_USER_PASSWORD_HASHES;
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed[`${tenantId}:${username}`] || parsed[username] || null;
    } catch {
      return null;
    }
  }

  private async verifyConfiguredCredential(password: string, credential: string): Promise<boolean> {
    if (credential.startsWith('plain:')) {
      return password === credential.slice(6);
    }

    if (!credential.startsWith('scrypt$')) {
      return false;
    }

    const [, salt, expectedHash] = credential.split('$');
    if (!salt || !expectedHash) {
      return false;
    }

    const actualHashBuf = await scryptAsync(password, salt, 64) as Buffer;
    const actualHash = actualHashBuf.toString('hex');
    const actualBuf = Buffer.from(actualHash, 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (actualBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(actualBuf, expectedBuf);
  }

  private getSessionSecret(): string {
    return getAuthSessionSecret();
  }

  private getSessionTtlSeconds(): number {
    const parsed = Number(process.env.AUTH_SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 60 * 60 * 24 * 7;
    }
    return Math.floor(parsed);
  }

  private isDatabaseUnavailable(error: unknown) {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return true;
    }

    const message = error instanceof Error ? error.message : String(error || '');
    return message.includes("Can't reach database server");
  }
}
