import { Module } from '@nestjs/common';
import { AdapterRuntimeModule } from '../adapter-runtime/adapter-runtime.module';
import { ApiDeliveryAgent } from './api-delivery.agent';
import { ApiDeliveryBootstrapService } from './api-delivery-bootstrap.service';
import { DeliveryOrchestratorService } from './delivery-orchestrator.service';
import { PageFlowDeliveryService } from './page-flow-delivery.service';
import { UrlDeliveryAgent } from './url-delivery.agent';
import { UrlDeliveryBootstrapService } from './url-delivery-bootstrap.service';
import { VisionDeliveryAgent } from './vision-delivery.agent';
import { VisionDeliveryBootstrapService } from './vision-delivery-bootstrap.service';
import { VisionDeliveryService } from './vision-delivery.service';
import { VisionTargetResolver } from './vision-target-resolver';
import { VisionTaskRuntime } from './vision-task-runtime';

@Module({
  imports: [AdapterRuntimeModule],
  providers: [
    DeliveryOrchestratorService,
    PageFlowDeliveryService,
    ApiDeliveryBootstrapService,
    UrlDeliveryBootstrapService,
    VisionDeliveryBootstrapService,
    VisionTargetResolver,
    VisionTaskRuntime,
    VisionDeliveryService,
    ApiDeliveryAgent,
    UrlDeliveryAgent,
    VisionDeliveryAgent,
  ],
  exports: [DeliveryOrchestratorService],
})
export class DeliveryRuntimeModule {}
