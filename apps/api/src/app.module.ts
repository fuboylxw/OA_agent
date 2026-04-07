import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { resolve } from 'path';
import { BootstrapModule } from './modules/bootstrap/bootstrap.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { IrNormalizerModule } from './modules/ir-normalizer/ir-normalizer.module';
import { AdapterCompilerModule } from './modules/adapter-compiler/adapter-compiler.module';
import { ReplayValidatorModule } from './modules/replay-validator/replay-validator.module';
import { ConnectorModule } from './modules/connector/connector.module';
import { AdapterRuntimeModule } from './modules/adapter-runtime/adapter-runtime.module';
import { ProcessLibraryModule } from './modules/process-library/process-library.module';
import { AuditModule } from './modules/audit/audit.module';
import { PermissionModule } from './modules/permission/permission.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { SubmissionModule } from './modules/submission/submission.module';
import { RuleModule } from './modules/rule/rule.module';
import { StatusModule } from './modules/status/status.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommonModule } from './modules/common/common.module';
import { MCPModule } from './modules/mcp/mcp.module';
import { SyncModule } from './modules/sync/sync.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { ApiParseModule } from './modules/api-parse/api-parse.module';
import { AttachmentModule } from './modules/attachment/attachment.module';
import { HealthController } from './health.controller';
import { GlobalAuthGuard } from './modules/common/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '../../.env'),
      ],
    }),
    // Rate limiting
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 60,
      },
    ]),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    BullModule.registerQueue(
      { name: 'bootstrap', defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: 100, removeOnFail: 200 } },
      { name: 'parse', defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 200 } },
      { name: 'submit', defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 200, removeOnFail: 500 } },
      { name: 'status', defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 500, removeOnFail: 500 } },
      { name: 'sync', defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 200, removeOnFail: 500 } },
      { name: 'webhook', defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 500, removeOnFail: 500 } },
    ),
    CommonModule,
    BootstrapModule,
    DiscoveryModule,
    IrNormalizerModule,
    AdapterCompilerModule,
    ReplayValidatorModule,
    AdapterRuntimeModule,
    ConnectorModule,
    ProcessLibraryModule,
    AuditModule,
    PermissionModule,
    AssistantModule,
    RuleModule,
    SubmissionModule,
    StatusModule,
    DashboardModule,
    AuthModule,
    MCPModule,
    AttachmentModule,
    SyncModule,
    WebhookModule,
    ApiParseModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global auth guard — all routes require auth unless marked @Public()
    {
      provide: APP_GUARD,
      useClass: GlobalAuthGuard,
    },
    // Global rate limiting guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
