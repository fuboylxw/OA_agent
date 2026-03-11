import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { MCPController } from './mcp.controller';
import { MCPService } from './mcp.service';
import { MCPExecutorService } from './mcp-executor.service';
import { MCPToolGeneratorService } from './mcp-tool-generator.service';
import { ApiUploadService } from './api-upload.service';
import { ApiDocParserAgent } from './agents/api-doc-parser.agent';
import { WorkflowApiIdentifierAgent } from './agents/workflow-api-identifier.agent';
import { ApiValidatorAgent } from './agents/api-validator.agent';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';

@Module({
  imports: [CommonModule, AdapterRuntimeModule],
  controllers: [MCPController],
  providers: [
    MCPService,
    MCPExecutorService,
    MCPToolGeneratorService,
    ApiUploadService,
    ApiDocParserAgent,
    WorkflowApiIdentifierAgent,
    ApiValidatorAgent,
  ],
  exports: [MCPService, MCPExecutorService, ApiUploadService],
})
export class MCPModule {}
