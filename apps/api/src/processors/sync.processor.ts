import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { SyncService } from '../modules/sync/sync.service';

@Processor('sync')
@Injectable()
export class SyncProcessor {
  constructor(private readonly syncService: SyncService) {}

  @Process('run')
  async handleSync(job: Job<{ syncJobId: string }>) {
    return this.syncService.execute(job.data.syncJobId);
  }
}
