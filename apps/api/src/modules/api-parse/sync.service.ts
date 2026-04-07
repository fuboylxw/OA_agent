import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ChatSessionProcessService } from '../common/chat-session-process.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { StatusMapperService } from './status-mapper.service';
import { SyncStrategy } from './types';

const MAX_SYNC_FAIL = 10;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatSessionProcessService: ChatSessionProcessService,
    private readonly adapterRuntime: AdapterRuntimeService,
    private readonly statusMapper: StatusMapperService,
  ) {}

  async pollPendingSubmissions(
    tenantId?: string,
  ): Promise<{ synced: number; failed: number }> {
    const connectors = await this.prisma.connector.findMany({
      where: {
        tenantId,
        status: 'active',
        syncStrategy: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        syncStrategy: true,
      },
    });

    let synced = 0;
    let failed = 0;

    for (const connector of connectors) {
      const strategy = connector.syncStrategy as unknown as SyncStrategy | null;
      if (!strategy || !this.shouldPoll(strategy)) {
        continue;
      }

      try {
        const result = await this.pollConnector(connector.id, connector.tenantId, strategy);
        synced += result.synced;
        failed += result.failed;
      } catch (error: any) {
        this.logger.error(`Poll failed for connector ${connector.id}: ${error.message}`);
        failed++;
      }
    }

    this.logger.log(`Poll complete: ${synced} synced, ${failed} failed`);
    return { synced, failed };
  }

  async handleWebhook(
    connectorId: string,
    payload: Record<string, any>,
  ): Promise<{ processed: boolean; submissionId?: string }> {
    const start = Date.now();

    try {
      const connector = await this.prisma.connector.findUnique({
        where: { id: connectorId },
        select: {
          id: true,
          tenantId: true,
        },
      });

      if (!connector) {
        this.logger.warn(`Webhook received for unknown connector ${connectorId}`);
        return { processed: false };
      }

      const mappingConfig = await this.statusMapper.getConfig(connectorId, connector.tenantId);
      const oaSubmissionId = this.extractSubmissionId(payload);
      if (!oaSubmissionId) {
        this.logger.warn(`Webhook for connector ${connectorId}: missing submission id`);
        return { processed: false };
      }

      const submission = await this.prisma.submission.findFirst({
        where: {
          tenantId: connector.tenantId,
          oaSubmissionId,
          template: {
            is: {
              connectorId,
            },
          },
        },
        select: {
          id: true,
          tenantId: true,
          status: true,
        },
      });

      if (!submission) {
        this.logger.warn(
          `Webhook for connector ${connectorId}: no local submission for OA id ${oaSubmissionId}`,
        );
        return { processed: false };
      }

      const localStatus = this.statusMapper.mapStatus(payload, mappingConfig);
      const statusBefore = submission.status;
      const changed = statusBefore !== localStatus;

      if (changed) {
        await this.prisma.$transaction([
          this.prisma.submission.updateMany({
            where: {
              id: submission.id,
              tenantId: connector.tenantId,
            },
            data: {
              status: localStatus,
              lastSyncedAt: new Date(),
              syncFailCount: 0,
            },
          }),
          this.prisma.submissionStatus.create({
            data: {
              submissionId: submission.id,
              status: localStatus,
              statusDetail: payload,
            },
          }),
          this.prisma.submissionEvent.create({
            data: {
              tenantId: submission.tenantId,
              submissionId: submission.id,
              eventType: localStatus,
              eventSource: 'oa_webhook',
              eventTime: new Date(),
              status: localStatus,
              payload,
            },
          }),
        ]);

        await this.chatSessionProcessService.syncSubmissionStatusToSession({
          submissionId: submission.id,
          previousSubmissionStatus: statusBefore,
          externalStatus: localStatus,
          payload,
          createStatusMessage: true,
        });
      }

      await this.writeSyncLog(
        connectorId,
        submission.id,
        'webhook',
        true,
        statusBefore,
        localStatus,
        payload,
        null,
        Date.now() - start,
      );

      return { processed: true, submissionId: submission.id };
    } catch (error: any) {
      this.logger.error(`Webhook processing failed for connector ${connectorId}: ${error.message}`);
      await this.writeSyncLog(
        connectorId,
        null,
        'webhook',
        false,
        null,
        null,
        payload,
        error.message,
        Date.now() - start,
      );
      return { processed: false };
    }
  }

  async syncOnDemand(
    submissionId: string,
    tenantId: string,
    userId?: string,
  ): Promise<{ success: boolean; newStatus?: string }> {
    const submission = await this.prisma.submission.findFirst({
      where: {
        id: submissionId,
        tenantId,
        userId,
        oaSubmissionId: { not: null },
      },
      select: {
        id: true,
        oaSubmissionId: true,
        template: {
          select: {
            connectorId: true,
          },
        },
      },
    });

    if (!submission?.oaSubmissionId || !submission.template?.connectorId) {
      return { success: false };
    }

    try {
      await this.syncOne(
        submission.template.connectorId,
        tenantId,
        submission.id,
        submission.oaSubmissionId,
      );

      const updated = await this.prisma.submission.findFirst({
        where: {
          id: submissionId,
          tenantId,
        },
        select: {
          status: true,
        },
      });

      return { success: true, newStatus: updated?.status };
    } catch {
      return { success: false };
    }
  }

  private async pollConnector(
    connectorId: string,
    tenantId: string,
    strategy: SyncStrategy,
  ): Promise<{ synced: number; failed: number }> {
    const submissions = await this.findSyncableSubmissions(connectorId, tenantId);
    if (submissions.length === 0) {
      return { synced: 0, failed: 0 };
    }

    if (
      (strategy.primary === 'batch_polling' || strategy.fallback === 'batch_polling') &&
      strategy.batchQueryToolName
    ) {
      return this.batchSync(connectorId, tenantId, submissions, strategy);
    }

    let synced = 0;
    let failed = 0;

    for (const submission of submissions) {
      if (!submission.oaSubmissionId) {
        continue;
      }

      try {
        const changed = await this.syncOne(
          connectorId,
          tenantId,
          submission.id,
          submission.oaSubmissionId,
        );
        if (changed) {
          synced++;
        }
      } catch {
        failed++;
      }
    }

    return { synced, failed };
  }

  private async syncOne(
    connectorId: string,
    tenantId: string,
    submissionId: string,
    oaSubmissionId: string,
  ): Promise<boolean> {
    const start = Date.now();
    let adapter;

    try {
      adapter = await this.adapterRuntime.createAdapterForConnector(connectorId);
      const result = await adapter.queryStatus(oaSubmissionId);

      const mappingConfig = await this.statusMapper.getConfig(connectorId, tenantId);
      const remoteRaw = result.statusDetail || { status: result.status };
      const localStatus = this.statusMapper.mapStatus(remoteRaw, mappingConfig);

      const submission = await this.prisma.submission.findFirst({
        where: {
          id: submissionId,
          tenantId,
          template: {
            is: {
              connectorId,
            },
          },
        },
        select: {
          status: true,
          tenantId: true,
        },
      });

      if (!submission) {
        throw new Error('Submission not found');
      }

      const statusBefore = submission.status || 'unknown';
      const changed = statusBefore !== localStatus;

      if (changed) {
        await this.prisma.$transaction([
          this.prisma.submission.updateMany({
            where: {
              id: submissionId,
              tenantId,
            },
            data: {
              status: localStatus,
              lastSyncedAt: new Date(),
              syncFailCount: 0,
            },
          }),
          this.prisma.submissionStatus.create({
            data: {
              submissionId,
              status: localStatus,
              statusDetail: result.statusDetail || {},
            },
          }),
          this.prisma.submissionEvent.create({
            data: {
              tenantId: submission.tenantId,
              submissionId,
              eventType: localStatus,
              eventSource: 'oa_pull',
              eventTime: new Date(),
              status: localStatus,
              payload: remoteRaw,
            },
          }),
        ]);

        await this.chatSessionProcessService.syncSubmissionStatusToSession({
          submissionId,
          previousSubmissionStatus: statusBefore,
          externalStatus: localStatus,
          payload: remoteRaw,
          createStatusMessage: true,
        });
      } else {
        await this.prisma.submission.updateMany({
          where: {
            id: submissionId,
            tenantId,
          },
          data: {
            lastSyncedAt: new Date(),
            syncFailCount: 0,
          },
        });
      }

      await this.writeSyncLog(
        connectorId,
        submissionId,
        'polling',
        true,
        statusBefore,
        localStatus,
        remoteRaw,
        null,
        Date.now() - start,
      );

      return changed;
    } catch (error: any) {
      this.logger.error(`Sync failed for submission ${submissionId}: ${error.message}`);

      await this.prisma.submission.updateMany({
        where: {
          id: submissionId,
          tenantId,
        },
        data: {
          syncFailCount: {
            increment: 1,
          },
        },
      });

      await this.writeSyncLog(
        connectorId,
        submissionId,
        'polling',
        false,
        null,
        null,
        null,
        error.message,
        Date.now() - start,
      );

      throw error;
    } finally {
      if (adapter) {
        await this.adapterRuntime.destroyAdapter(adapter);
      }
    }
  }

  private async batchSync(
    connectorId: string,
    tenantId: string,
    submissions: Array<{ id: string; oaSubmissionId: string | null }>,
    _strategy: SyncStrategy,
  ): Promise<{ synced: number; failed: number }> {
    let synced = 0;
    let failed = 0;

    for (const submission of submissions) {
      if (!submission.oaSubmissionId) {
        continue;
      }

      try {
        const changed = await this.syncOne(
          connectorId,
          tenantId,
          submission.id,
          submission.oaSubmissionId,
        );
        if (changed) {
          synced++;
        }
      } catch {
        failed++;
      }
    }

    return { synced, failed };
  }

  private async findSyncableSubmissions(connectorId: string, tenantId: string) {
    return this.prisma.submission.findMany({
      where: {
        tenantId,
        template: {
          is: {
            connectorId,
          },
        },
        status: {
          in: ['submitted', 'in_progress'],
        },
        oaSubmissionId: {
          not: null,
        },
        syncFailCount: {
          lt: MAX_SYNC_FAIL,
        },
      },
      select: {
        id: true,
        oaSubmissionId: true,
      },
      take: 100,
    });
  }

  private shouldPoll(strategy: SyncStrategy) {
    if (strategy.primary === 'single_polling' || strategy.primary === 'batch_polling') {
      return true;
    }

    return (
      strategy.primary === 'manual' &&
      (strategy.fallback === 'single_polling' || strategy.fallback === 'batch_polling')
    );
  }

  private extractSubmissionId(payload: Record<string, any>): string | null {
    return (
      payload.submissionId ||
      payload.submission_id ||
      payload.id ||
      payload.data?.id ||
      payload.data?.submissionId ||
      payload.data?.submission_id ||
      payload.processInstanceId ||
      payload.workId ||
      null
    );
  }

  private async writeSyncLog(
    connectorId: string,
    submissionId: string | null,
    syncType: string,
    success: boolean,
    statusBefore: string | null,
    statusAfter: string | null,
    remoteRaw: any,
    error: string | null,
    durationMs: number,
  ) {
    try {
      await this.prisma.syncLog.create({
        data: {
          connectorId,
          submissionId,
          syncType,
          success,
          statusBefore,
          statusAfter,
          remoteRaw,
          error,
          durationMs,
        },
      });
    } catch (writeError: any) {
      this.logger.error(`Failed to write sync log: ${writeError.message}`);
    }
  }
}
