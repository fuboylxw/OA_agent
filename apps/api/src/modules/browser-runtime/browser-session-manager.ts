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
    const session: BrowserSessionRecord = {
      sessionId,
      provider,
      requestedProvider,
      browserExecutablePath: request.runtime.browserExecutablePath,
      headless: request.runtime.headless !== false,
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
}
