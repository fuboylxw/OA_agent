import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { IntentAgent } from './agents/intent.agent';
import { FlowAgent } from './agents/flow.agent';
import { FormAgent } from './agents/form.agent';
import { ConnectorRouter } from './agents/connector-router';
import { TaskPlanAgent } from './agents/task-plan.agent';
import { DeliveryCapabilityRouter } from './delivery-capability.router';
import { ContextManager } from './context/context.manager';
import { PermissionModule } from '../permission/permission.module';
import { AuditModule } from '../audit/audit.module';
import { ProcessLibraryModule } from '../process-library/process-library.module';
import { SubmissionModule } from '../submission/submission.module';
import { AttachmentModule } from '../attachment/attachment.module';
import { AuthBindingModule } from '../auth-binding/auth-binding.module';

@Module({
  imports: [PermissionModule, AuditModule, ProcessLibraryModule, SubmissionModule, AttachmentModule, AuthBindingModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    IntentAgent,
    FlowAgent,
    FormAgent,
    ConnectorRouter,
    TaskPlanAgent,
    DeliveryCapabilityRouter,
    ContextManager,
  ],
  exports: [AssistantService, TaskPlanAgent, DeliveryCapabilityRouter, ContextManager],
})
export class AssistantModule {}
