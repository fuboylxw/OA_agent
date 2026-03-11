import { Module } from '@nestjs/common';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';
import { ApiParseController } from './api-parse.controller';
import { ApiParseService } from './api-parse.service';
import { DocNormalizerService } from './doc-normalizer.service';
import { WorkflowIdentifierAgent } from './workflow-identifier.agent';
import { EndpointValidatorService } from './endpoint-validator.service';
import { MCPGeneratorService } from './mcp-generator.service';
import { SyncService } from './sync.service';
import { StatusMapperService } from './status-mapper.service';
import { FlowDiscoveryService } from './flow-discovery.service';

@Module({
  imports: [AdapterRuntimeModule],
  controllers: [ApiParseController],
  providers: [
    ApiParseService,
    DocNormalizerService,
    WorkflowIdentifierAgent,
    EndpointValidatorService,
    MCPGeneratorService,
    SyncService,
    StatusMapperService,
    FlowDiscoveryService,
  ],
  exports: [ApiParseService, SyncService, StatusMapperService, FlowDiscoveryService],
})
export class ApiParseModule {}
