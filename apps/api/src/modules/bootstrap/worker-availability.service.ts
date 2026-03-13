import { InjectQueue } from '@nestjs/bull';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bull';
import {
  BOOTSTRAP_WORKER_HEARTBEAT_KEY,
  BOOTSTRAP_WORKER_STALE_AFTER_MS,
  BootstrapWorkerHeartbeatPayload,
} from '@uniflow/shared-types';

type QueueJobCounts = Awaited<ReturnType<Queue['getJobCounts']>>;

type BootstrapWorkerStatus = {
  available: boolean;
  stale: boolean;
  heartbeatAgeMs: number | null;
  heartbeat: BootstrapWorkerHeartbeatPayload | null;
  queue: QueueJobCounts | null;
  reason?: string;
};

@Injectable()
export class WorkerAvailabilityService {
  private readonly logger = new Logger(WorkerAvailabilityService.name);

  constructor(
    @InjectQueue('bootstrap') private readonly bootstrapQueue: Queue,
  ) {}

  async assertBootstrapWorkerAvailable() {
    const status = await this.getBootstrapWorkerStatus();
    if (!status.available) {
      const reason = status.reason || 'bootstrap worker unavailable';
      this.logger.warn(`Rejecting bootstrap job creation: ${reason}`);
      throw new ServiceUnavailableException(
        '初始化任务处理器未就绪，请先启动 worker 后再重试。',
      );
    }
  }

  async getBootstrapWorkerStatus(): Promise<BootstrapWorkerStatus> {
    try {
      await this.bootstrapQueue.isReady();
      const [rawHeartbeat, queueCounts] = await Promise.all([
        this.bootstrapQueue.client.get(BOOTSTRAP_WORKER_HEARTBEAT_KEY),
        this.bootstrapQueue.getJobCounts(),
      ]);

      if (!rawHeartbeat) {
        return {
          available: false,
          stale: true,
          heartbeatAgeMs: null,
          heartbeat: null,
          queue: queueCounts,
          reason: 'missing_heartbeat',
        };
      }

      let heartbeat: BootstrapWorkerHeartbeatPayload | null = null;
      try {
        heartbeat = JSON.parse(rawHeartbeat) as BootstrapWorkerHeartbeatPayload;
      } catch (error: any) {
        this.logger.warn(`Invalid worker heartbeat payload: ${error.message}`);
        return {
          available: false,
          stale: true,
          heartbeatAgeMs: null,
          heartbeat: null,
          queue: queueCounts,
          reason: 'invalid_heartbeat',
        };
      }

      const updatedAt = new Date(heartbeat.updatedAt).getTime();
      const heartbeatAgeMs = Number.isFinite(updatedAt)
        ? Date.now() - updatedAt
        : null;
      const stale = heartbeatAgeMs === null || heartbeatAgeMs > BOOTSTRAP_WORKER_STALE_AFTER_MS;

      return {
        available: !stale,
        stale,
        heartbeatAgeMs,
        heartbeat,
        queue: queueCounts,
        reason: stale ? 'stale_heartbeat' : undefined,
      };
    } catch (error: any) {
      this.logger.error(`Failed to read worker availability: ${error.message}`);
      return {
        available: false,
        stale: true,
        heartbeatAgeMs: null,
        heartbeat: null,
        queue: null,
        reason: 'queue_unreachable',
      };
    }
  }
}
