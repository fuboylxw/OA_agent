import { Injectable } from '@nestjs/common';
import type { AgentResultPacket, DeliveryCapabilitySummary, TaskPacket } from '@uniflow/shared-types';
import { PrismaService } from '../../common/prisma.service';

export interface SessionOrchestrationContext {
  sessionId: string;
  currentConnectorId?: string | null;
  currentConnectorName?: string | null;
  currentProcessCode?: string | null;
  currentProcessName?: string | null;
  currentTemplateId?: string | null;
  currentSubmissionId?: string | null;
  currentOaSubmissionId?: string | null;
  currentFormData: Record<string, any>;
  missingFields: Array<{ key: string; label: string }>;
  selectedPath?: 'api' | 'url' | 'vision' | null;
  fallbackPolicy: Array<'api' | 'url' | 'vision'>;
  processStatus?: string | null;
  updatedAt: string;
}

export interface UserSharedContext {
  userId: string;
  tenantId: string;
  userInfo: {
    displayName: string;
    username: string;
    email: string;
  };
  favoriteProcesses: Array<{
    processCode: string;
    processName: string;
    usageCount: number;
    lastUsedAt: string;
  }>;
  recentSubmissions: Array<{
    submissionId: string;
    processCode: string;
    processName: string;
    status: string;
    submittedAt: string;
  }>;
  preferences: {
    confirmBeforeSubmit: boolean;
    autoFillFromHistory: boolean;
  };
  learnedPatterns?: Record<string, any>;
  version: number;
  updatedAt: string;
}

export interface GlobalSharedContext {
  tenantId: string;
  availableProcesses: Array<{
    templateId: string;
    processCode: string;
    processName: string;
    connectorId: string;
    connectorName: string;
    delivery?: DeliveryCapabilitySummary | null;
  }>;
  connectors: Array<{
    connectorId: string;
    connectorName: string;
    oaType: string;
    status: string;
  }>;
  cachedAt: string;
}

export interface ExecutionContextRecord {
  taskId: string;
  packet: TaskPacket;
  events: Array<{
    type: string;
    timestamp: string;
    payload?: Record<string, any>;
  }>;
  result?: AgentResultPacket;
}

@Injectable()
export class ContextManager {
  private static readonly globalCache = new Map<string, GlobalSharedContext>();
  private static readonly globalCacheExpires = new Map<string, number>();
  private static readonly userSharedStore = new Map<string, Partial<UserSharedContext>>();
  private static readonly executionStore = new Map<string, ExecutionContextRecord>();

  constructor(private readonly prisma: PrismaService) {}

  async getSessionContext(sessionId: string): Promise<SessionOrchestrationContext> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    const metadata = ((session?.metadata || {}) as Record<string, any>) || {};
    const context = ((metadata.orchestrationContext || {}) as Partial<SessionOrchestrationContext>);

    return {
      sessionId,
      currentConnectorId: context.currentConnectorId || null,
      currentConnectorName: context.currentConnectorName || null,
      currentProcessCode: context.currentProcessCode || null,
      currentProcessName: context.currentProcessName || null,
      currentTemplateId: context.currentTemplateId || null,
      currentSubmissionId: context.currentSubmissionId || null,
      currentOaSubmissionId: context.currentOaSubmissionId || null,
      currentFormData: context.currentFormData || {},
      missingFields: Array.isArray(context.missingFields) ? context.missingFields : [],
      selectedPath: context.selectedPath || null,
      fallbackPolicy: Array.isArray(context.fallbackPolicy) ? context.fallbackPolicy : [],
      processStatus: context.processStatus || null,
      updatedAt: context.updatedAt || new Date().toISOString(),
    };
  }

  async patchSessionContext(sessionId: string, patch: Partial<SessionOrchestrationContext>): Promise<SessionOrchestrationContext> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    const metadata = ((session?.metadata || {}) as Record<string, any>) || {};
    const current = await this.getSessionContext(sessionId);
    const merged: SessionOrchestrationContext = {
      ...current,
      ...patch,
      currentFormData: { ...(current.currentFormData || {}), ...(patch.currentFormData || {}) },
      missingFields: patch.missingFields ?? current.missingFields,
      fallbackPolicy: patch.fallbackPolicy ?? current.fallbackPolicy,
      updatedAt: new Date().toISOString(),
    };

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        metadata: {
          ...metadata,
          orchestrationContext: merged,
        } as any,
      },
    });

    return merged;
  }

  async clearSessionContext(sessionId: string): Promise<void> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    });
    if (!session) return;
    const metadata = ((session.metadata || {}) as Record<string, any>) || {};
    delete metadata.orchestrationContext;
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { metadata },
    });
  }

  async getUserSharedContext(userId: string, tenantId: string): Promise<UserSharedContext> {
    const [user, submissions] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, displayName: true, email: true },
      }),
      this.prisma.submission.findMany({
        where: { userId, tenantId },
        include: {
          template: {
            select: { processCode: true, processName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const usageMap = new Map<string, { processCode: string; processName: string; usageCount: number; lastUsedAt: string }>();
    for (const submission of submissions) {
      const key = submission.template?.processCode || 'unknown';
      const existing = usageMap.get(key);
      if (existing) {
        existing.usageCount += 1;
      } else {
        usageMap.set(key, {
          processCode: submission.template?.processCode || 'unknown',
          processName: submission.template?.processName || submission.template?.processCode || '未知流程',
          usageCount: 1,
          lastUsedAt: submission.createdAt.toISOString(),
        });
      }
    }

    const memoryKey = `${tenantId}:${userId}`;
    const overlay = ContextManager.userSharedStore.get(memoryKey) || {};
    return {
      userId,
      tenantId,
      userInfo: {
        displayName: user?.displayName || '',
        username: user?.username || '',
        email: user?.email || '',
      },
      favoriteProcesses: [...usageMap.values()].sort((a, b) => b.usageCount - a.usageCount),
      recentSubmissions: submissions.map((submission) => ({
        submissionId: submission.id,
        processCode: submission.template?.processCode || 'unknown',
        processName: submission.template?.processName || submission.template?.processCode || '未知流程',
        status: submission.status,
        submittedAt: (submission.submittedAt || submission.createdAt).toISOString(),
      })),
      preferences: {
        confirmBeforeSubmit: true,
        autoFillFromHistory: true,
        ...(overlay.preferences || {}),
      },
      learnedPatterns: overlay.learnedPatterns || {},
      version: typeof overlay.version === 'number' ? overlay.version : 1,
      updatedAt: new Date().toISOString(),
    };
  }

  async patchUserSharedContext(userId: string, tenantId: string, patch: Partial<UserSharedContext>): Promise<UserSharedContext> {
    const key = `${tenantId}:${userId}`;
    const current = ContextManager.userSharedStore.get(key) || {};
    const merged = {
      ...current,
      ...patch,
      preferences: {
        ...((current as UserSharedContext).preferences || {}),
        ...(patch.preferences || {}),
      },
      version: typeof current.version === 'number' ? current.version + 1 : 1,
    } as Partial<UserSharedContext>;
    ContextManager.userSharedStore.set(key, merged);
    return this.getUserSharedContext(userId, tenantId);
  }

  async getGlobalContext(tenantId: string): Promise<GlobalSharedContext> {
    const now = Date.now();
    const expiresAt = ContextManager.globalCacheExpires.get(tenantId) || 0;
    const cached = ContextManager.globalCache.get(tenantId);
    if (cached && expiresAt > now) {
      return cached;
    }

    const [templates, connectors] = await Promise.all([
      this.prisma.processTemplate.findMany({
        where: { tenantId, status: 'published' },
        include: {
          connector: {
            select: { id: true, name: true },
          },
        },
        orderBy: { processName: 'asc' },
      }),
      this.prisma.connector.findMany({
        where: { tenantId },
        select: { id: true, name: true, oaType: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const context: GlobalSharedContext = {
      tenantId,
      availableProcesses: templates.map((template) => ({
        templateId: template.id,
        processCode: template.processCode,
        processName: template.processName,
        connectorId: template.connectorId,
        connectorName: template.connector?.name || 'unknown',
        delivery: (((template.uiHints as Record<string, any> | null) || {}).delivery as DeliveryCapabilitySummary | undefined) || null,
      })),
      connectors: connectors.map((connector) => ({
        connectorId: connector.id,
        connectorName: connector.name,
        oaType: connector.oaType,
        status: connector.status,
      })),
      cachedAt: new Date().toISOString(),
    };

    ContextManager.globalCache.set(tenantId, context);
    ContextManager.globalCacheExpires.set(tenantId, now + 5 * 60 * 1000);
    return context;
  }

  async createExecutionContext(taskId: string, packet: TaskPacket): Promise<ExecutionContextRecord> {
    const record: ExecutionContextRecord = {
      taskId,
      packet,
      events: [{ type: 'created', timestamp: new Date().toISOString() }],
    };
    ContextManager.executionStore.set(taskId, record);
    return record;
  }

  getExecutionContext(taskId: string): ExecutionContextRecord | null {
    return ContextManager.executionStore.get(taskId) || null;
  }

  appendExecutionEvent(taskId: string, type: string, payload?: Record<string, any>) {
    const record = ContextManager.executionStore.get(taskId);
    if (!record) return null;
    record.events.push({ type, timestamp: new Date().toISOString(), payload });
    return record;
  }

  finalizeExecution(taskId: string, result: AgentResultPacket) {
    const record = ContextManager.executionStore.get(taskId);
    if (!record) return null;
    record.result = result;
    record.events.push({
      type: 'finalized',
      timestamp: new Date().toISOString(),
      payload: { success: result.success, agentType: result.agentType },
    });
    return record;
  }
}
