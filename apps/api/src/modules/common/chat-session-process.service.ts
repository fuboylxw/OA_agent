import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  ChatProcessStatus,
  ReworkHint,
  mapSubmissionStatusToChatProcessStatus,
} from './chat-process-state';
import { normalizeSubmissionStatus } from './submission-status.util';

@Injectable()
export class ChatSessionProcessService {
  constructor(private readonly prisma: PrismaService) {}

  async syncSubmissionStatusToSession(input: {
    submissionId: string;
    previousSubmissionStatus?: string;
    externalStatus?: string | null;
    payload?: Record<string, any> | null;
    createStatusMessage?: boolean;
  }) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: input.submissionId },
    });
    if (!submission) {
      return;
    }

    const sessionId = await this.resolveSessionId(submission.draftId);
    if (!sessionId) {
      return;
    }

    const [session, template] = await Promise.all([
      this.prisma.chatSession.findUnique({ where: { id: sessionId } }),
      this.prisma.processTemplate.findUnique({ where: { id: submission.templateId } }),
    ]);
    if (!session) {
      return;
    }

    const metadata = ((session.metadata || {}) as Record<string, any>) || {};
    const reason = this.extractStatusReason(input.payload);
    const reworkHint = this.deriveReworkHint(reason, input.payload);
    const effectiveSubmissionStatus = normalizeSubmissionStatus(submission.status, {
      submitResult: submission.submitResult,
    }) || submission.status;
    const nextProcessStatus = mapSubmissionStatusToChatProcessStatus(effectiveSubmissionStatus);
    const nextMetadata = {
      ...metadata,
      processId: metadata.processId || submission.draftId || session.id,
      processType: metadata.processType || 'submission',
      currentTemplateId: template?.id || metadata.currentTemplateId || submission.templateId,
      currentProcessCode: template?.processCode || metadata.currentProcessCode || null,
      currentProcessName: template?.processName || metadata.currentProcessName || null,
      currentProcessCategory: template?.processCategory || metadata.currentProcessCategory || null,
      currentFormData: (submission.formData as Record<string, any>) || metadata.currentFormData || {},
      currentSubmissionId: submission.id,
      currentOaSubmissionId: submission.oaSubmissionId || null,
      lastSubmissionStatus: effectiveSubmissionStatus,
      processStatus: nextProcessStatus,
      processUpdatedAt: new Date().toISOString(),
      missingFields: [],
      reworkHint: nextProcessStatus === ChatProcessStatus.REWORK_REQUIRED ? reworkHint : null,
      reworkReason: nextProcessStatus === ChatProcessStatus.REWORK_REQUIRED ? reason : null,
    } as Record<string, any>;

    delete nextMetadata.pendingDraftId;

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: { metadata: nextMetadata },
    });

    const shouldCreateStatusMessage = Boolean(
      input.createStatusMessage
      && nextProcessStatus !== ChatProcessStatus.SUBMITTED
      && (
        input.previousSubmissionStatus !== submission.status
        || metadata.processStatus !== nextProcessStatus
        || (nextProcessStatus === ChatProcessStatus.REWORK_REQUIRED && reason && metadata.reworkReason !== reason)
      ),
    );

    if (!shouldCreateStatusMessage) {
      return;
    }

    await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: this.buildStatusMessage({
          processStatus: nextProcessStatus,
          processName: template?.processName || metadata.currentProcessName || '当前申请',
          oaSubmissionId: submission.oaSubmissionId || undefined,
          reason,
          reworkHint,
        }),
        metadata: {
          messageKind: 'text',
          processStatus: nextProcessStatus,
          submissionId: submission.id,
          oaSubmissionId: submission.oaSubmissionId,
          reworkHint,
          reworkReason: reason,
          externalStatus: input.externalStatus || null,
          statusSyncPayload: input.payload || null,
        },
      },
    });
  }

  private async resolveSessionId(draftId?: string | null) {
    if (!draftId) {
      return null;
    }

    const draft = await this.prisma.processDraft.findUnique({
      where: { id: draftId },
      select: { sessionId: true },
    });

    return draft?.sessionId || null;
  }

  private buildStatusMessage(input: {
    processStatus: ChatProcessStatus;
    processName: string;
    oaSubmissionId?: string;
    reason?: string | null;
    reworkHint: ReworkHint;
  }) {
    const submissionLine = input.oaSubmissionId ? `\n申请编号：${input.oaSubmissionId}` : '';

    switch (input.processStatus) {
      case ChatProcessStatus.DRAFT_SAVED:
        return `${input.processName}已保存到 OA 待发箱，尚未正式送审。${submissionLine}`;
      case ChatProcessStatus.COMPLETED:
        return `${input.processName}已在 OA 系统审批通过，当前申请已完成。${submissionLine}`;
      case ChatProcessStatus.CANCELLED:
        return `${input.processName}已在 OA 系统中取消或撤回。${submissionLine}`;
      case ChatProcessStatus.REWORK_REQUIRED:
        if (input.reworkHint === 'supplement') {
          return `${input.processName}已被退回，请补充材料后在当前会话继续办理。${submissionLine}${input.reason ? `\n驳回原因：${input.reason}` : ''}`;
        }
        if (input.reworkHint === 'modify') {
          return `${input.processName}已被退回，请修改申请内容后在当前会话重新提交。${submissionLine}${input.reason ? `\n驳回原因：${input.reason}` : ''}`;
        }
        return `${input.processName}已被驳回，请根据驳回原因在当前会话继续处理。${submissionLine}${input.reason ? `\n驳回原因：${input.reason}` : ''}`;
      case ChatProcessStatus.FAILED:
        return `${input.processName}处理失败，请稍后重试。${submissionLine}`;
      default:
        return `${input.processName}状态已更新。${submissionLine}`;
    }
  }

  private deriveReworkHint(
    reason?: string | null,
    payload?: Record<string, any> | null,
  ): ReworkHint {
    return this.extractExplicitReworkHint(payload, reason);
  }

  private extractExplicitReworkHint(
    payload?: Record<string, any> | null,
    reason?: string | null,
  ): ReworkHint {
    const explicitKeys = [
      'reworkHint',
      'reworkType',
      'action',
      'actionType',
      'requiredAction',
      'nextAction',
    ];

    for (const key of explicitKeys) {
      const value = payload?.[key];
      const normalized = this.normalizeExplicitReworkHint(value);
      if (normalized !== 'unknown') {
        return normalized;
      }
    }

    if (payload?.requiresSupplement === true || payload?.needSupplement === true) {
      return 'supplement';
    }

    if (payload?.requiresModify === true || payload?.needModify === true) {
      return 'modify';
    }

    return 'unknown';
  }

  private normalizeExplicitReworkHint(value: unknown): ReworkHint {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return 'unknown';
    }

    if (['supplement', 'supplement_material', '补件', '补充', '补充材料', '补交'].includes(normalized)) {
      return 'supplement';
    }

    if (['modify', 'modification', '修改', '更正', '调整', '重填', '重新填写'].includes(normalized)) {
      return 'modify';
    }

    return 'unknown';
  }

  private extractStatusReason(payload?: Record<string, any> | null) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const candidateKeys = [
      'reason',
      'message',
      'remark',
      'comment',
      'memo',
      'description',
      'desc',
      'opinion',
      'advice',
      'errorMessage',
      'rejectReason',
      'approvalComment',
    ];

    const queue: unknown[] = [payload];
    const visited = new Set<object>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      if (typeof current !== 'object') {
        continue;
      }

      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const record = current as Record<string, any>;

      for (const key of candidateKeys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
          if (key === 'rejectReason') {
            return value.trim();
          }
          if ((key === 'approvalComment' || key === 'comment' || key === 'opinion') && record.reworkHint) {
            return value.trim();
          }
        }
      }

      for (const value of Object.values(record)) {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return null;
  }

  private collectStrings(payload?: Record<string, any> | null) {
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const values: string[] = [];
    const queue: unknown[] = [payload];

    while (queue.length > 0) {
      const current = queue.shift();
      if (typeof current === 'string') {
        values.push(current);
        continue;
      }
      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }
      if (current && typeof current === 'object') {
        queue.push(...Object.values(current as Record<string, unknown>));
      }
    }

    return values;
  }
}
