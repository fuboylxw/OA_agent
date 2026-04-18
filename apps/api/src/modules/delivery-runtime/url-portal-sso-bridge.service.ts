import { Injectable } from '@nestjs/common';
import type { RpaFlowDefinition, RpaPortalSsoBridgeDefinition } from '@uniflow/shared-types';
import type { PlatformTicketResult } from '../adapter-runtime/platform-ticket-broker';

interface UrlPortalSsoBridgeInput {
  connectorId: string;
  processCode: string;
  processName: string;
  action: 'submit' | 'queryStatus';
  authConfig: Record<string, any>;
  flow?: RpaFlowDefinition;
  ticket: PlatformTicketResult;
}

interface UrlPortalSsoBridgeResult {
  authConfig: Record<string, any>;
  ticket: PlatformTicketResult;
}

interface OaInfoCaptureHandle {
  promise: Promise<any>;
  targetUrl: string;
  dispose: () => void;
}

interface PortalAuthProbeHandle {
  state: {
    authorizationHeader?: string;
    accessToken?: string;
  };
  dispose: () => void;
}

interface OaInfoResolutionResult {
  payload: any;
  source: 'portal_response' | 'http_fallback';
}

const OA_INFO_SOFT_TIMEOUT = Symbol('oa_info_soft_timeout');

@Injectable()
export class UrlPortalSsoBridgeService {
  async resolve(input: UrlPortalSsoBridgeInput): Promise<UrlPortalSsoBridgeResult> {
    const bridge = input.flow?.platform?.portalSsoBridge;
    if (!bridge?.enabled) {
      return {
        authConfig: input.authConfig,
        ticket: input.ticket,
      };
    }

    try {
      switch (bridge.mode || 'oa_info') {
        case 'oa_info':
          return await this.resolveViaOaInfo(input, bridge);
        default:
          throw new Error(`Unsupported portal SSO bridge mode: ${String(bridge.mode)}`);
      }
    } catch (error: any) {
      if (bridge.required === false) {
        return {
          authConfig: input.authConfig,
          ticket: {
            ...input.ticket,
            metadata: {
              ...(input.ticket.metadata || {}),
              portalSsoBridge: {
                enabled: true,
                activated: false,
                error: error?.message || 'portal_sso_bridge_failed',
              },
            },
          },
        };
      }
      throw error;
    }
  }

  private async resolveViaOaInfo(
    input: UrlPortalSsoBridgeInput,
    bridge: RpaPortalSsoBridgeDefinition,
  ): Promise<UrlPortalSsoBridgeResult> {
    const playwright = require('playwright');
    const browser = await playwright.chromium.launch({
      headless: this.resolveHeadlessMode(input.flow),
      executablePath: input.flow?.runtime?.browserExecutablePath || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });

    try {
      const contextOptions: Record<string, any> = {};
      const storageState = this.parseStorageState(input.authConfig);
      if (storageState) {
        contextOptions.storageState = storageState;
      }

      const context = await browser.newContext(contextOptions);
      const bootstrapCookies = storageState?.cookies?.length
        ? [] as Array<Record<string, any>>
        : this.normalizeBootstrapCookies(input.authConfig, bridge.portalUrl || input.ticket.jumpUrl);
      if (bootstrapCookies.length > 0) {
        await context.addCookies(bootstrapCookies);
      }

      const page = await context.newPage();
      const portalUrl = this.resolvePortalUrl(input, bridge);
      const timeoutMs = input.flow?.runtime?.timeoutMs || 30000;
      const portalAuthProbe = this.capturePortalAuthState(page, portalUrl);
      const oaInfoCapture = this.captureOaInfo(
        page,
        this.resolveOaInfoUrl(portalUrl, bridge.oaInfoUrl),
        timeoutMs,
      );
      await page.goto(portalUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      await page.waitForLoadState('networkidle', {
        timeout: Math.min(input.flow?.runtime?.stabilityTimeoutMs || 8000, timeoutMs),
      }).catch(() => undefined);

      const oaInfoResolution = await this.resolveOaInfoPayload({
        authConfig: input.authConfig,
        context,
        capture: oaInfoCapture,
        portalAuthState: portalAuthProbe.state,
        portalUrl,
        timeoutMs,
      });
      const oaInfo = oaInfoResolution.payload;
      const sourceUrl = this.resolveSourceUrl(oaInfo, bridge.sourcePath);
      if (!sourceUrl) {
        throw new Error('Portal OA info did not contain a usable SSO source URL');
      }

      const targetBusinessUrl = this.resolveTargetBusinessUrl(input, bridge, sourceUrl);
      const resolvedSsoUrl = this.buildResolvedSsoUrl(sourceUrl, targetBusinessUrl);
      await page.goto(resolvedSsoUrl, {
        waitUntil: 'domcontentloaded',
        timeout: input.flow?.runtime?.timeoutMs || 30000,
      });
      await page.waitForLoadState('networkidle', {
        timeout: Math.min(input.flow?.runtime?.stabilityTimeoutMs || 8000, input.flow?.runtime?.timeoutMs || 30000),
      }).catch(() => undefined);

      const finalUrl = page.url() || targetBusinessUrl;
      const mergedStorageState = await context.storageState();
      const mergedCookies = this.normalizePlaywrightCookies(mergedStorageState?.cookies, finalUrl);
      const sessionCookie = this.buildCookieHeaderForUrl(mergedCookies, finalUrl);
      const nextAuthConfig = this.mergeAuthConfig(input.authConfig, {
        ...(sessionCookie ? { cookie: sessionCookie, sessionCookie } : {}),
        platformConfig: {
          storageState: mergedStorageState,
          ...(mergedCookies.length > 0 ? { cookies: mergedCookies } : {}),
          cookieOrigin: this.toOrigin(finalUrl),
          ...(portalAuthProbe.state.authorizationHeader || portalAuthProbe.state.accessToken
            ? {
                portalAuth: {
                  ...(portalAuthProbe.state.authorizationHeader
                    ? { authorizationHeader: portalAuthProbe.state.authorizationHeader }
                    : {}),
                  ...(portalAuthProbe.state.accessToken
                    ? { accessToken: portalAuthProbe.state.accessToken }
                    : {}),
                },
              }
            : {}),
        },
      });
      portalAuthProbe.dispose();

      return {
        authConfig: nextAuthConfig,
        ticket: {
          ...input.ticket,
          jumpUrl: finalUrl,
          metadata: {
            ...(input.ticket.metadata || {}),
            portalSsoBridge: {
              enabled: true,
              activated: true,
              mode: bridge.mode || 'oa_info',
              portalUrl,
              oaInfoUrl: bridge.oaInfoUrl,
              oaInfoSource: oaInfoResolution.source,
              portalAuthMode: this.resolvePortalAuthMode(portalAuthProbe.state),
              sourceUrl,
              resolvedSsoUrl,
              finalUrl,
            },
          },
        },
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private captureOaInfo(page: any, oaInfoUrl: string, timeoutMs: number): OaInfoCaptureHandle {
    let settled = false;
    let resolvePromise: (value: any) => void = () => undefined;
    let rejectPromise: (error: any) => void = () => undefined;
    const cleanup = (markSettled = true) => {
      if (markSettled) {
        settled = true;
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      if (typeof page?.off === 'function') {
        page.off('response', handler);
      }
    };

    const handler = async (response: any) => {
      if (settled) {
        return;
      }

      try {
        const responseUrl = String(response?.url?.() || '');
        if (!responseUrl || !this.matchesOaInfoUrl(responseUrl, oaInfoUrl)) {
          return;
        }

        const payload = await response.json();
        cleanup();
        resolvePromise(payload);
      } catch (error) {
        cleanup();
        rejectPromise(error);
      }
    };

    const promise = new Promise<any>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      cleanup();
      rejectPromise(new Error(`Timed out waiting for OA info response from ${oaInfoUrl}`));
    }, timeoutMs);

    page.on('response', handler);
    return {
      promise,
      targetUrl: oaInfoUrl,
      dispose: () => cleanup(),
    };
  }

  private async resolveOaInfoPayload(input: {
    authConfig: Record<string, any>;
    context: any;
    capture: OaInfoCaptureHandle;
    portalAuthState: {
      authorizationHeader?: string;
      accessToken?: string;
    };
    portalUrl: string;
    timeoutMs: number;
  }): Promise<OaInfoResolutionResult> {
    const softTimeoutMs = Math.max(1000, Math.min(4000, Math.floor(input.timeoutMs / 5)));
    const quickCapture = await this.awaitWithSoftTimeout(input.capture.promise, softTimeoutMs)
      .catch((error) => {
        throw new Error(`Portal OA info response failed: ${this.formatErrorMessage(error)}`);
      });
    if (quickCapture !== OA_INFO_SOFT_TIMEOUT) {
      input.capture.dispose();
      return {
        payload: quickCapture,
        source: 'portal_response',
      };
    }

    let fallbackError: any;
    try {
      const payload = await this.fetchOaInfoViaHttp({
        authConfig: input.authConfig,
        context: input.context,
        portalAuthState: input.portalAuthState,
        portalUrl: input.portalUrl,
        oaInfoUrl: input.capture.targetUrl,
        timeoutMs: Math.min(10000, input.timeoutMs),
      });
      input.capture.dispose();
      return {
        payload,
        source: 'http_fallback',
      };
    } catch (error) {
      fallbackError = error;
    }

    try {
      const payload = await input.capture.promise;
      return {
        payload,
        source: 'portal_response',
      };
    } catch (captureError) {
      const suffix = fallbackError
        ? `; fallback request failed: ${this.formatErrorMessage(fallbackError)}`
        : '';
      throw new Error(
        `${this.formatErrorMessage(captureError)}${suffix}`,
      );
    } finally {
      input.capture.dispose();
    }
  }

  private async fetchOaInfoViaHttp(input: {
    authConfig: Record<string, any>;
    context: any;
    portalAuthState: {
      authorizationHeader?: string;
      accessToken?: string;
    };
    portalUrl: string;
    oaInfoUrl: string;
    timeoutMs: number;
  }) {
    const storageState = await input.context?.storageState?.().catch(() => undefined);
    const contextCookies = this.normalizePlaywrightCookies(storageState?.cookies, input.portalUrl);
    const cookies = contextCookies.length > 0
      ? contextCookies
      : this.normalizeBootstrapCookies(input.authConfig, input.portalUrl);
    const cookieHeader = this.buildCookieHeaderForUrl(cookies, input.oaInfoUrl);
    const authHeader = this.resolvePortalAuthorizationHeader(input.authConfig, input.portalAuthState);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await fetch(input.oaInfoUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          ...(authHeader ? { Authorization: authHeader } : {}),
          Referer: input.portalUrl,
        },
        signal: controller.signal,
      });
      const rawBody = await response.text();
      const payload = this.parseJsonBody(rawBody, input.oaInfoUrl);

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} when requesting ${input.oaInfoUrl}${rawBody ? `: ${this.previewBody(rawBody)}` : ''}`,
        );
      }

      return payload;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Timed out requesting OA info from ${input.oaInfoUrl}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private capturePortalAuthState(page: any, portalUrl: string): PortalAuthProbeHandle {
    const state: {
      authorizationHeader?: string;
      accessToken?: string;
    } = {};
    const portalOrigin = this.toOrigin(portalUrl);

    const requestHandler = (request: any) => {
      try {
        const requestUrl = String(request?.url?.() || '');
        if (!requestUrl || (portalOrigin && !requestUrl.startsWith(portalOrigin))) {
          return;
        }
        const headers = request.headers?.() || {};
        const authorization = headers.authorization || headers.Authorization;
        if (typeof authorization === 'string' && authorization.trim()) {
          state.authorizationHeader = authorization.trim();
          const tokenMatch = state.authorizationHeader.match(/^Bearer\s+(.+)$/i);
          if (tokenMatch?.[1]) {
            state.accessToken = tokenMatch[1].trim();
          }
        }
      } catch {
        return;
      }
    };

    const responseHandler = async (response: any) => {
      try {
        const responseUrl = String(response?.url?.() || '');
        if (!responseUrl || !/\/oauth\/token(?:[/?#]|$)/i.test(responseUrl)) {
          return;
        }

        const payload = await response.json();
        const accessToken = this.readAccessTokenFromPayload(payload);
        if (accessToken) {
          state.accessToken = accessToken;
          if (!state.authorizationHeader) {
            state.authorizationHeader = `Bearer ${accessToken}`;
          }
        }
      } catch {
        return;
      }
    };

    page.on('request', requestHandler);
    page.on('response', responseHandler);
    return {
      state,
      dispose: () => {
        if (typeof page?.off === 'function') {
          page.off('request', requestHandler);
          page.off('response', responseHandler);
        }
      },
    };
  }

  private readAccessTokenFromPayload(payload: any) {
    const token = this.readByPath(payload, 'access_token')
      ?? this.readByPath(payload, 'data.access_token')
      ?? this.readByPath(payload, 'result.access_token');
    return typeof token === 'string' && token.trim()
      ? token.trim()
      : undefined;
  }

  private resolvePortalAuthorizationHeader(
    authConfig: Record<string, any>,
    runtimeState?: { authorizationHeader?: string; accessToken?: string },
  ) {
    const runtimeHeader = String(runtimeState?.authorizationHeader || '').trim();
    if (runtimeHeader) {
      return runtimeHeader;
    }

    const runtimeToken = String(runtimeState?.accessToken || '').trim();
    if (runtimeToken) {
      return `Bearer ${runtimeToken}`;
    }

    const platformConfig = this.asRecord(authConfig.platformConfig);
    const portalAuth = this.asRecord(platformConfig.portalAuth);
    const configuredHeader = String(
      portalAuth.authorizationHeader
      ?? authConfig.authorizationHeader
      ?? platformConfig.authorizationHeader
      ?? '',
    ).trim();
    if (configuredHeader) {
      return configuredHeader;
    }

    const configuredToken = String(
      portalAuth.accessToken
      ?? authConfig.accessToken
      ?? platformConfig.accessToken
      ?? '',
    ).trim();
    if (configuredToken) {
      return `Bearer ${configuredToken}`;
    }

    return undefined;
  }

  private resolvePortalAuthMode(state?: { authorizationHeader?: string; accessToken?: string }) {
    if (String(state?.authorizationHeader || '').trim()) {
      return 'authorization_header';
    }
    if (String(state?.accessToken || '').trim()) {
      return 'access_token';
    }
    return 'cookie_only';
  }

  private resolveOaInfoUrl(portalUrl: string, oaInfoUrl?: string) {
    const value = String(oaInfoUrl || '').trim() || '/gate/lobby/api/oa/info';
    try {
      return new URL(value).toString();
    } catch {
      return new URL(value, portalUrl).toString();
    }
  }

  private matchesOaInfoUrl(responseUrl: string, targetUrl: string) {
    try {
      const response = new URL(responseUrl);
      const target = new URL(targetUrl);
      return response.origin === target.origin
        && response.pathname === target.pathname;
    } catch {
      return responseUrl.includes(targetUrl);
    }
  }

  private async awaitWithSoftTimeout<T>(promise: Promise<T>, timeoutMs: number) {
    return new Promise<T | typeof OA_INFO_SOFT_TIMEOUT>((resolve, reject) => {
      const timer = setTimeout(() => resolve(OA_INFO_SOFT_TIMEOUT), timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private parseJsonBody(rawBody: string, url: string) {
    const text = String(rawBody || '').trim();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON response from ${url}, received: ${this.previewBody(text)}`);
    }
  }

  private previewBody(rawBody: string) {
    return rawBody
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  private formatErrorMessage(error: any) {
    return String(error?.message || error || 'unknown_error');
  }

  private resolvePortalUrl(input: UrlPortalSsoBridgeInput, bridge: RpaPortalSsoBridgeDefinition) {
    const portalUrl = String(bridge.portalUrl || input.flow?.platform?.entryUrl || '').trim();
    if (!portalUrl) {
      throw new Error('Portal SSO bridge requires portalUrl or platform.entryUrl');
    }
    return portalUrl;
  }

  private resolveSourceUrl(payload: any, sourcePath?: string) {
    const candidates = [
      sourcePath ? `data.${sourcePath}` : undefined,
      sourcePath,
      'data.coordinateUrl',
      'data.workUrl',
      'coordinateUrl',
      'workUrl',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const value = this.readByPath(payload, candidate);
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return undefined;
  }

  private resolveTargetBusinessUrl(
    input: UrlPortalSsoBridgeInput,
    bridge: RpaPortalSsoBridgeDefinition,
    sourceUrl: string,
  ) {
    const values = {
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName,
      action: input.action,
      targetSystem: input.flow?.platform?.targetSystem,
    };
    const target = String(
      bridge.targetPathTemplate
      || input.ticket.jumpUrl
      || this.inferTargetPathTemplateFromFlow(input)
      || '',
    ).replace(/\{([^}]+)\}/g, (_match, key: string) => String(values[key as keyof typeof values] ?? ''));

    if (!target.trim()) {
      throw new Error('Portal SSO bridge requires ticket.jumpUrl or portalSsoBridge.targetPathTemplate');
    }

    try {
      return new URL(target).toString();
    } catch {
      return new URL(target, sourceUrl).toString();
    }
  }

  private inferTargetPathTemplateFromFlow(input: UrlPortalSsoBridgeInput) {
    const platform = this.asRecord(input.flow?.platform);
    const runtime = this.asRecord(input.flow?.runtime);
    const portalUrl = String(
      platform.portalSsoBridge && typeof platform.portalSsoBridge === 'object'
        ? this.asRecord(platform.portalSsoBridge).portalUrl
        : platform.entryUrl,
    ).trim();
    const preferredOrigin = this.tryGetOrigin(
      platform.businessBaseUrl,
      platform.targetBaseUrl,
      platform.targetSystem,
      input.authConfig?.platformConfig && typeof input.authConfig.platformConfig === 'object'
        ? this.asRecord(input.authConfig.platformConfig).targetBaseUrl
        : undefined,
      input.authConfig?.platformConfig && typeof input.authConfig.platformConfig === 'object'
        ? this.asRecord(input.authConfig.platformConfig).businessBaseUrl
        : undefined,
    );
    const candidates = this.collectFlowNavigationUrls([
      ...this.normalizeSteps(runtime.preflight?.steps),
      ...this.normalizeSteps(this.asRecord(input.flow?.actions).submit?.steps),
      ...this.normalizeSteps(this.asRecord(input.flow?.actions).queryStatus?.steps),
    ]);

    if (candidates.length === 0) {
      return undefined;
    }

    if (preferredOrigin) {
      const preferredCandidate = [...candidates]
        .reverse()
        .find((value) => this.sameOrigin(value, preferredOrigin));
      if (preferredCandidate) {
        return preferredCandidate;
      }
    }

    const nonPortalCandidate = [...candidates]
      .reverse()
      .find((value) => !portalUrl || !this.sameOrigin(value, portalUrl));
    if (nonPortalCandidate) {
      return nonPortalCandidate;
    }

    return candidates[candidates.length - 1];
  }

  private normalizeSteps(value: unknown) {
    return Array.isArray(value)
      ? value.filter((step): step is Record<string, any> => Boolean(step && typeof step === 'object' && !Array.isArray(step)))
      : [];
  }

  private collectFlowNavigationUrls(steps: Array<Record<string, any>>) {
    return steps
      .filter((step) => String(step?.type || '').trim().toLowerCase() === 'goto')
      .map((step) => this.normalizeAbsoluteUrl(step?.value))
      .filter((value): value is string => Boolean(value));
  }

  private normalizeAbsoluteUrl(value: unknown) {
    const raw = String(value || '').trim();
    return /^https?:\/\//i.test(raw)
      ? raw
      : undefined;
  }

  private tryGetOrigin(...values: unknown[]) {
    for (const value of values) {
      const raw = this.normalizeAbsoluteUrl(value);
      if (!raw) {
        continue;
      }
      try {
        return new URL(raw).origin;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private sameOrigin(left: string, right: string) {
    try {
      return new URL(left).origin === new URL(right).origin;
    } catch {
      return left === right;
    }
  }

  private buildResolvedSsoUrl(sourceUrl: string, targetBusinessUrl: string) {
    const ssoUrl = new URL(sourceUrl);
    ssoUrl.searchParams.set('tourl', this.toRelativeTarget(targetBusinessUrl, ssoUrl));
    return ssoUrl.toString();
  }

  private toRelativeTarget(targetBusinessUrl: string, ssoUrl: URL) {
    try {
      const target = new URL(targetBusinessUrl);
      if (target.origin === ssoUrl.origin) {
        return `${target.pathname}${target.search}${target.hash}`;
      }
      return target.toString();
    } catch {
      return targetBusinessUrl;
    }
  }

  private mergeAuthConfig(base: Record<string, any>, patch: Record<string, any>) {
    return {
      ...base,
      ...patch,
      platformConfig: {
        ...this.asRecord(base.platformConfig),
        ...this.asRecord(patch.platformConfig),
      },
    };
  }

  private parseStorageState(authConfig: Record<string, any>) {
    const value = this.asRecord(authConfig.platformConfig).storageState ?? authConfig.storageState;
    if (!value) {
      return undefined;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value;
  }

  private normalizeBootstrapCookies(authConfig: Record<string, any>, fallbackOrigin?: string) {
    const platformConfig = this.asRecord(authConfig.platformConfig);
    const cookies = Array.isArray(platformConfig.cookies)
      ? platformConfig.cookies
      : Array.isArray(authConfig.cookies)
        ? authConfig.cookies
        : undefined;

    if (Array.isArray(cookies) && cookies.length > 0) {
      return cookies
        .map((cookie) => this.normalizeCookie(cookie, platformConfig.cookieOrigin || authConfig.cookieOrigin || fallbackOrigin))
        .filter(Boolean) as Array<Record<string, any>>;
    }

    const cookieHeader = String(
      authConfig.sessionCookie
      ?? authConfig.cookie
      ?? platformConfig.sessionCookie
      ?? platformConfig.cookie
      ?? '',
    ).trim();

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

        return this.normalizeCookie({
          name: segment.slice(0, separatorIndex).trim(),
          value: segment.slice(separatorIndex + 1).trim(),
          path: '/',
        }, platformConfig.cookieOrigin || authConfig.cookieOrigin || fallbackOrigin);
      })
      .filter(Boolean) as Array<Record<string, any>>;
  }

  private normalizePlaywrightCookies(cookies: any, fallbackUrl?: string) {
    if (!Array.isArray(cookies)) {
      return [];
    }

    return cookies
      .map((cookie) => this.normalizeCookie(cookie, fallbackUrl))
      .filter(Boolean) as Array<Record<string, any>>;
  }

  private normalizeCookie(cookie: any, fallbackOrigin?: string) {
    if (!cookie || typeof cookie !== 'object' || !cookie.name) {
      return undefined;
    }

    const normalized: Record<string, any> = {
      name: String(cookie.name),
      value: String(cookie.value || ''),
      path: String(cookie.path || '/'),
    };

    if (cookie.domain) {
      normalized.domain = String(cookie.domain);
    } else if (cookie.url) {
      normalized.url = String(cookie.url);
    } else if (fallbackOrigin) {
      normalized.url = this.toOrigin(fallbackOrigin) || fallbackOrigin;
    } else {
      return undefined;
    }

    if (cookie.expires !== undefined) normalized.expires = cookie.expires;
    if (cookie.httpOnly !== undefined) normalized.httpOnly = Boolean(cookie.httpOnly);
    if (cookie.secure !== undefined) normalized.secure = Boolean(cookie.secure);
    if (cookie.sameSite !== undefined) normalized.sameSite = cookie.sameSite;
    return normalized;
  }

  private buildCookieHeaderForUrl(cookies: Array<Record<string, any>>, targetUrl: string) {
    try {
      const target = new URL(targetUrl);
      const matched = cookies.filter((cookie) => this.matchesCookie(cookie, target));
      return matched.length > 0
        ? matched.map((cookie) => `${cookie.name}=${cookie.value || ''}`).join('; ')
        : undefined;
    } catch {
      return undefined;
    }
  }

  private matchesCookie(cookie: Record<string, any>, target: URL) {
    const cookiePath = String(cookie.path || '/');
    if (!target.pathname.startsWith(cookiePath)) {
      return false;
    }

    if (cookie.url) {
      try {
        const cookieUrl = new URL(String(cookie.url));
        return cookieUrl.origin === target.origin;
      } catch {
        return false;
      }
    }

    const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (!domain) {
      return false;
    }

    const host = target.hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  }

  private resolveHeadlessMode(flow?: RpaFlowDefinition) {
    const requestedHeadless = flow?.runtime?.headless !== false;
    if (requestedHeadless) {
      return true;
    }

    return !Boolean(
      (process.env.DISPLAY || '').trim()
      || (process.env.WAYLAND_DISPLAY || '').trim()
      || (process.env.MIR_SOCKET || '').trim(),
    );
  }

  private readByPath(value: any, path: string) {
    return String(path || '')
      .split('.')
      .filter(Boolean)
      .reduce((current, key) => current?.[key], value);
  }

  private toOrigin(value?: string) {
    if (!value) {
      return undefined;
    }

    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}`;
    } catch {
      return undefined;
    }
  }

  private asRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, any>;
  }
}
