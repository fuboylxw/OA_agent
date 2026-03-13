import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ChatSessionProcessService } from '../common/chat-session-process.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { StatusMapperService } from './status-mapper.service';
import { SyncStrategy } from './types';

const MAX_SYNC_FAIL = 10;
const DEFAULT_POLL_INTERVAL_MS = 300_000; // 5 min

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatSessionProcessService: ChatSessionProcessService,
    private readonly adapterRuntime: AdapterRuntimeService,
    private readonly statusMapper: StatusMapperService,
  ) {}

  // ── 定时轮询入口 ──────────────────────────────────────────

  /**
   * 轮询所有需要同步的 pending submissions
   * 由外部定时任务（Cron / BullMQ）调用
   */
  async pollPendingSubmissions(): Promise<{ synced: number; failed: number }> {
    // 找出所有启用了轮询策略的 connector
    const connectors = await this.prisma.connector.findMany({
      where: {
        status: 'active',
        syncStrategy: { not: null },
      },
      select: { id: true, syncStrategy: true },
    });

    let synced = 0;
    let failed = 0;

    for (const connector of connectors) {
      const strategy = connector.syncStrategy as unknown as SyncStrategy | null;
      if (!strategy) continue;
      if (strategy.primary === 'manual' && strategy.fallback !== 'single_polling' && strategy.fallback !== 'batch_polling') {
        continue;
      }

      try {
        const result = await this.pollConnector(connector.id, strategy);
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

  /**
   * 轮询单个 connector 下的待同步 submissions
   */
  private async pollConnector(
    connectorId: string,
    strategy: SyncStrategy,
  ): Promise<{ synced: number; failed: number }> {
    // 查找该 connector 关联的、需要同步的 submissions
    const submissions = await this.findSyncableSubmissions(connectorId);

    if (submissions.length === 0) return { synced: 0, failed: 0 };

    // 根据策略选择同步方式
    if (
      (strategy.primary === 'batch_polling' || strategy.fallback === 'batch_polling') &&
      strategy.batchQueryToolName
    ) {
      return this.batchSync(connectorId, submissions, strategy);
    }

    // 逐条同步
    let synced = 0;
    let failed = 0;
    for (const sub of submissions) {
      try {
        const changed = await this.syncOne(connectorId, sub.id, sub.oaSubmissionId!);
        if (changed) synced++;
      } catch {
        failed++;
      }
    }
    return { synced, failed };
  }

  // ── 单条同步 ──────────────────────────────────────────────

  /**
   * 同步单条 submission 的状态
   */
  async syncOne(
    connectorId: string,
    submissionId: string,
    oaSubmissionId: string,
  ): Promise<boolean> {
    const start = Date.now();
    let adapter;

    try {
      adapter = await this.adapterRuntime.createAdapterForConnector(connectorId);
      const result = await adapter.queryStatus(oaSubmissionId);

      const mappingConfig = await this.statusMapper.getConfig(connectorId);
      const remoteRaw = result.statusDetail || { status: result.status };
      const localStatus = this.statusMapper.mapStatus(remoteRaw, mappingConfig);

      const submission = await this.prisma.submission.findUnique({
        where: { id: submissionId },
        select: { status: true },
      });

      const statusBefore = submission?.status || 'unknown';
      const changed = statusBefore !== localStatus;

      if (changed) {
        await this.prisma.$transaction([
          this.prisma.submission.update({
            where: { id: submissionId },
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
              tenantId: submission?.status ? (await this.getSubmissionTenantId(submissionId)) : '',
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
        // 状态未变，仅更新同步时间
        await this.prisma.submission.update({
          where: { id: submissionId },
          data: { lastSyncedAt: new Date(), syncFailCount: 0 },
        });
      }

      await this.writeSyncLog(connectorId, submissionId, 'polling', true, statusBefore, localStatus, remoteRaw, null, Date.now() - start);

      return changed;
    } catch (error: any) {
      this.logger.error(`Sync failed for submission ${submissionId}: ${error.message}`);

      await this.prisma.submission.update({
        where: { id: submissionId },
        data: { syncFailCount: { increment: 1 } },
      });

      await this.writeSyncLog(connectorId, submissionId, 'polling', false, null, null, null, error.message, Date.now() - start);

      throw error;
    } finally {
      if (adapter) {
        await this.adapterRuntime.destroyAdapter(adapter);
      }
    }
  }

  // ── 批量同步 ──────────────────────────────────────────────

  private async batchSync(
    connectorId: string,
    submissions: Array<{ id: string; oaSubmissionId: string | null }>,
    strategy: SyncStrategy,
  ): Promise<{ synced: number; failed: number }> {
    // 批量同步需要通过 MCPTool 的 batch_query 端点
    // 这里退化为逐条同步，因为 GenericHttpAdapter.queryStatus 已经封装了单条查询
    // 未来可以扩展为真正的批量 API 调用
    let synced = 0;
    let failed = 0;

    for (const sub of submissions) {
      if (!sub.oaSubmissionId) continue;
      try {
        const changed = await this.syncOne(connectorId, sub.id, sub.oaSubmissionId);
        if (changed) synced++;
      } catch {
        failed++;
      }
    }

    return { synced, failed };
  }

  // ── Webhook 接收 ──────────────────────────────────────────

  /**
   * 处理从 OA 系统推送的 webhook 事件
   */
  async handleWebhook(
    connectorId: string,
    payload: Record<string, any>,
  ): Promise<{ processed: boolean; submissionId?: string }> {
    const start = Date.now();

    try {
      const mappingConfig = await this.statusMapper.getConfig(connectorId);

      // 从 payload 中提取 submission 标识
      const oaSubmissionId = this.extractSubmissionId(payload);
      if (!oaSubmissionId) {
        this.logger.warn(`Webhook for connector ${connectorId}: cannot extract submission ID from payload`);
        return { processed: false };
      }

      // 查找本地 submission
      const submission = await this.prisma.submission.findFirst({
        where: { oaSubmissionId },
        select: { id: true, tenantId: true, status: true },
      });

      if (!submission) {
        this.logger.warn(`Webhook: no local submission found for OA ID ${oaSubmissionId}`);
        return { processed: false };
      }

      const localStatus = this.statusMapper.mapStatus(payload, mappingConfig);
      const statusBefore = submission.status;
      const changed = statusBefore !== localStatus;

      if (changed) {
        await this.prisma.$transaction([
          this.prisma.submission.update({
            where: { id: submission.id },
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

      await this.writeSyncLog(connectorId, submission.id, 'webhook', true, statusBefore, localStatus, payload, null, Date.now() - start);

      return { processed: true, submissionId: submission.id };
    } catch (error: any) {
      this.logger.error(`Webhook processing failed for connector ${connectorId}: ${error.message}`);
      await this.writeSyncLog(connectorId, null, 'webhook', false, null, null, payload, error.message, Date.now() - start);
      return { processed: false };
    }
  }

  // ── 按需同步（用户手动触发） ──────────────────────────────

  /**
   * 按需同步单条 submission
   */
  async syncOnDemand(submissionId: string): Promise<{ success: boolean; newStatus?: string }> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        tenant: { select: { connectors: { select: { id: true }, take: 1 } } },
      },
    });

    if (!submission || !submission.oaSubmissionId) {
      return { success: false };
    }

    // 找到关联的 connector（通过 template → connector）
    const connectorId = await this.findConnectorForSubmission(submissionId);
    if (!connectorId) return { success: false };

    try {
      await this.syncOne(connectorId, submissionId, submission.oaSubmissionId);
      const updated = await this.prisma.submission.findUnique({
        where: { id: submissionId },
        select: { status: true },
      });
      return { success: true, newStatus: updated?.status };
    } catch {
      return { success: false };
    }
  }

  // ── 辅助方法 ──────────────────────────────────────────────

  /**
   * 查找需要同步的 submissions：
   * - 状态为 submitted / in_progress
   * - 有 oaSubmissionId
   * - syncFailCount < MAX_SYNC_FAIL
   */
  private async findSyncableSubmissions(connectorId: string) {
    // 通过 processTemplate 关联找到 connector 下的 submissions
    const templates = await this.prisma.processTemplate.findMany({
      where: { connectorId },
      select: { id: true },
    });
    const templateIds = templates.map(t => t.id);

    if (templateIds.length === 0) return [];

    return this.prisma.submission.findMany({
      where: {
        templateId: { in: templateIds },
        status: { in: ['submitted', 'in_progress'] },
        oaSubmissionId: { not: null },
        syncFailCount: { lt: MAX_SYNC_FAIL },
      },
      select: { id: true, oaSubmissionId: true },
      take: 100, // 每次最多处理 100 条
    });
  }

  /**
   * 从 webhook payload 中提取 submission ID
   */
  private extractSubmissionId(payload: Record<string, any>): string | null {
    return payload.submissionId
      || payload.submission_id
      || payload.id
      || payload.data?.id
      || payload.data?.submissionId
      || payload.data?.submission_id
      || payload.processInstanceId
      || payload.workId
      || null;
  }

  private async getSubmissionTenantId(submissionId: string): Promise<string> {
    const sub = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { tenantId: true },
    });
    return sub?.tenantId || '';
  }

  private async findConnectorForSubmission(submissionId: string): Promise<string | null> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { templateId: true },
    });
    if (!submission) return null;

    const template = await this.prisma.processTemplate.findUnique({
      where: { id: submission.templateId },
      select: { connectorId: true },
    });
    return template?.connectorId || null;
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
    } catch (e: any) {
      this.logger.error(`Failed to write sync log: ${e.message}`);
    }
  }
}
