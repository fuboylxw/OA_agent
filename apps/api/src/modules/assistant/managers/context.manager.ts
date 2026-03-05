/**
 * 上下文管理器
 * 实现会话、流程、共享上下文的统一管理
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import {
  SessionContext,
  ProcessContext,
  SharedContext,
  ProcessStatus,
  ConversationMessage,
} from '../types/context.types';

@Injectable()
export class ContextManager {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取会话上下文
   */
  async getSession(sessionId: string): Promise<SessionContext | null> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50, // 最近50条消息
        },
      },
    });

    if (!session) {
      return null;
    }

    return {
      sessionId: session.id,
      userId: session.userId,
      tenantId: session.tenantId,
      conversationHistory: session.messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: m.createdAt,
        metadata: m.metadata as Record<string, any>,
      })),
      currentProcess: this.extractProcessContext(session.metadata as any),
      createdAt: session.createdAt,
    };
  }

  /**
   * 创建会话上下文
   */
  async createSession(userId: string, tenantId: string): Promise<SessionContext> {
    const session = await this.prisma.chatSession.create({
      data: {
        userId,
        tenantId,
        status: 'active',
        metadata: {},
      },
    });

    return {
      sessionId: session.id,
      userId: session.userId,
      tenantId: session.tenantId,
      conversationHistory: [],
      createdAt: session.createdAt,
    };
  }

  /**
   * 更新会话上下文
   */
  async updateSession(
    sessionId: string,
    updates: Partial<SessionContext>,
  ): Promise<void> {
    const updateData: any = {};

    if (updates.currentProcess) {
      updateData.metadata = this.serializeProcessContext(updates.currentProcess);
    }

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: updateData,
    });
  }

  /**
   * 删除会话上下文
   */
  async deleteSession(sessionId: string): Promise<void> {
    // 删除消息
    await this.prisma.chatMessage.deleteMany({
      where: { sessionId },
    });

    // 删除会话
    await this.prisma.chatSession.delete({
      where: { id: sessionId },
    });
  }

  /**
   * 获取流程上下文
   */
  async getProcessContext(sessionId: string): Promise<ProcessContext | null> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || !session.metadata) {
      return null;
    }

    return this.extractProcessContext(session.metadata as any);
  }

  /**
   * 创建流程上下文
   */
  async createProcessContext(
    sessionId: string,
    processCode: string,
    processType: string = 'submission',
  ): Promise<ProcessContext> {
    const processId = `process_${Date.now()}`;
    const now = new Date();

    const processContext: ProcessContext = {
      processId,
      processType,
      processCode,
      status: ProcessStatus.INITIALIZED,
      parameters: {},
      collectedParams: new Set(),
      validationErrors: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        metadata: this.serializeProcessContext(processContext),
      },
    });

    return processContext;
  }

  /**
   * 更新流程上下文
   */
  async updateProcessContext(
    sessionId: string,
    updates: Partial<ProcessContext>,
  ): Promise<void> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const currentContext = this.extractProcessContext(session.metadata as any);
    if (!currentContext) {
      throw new Error(`No process context found for session: ${sessionId}`);
    }

    const updatedContext: ProcessContext = {
      ...currentContext,
      ...updates,
      updatedAt: new Date(),
    };

    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        metadata: this.serializeProcessContext(updatedContext),
      },
    });
  }

  /**
   * 清除流程上下文
   */
  async clearProcessContext(sessionId: string): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        metadata: {},
      },
    });
  }

  /**
   * 获取共享上下文
   */
  async getSharedContext(userId: string, tenantId: string): Promise<SharedContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // 获取用户最近的提交记录
    const recentSubmissions = await this.prisma.submission.findMany({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { template: true },
    });

    // 统计常用流程类型
    const frequentTypes = this.calculateFrequentTypes(recentSubmissions);

    // 获取用户元数据
    const metadata = (user.metadata as any) || {};

    return {
      userId,
      profile: {
        employeeId: user.id,
        name: user.name || 'User',
        department: metadata.department,
        position: metadata.position,
        email: metadata.email,
        phone: metadata.phone,
      },
      preferences: {
        defaultApprover: metadata.defaultApprover,
        defaultCC: metadata.defaultCC || [],
        language: metadata.language || 'zh-CN',
        notificationSettings: metadata.notificationSettings || {
          email: true,
          sms: false,
          inApp: true,
        },
      },
      history: {
        recentRequests: recentSubmissions.map(s => ({
          id: s.id,
          processCode: s.template.processCode,
          processName: s.template.processName,
          status: s.status,
          createdAt: s.createdAt,
          completedAt: s.submittedAt,
        })),
        frequentTypes,
        totalSubmissions: recentSubmissions.length,
        lastActivityAt: recentSubmissions[0]?.createdAt,
      },
    };
  }

  /**
   * 更新共享上下文
   */
  async updateSharedContext(
    userId: string,
    updates: Partial<SharedContext>,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const currentMetadata = (user.metadata as any) || {};
    const updatedMetadata = { ...currentMetadata };

    if (updates.profile) {
      Object.assign(updatedMetadata, {
        department: updates.profile.department,
        position: updates.profile.position,
        email: updates.profile.email,
        phone: updates.profile.phone,
      });
    }

    if (updates.preferences) {
      Object.assign(updatedMetadata, {
        defaultApprover: updates.preferences.defaultApprover,
        defaultCC: updates.preferences.defaultCC,
        language: updates.preferences.language,
        notificationSettings: updates.preferences.notificationSettings,
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        metadata: updatedMetadata,
      },
    });
  }

  /**
   * 添加会话消息
   */
  async addMessage(
    sessionId: string,
    message: ConversationMessage,
  ): Promise<void> {
    await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: message.role,
        content: message.content,
        metadata: message.metadata,
      },
    });
  }

  /**
   * 获取会话消息历史
   */
  async getMessageHistory(
    sessionId: string,
    limit: number = 50,
  ): Promise<ConversationMessage[]> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      timestamp: m.createdAt,
      metadata: m.metadata as Record<string, any>,
    }));
  }

  /**
   * 清理过期会话
   */
  async cleanupExpiredSessions(expirationDays: number = 30): Promise<number> {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - expirationDays);

    // 查找过期会话
    const expiredSessions = await this.prisma.chatSession.findMany({
      where: {
        updatedAt: {
          lt: expirationDate,
        },
        status: 'active',
      },
      select: { id: true },
    });

    // 删除过期会话
    for (const session of expiredSessions) {
      await this.deleteSession(session.id);
    }

    console.log(`[ContextManager] Cleaned up ${expiredSessions.length} expired sessions`);
    return expiredSessions.length;
  }

  /**
   * 提取流程上下文
   */
  private extractProcessContext(metadata: any): ProcessContext | null {
    if (!metadata || !metadata.currentProcessCode) {
      return null;
    }

    return {
      processId: metadata.processId || `process_${Date.now()}`,
      processType: metadata.processType || 'submission',
      processCode: metadata.currentProcessCode,
      status: metadata.processStatus || ProcessStatus.INITIALIZED,
      parameters: metadata.currentFormData || {},
      collectedParams: new Set(Object.keys(metadata.currentFormData || {})),
      validationErrors: metadata.validationErrors || [],
      createdAt: new Date(metadata.processCreatedAt || Date.now()),
      updatedAt: new Date(metadata.processUpdatedAt || Date.now()),
    };
  }

  /**
   * 序列化流程上下文
   */
  private serializeProcessContext(context: ProcessContext): any {
    return {
      processId: context.processId,
      processType: context.processType,
      currentProcessCode: context.processCode,
      processStatus: context.status,
      currentFormData: context.parameters,
      validationErrors: context.validationErrors,
      processCreatedAt: context.createdAt.toISOString(),
      processUpdatedAt: context.updatedAt.toISOString(),
    };
  }

  /**
   * 计算常用流程类型
   */
  private calculateFrequentTypes(submissions: any[]): string[] {
    const typeCounts = submissions.reduce((acc, s) => {
      const code = s.template.processCode;
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(typeCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([code]) => code);
  }

  /**
   * 获取会话统计信息
   */
  async getSessionStats(userId: string, tenantId: string): Promise<{
    totalSessions: number;
    activeSessions: number;
    totalMessages: number;
    averageMessagesPerSession: number;
  }> {
    const sessions = await this.prisma.chatSession.findMany({
      where: { userId, tenantId },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    const totalSessions = sessions.length;
    const activeSessions = sessions.filter(s => s.status === 'active').length;
    const totalMessages = sessions.reduce((sum, s) => sum + s._count.messages, 0);
    const averageMessagesPerSession = totalSessions > 0 ? totalMessages / totalSessions : 0;

    return {
      totalSessions,
      activeSessions,
      totalMessages,
      averageMessagesPerSession,
    };
  }
}
