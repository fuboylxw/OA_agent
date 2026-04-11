import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { MCPController } from './mcp.controller';
import { MCPService } from './mcp.service';
import { MCPExecutorService } from './mcp-executor.service';
import { MCPToolGeneratorService } from './mcp-tool-generator.service';
import { ApiUploadService } from './api-upload.service';
import { ApiUploadJobService } from './api-upload-job.service';
import { ApiUploadRepairService } from './api-upload-repair.service';
import { ApiDocParserAgent } from './agents/api-doc-parser.agent';
import { WorkflowApiIdentifierAgent } from './agents/workflow-api-identifier.agent';
import { ApiValidatorAgent } from './agents/api-validator.agent';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';
import { DocNormalizerService } from '../api-parse/doc-normalizer.service';

@Module({
  imports: [CommonModule, AdapterRuntimeModule],
  controllers: [MCPController],
  providers: [
    MCPService,
    MCPExecutorService,
    MCPToolGeneratorService,
    ApiUploadService,
    ApiUploadJobService,
    ApiUploadRepairService,
    ApiDocParserAgent,
    WorkflowApiIdentifierAgent,
    ApiValidatorAgent,
    DocNormalizerService,
  ],
  exports: [MCPService, MCPExecutorService, ApiUploadService, ApiUploadJobService],
})
export class MCPModule {}
