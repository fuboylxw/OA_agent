import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuditModule } from '../audit/audit.module';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookProcessor } from '../../processors/webhook.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'webhook' }),
    AuditModule,
    AdapterRuntimeModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookProcessor],
  exports: [WebhookService],
})
export class WebhookModule {}
