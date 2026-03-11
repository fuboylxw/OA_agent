import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { IntentAgent } from './agents/intent.agent';
import { FlowAgent } from './agents/flow.agent';
import { FormAgent } from './agents/form.agent';
import { ConnectorRouter } from './agents/connector-router';
import { PermissionModule } from '../permission/permission.module';
import { AuditModule } from '../audit/audit.module';
import { ProcessLibraryModule } from '../process-library/process-library.module';
import { MCPModule } from '../mcp/mcp.module';
import { SubmissionModule } from '../submission/submission.module';

@Module({
  imports: [PermissionModule, AuditModule, ProcessLibraryModule, MCPModule, SubmissionModule],
  controllers: [AssistantController],
  providers: [AssistantService, IntentAgent, FlowAgent, FormAgent, ConnectorRouter],
  exports: [AssistantService],
})
export class AssistantModule {}
