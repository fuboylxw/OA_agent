import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SubmissionController } from './submission.controller';
import { SubmissionService } from './submission.service';
import { AuditModule } from '../audit/audit.module';
import { RuleModule } from '../rule/rule.module';
import { PermissionModule } from '../permission/permission.module';
import { ProcessLibraryModule } from '../process-library/process-library.module';
import { ConnectorModule } from '../connector/connector.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'submit' }),
    AuditModule,
    RuleModule,
    PermissionModule,
    ProcessLibraryModule,
    ConnectorModule,
  ],
  controllers: [SubmissionController],
  providers: [SubmissionService],
  exports: [SubmissionService],
})
export class SubmissionModule {}
