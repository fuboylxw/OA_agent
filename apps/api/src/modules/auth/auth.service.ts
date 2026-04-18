import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { issueAuthSessionToken } from '@uniflow/shared-types';
import type { Request } from 'express';
import axios from 'axios';
import { PrismaService } from '../common/prisma.service';
import { getAuthSessionSecret } from '../common/auth-session-secret';
import { DelegatedCredentialService } from '../delegated-credential/delegated-credential.service';
import { normalizeIdentityType } from '../common/identity-scope.util';

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

  isOauth2Enabled() {
    return true;
  }

  async login(username: string, password: string, tenantId?: string) {
    void username;
    void password;
    void tenantId;
    throw new ForbiddenException('系统已切换为第三方认证登录，不再支持本地用户名密码登录');
  }

  async exchangeOauth2Code(
    code: string,
    state: string,
  ) {
    if (!this.isOauth2Enabled()) {
      throw new ForbiddenException('当前未启用统一认证');
    }

    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new UnauthorizedException('缺少授权码');
    }

    const statePayload = this.verifyOauthState(state);
    const accessToken = await this.exchangeAuthorizationCode(
      normalizedCode,
      statePayload.redirectUri,
    );
    const profile = await this.fetchOauthUserProfile(accessToken);
    const user = await this.upsertOauthUser(profile);
    await this.delegatedCredentialService.seedMockCredentialsForUser({
      tenantId: user.tenantId,
      userId: user.id,
    }).catch((error: any) => {
      this.logger.warn(`Failed to seed delegated credentials for ${user.id}: ${error.message}`);
    });

    const session = this.issueSessionForUser(user);

    return {
      ...session,
      redirectTo: statePayload.returnTo,
    };
  }

  buildOauth2AuthorizationUrl(req: Request, returnTo?: string) {
    if (!this.isOauth2Enabled()) {
      throw new ForbiddenException('当前未启用统一认证');
    }

    const redirectUri = this.resolveOauthRedirectUri(req);
    const state = this.issueOauthState({
      redirectUri,
      returnTo: this.normalizeReturnTo(returnTo),
    });
    const authorizeUrl = new URL(this.resolveOauthEndpoint('authorize'));
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', this.requireEnv('AUTH_OAUTH2_CLIENT_ID'));
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', this.getOauthScope());
    authorizeUrl.searchParams.set('state', state);
    return authorizeUrl.toString();
  }

  buildOauth2LogoutUrl(req: Request, returnTo?: string) {
    if (!this.isOauth2Enabled()) {
      return this.normalizeReturnTo(returnTo);
    }

    const callback = `${this.resolvePublicWebBaseUrl(req, { preferRequestOrigin: true })}${this.normalizeReturnTo(returnTo || '/login')}`;
    const logoutUrl = new URL(this.resolveOauthEndpoint('logout'));
    for (const paramName of this.getOauthLogoutRedirectParams()) {
      logoutUrl.searchParams.set(paramName, callback);
    }
    return logoutUrl.toString();
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
      identityType: user.identityType || undefined,
    };
  }

  async getCurrentUser(userId: string) {
    return this.getUserInfo(userId);
  }

  private getSessionSecret(): string {
    return getAuthSessionSecret();
  }

  private issueSessionForUser(user: {
    id: string;
    username: string;
    displayName: string;
    tenantId: string;
    roles: unknown;
    identityType?: string | null;
  }) {
    const roles = this.parseRoles(user.roles);
    const sessionSecret = this.getSessionSecret();
    const sessionTtlSeconds = this.getSessionTtlSeconds();
    const { token, claims } = issueAuthSessionToken({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roles,
      tenantId: user.tenantId,
      identityType: user.identityType || undefined,
    }, sessionSecret, sessionTtlSeconds);

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roles,
      tenantId: user.tenantId,
      identityType: user.identityType || undefined,
      sessionToken: token,
      sessionExpiresAt: new Date(claims.exp * 1000).toISOString(),
    };
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

  private getOauthScope() {
    return (process.env.AUTH_OAUTH2_SCOPE || 'client').trim() || 'client';
  }

  private getOauthLogoutRedirectParams() {
    const configured = (process.env.AUTH_OAUTH2_LOGOUT_REDIRECT_PARAMS
      || process.env.AUTH_OAUTH2_LOGOUT_REDIRECT_PARAM
      || 'callback')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    return configured.length > 0 ? configured : ['callback'];
  }

  private resolveOauthEndpoint(kind: 'authorize' | 'token' | 'userinfo' | 'logout') {
    const directMapping: Record<'authorize' | 'token' | 'userinfo' | 'logout', string | undefined> = {
      authorize: process.env.AUTH_OAUTH2_AUTHORIZE_URL,
      token: process.env.AUTH_OAUTH2_TOKEN_URL,
      userinfo: process.env.AUTH_OAUTH2_USERINFO_URL,
      logout: process.env.AUTH_OAUTH2_LOGOUT_URL,
    };

    const direct = directMapping[kind]?.trim();
    if (direct) {
      return direct;
    }

    const baseUrl = this.requireEnv('AUTH_OAUTH2_BASE_URL').replace(/\/+$/, '');
    const pathMapping: Record<'authorize' | 'token' | 'userinfo' | 'logout', string> = {
      authorize: '/auth2/oauth/authorize',
      token: '/auth2/oauth/token',
      userinfo: '/auth2/api/v1/getUserInfo',
      logout: '/auth2/logout',
    };

    return `${baseUrl}${pathMapping[kind]}`;
  }

  private resolveOauthRedirectUri(req: Request) {
    const configured = (process.env.AUTH_OAUTH2_REDIRECT_URI || '').trim();
    if (configured) {
      return this.rewriteConfiguredPublicUrlToRequestOrigin(configured, req);
    }

    return `${this.resolvePublicWebBaseUrl(req)}/login/callback`;
  }

  private resolvePublicWebBaseUrl(req: Request, options?: { preferRequestOrigin?: boolean }) {
    const requestBaseUrl = this.resolveRequestPublicWebBaseUrl(req);
    if (options?.preferRequestOrigin && requestBaseUrl) {
      return requestBaseUrl;
    }

    const configured = (process.env.PUBLIC_WEB_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
    if (configured) {
      return configured.replace(/\/+$/, '');
    }

    if (requestBaseUrl) {
      return requestBaseUrl;
    }

    throw new UnauthorizedException('无法解析公网访问地址，请配置 PUBLIC_WEB_BASE_URL');
  }

  private resolveRequestPublicWebBaseUrl(req: Request) {
    const forwardedHost = req.header('x-forwarded-host');
    const host = forwardedHost || req.header('host') || '';
    if (!host) {
      return '';
    }

    const proto = (req.header('x-forwarded-proto')
      || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')).trim();
    return `${proto}://${host}`.replace(/\/+$/, '');
  }

  private rewriteConfiguredPublicUrlToRequestOrigin(configuredUrl: string, req: Request) {
    const requestBaseUrl = this.resolveRequestPublicWebBaseUrl(req);
    if (!requestBaseUrl) {
      return configuredUrl;
    }

    try {
      const configured = new URL(configuredUrl);
      const requestBase = new URL(requestBaseUrl);
      if (configured.origin === requestBase.origin) {
        return configured.toString();
      }

      configured.protocol = requestBase.protocol;
      configured.host = requestBase.host;
      return configured.toString();
    } catch {
      return configuredUrl;
    }
  }

  private issueOauthState(input: { redirectUri: string; returnTo: string }) {
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = 10 * 60;
    const payload = Buffer.from(JSON.stringify({
      ver: 'oauth2_state_v1',
      redirectUri: input.redirectUri,
      returnTo: this.normalizeReturnTo(input.returnTo),
      nonce: randomBytes(12).toString('hex'),
      iat: now,
      exp: now + ttlSeconds,
    }), 'utf8').toString('base64url');
    const signature = this.signOauthState(payload);
    return `${payload}.${signature}`;
  }

  private verifyOauthState(token: string) {
    const normalized = token.trim();
    const [payload, signature] = normalized.split('.');
    if (!payload || !signature || !this.safeEqual(signature, this.signOauthState(payload))) {
      throw new UnauthorizedException('OAuth 状态参数无效，请重新登录');
    }

    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        ver: string;
        redirectUri?: string;
        returnTo?: string;
        exp?: number;
      };

      const now = Math.floor(Date.now() / 1000);
      if (parsed.ver !== 'oauth2_state_v1' || !parsed.redirectUri || typeof parsed.exp !== 'number' || parsed.exp <= now) {
        throw new Error('invalid');
      }

      return {
        redirectUri: parsed.redirectUri,
        returnTo: this.normalizeReturnTo(parsed.returnTo),
      };
    } catch {
      throw new UnauthorizedException('OAuth 状态参数无效，请重新登录');
    }
  }

  private signOauthState(payload: string) {
    return createHmac('sha256', this.getOauthStateSecret())
      .update(payload)
      .digest('base64url');
  }

  private getOauthStateSecret() {
    return (process.env.AUTH_OAUTH2_STATE_SECRET || '').trim() || this.getSessionSecret();
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private normalizeReturnTo(value?: string | null) {
    const normalized = (value || '').trim();
    if (!normalized || !normalized.startsWith('/') || normalized.startsWith('//')) {
      return '/';
    }
    return normalized;
  }

  private requireEnv(name: string) {
    const value = (process.env[name] || '').trim();
    if (!value) {
      throw new ServiceUnavailableException(`缺少环境变量 ${name}`);
    }
    return value;
  }

  private async exchangeAuthorizationCode(code: string, redirectUri: string) {
    const clientId = this.requireEnv('AUTH_OAUTH2_CLIENT_ID');
    const clientSecret = this.requireEnv('AUTH_OAUTH2_CLIENT_SECRET');
    const basicToken = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    let response;
    try {
      response = await axios.post(
        this.resolveOauthEndpoint('token'),
        undefined,
        {
          params: {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
          },
          headers: {
            Authorization: `Basic ${basicToken}`,
          },
          timeout: 15000,
        },
      );
    } catch (error: any) {
      const message = this.extractAxiosMessage(error) || '统一认证换取令牌失败';
      this.logger.warn(`OAuth token exchange failed: ${message}`);
      throw new UnauthorizedException(message);
    }

    const accessToken = this.pickString(response.data, [
      'access_token',
      'data.access_token',
      'result.access_token',
      'token',
      'data.token',
      'result.token',
    ]);

    if (!accessToken) {
      this.logger.warn(`OAuth token response missing access_token: ${JSON.stringify(response.data)}`);
      throw new UnauthorizedException('统一认证未返回访问令牌');
    }

    return accessToken;
  }

  private async fetchOauthUserProfile(accessToken: string) {
    let response;
    try {
      response = await axios.get(this.resolveOauthEndpoint('userinfo'), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 15000,
      });
    } catch (error: any) {
      const message = this.extractAxiosMessage(error) || '获取统一认证用户信息失败';
      this.logger.warn(`OAuth userinfo request failed: ${message}`);
      throw new UnauthorizedException(message);
    }

    const oaUserId = this.pickString(response.data, [
      'userId',
      'user_id',
      'uid',
      'id',
      'data.userId',
      'data.user_id',
      'data.uid',
      'data.id',
      'data.user.userId',
      'data.user.id',
      'result.userId',
      'result.id',
    ]);
    const username = this.pickString(response.data, [
      'username',
      'userName',
      'loginName',
      'login_name',
      'account',
      'accountName',
      'userCode',
      'user_code',
      'code',
      'data.username',
      'data.userName',
      'data.loginName',
      'data.account',
      'data.user.username',
      'data.user.userName',
      'result.username',
      'result.userName',
    ]) || oaUserId;
    const displayName = this.pickString(response.data, [
      'displayName',
      'display_name',
      'name',
      'realName',
      'real_name',
      'nickName',
      'nickname',
      'data.displayName',
      'data.name',
      'data.realName',
      'data.nickName',
      'data.user.displayName',
      'data.user.name',
      'data.user.realName',
      'result.displayName',
      'result.name',
    ]) || username;
    const email = this.pickString(response.data, [
      'email',
      'mail',
      'data.email',
      'data.mail',
      'data.user.email',
      'result.email',
    ]);

    if (!username) {
      this.logger.warn(`OAuth userinfo missing username: ${JSON.stringify(response.data)}`);
      throw new UnauthorizedException('统一认证未返回用户名信息');
    }

    return {
      oaUserId: oaUserId || undefined,
      username: this.normalizeUsername(username),
      displayName: displayName || this.normalizeUsername(username),
      email: email || '',
      identityType: this.resolveOauthIdentityType(response.data),
    };
  }

  private async upsertOauthUser(profile: {
    oaUserId?: string;
    username: string;
    displayName: string;
    email?: string;
    identityType?: string;
  }) {
    const tenant = await this.ensureDefaultTenant();
    const syntheticEmail = profile.email?.trim() || `${profile.username}@oauth.local`;

    const existing = await this.prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        OR: [
          { username: profile.username },
          ...(profile.oaUserId ? [{ oaUserId: profile.oaUserId }] : []),
          { email: syntheticEmail },
        ],
      },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          displayName: profile.displayName,
          email: existing.email || syntheticEmail,
          oaUserId: profile.oaUserId || existing.oaUserId,
          identityType: profile.identityType || existing.identityType,
          status: 'active',
        },
      });
    }

    return this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        username: profile.username,
        email: syntheticEmail,
        displayName: profile.displayName,
        roles: this.resolveOauthBootstrapRoles(profile),
        oaUserId: profile.oaUserId,
        identityType: profile.identityType,
        status: 'active',
      },
    });
  }

  private async ensureDefaultTenant() {
    const defaultTenantId = (process.env.DEFAULT_TENANT_ID || '').trim();
    if (defaultTenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: defaultTenantId },
      });
      if (tenant) {
        return tenant;
      }

      return this.prisma.tenant.create({
        data: {
          id: defaultTenantId,
          code: 'default',
          name: 'Default Tenant',
          status: 'active',
        },
      });
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { code: 'default' },
    });
    if (tenant) {
      return tenant;
    }

    return this.prisma.tenant.create({
      data: {
        code: 'default',
        name: 'Default Tenant',
        status: 'active',
      },
    });
  }

  private resolveOauthBootstrapRoles(profile: { username: string; oaUserId?: string }) {
    const roles = new Set<string>(['user']);
    const username = profile.username.toLowerCase();
    const oaUserId = (profile.oaUserId || '').toLowerCase();

    if (this.matchesOauthRoleRule(username, oaUserId, 'AUTH_OAUTH2_FLOW_MANAGER_USERNAMES', 'AUTH_OAUTH2_FLOW_MANAGER_USER_IDS')) {
      roles.add('flow_manager');
    }

    if (this.matchesOauthRoleRule(username, oaUserId, 'AUTH_OAUTH2_ADMIN_USERNAMES', 'AUTH_OAUTH2_ADMIN_USER_IDS')) {
      roles.add('admin');
      roles.add('flow_manager');
    }

    return Array.from(roles);
  }

  private matchesOauthRoleRule(
    username: string,
    oaUserId: string,
    usernameEnv: string,
    userIdEnv: string,
  ) {
    const usernames = this.parseCsvEnv(usernameEnv);
    const userIds = this.parseCsvEnv(userIdEnv);
    return usernames.has(username) || (oaUserId ? userIds.has(oaUserId) : false);
  }

  private parseCsvEnv(name: string) {
    return new Set(
      (process.env[name] || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private normalizeUsername(input: string) {
    return input.trim().replace(/\s+/g, '_');
  }

  private resolveOauthIdentityType(input: unknown) {
    const direct = normalizeIdentityType(this.pickString(input, [
      'identityType',
      'userType',
      'personType',
      'staffType',
      'accountType',
      'identity',
      'userIdentity',
      'data.identityType',
      'data.userType',
      'data.personType',
      'data.staffType',
      'data.accountType',
      'data.identity',
      'data.userIdentity',
      'data.user.identityType',
      'data.user.userType',
      'data.user.personType',
      'data.user.staffType',
      'data.user.accountType',
      'data.user.identity',
      'data.user.userIdentity',
      'result.identityType',
      'result.userType',
      'result.personType',
      'result.staffType',
      'result.accountType',
      'result.identity',
      'result.userIdentity',
    ]));
    if (direct) {
      return direct;
    }

    const raw = this.pickString(input, [
      'identityType',
      'userType',
      'personType',
      'staffType',
      'accountType',
      'identity',
      'userIdentity',
      'data.identityType',
      'data.userType',
      'data.personType',
      'data.staffType',
      'data.accountType',
      'data.identity',
      'data.userIdentity',
      'data.user.identityType',
      'data.user.userType',
      'data.user.personType',
      'data.user.staffType',
      'data.user.accountType',
      'data.user.identity',
      'data.user.userIdentity',
      'result.identityType',
      'result.userType',
      'result.personType',
      'result.staffType',
      'result.accountType',
      'result.identity',
      'result.userIdentity',
    ]).toLowerCase();
    if (!raw) {
      return undefined;
    }

    if (this.parseCsvEnv('AUTH_OAUTH2_TEACHER_IDENTITY_VALUES').has(raw)) {
      return 'teacher';
    }
    if (this.parseCsvEnv('AUTH_OAUTH2_STUDENT_IDENTITY_VALUES').has(raw)) {
      return 'student';
    }
    return undefined;
  }

  private pickString(input: unknown, paths: string[]) {
    for (const path of paths) {
      const value = this.pickPathValue(input, path);
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }

    return '';
  }

  private pickPathValue(input: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object' || !(segment in (current as Record<string, unknown>))) {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment];
    }, input);
  }

  private extractAxiosMessage(error: any) {
    const message = error?.response?.data?.message;
    if (Array.isArray(message)) {
      const first = message.find((item) => typeof item === 'string' && item.trim());
      if (first) {
        return first.trim();
      }
    }
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
    if (typeof error?.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }
    return '';
  }
}
