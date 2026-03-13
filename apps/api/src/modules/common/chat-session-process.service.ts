import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  ChatProcessStatus,
  ReworkHint,
  mapSubmissionStatusToChatProcessStatus,
} from './chat-process-state';

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
    const nextProcessStatus = mapSubmissionStatusToChatProcessStatus(submission.status);
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
      lastSubmissionStatus: submission.status,
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
    const text = `${reason || ''} ${this.collectStrings(payload).join(' ')}`.toLowerCase();
    if (!text.trim()) {
      return 'unknown';
    }

    const supplementKeywords = [
      '附件',
      '材料',
      '发票',
      '票据',
      '凭证',
      '证明',
      '上传',
      '补充',
      '补交',
      '材料不全',
      '附件缺失',
      'receipt',
      'invoice',
      'attachment',
      'document',
      'proof',
      'material',
      'upload',
      'supplement',
    ];
    const modifyKeywords = [
      '修改',
      '更正',
      '调整',
      '重填',
      '重新填写',
      '内容',
      '信息',
      '金额',
      '日期',
      '事由',
      '错误',
      '不一致',
      '不规范',
      '有误',
      'modify',
      'update',
      'revise',
      'correct',
      'amount',
      'date',
      'content',
      'field',
      'invalid',
    ];

    const supplementScore = supplementKeywords.filter((keyword) => text.includes(keyword)).length;
    const modifyScore = modifyKeywords.filter((keyword) => text.includes(keyword)).length;

    if (supplementScore === 0 && modifyScore === 0) {
      return 'unknown';
    }

    return supplementScore >= modifyScore ? 'supplement' : 'modify';
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
    const candidates: Array<{ value: string; score: number }> = [];

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
      const contextText = [
        record.status,
        record.currentStepStatus,
        record.eventType,
        record.action,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
        .toLowerCase();
      const rejectedContext = /reject|refuse|deny|驳回|拒绝/.test(contextText);

      for (const key of candidateKeys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
          const normalizedValue = value.trim();
          let score = 1;

          if (key === 'rejectReason') {
            score += 8;
          } else if (key === 'comment' || key === 'approvalComment' || key === 'opinion') {
            score += 3;
          }

          if (rejectedContext) {
            score += 10;
          }

          if (/补充|补交|修改|更正|重新提交|附件|材料|证明|驳回|拒绝|reject|supplement|modify/i.test(normalizedValue)) {
            score += 4;
          }

          if (/^(提交申请|审批通过|审批已通过|状态已更新)$/i.test(normalizedValue)) {
            score -= 6;
          }

          candidates.push({ value: normalizedValue, score });
        }
      }

      for (const value of Object.values(record)) {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.value || null;
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
