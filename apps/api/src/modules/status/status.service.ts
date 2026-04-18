import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { ChatSessionProcessService } from '../common/chat-session-process.service';
import { AuditService } from '../audit/audit.service';
import {
  buildStatusEventRemoteId,
  isDeliveryPath,
  type DeliveryPath,
} from '@uniflow/shared-types';
import { DeliveryOrchestratorService } from '../delivery-runtime/delivery-orchestrator.service';
import {
  isUnsupportedStatusQueryResult,
  mapExternalStatusToSubmissionStatus,
  normalizeSubmissionStatus,
} from '../common/submission-status.util';
import { mapSubmissionStatusToChatProcessStatus } from '../common/chat-process-state';
import { buildConversationRestoreState } from '../common/chat-retention.util';

@Injectable()
export class StatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatSessionProcessService: ChatSessionProcessService,
    private readonly auditService: AuditService,
    private readonly deliveryOrchestrator: DeliveryOrchestratorService,
  ) {}

  async queryStatus(submissionId: string, tenantId: string, traceId: string, userId?: string) {
    const submission = await this.prisma.submission.findFirst({
      where: {
        id: submissionId,
        tenantId,
        ...(userId ? { userId } : {}),
      },
      include: {
        events: {
          orderBy: { eventTime: 'desc' },
          take: 20,
        },
        statusRecords: {
          orderBy: { queriedAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    // If we have an OA submission ID, query the OA system
    let oaStatus = null;
    let effectiveStatus = normalizeSubmissionStatus(submission.status, {
      submitResult: submission.submitResult,
    }) || submission.status;
    let effectiveStatusRecords = submission.statusRecords;
    let effectiveEvents = submission.events;
    if (submission.oaSubmissionId) {
      const previousStatus = submission.status;
      const template = await this.prisma.processTemplate.findUnique({
        where: { id: submission.templateId },
      });
      if (!template) {
        throw new NotFoundException('Connector not found for submission');
      }
      const submitMetadata = ((submission.submitResult as Record<string, any> | null)?.metadata || {}) as Record<string, any>;
      const selectedPath = this.toDeliveryPath(submitMetadata.deliveryPath);
      const execution = await this.deliveryOrchestrator.queryStatus({
        connectorId: template.connectorId,
        processCode: template.processCode,
        processName: template.processName || template.processCode,
        tenantId: submission.tenantId,
        userId: submission.userId,
        submissionId: submission.oaSubmissionId,
        selectedPath,
        fallbackPolicy: selectedPath ? [selectedPath] : [],
        traceId,
      });
      const result = execution.statusResult;
      oaStatus = result;
      if (isUnsupportedStatusQueryResult(result)) {
        oaStatus = null;
      } else {
        const queriedAt = new Date();
        const mappedStatus = mapExternalStatusToSubmissionStatus(result.status, submission.status);
        const statusRecord = {
          id: `status-${submission.id}-${queriedAt.getTime()}`,
          submissionId: submission.id,
          status: result.status,
          statusDetail: result as any,
          queriedAt,
        };
        const statusEvent = {
          id: `event-${submission.id}-${queriedAt.getTime()}`,
          tenantId: submission.tenantId,
          submissionId: submission.id,
          eventType: 'status_polled',
          eventSource: 'oa_pull',
          remoteEventId: buildStatusEventRemoteId(submission.oaSubmissionId, result as Record<string, any>),
          eventTime: queriedAt,
          status: result.status,
          payload: result as any,
          createdAt: queriedAt,
        };

        const eventCreated = await this.createSubmissionEvent({
          data: {
            tenantId: submission.tenantId,
            submissionId: submission.id,
            eventType: 'status_polled',
            eventSource: 'oa_pull',
            remoteEventId: statusEvent.remoteEventId,
            eventTime: queriedAt,
            status: result.status,
            payload: result as any,
          },
        });
        if (eventCreated) {
          await this.prisma.submissionStatus.create({
            data: {
              submissionId: submission.id,
              status: result.status,
              statusDetail: result as any,
            },
          });
        }
        await this.prisma.submission.update({
          where: { id: submission.id },
          data: {
            status: mappedStatus,
            ...buildConversationRestoreState(
              mapSubmissionStatusToChatProcessStatus(mappedStatus),
            ),
          },
        });

        if (eventCreated || mappedStatus !== previousStatus) {
          await this.chatSessionProcessService.syncSubmissionStatusToSession({
            submissionId: submission.id,
            previousSubmissionStatus: previousStatus,
            externalStatus: result.status,
            payload: result as Record<string, any>,
            createStatusMessage: eventCreated,
          });
        }

        effectiveStatus = mappedStatus;
        effectiveStatusRecords = eventCreated
          ? [statusRecord, ...submission.statusRecords]
          : submission.statusRecords;
        effectiveEvents = eventCreated
          ? [statusEvent, ...submission.events]
          : submission.events;
      }
    }

    await this.auditService.createLog({
      tenantId: submission.tenantId,
      traceId,
      userId: submission.userId,
      action: 'query_status',
      resource: submissionId,
      result: 'success',
      details: { oaStatus },
    });

    return {
      submissionId: submission.id,
      status: effectiveStatus,
      oaSubmissionId: submission.oaSubmissionId,
      oaStatus,
      timeline: this.buildTimeline({
        ...submission,
        status: effectiveStatus,
        statusRecords: effectiveStatusRecords,
        events: effectiveEvents,
      }),
      statusRecords: effectiveStatusRecords,
    };
  }

  async listMySubmissions(tenantId: string, userId: string) {
    const submissions = await this.prisma.submission.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return submissions.map(s => ({
      id: s.id,
      templateId: s.templateId,
      status: normalizeSubmissionStatus(s.status, {
        submitResult: s.submitResult,
      }) || s.status,
      oaSubmissionId: s.oaSubmissionId,
      createdAt: s.createdAt,
      submittedAt: s.submittedAt,
    }));
  }

  async getTimeline(submissionId: string, tenantId: string, userId?: string) {
    const submission = await this.prisma.submission.findFirst({
      where: {
        id: submissionId,
        tenantId,
        ...(userId ? { userId } : {}),
      },
      include: {
        events: {
          orderBy: { eventTime: 'asc' },
        },
        statusRecords: {
          orderBy: { queriedAt: 'asc' },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    return this.buildTimeline(submission);
  }

  private buildTimeline(submission: any) {
    const timeline: Array<{
      timestamp: Date;
      status: string;
      description: string;
    }> = [];

    // Created
    timeline.push({
      timestamp: submission.createdAt,
      status: 'created',
      description: '申请已创建',
    });

    // Submitted
    if (submission.submittedAt) {
      timeline.push({
        timestamp: submission.submittedAt,
        status: 'submitted',
        description: '已提交至OA系统',
      });
    }

    // Status records
    if (submission.statusRecords) {
      for (const record of submission.statusRecords) {
        timeline.push({
          timestamp: record.queriedAt,
          status: record.status,
          description: `状态更新: ${record.status}`,
        });
      }
    }

    if (submission.events) {
      for (const event of submission.events) {
        const description = event.eventType === 'draft_saved'
          ? '事件: 已保存到 OA 待发箱'
          : `事件: ${event.eventType}`;
        timeline.push({
          timestamp: event.eventTime,
          status: event.status,
          description,
        });
      }
    }

    // Sort by timestamp
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return timeline;
  }
  private async createSubmissionEvent(input: {
    data: Prisma.SubmissionEventUncheckedCreateInput;
  }) {
    try {
      await this.prisma.submissionEvent.create(input);
      return true;
    } catch (error) {
      if (this.isDuplicateSubmissionEventError(error)) {
        return false;
      }
      throw error;
    }
  }

  private isDuplicateSubmissionEventError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private toDeliveryPath(value: unknown): DeliveryPath | null {
    return isDeliveryPath(value)
      ? value
      : null;
  }
}
