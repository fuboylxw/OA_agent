/**
 * @deprecated 此 Module 已废弃，不被任何入口引用。
 * Bootstrap 流水线已统一由 apps/worker 中的 WorkerModule 处理。
 * 保留此文件仅供参考，请勿在 AppModule 或其他入口中 import。
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'path';
import { BootstrapProcessor } from './processors/bootstrap.processor';
import { CommonModule } from './modules/common/common.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { IrNormalizerModule } from './modules/ir-normalizer/ir-normalizer.module';
import { AdapterCompilerModule } from './modules/adapter-compiler/adapter-compiler.module';
import { ReplayValidatorModule } from './modules/replay-validator/replay-validator.module';
import { BootstrapStateMachine } from './modules/bootstrap/bootstrap.state-machine';
import { SyncModule } from './modules/sync/sync.module';
import { WebhookModule } from './modules/webhook/webhook.module';

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
    CommonModule,
    DiscoveryModule,
    IrNormalizerModule,
    AdapterCompilerModule,
    ReplayValidatorModule,
    SyncModule,
    WebhookModule,
  ],
  providers: [BootstrapProcessor, BootstrapStateMachine],
})
export class WorkerModule {}
