import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bull';
import { hostname } from 'os';
import {
  BOOTSTRAP_WORKER_HEARTBEAT_INTERVAL_MS,
  BOOTSTRAP_WORKER_HEARTBEAT_KEY,
  BOOTSTRAP_WORKER_HEARTBEAT_TTL_SECONDS,
  BootstrapWorkerHeartbeatPayload,
} from '@uniflow/shared-types';

@Injectable()
export class WorkerHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private readonly startedAt = new Date().toISOString();
  private readonly instanceId = `${hostname()}-${process.pid}-${Date.now()}`;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectQueue('bootstrap') private readonly bootstrapQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.publishHeartbeat();
    this.timer = setInterval(() => {
      void this.publishHeartbeat();
    }, BOOTSTRAP_WORKER_HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async publishHeartbeat() {
    try {
      await this.bootstrapQueue.isReady();
      const payload: BootstrapWorkerHeartbeatPayload = {
        service: 'uniflow-worker',
        queue: 'bootstrap',
        instanceId: this.instanceId,
        pid: process.pid,
        hostname: hostname(),
        startedAt: this.startedAt,
        updatedAt: new Date().toISOString(),
      };

      await this.bootstrapQueue.client.set(
        BOOTSTRAP_WORKER_HEARTBEAT_KEY,
        JSON.stringify(payload),
        'EX',
        BOOTSTRAP_WORKER_HEARTBEAT_TTL_SECONDS,
      );
    } catch (error: any) {
      this.logger.error(`Failed to publish worker heartbeat: ${error.message}`);
    }
  }
}
