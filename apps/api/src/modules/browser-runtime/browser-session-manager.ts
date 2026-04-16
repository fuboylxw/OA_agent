import { randomUUID } from 'crypto';
import type { BrowserSessionRecord, BrowserTabRecord, BrowserTaskRequest, BrowserTaskWarning } from './browser-runtime.types';

export class BrowserSessionManager {
  private readonly sessions = new Map<string, BrowserSessionRecord>();

  createSession(
    request: BrowserTaskRequest,
    provider: string,
    requestedProvider: string,
    warnings: BrowserTaskWarning[] = [],
  ): BrowserSessionRecord {
    const sessionId = `browser-${randomUUID()}`;
    const tabId = `tab-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const initialUrl = request.ticket.jumpUrl || request.flow.platform?.entryUrl || 'about:blank';
    const tab: BrowserTabRecord = {
      tabId,
      url: initialUrl,
      title: request.flow.processName,
      action: request.action,
      flow: request.flow,
      payload: request.payload,
      ticket: request.ticket,
      history: [initialUrl],
      formValues: {},
      uploads: [],
      extractedValues: {},
      artifacts: {},
      pageVersion: 1,
      lastInteractionAt: now,
    };
    const authBootstrap = this.extractAuthBootstrap(request.payload?.auth, initialUrl);
    const headlessMode = this.resolveHeadlessMode(request, warnings);
    const session: BrowserSessionRecord = {
      sessionId,
      provider,
      requestedProvider,
      browserExecutablePath: request.runtime.browserExecutablePath,
      storageState: authBootstrap.storageState,
      cookies: authBootstrap.cookies,
      cookieHeader: authBootstrap.cookieHeader,
      cookieOrigin: authBootstrap.cookieOrigin,
      headless: headlessMode,
      createdAt: now,
      activeTabId: tabId,
      tabs: new Map([[tabId, tab]]),
      warnings: [...warnings],
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser session ${sessionId} not found`);
    }
    return session;
  }

  getActiveTab(session: BrowserSessionRecord) {
    const tab = session.tabs.get(session.activeTabId);
    if (!tab) {
      throw new Error(`Active tab ${session.activeTabId} not found`);
    }
    return tab;
  }

  updateTab(session: BrowserSessionRecord, updater: (tab: BrowserTabRecord) => void) {
    const tab = this.getActiveTab(session);
    updater(tab);
    tab.lastInteractionAt = new Date().toISOString();
  }

  appendWarning(session: BrowserSessionRecord, warning: BrowserTaskWarning) {
    session.warnings.push(warning);
  }

  private extractAuthBootstrap(authConfig: unknown, initialUrl: string) {
    const authRecord = this.asRecord(authConfig);
    const platformConfig = this.asRecord(authRecord.platformConfig);
    const storageState = platformConfig.storageState ?? authRecord.storageState;
    const cookies = this.normalizeCookies(platformConfig.cookies ?? authRecord.cookies);
    const cookieHeader = this.normalizeCookieHeader(
      authRecord.sessionCookie
      ?? authRecord.cookie
      ?? platformConfig.sessionCookie
      ?? platformConfig.cookie,
    );
    const cookieOrigin = this.normalizeCookieOrigin(
      platformConfig.cookieOrigin
      ?? authRecord.cookieOrigin
      ?? initialUrl,
    );

    return {
      storageState,
      cookies,
      cookieHeader,
      cookieOrigin,
    };
  }

  private normalizeCookies(value: unknown) {
    return Array.isArray(value)
      ? value.filter((cookie) => cookie && typeof cookie === 'object') as Array<Record<string, any>>
      : undefined;
  }

  private normalizeCookieHeader(value: unknown) {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : undefined;
  }

  private normalizeCookieOrigin(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
      return undefined;
    }

    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}`;
    } catch {
      return undefined;
    }
  }

  private asRecord(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, any>;
  }

  private resolveHeadlessMode(
    request: BrowserTaskRequest,
    warnings: BrowserTaskWarning[],
  ) {
    const requestedHeadless = request.runtime.headless !== false;
    if (requestedHeadless) {
      return true;
    }

    const forceHeadless = process.env.BROWSER_RUNTIME_FORCE_HEADLESS === 'true';
    const hasDisplayServer = Boolean(
      (process.env.DISPLAY || '').trim()
      || (process.env.WAYLAND_DISPLAY || '').trim()
      || (process.env.MIR_SOCKET || '').trim(),
    );

    if (!forceHeadless && hasDisplayServer) {
      return false;
    }

    warnings.push({
      code: forceHeadless
        ? 'browser_runtime_force_headless'
        : 'browser_runtime_missing_display',
      message: forceHeadless
        ? 'BROWSER_RUNTIME_FORCE_HEADLESS=true, running Playwright in headless mode.'
        : 'No display server detected, running Playwright in headless mode.',
    });

    return true;
  }
}
