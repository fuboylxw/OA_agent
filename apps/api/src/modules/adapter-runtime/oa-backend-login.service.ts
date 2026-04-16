import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosResponse } from 'axios';
import { createPrivateKey, randomBytes, sign as cryptoSign } from 'crypto';
import { sm2 } from 'sm-crypto';
import type { RpaFlowDefinition } from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { encryptAuthBindingPayload } from '../auth-binding/auth-binding-crypto';

interface RuntimeAuthScope {
  tenantId?: string;
  userId?: string;
}

interface OaBackendLoginConfig {
  enabled: boolean;
  loginUrl: string;
  method: 'GET' | 'POST';
  requestMode: 'query' | 'form' | 'json';
  clientId: string;
  privateKey: string;
  accountField?: string;
  nonceLength: number;
  timestampMode: 'millis' | 'seconds' | 'iso';
  signField: string;
  signDigest: string;
  signEncoding: 'base64' | 'hex';
  headers: Record<string, string>;
  extraParams: Record<string, any>;
  cookieOrigin?: string;
  cookieDomain?: string;
  cookiePath?: string;
  responseCookiePath?: string;
  responseStorageStatePath?: string;
  responseSuccessPath?: string;
  responseSuccessValue?: string | number | boolean;
  persistBinding: boolean;
  bindingName?: string;
}

interface PersistableUser {
  id: string;
  tenantId: string;
  username: string;
  email: string;
  oaUserId: string | null;
}

@Injectable()
export class OaBackendLoginService {
  private readonly logger = new Logger(OaBackendLoginService.name);
  private readonly client = axios.create({
    timeout: 15000,
    validateStatus: () => true,
  });

  constructor(private readonly prisma: PrismaService) {}

  async resolveExecutionAuthConfig(input: {
    connectorId: string;
    authType: string;
    authConfig: Record<string, any>;
    authScope?: RuntimeAuthScope;
    flow?: RpaFlowDefinition;
  }): Promise<{ authConfig: Record<string, any> } | null> {
    const config = this.readBackendLoginConfig(input.authConfig);
    if (!config?.enabled) {
      return null;
    }

    const tenantId = input.authScope?.tenantId?.trim();
    const userId = input.authScope?.userId?.trim();
    if (!tenantId || !userId) {
      throw new Error('OA backend login requires an authenticated tenant user scope');
    }

    const user = await this.loadUser(tenantId, userId);
    const account = this.resolveAccount(config, user);
    if (!account) {
      throw new Error(`Unable to resolve OA account for user ${userId}`);
    }

    const requestPayload = this.buildSignedPayload(config, account);
    const response = await this.sendLoginRequest(config, requestPayload);
    this.assertResponseSuccess(config, response);

    const authFragment = this.buildAuthFragment(config, response, input.authConfig, input.flow);
    if (config.persistBinding) {
      await this.persistSessionBinding({
        connectorId: input.connectorId,
        authType: input.authType,
        tenantId,
        user,
        authFragment,
        bindingName: config.bindingName,
      }).catch((error: any) => {
        this.logger.warn(`Failed to persist OA backend login session for connector ${input.connectorId}: ${error.message}`);
      });
    }

    return { authConfig: authFragment };
  }

  private async loadUser(tenantId: string, userId: string): Promise<PersistableUser> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
      },
      select: {
        id: true,
        tenantId: true,
        username: true,
        email: true,
        oaUserId: true,
      },
    });

    if (!user) {
      throw new Error(`User ${userId} not found in tenant ${tenantId}`);
    }

    return user;
  }

  private readBackendLoginConfig(authConfig: Record<string, any> | null | undefined): OaBackendLoginConfig | null {
    const rootConfig = this.asRecord(authConfig);
    const platformConfig = this.asRecord(rootConfig.platformConfig);
    const rawConfig = this.firstRecord([
      platformConfig.oaBackendLogin,
      platformConfig.backendLogin,
      platformConfig.whiteListLogin,
      platformConfig.whitelistLogin,
      rootConfig.oaBackendLogin,
      rootConfig.backendLogin,
      rootConfig.whiteListLogin,
      rootConfig.whitelistLogin,
    ]);

    if (!rawConfig) {
      return null;
    }

    const enabled = rawConfig.enabled !== false;
    const loginUrl = String(rawConfig.loginUrl || rawConfig.url || '').trim();
    const method = String(rawConfig.method || 'POST').trim().toUpperCase() === 'GET' ? 'GET' : 'POST';
    const requestMode = this.normalizeRequestMode(rawConfig.requestMode, method);

    return {
      enabled,
      loginUrl,
      method,
      requestMode,
      clientId: this.readStringSetting(rawConfig, 'clientId', 'clientIdEnv', 'AUTH_OAUTH2_CLIENT_ID'),
      privateKey: this.readStringSetting(rawConfig, 'privateKey', 'privateKeyEnv', 'AUTH_OAUTH2_PRIVATE_KEY'),
      accountField: String(rawConfig.accountField || '').trim() || undefined,
      nonceLength: this.normalizePositiveInt(rawConfig.nonceLength, 10),
      timestampMode: this.normalizeTimestampMode(rawConfig.timestampMode),
      signField: String(rawConfig.signField || 'sign').trim() || 'sign',
      signDigest: String(rawConfig.signDigest || 'sm3').trim() || 'sm3',
      signEncoding: String(rawConfig.signEncoding || 'hex').trim().toLowerCase() === 'base64' ? 'base64' : 'hex',
      headers: this.normalizeHeaders(rawConfig.headers),
      extraParams: this.asRecord(rawConfig.extraParams),
      cookieOrigin: String(rawConfig.cookieOrigin || '').trim() || undefined,
      cookieDomain: String(rawConfig.cookieDomain || '').trim() || undefined,
      cookiePath: String(rawConfig.cookiePath || '').trim() || undefined,
      responseCookiePath: String(rawConfig.responseCookiePath || '').trim() || undefined,
      responseStorageStatePath: String(rawConfig.responseStorageStatePath || '').trim() || undefined,
      responseSuccessPath: String(rawConfig.responseSuccessPath || '').trim() || undefined,
      responseSuccessValue: rawConfig.responseSuccessValue as string | number | boolean | undefined,
      persistBinding: rawConfig.persistBinding !== false,
      bindingName: String(rawConfig.bindingName || '').trim() || undefined,
    };
  }

  private buildSignedPayload(config: OaBackendLoginConfig, account: string) {
    if (!config.loginUrl) {
      throw new Error('OA backend login is enabled but loginUrl is missing');
    }
    if (!config.clientId) {
      throw new Error('OA backend login is enabled but clientId is missing');
    }
    if (!config.privateKey) {
      throw new Error('OA backend login is enabled but privateKey is missing');
    }

    const payload: Record<string, any> = {
      clientId: config.clientId,
      account,
      timestamp: this.generateTimestamp(config.timestampMode),
      nonceStr: this.generateNonce(config.nonceLength),
      ...config.extraParams,
    };
    const signSource = Object.entries(payload)
      .filter(([key, value]) => key !== config.signField && value !== undefined && value !== null && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&');
    payload[config.signField] = this.signPayload(signSource, config);
    return payload;
  }

  private async sendLoginRequest(
    config: OaBackendLoginConfig,
    payload: Record<string, any>,
  ): Promise<AxiosResponse<any>> {
    const headers = {
      ...config.headers,
    };

    if (config.requestMode === 'query') {
      return this.client.request({
        method: config.method,
        url: config.loginUrl,
        params: payload,
        headers,
      });
    }

    if (config.requestMode === 'json') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      return this.client.request({
        method: config.method,
        url: config.loginUrl,
        data: payload,
        headers,
      });
    }

    headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
    const body = new URLSearchParams(
      Object.entries(payload).reduce<Record<string, string>>((result, [key, value]) => {
        result[key] = String(value ?? '');
        return result;
      }, {}),
    ).toString();
    return this.client.request({
      method: config.method,
      url: config.loginUrl,
      data: body,
      headers,
    });
  }

  private assertResponseSuccess(config: OaBackendLoginConfig, response: AxiosResponse<any>) {
    if (response.status >= 400) {
      throw new Error(`OA backend login failed with HTTP ${response.status}`);
    }

    if (!config.responseSuccessPath) {
      return;
    }

    const actualValue = this.readByPath(response.data, config.responseSuccessPath);
    if (actualValue !== config.responseSuccessValue) {
      throw new Error(
        `OA backend login success check failed: expected ${config.responseSuccessPath}=${String(config.responseSuccessValue)}, got ${String(actualValue)}`,
      );
    }
  }

  private buildAuthFragment(
    config: OaBackendLoginConfig,
    response: AxiosResponse<any>,
    baseAuthConfig: Record<string, any>,
    flow?: RpaFlowDefinition,
  ) {
    const cookieOrigin = this.resolveCookieOrigin(config, baseAuthConfig, flow);
    const storageState = this.extractStorageState(config, response);
    const setCookieCookies = this.parseSetCookieHeaders(response.headers?.['set-cookie'], cookieOrigin, config);
    const cookieHeaderFromBody = this.extractCookieHeader(config, response.data);
    const cookieHeader = cookieHeaderFromBody || (setCookieCookies.length > 0 ? this.toCookieHeader(setCookieCookies) : undefined);
    const cookies = storageState?.cookies?.length
      ? this.normalizePlaywrightCookies(storageState.cookies, cookieOrigin, config)
      : setCookieCookies.length > 0
        ? setCookieCookies
        : this.parseCookieHeader(cookieHeader, cookieOrigin, config);

    if ((!storageState || !Array.isArray(storageState.cookies)) && cookies.length === 0) {
      throw new Error('OA backend login did not return usable cookies or storageState');
    }

    return {
      ...(cookieHeader ? { cookie: cookieHeader, sessionCookie: cookieHeader } : {}),
      platformConfig: {
        ...this.asRecord(baseAuthConfig.platformConfig),
        ...(cookies.length > 0
          ? {
              storageState: {
                cookies,
                origins: [],
              },
            }
          : {}),
        ...(cookieOrigin ? { cookieOrigin } : {}),
      },
    };
  }

  private extractStorageState(config: OaBackendLoginConfig, response: AxiosResponse<any>) {
    const candidates = [
      config.responseStorageStatePath,
      'storageState',
      'data.storageState',
      'result.storageState',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const value = this.readByPath(response.data, candidate);
      const parsed = this.parseStorageState(value);
      if (parsed) {
        return parsed;
      }
    }

    return undefined;
  }

  private extractCookieHeader(config: OaBackendLoginConfig, body: any) {
    const candidates = [
      config.responseCookiePath,
      'cookie',
      'sessionCookie',
      'data.cookie',
      'data.sessionCookie',
      'result.cookie',
      'result.sessionCookie',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const value = this.readByPath(body, candidate);
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return undefined;
  }

  private resolveAccount(config: OaBackendLoginConfig, user: PersistableUser) {
    const preferredField = (config.accountField || '').trim();
    if (preferredField) {
      return this.readAccountValue(user, preferredField);
    }

    return user.oaUserId || user.username || user.email || undefined;
  }

  private readAccountValue(user: PersistableUser, field: string) {
    switch (field) {
      case 'oaUserId':
        return user.oaUserId || undefined;
      case 'username':
        return user.username || undefined;
      case 'email':
        return user.email || undefined;
      case 'id':
        return user.id || undefined;
      default:
        return undefined;
    }
  }

  private resolveCookieOrigin(
    config: OaBackendLoginConfig,
    authConfig: Record<string, any>,
    flow?: RpaFlowDefinition,
  ) {
    const candidates = [
      config.cookieOrigin,
      String(this.asRecord(authConfig.platformConfig).cookieOrigin || '').trim(),
      String(flow?.platform?.entryUrl || '').trim(),
      String(this.asRecord(authConfig.platformConfig).entryUrl || '').trim(),
      config.loginUrl,
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        const url = new URL(candidate);
        return `${url.protocol}//${url.host}`;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async persistSessionBinding(input: {
    tenantId: string;
    connectorId: string;
    authType: string;
    user: PersistableUser;
    authFragment: Record<string, any>;
    bindingName?: string;
  }) {
    const storageState = this.asRecord(this.asRecord(input.authFragment.platformConfig).storageState);
    const cookieHeader = String(input.authFragment.sessionCookie || input.authFragment.cookie || '').trim();
    const assetType = Array.isArray(storageState.cookies) && storageState.cookies.length > 0
      ? 'browser_session'
      : 'cookie_session';
    const payload = assetType === 'browser_session'
      ? { storageState }
      : {
          cookie: cookieHeader,
          sessionCookie: cookieHeader,
          cookieOrigin: this.asRecord(input.authFragment.platformConfig).cookieOrigin,
        };

    const now = new Date();
    const binding = await this.prisma.authBinding.findFirst({
      where: {
        tenantId: input.tenantId,
        connectorId: input.connectorId,
        userId: input.user.id,
        ownerType: 'user',
      },
      orderBy: [
        { isDefault: 'desc' },
        { updatedAt: 'desc' },
      ],
    }) || await this.prisma.authBinding.create({
      data: {
        tenantId: input.tenantId,
        connectorId: input.connectorId,
        userId: input.user.id,
        ownerType: 'user',
        bindingName: input.bindingName || 'OA白名单登录会话',
        authType: input.authType,
        authMode: assetType,
        status: 'active',
        isDefault: true,
        metadata: {
          source: 'oa_backend_login',
        },
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.authSessionAsset.updateMany({
        where: {
          tenantId: input.tenantId,
          authBindingId: binding.id,
          assetType,
          status: 'active',
        },
        data: {
          status: 'stale',
        },
      });

      await tx.authSessionAsset.create({
        data: {
          tenantId: input.tenantId,
          authBindingId: binding.id,
          assetType,
          status: 'active',
          encryptedPayload: encryptAuthBindingPayload(payload),
          issuedAt: now,
          metadata: {
            source: 'oa_backend_login',
            userAccount: input.user.oaUserId || input.user.username,
          },
        },
      });

      await tx.authBinding.update({
        where: { id: binding.id },
        data: {
          authMode: assetType,
          lastBoundAt: now,
          status: 'active',
        },
      });
    });
  }

  private parseStorageState(value: unknown) {
    if (!value) {
      return undefined;
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return this.parseStorageState(parsed);
      } catch {
        return undefined;
      }
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, any>;
    if (!Array.isArray(record.cookies)) {
      return undefined;
    }

    return {
      cookies: record.cookies,
      origins: Array.isArray(record.origins) ? record.origins : [],
    };
  }

  private parseSetCookieHeaders(
    rawHeader: unknown,
    cookieOrigin: string | undefined,
    config: OaBackendLoginConfig,
  ) {
    const values = Array.isArray(rawHeader)
      ? rawHeader
      : typeof rawHeader === 'string'
        ? [rawHeader]
        : [];
    if (values.length === 0) {
      return [];
    }

    return values
      .map((header) => this.parseSetCookieHeader(header, cookieOrigin, config))
      .filter(Boolean) as Array<Record<string, any>>;
  }

  private parseSetCookieHeader(
    header: string,
    cookieOrigin: string | undefined,
    config: OaBackendLoginConfig,
  ) {
    if (!header || typeof header !== 'string') {
      return undefined;
    }

    const segments = header.split(';').map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) {
      return undefined;
    }

    const nameValue = segments.shift();
    if (!nameValue || !nameValue.includes('=')) {
      return undefined;
    }

    const separatorIndex = nameValue.indexOf('=');
    const name = nameValue.slice(0, separatorIndex).trim();
    const value = nameValue.slice(separatorIndex + 1).trim();
    if (!name) {
      return undefined;
    }

    const cookie: Record<string, any> = {
      name,
      value,
      path: config.cookiePath || '/',
    };

    for (const segment of segments) {
      const [rawKey, ...rest] = segment.split('=');
      const key = rawKey.trim().toLowerCase();
      const rawValue = rest.join('=').trim();
      switch (key) {
        case 'domain':
          cookie.domain = rawValue;
          break;
        case 'path':
          cookie.path = rawValue || cookie.path;
          break;
        case 'expires': {
          const expiresAt = Date.parse(rawValue);
          if (!Number.isNaN(expiresAt)) {
            cookie.expires = Math.floor(expiresAt / 1000);
          }
          break;
        }
        case 'max-age': {
          const maxAge = Number.parseInt(rawValue, 10);
          if (!Number.isNaN(maxAge)) {
            cookie.expires = Math.floor(Date.now() / 1000) + maxAge;
          }
          break;
        }
        case 'secure':
          cookie.secure = true;
          break;
        case 'httponly':
          cookie.httpOnly = true;
          break;
        case 'samesite':
          cookie.sameSite = this.normalizeSameSite(rawValue);
          break;
        default:
          break;
      }
    }

    if (!cookie.domain && config.cookieDomain) {
      cookie.domain = config.cookieDomain;
    }

    if (!cookie.domain && cookieOrigin) {
      cookie.url = cookieOrigin;
    }

    return cookie;
  }

  private parseCookieHeader(
    cookieHeader: string | undefined,
    cookieOrigin: string | undefined,
    config: OaBackendLoginConfig,
  ) {
    if (!cookieHeader) {
      return [];
    }

    return cookieHeader
      .split(';')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const separatorIndex = segment.indexOf('=');
        if (separatorIndex <= 0) {
          return undefined;
        }

        const cookie: Record<string, any> = {
          name: segment.slice(0, separatorIndex).trim(),
          value: segment.slice(separatorIndex + 1).trim(),
          path: config.cookiePath || '/',
        };
        if (config.cookieDomain) {
          cookie.domain = config.cookieDomain;
        } else if (cookieOrigin) {
          cookie.url = cookieOrigin;
        }
        return cookie;
      })
      .filter(Boolean) as Array<Record<string, any>>;
  }

  private normalizePlaywrightCookies(
    cookies: any[],
    cookieOrigin: string | undefined,
    config: OaBackendLoginConfig,
  ) {
    return cookies
      .map((cookie) => {
        if (!cookie || typeof cookie !== 'object' || !cookie.name) {
          return undefined;
        }

        const normalized: Record<string, any> = {
          name: String(cookie.name),
          value: String(cookie.value || ''),
          path: String(cookie.path || config.cookiePath || '/'),
        };

        if (cookie.domain || config.cookieDomain) {
          normalized.domain = String(cookie.domain || config.cookieDomain);
        } else if (cookie.url || cookieOrigin) {
          normalized.url = String(cookie.url || cookieOrigin);
        }

        if (cookie.expires !== undefined) normalized.expires = cookie.expires;
        if (cookie.httpOnly !== undefined) normalized.httpOnly = Boolean(cookie.httpOnly);
        if (cookie.secure !== undefined) normalized.secure = Boolean(cookie.secure);
        if (cookie.sameSite !== undefined) normalized.sameSite = this.normalizeSameSite(String(cookie.sameSite));
        return normalized;
      })
      .filter(Boolean) as Array<Record<string, any>>;
  }

  private toCookieHeader(cookies: Array<Record<string, any>>) {
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }

  private signPayload(source: string, config: OaBackendLoginConfig) {
    if (config.signDigest.trim().toLowerCase() === 'sm3') {
      const signatureHex = sm2.doSignature(source, this.extractSm2PrivateKeyHex(config.privateKey), {
        der: true,
        hash: true,
      });
      return config.signEncoding === 'hex'
        ? signatureHex
        : Buffer.from(signatureHex, 'hex').toString('base64');
    }

    const privateKey = this.createSigningKey(config.privateKey);
    const signature = cryptoSign(
      config.signDigest,
      Buffer.from(source, 'utf8'),
      {
        key: privateKey,
        dsaEncoding: 'der',
      } as any,
    );

    return config.signEncoding === 'hex'
      ? signature.toString('hex')
      : signature.toString('base64');
  }

  private extractSm2PrivateKeyHex(rawKey: string) {
    const keyObject = this.createSigningKey(rawKey);
    const exported = keyObject.export({
      format: 'der',
      type: 'pkcs8',
    }) as Buffer;
    const match = exported.toString('hex').match(/0201010420([0-9a-f]{64})/i);
    if (!match) {
      throw new Error('Unsupported SM2 private key format');
    }
    return match[1];
  }

  private createSigningKey(rawKey: string) {
    const normalized = String(rawKey || '').trim();
    if (!normalized) {
      throw new Error('OA backend login private key is empty');
    }

    if (normalized.includes('BEGIN')) {
      return createPrivateKey(normalized);
    }

    const der = Buffer.from(normalized, 'base64');
    for (const type of ['pkcs8', 'sec1'] as const) {
      try {
        return createPrivateKey({
          key: der,
          format: 'der',
          type,
        });
      } catch {
        continue;
      }
    }

    throw new Error('Unsupported OA backend login private key format');
  }

  private normalizeHeaders(headers: unknown) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      return {};
    }

    return Object.entries(headers as Record<string, any>).reduce<Record<string, string>>((result, [key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        result[key] = String(value);
      }
      return result;
    }, {});
  }

  private normalizeRequestMode(value: unknown, method: 'GET' | 'POST'): OaBackendLoginConfig['requestMode'] {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'query' || normalized === 'form' || normalized === 'json') {
      return normalized;
    }
    return method === 'GET' ? 'query' : 'form';
  }

  private normalizeTimestampMode(value: unknown): OaBackendLoginConfig['timestampMode'] {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'seconds' || normalized === 'iso') {
      return normalized;
    }
    return 'millis';
  }

  private normalizePositiveInt(value: unknown, fallback: number) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private normalizeSameSite(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'strict') return 'Strict';
    if (normalized === 'none') return 'None';
    return 'Lax';
  }

  private generateTimestamp(mode: OaBackendLoginConfig['timestampMode']) {
    if (mode === 'seconds') {
      return String(Math.floor(Date.now() / 1000));
    }
    if (mode === 'iso') {
      return new Date().toISOString();
    }
    return String(Date.now());
  }

  private generateNonce(length: number) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(length);
    return Array.from(bytes).map((byte) => alphabet[byte % alphabet.length]).join('');
  }

  private readStringSetting(
    config: Record<string, any>,
    key: string,
    envKey: string,
    fallbackEnvName?: string,
  ) {
    const direct = String(config[key] || '').trim();
    if (direct) {
      return direct;
    }

    const envName = String(config[envKey] || '').trim();
    if (envName) {
      return String(process.env[envName] || '').trim();
    }

    return fallbackEnvName ? String(process.env[fallbackEnvName] || '').trim() : '';
  }

  private readByPath(source: any, path: string) {
    return path.split('.').reduce<any>((current, key) => current?.[key], source);
  }

  private firstRecord(values: unknown[]) {
    for (const value of values) {
      const record = this.asRecord(value);
      if (Object.keys(record).length > 0) {
        return record;
      }
    }
    return null;
  }

  private asRecord(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, any>;
  }
}
