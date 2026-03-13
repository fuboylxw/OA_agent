import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { ChatSessionProcessService } from '../common/chat-session-process.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { buildStatusEventRemoteId } from '@uniflow/shared-types';
import {
  ACTIVE_SUBMISSION_STATUSES,
  mapExternalStatusToSubmissionStatus,
} from '../common/submission-status.util';

@Injectable()
export class StatusSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatSessionProcessService: ChatSessionProcessService,
    private readonly adapterRuntimeService: AdapterRuntimeService,
  ) {}

  async run(syncJob: {
    id: string;
    tenantId: string;
    connectorId: string;
  }) {
    const templateIds = await this.prisma.processTemplate.findMany({
      where: {
        tenantId: syncJob.tenantId,
        connectorId: syncJob.connectorId,
      },
      select: { id: true },
    });

    const submissions = await this.prisma.submission.findMany({
      where: {
        tenantId: syncJob.tenantId,
        templateId: { in: templateIds.map((item) => item.id) },
        status: { in: [...ACTIVE_SUBMISSION_STATUSES] },
      },
      select: {
        id: true,
        status: true,
        oaSubmissionId: true,
        templateId: true,
        updatedAt: true,
      },
      take: 200,
      orderBy: { updatedAt: 'desc' },
    });

    const adapter = await this.adapterRuntimeService.createAdapterForConnector(syncJob.connectorId, []);
    let syncedStatuses = 0;
    let failedStatuses = 0;
    let deduplicatedStatuses = 0;

    for (const submission of submissions) {
      if (!submission.oaSubmissionId) {
        continue;
      }

      try {
        const previousStatus = submission.status;
        const result = await adapter.queryStatus(submission.oaSubmissionId);
        const mappedStatus = mapExternalStatusToSubmissionStatus(result.status, previousStatus);
        const remoteEventId = buildStatusEventRemoteId(submission.oaSubmissionId, result as Record<string, any>);

        const eventCreated = await this.createSubmissionEvent({
          data: {
            tenantId: syncJob.tenantId,
            submissionId: submission.id,
            eventType: 'status_synced',
            eventSource: 'oa_pull',
            remoteEventId,
            eventTime: new Date(),
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
          syncedStatuses += 1;
        } else {
          deduplicatedStatuses += 1;
        }

        await this.prisma.submission.update({
          where: { id: submission.id },
          data: {
            status: mappedStatus,
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
      } catch {
        failedStatuses += 1;
      }
    }

    return {
      syncJobId: syncJob.id,
      syncDomain: 'status',
      candidateSubmissions: submissions.length,
      oaTrackedSubmissions: submissions.filter((item) => !!item.oaSubmissionId).length,
      syncedStatuses,
      failedStatuses,
      deduplicatedStatuses,
      cursorValue: new Date().toISOString(),
      lastVersion: submissions[0]?.updatedAt.toISOString() || null,
      cursorMetadata: {
        candidateSubmissions: submissions.length,
        syncedStatuses,
        failedStatuses,
        deduplicatedStatuses,
      },
    };
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
}
