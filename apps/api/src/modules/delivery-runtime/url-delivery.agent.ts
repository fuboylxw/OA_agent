import { Injectable } from '@nestjs/common';
import {
  type DeliveryPath,
  URL_DELIVERY_PATH,
  VISION_DELIVERY_PATH,
} from '@uniflow/shared-types';
import type {
  DeliveryAgent,
  DeliveryStatusExecutionResult,
  DeliverySubmitExecutionResult,
  ResolvedDeliveryStatusRequest,
  ResolvedDeliverySubmitRequest,
} from './delivery-agent.types';
import { PageFlowDeliveryService } from './page-flow-delivery.service';
import { UrlDeliveryBootstrapService } from './url-delivery-bootstrap.service';

@Injectable()
export class UrlDeliveryAgent implements DeliveryAgent {
  readonly path: DeliveryPath = URL_DELIVERY_PATH;

  constructor(
    private readonly pageFlowDeliveryService: PageFlowDeliveryService,
    private readonly urlDeliveryBootstrapService: UrlDeliveryBootstrapService,
  ) {}

  async submit(input: ResolvedDeliverySubmitRequest): Promise<DeliverySubmitExecutionResult> {
    const prepared = await this.urlDeliveryBootstrapService.prepare({
      action: 'submit',
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName || input.processCode,
      tenantId: input.tenantId,
      userId: input.userId,
      uiHints: input.uiHints,
    });

    if (!prepared.rpaFlow) {
      return {
        submitResult: {
          success: false,
          errorMessage: `No URL flow is configured for ${input.processCode}`,
          metadata: {
            connectorId: input.connectorId,
            flowCode: input.processCode,
            deliveryPath: this.path,
          },
        },
        packet: {
          taskId: input.taskId,
          agentType: this.path,
          success: false,
          fallbackHint: {
            shouldFallback: true,
            nextPath: VISION_DELIVERY_PATH,
            errorType: 'url_not_configured',
            reason: `No URL flow is configured for ${input.processCode}`,
          },
          evidence: {
            artifactRefs: [],
            summary: `URL delivery is not configured for ${input.processCode}`,
          },
          statePatch: {
            lastExecutionPath: this.path,
            currentOaSubmissionId: null,
          },
        },
      };
    }

    return this.pageFlowDeliveryService.submit({
      path: URL_DELIVERY_PATH,
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName || input.processCode,
      taskId: input.taskId,
      traceId: input.traceId,
      context: prepared,
      formData: input.formData,
      attachments: input.attachments,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async queryStatus(input: ResolvedDeliveryStatusRequest): Promise<DeliveryStatusExecutionResult> {
    const prepared = await this.urlDeliveryBootstrapService.prepare({
      action: 'queryStatus',
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName || input.processCode,
      tenantId: input.tenantId,
      userId: input.userId,
      uiHints: input.uiHints,
    });

    if (!prepared.rpaFlow) {
      return {
        statusResult: {
          status: 'error',
          statusDetail: {
            error: `No URL flow is configured for ${input.processCode}`,
            connectorId: input.connectorId,
            flowCode: input.processCode,
            deliveryPath: this.path,
          },
        },
        packet: {
          taskId: input.taskId,
          agentType: this.path,
          success: false,
          fallbackHint: {
            shouldFallback: true,
            nextPath: VISION_DELIVERY_PATH,
            errorType: 'url_not_configured',
            reason: `No URL flow is configured for ${input.processCode}`,
          },
          evidence: {
            artifactRefs: [],
            summary: `URL status delivery is not configured for ${input.processCode}`,
          },
          statePatch: {
            lastExecutionPath: this.path,
            currentOaSubmissionId: input.submissionId,
          },
        },
      };
    }

    return this.pageFlowDeliveryService.queryStatus({
      path: URL_DELIVERY_PATH,
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName || input.processCode,
      taskId: input.taskId,
      traceId: input.traceId,
      context: prepared,
      submissionId: input.submissionId,
    });
  }
}
