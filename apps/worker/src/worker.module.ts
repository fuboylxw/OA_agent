import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'path';
import { PrismaService } from './services/prisma.service';
import { BootstrapProcessor } from './processors/bootstrap.processor';
import { SyncProcessor } from './processors/sync.processor';
import { WebhookProcessor } from './processors/webhook.processor';
import { BootstrapWatchdogService } from './services/bootstrap-watchdog.service';
import { WorkerHeartbeatService } from './services/worker-heartbeat.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '../../.env'),
      ],
    }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    BullModule.registerQueue(
      // Heavy queues — long-running LLM tasks, low concurrency
      {
        name: 'bootstrap',
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 10000 },
          timeout: 600000, // 10 min
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      },
      {
        name: 'parse',
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          timeout: 300000, // 5 min
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      },
      // Standard queues — medium latency
      {
        name: 'submit',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          timeout: 60000,
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      },
      {
        name: 'sync',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          timeout: 120000,
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      },
      // Fast queues — short tasks, high throughput
      {
        name: 'status',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          timeout: 30000,
          removeOnComplete: 500,
          removeOnFail: 500,
        },
      },
      {
        name: 'webhook',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          timeout: 30000,
          removeOnComplete: 500,
          removeOnFail: 500,
        },
      },
    ),
  ],
  providers: [
    PrismaService,
    { provide: 'PrismaService', useExisting: PrismaService },
    BootstrapProcessor,
    SyncProcessor,
    WebhookProcessor,
    BootstrapWatchdogService,
    WorkerHeartbeatService,
  ],
  exports: [PrismaService],
})
export class WorkerModule {}
