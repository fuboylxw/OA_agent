import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuditModule } from '../audit/audit.module';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncSchedulerService } from './sync-scheduler.service';
import { SyncCursorService } from './sync-cursor.service';
import { SchemaSyncService } from './schema-sync.service';
import { ReferenceSyncService } from './reference-sync.service';
import { StatusSyncService } from './status-sync.service';
import { SyncProcessor } from '../../processors/sync.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'sync' }),
    AuditModule,
    AdapterRuntimeModule,
  ],
  controllers: [SyncController],
  providers: [
    SyncService,
    SyncSchedulerService,
    SyncCursorService,
    SchemaSyncService,
    ReferenceSyncService,
    StatusSyncService,
    SyncProcessor,
  ],
  exports: [SyncService, SyncCursorService],
})
export class SyncModule {}
