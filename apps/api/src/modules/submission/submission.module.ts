import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SubmissionController } from './submission.controller';
import { SubmissionService } from './submission.service';
import { AuditModule } from '../audit/audit.module';
import { RuleModule } from '../rule/rule.module';
import { PermissionModule } from '../permission/permission.module';
import { ProcessLibraryModule } from '../process-library/process-library.module';
import { ConnectorModule } from '../connector/connector.module';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';
import { AttachmentModule } from '../attachment/attachment.module';
import { DeliveryRuntimeModule } from '../delivery-runtime/delivery-runtime.module';
import { SubmitProcessor } from '../../processors/submit.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'submit' }),
    AuditModule,
    RuleModule,
    PermissionModule,
    ProcessLibraryModule,
    ConnectorModule,
    AdapterRuntimeModule,
    DeliveryRuntimeModule,
    AttachmentModule,
  ],
  controllers: [SubmissionController],
  providers: [SubmissionService, SubmitProcessor],
  exports: [SubmissionService],
})
export class SubmissionModule {}
