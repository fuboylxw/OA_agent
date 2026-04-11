import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SyncService } from './sync.service';

@Injectable()
export class SyncSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly syncService: SyncService) {}

  onModuleInit() {
    if (!this.isEnabled()) {
      this.logger.log('Sync scheduler disabled');
      return;
    }

    const intervalMs = this.getPollIntervalMs();
    this.timer = setInterval(() => {
      void this.pollDueSchedules();
    }, intervalMs);
    this.timer.unref();

    this.logger.log(`Sync scheduler started with poll interval ${intervalMs}ms`);
    void this.pollDueSchedules();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async pollDueSchedules() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const result = await this.syncService.dispatchDueSchedules();
      if (result.enqueued > 0) {
        this.logger.log(`Dispatched ${result.enqueued} scheduled sync job(s)`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to dispatch scheduled sync jobs: ${error.message}`);
    } finally {
      this.running = false;
    }
  }

  private isEnabled() {
    return process.env.SYNC_SCHEDULER_ENABLED !== 'false';
  }

  private getPollIntervalMs() {
    const raw = parseInt(process.env.SYNC_SCHEDULER_POLL_MS || '60000', 10);
    return Number.isNaN(raw) ? 60000 : Math.max(raw, 10000);
  }
}
