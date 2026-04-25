import { Injectable } from '@nestjs/common';
import {
  getProcessRuntimeDefinition,
  getProcessRuntimePaths,
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
import { VisionDeliveryBootstrapService } from './vision-delivery-bootstrap.service';
import { VisionDeliveryService } from './vision-delivery.service';

@Injectable()
export class VisionDeliveryAgent implements DeliveryAgent {
  readonly path: DeliveryPath = VISION_DELIVERY_PATH;

  constructor(
    private readonly visionDeliveryService: VisionDeliveryService,
    private readonly visionDeliveryBootstrapService: VisionDeliveryBootstrapService,
  ) {}

  async submit(input: ResolvedDeliverySubmitRequest): Promise<DeliverySubmitExecutionResult> {
    const prepared = await this.visionDeliveryBootstrapService.prepare({
      action: 'submit',
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName || input.processCode,
      tenantId: input.tenantId,
      userId: input.userId,
      uiHints: input.uiHints,
    });

    if (!prepared.rpaFlow || !this.hasVisionCapability(prepared.rpaFlow.rpaDefinition, input.uiHints, 'submit')) {
      return {
        submitResult: {
          success: false,
          errorMessage: `No Vision flow is configured for ${input.processCode}`,
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
            nextPath: URL_DELIVERY_PATH,
            errorType: 'vision_not_configured',
            reason: `No Vision flow is configured for ${input.processCode}`,
          },
          evidence: {
            artifactRefs: [],
            summary: `Vision delivery is not configured for ${input.processCode}`,
          },
          statePatch: {
            lastExecutionPath: this.path,
            currentOaSubmissionId: null,
          },
        },
      };
    }

    return this.visionDeliveryService.submit({
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
    const prepared = await this.visionDeliveryBootstrapService.prepare({
      action: 'queryStatus',
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName || input.processCode,
      tenantId: input.tenantId,
      userId: input.userId,
      uiHints: input.uiHints,
    });

    if (!prepared.rpaFlow || !this.hasVisionCapability(prepared.rpaFlow.rpaDefinition, input.uiHints, 'queryStatus')) {
      return {
        statusResult: {
          status: 'error',
          statusDetail: {
            error: `No Vision flow is configured for ${input.processCode}`,
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
            nextPath: URL_DELIVERY_PATH,
            errorType: 'vision_not_configured',
            reason: `No Vision flow is configured for ${input.processCode}`,
          },
          evidence: {
            artifactRefs: [],
            summary: `Vision status delivery is not configured for ${input.processCode}`,
          },
          statePatch: {
            lastExecutionPath: this.path,
            currentOaSubmissionId: input.submissionId,
          },
        },
      };
    }

    return this.visionDeliveryService.queryStatus({
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName || input.processCode,
      taskId: input.taskId,
      traceId: input.traceId,
      context: prepared,
      submissionId: input.submissionId,
    });
  }

  private hasVisionCapability(
    definition: Record<string, any> | undefined,
    uiHints: Record<string, any>,
    action: 'submit' | 'queryStatus',
  ) {
    const runtimeDefinition = (getProcessRuntimeDefinition(uiHints) as Record<string, any> | undefined) || definition;
    const explicitRpa = getProcessRuntimePaths(uiHints, action).includes('vision');
    if (explicitRpa) {
      return true;
    }

    if (this.isDirectLinkDefinition(runtimeDefinition)) {
      return false;
    }

    const actionDefinition = action === 'submit'
      ? runtimeDefinition?.actions?.submit
      : runtimeDefinition?.actions?.queryStatus;
    return Array.isArray(actionDefinition?.steps) && actionDefinition.steps.length > 0;
  }

  private isDirectLinkDefinition(definition: Record<string, any> | undefined) {
    if (!definition || typeof definition !== 'object') {
      return false;
    }

    const metadata = definition.metadata && typeof definition.metadata === 'object'
      ? definition.metadata as Record<string, any>
      : {};
    const accessMode = String(definition.accessMode || metadata.accessMode || '').trim().toLowerCase();
    const sourceType = String(definition.sourceType || metadata.sourceType || '').trim().toLowerCase();

    return accessMode === 'direct_link' || sourceType === 'direct_link';
  }
}
