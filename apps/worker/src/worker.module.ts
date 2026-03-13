import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './services/prisma.service';
import { BootstrapProcessor } from './processors/bootstrap.processor';
import { SyncProcessor } from './processors/sync.processor';
import { WebhookProcessor } from './processors/webhook.processor';
import { BootstrapWatchdogService } from './services/bootstrap-watchdog.service';
import { WorkerHeartbeatService } from './services/worker-heartbeat.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue(
      { name: 'bootstrap' },
      { name: 'parse' },
      { name: 'submit' },
      { name: 'status' },
      { name: 'sync' },
      { name: 'webhook' },
    ),
  ],
  providers: [
    { provide: 'PrismaService', useClass: PrismaService },
    PrismaService,
    BootstrapProcessor,
    SyncProcessor,
    WebhookProcessor,
    BootstrapWatchdogService,
    WorkerHeartbeatService,
  ],
  exports: [PrismaService],
})
export class WorkerModule {}
