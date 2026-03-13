import { InjectQueue } from '@nestjs/bull';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../services/prisma.service';
import {
  BOOTSTRAP_ACTIVE_STATUSES,
  BOOTSTRAP_JOB_AUTO_RECOVERY_LIMIT,
  BOOTSTRAP_JOB_AUTO_RECONCILE_LIMIT,
  BOOTSTRAP_JOB_STALL_THRESHOLD_MS,
  BOOTSTRAP_JOB_WATCHDOG_INTERVAL_MS,
  BOOTSTRAP_PROCESSING_STATUSES,
  BOOTSTRAP_QUEUE_PENDING_STATUSES,
} from '@uniflow/shared-types';

type QueueRuntime = {
  state: string | null;
};

type RuntimeBootstrapJob = {
  id: string;
  name: string | null;
  status: string;
  currentStage: string | null;
  queueJobId: string | null;
  stageStartedAt: Date | null;
  lastHeartbeatAt: Date | null;
  updatedAt: Date;
  recoveryAttemptCount: number;
  reconcileAttemptCount: number;
};

@Injectable()
export class BootstrapWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BootstrapWatchdogService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject('PrismaService') private readonly prisma: PrismaService,
    @InjectQueue('bootstrap') private readonly bootstrapQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.scanForStalledJobs();
    this.timer = setInterval(() => {
      void this.scanForStalledJobs();
    }, BOOTSTRAP_JOB_WATCHDOG_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async scanForStalledJobs() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.bootstrapQueue.isReady();

      const jobs = await this.prisma.bootstrapJob.findMany({
        where: {
          status: {
            in: [...BOOTSTRAP_ACTIVE_STATUSES],
          },
        },
        select: {
          id: true,
          name: true,
          status: true,
          currentStage: true,
          queueJobId: true,
          stageStartedAt: true,
          lastHeartbeatAt: true,
          updatedAt: true,
          recoveryAttemptCount: true,
          reconcileAttemptCount: true,
        },
      });

      for (const job of jobs) {
        await this.inspectJob(job);
      }
    } catch (error: any) {
      this.logger.error(`Bootstrap watchdog scan failed: ${error.message}`);
    } finally {
      this.running = false;
    }
  }

  private async inspectJob(job: RuntimeBootstrapJob) {
    const queueRuntime = await this.resolveQueueRuntime(job.queueJobId);
    if (!this.isStalled(job, queueRuntime.state)) {
      return;
    }

    const stalledStage = job.currentStage || job.status;
    const reason = this.buildStalledReason(job, queueRuntime.state);

    if (
      stalledStage === 'COMPILING' &&
      job.reconcileAttemptCount < BOOTSTRAP_JOB_AUTO_RECONCILE_LIMIT
    ) {
      await this.requeueJob(job, 'AUTO_RECONCILING', reason, {
        reconcileAttemptCount: { increment: 1 },
      });
      return;
    }

    if (job.recoveryAttemptCount < BOOTSTRAP_JOB_AUTO_RECOVERY_LIMIT) {
      await this.requeueJob(job, 'AUTO_RECOVERING', reason, {
        recoveryAttemptCount: { increment: 1 },
      });
      return;
    }

    await this.moveToManualReview(job, reason);
  }

  private isStalled(job: RuntimeBootstrapJob, queueState: string | null): boolean {
    const referenceTime = (
      job.lastHeartbeatAt ||
      job.stageStartedAt ||
      job.updatedAt
    ).getTime();
    const ageMs = Date.now() - referenceTime;
    if (ageMs < BOOTSTRAP_JOB_STALL_THRESHOLD_MS) {
      return false;
    }

    if (
      BOOTSTRAP_QUEUE_PENDING_STATUSES.includes(job.status as any) &&
      queueState &&
      ['waiting', 'delayed', 'paused'].includes(queueState)
    ) {
      return false;
    }

    if (
      BOOTSTRAP_PROCESSING_STATUSES.includes((job.currentStage || job.status) as any) &&
      queueState === 'active'
    ) {
      return true;
    }

    return true;
  }

  private async resolveQueueRuntime(queueJobId: string | null): Promise<QueueRuntime> {
    if (!queueJobId) {
      return { state: null };
    }

    try {
      const queueJob = await this.bootstrapQueue.getJob(queueJobId);
      if (!queueJob) {
        return { state: null };
      }

      return {
        state: await queueJob.getState(),
      };
    } catch (error: any) {
      this.logger.warn(`Failed to inspect queue job ${queueJobId}: ${error.message}`);
      return { state: null };
    }
  }

  private buildStalledReason(job: RuntimeBootstrapJob, queueState: string | null) {
    const reference = job.lastHeartbeatAt || job.stageStartedAt || job.updatedAt;
    const ageMs = Date.now() - reference.getTime();
    const stage = job.currentStage || job.status;

    return [
      `任务在 ${stage} 阶段超过 ${BOOTSTRAP_JOB_STALL_THRESHOLD_MS / 1000} 秒未更新心跳`,
      `当前状态=${job.status}`,
      `队列状态=${queueState || 'missing'}`,
      `心跳年龄=${ageMs}ms`,
    ].join('；');
  }

  private async requeueJob(
    job: RuntimeBootstrapJob,
    recoveryStatus: 'AUTO_RECOVERING' | 'AUTO_RECONCILING',
    reason: string,
    counterUpdate: Pick<Prisma.BootstrapJobUpdateInput, 'recoveryAttemptCount' | 'reconcileAttemptCount'>,
  ) {
    const queueJobId = randomUUID();
    const now = new Date();

    await this.prisma.bootstrapJob.update({
      where: { id: job.id },
      data: {
        status: recoveryStatus,
        currentStage: recoveryStatus,
        queueJobId,
        stageStartedAt: now,
        lastHeartbeatAt: now,
        completedAt: null,
        stalledReason: reason,
        lastError: reason,
        ...counterUpdate,
      },
    });

    try {
      await this.bootstrapQueue.add(
        'process',
        {
          jobId: job.id,
          queueJobId,
          recoveryTrigger: recoveryStatus,
        },
        {
          jobId: queueJobId,
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      );
      await this.appendRecoveryEvidence(job.id, recoveryStatus, reason);
      this.logger.warn(
        `${recoveryStatus} triggered for bootstrap job ${job.id} (${job.name || 'unnamed'})`,
      );
    } catch (error: any) {
      const message = `${reason}；自动补救重新入队失败: ${error.message}`;
      await this.prisma.bootstrapJob.update({
        where: { id: job.id },
        data: {
          stalledReason: message,
          lastError: message,
          lastHeartbeatAt: new Date(),
        },
      }).catch(() => {});
      this.logger.error(`Failed to requeue stalled bootstrap job ${job.id}: ${error.message}`);
    }
  }

  private async moveToManualReview(job: RuntimeBootstrapJob, reason: string) {
    const stage = job.currentStage || job.status;
    const message = `${reason}；自动恢复次数已用尽，请人工重新处理后再验证。`;

    await this.prisma.bootstrapJob.update({
      where: { id: job.id },
      data: {
        status: 'MANUAL_REVIEW',
        currentStage: stage,
        lastHeartbeatAt: new Date(),
        completedAt: new Date(),
        stalledReason: message,
        lastError: message,
      },
    });

    await this.appendRecoveryEvidence(job.id, 'MANUAL_REVIEW', message);
    this.logger.warn(`Bootstrap job ${job.id} moved to MANUAL_REVIEW`);
  }

  private async appendRecoveryEvidence(
    bootstrapJobId: string,
    action: 'AUTO_RECOVERING' | 'AUTO_RECONCILING' | 'MANUAL_REVIEW',
    reason: string,
  ) {
    const report = await this.prisma.bootstrapReport.findFirst({
      where: { bootstrapJobId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        evidence: true,
      },
    });

    if (!report) {
      return;
    }

    const evidence = Array.isArray(report.evidence) ? report.evidence : [];
    await this.prisma.bootstrapReport.update({
      where: { id: report.id },
      data: {
        evidence: [
          ...evidence,
          {
            type: 'stalled_recovery',
            action,
            reason,
            timestamp: new Date().toISOString(),
          },
        ] as Prisma.InputJsonValue,
      },
    });
  }
}
