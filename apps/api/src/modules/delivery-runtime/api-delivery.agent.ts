import { Injectable } from '@nestjs/common';
import {
  API_DELIVERY_PATH,
  type DeliveryPath,
  URL_DELIVERY_PATH,
} from '@uniflow/shared-types';
import type {
  DeliveryAgent,
  DeliveryStatusExecutionResult,
  DeliverySubmitExecutionResult,
  ResolvedDeliveryStatusRequest,
  ResolvedDeliverySubmitRequest,
} from './delivery-agent.types';
import { ApiDeliveryBootstrapService } from './api-delivery-bootstrap.service';

@Injectable()
export class ApiDeliveryAgent implements DeliveryAgent {
  readonly path: DeliveryPath = API_DELIVERY_PATH;

  constructor(private readonly apiDeliveryBootstrapService: ApiDeliveryBootstrapService) {}

  async submit(input: ResolvedDeliverySubmitRequest): Promise<DeliverySubmitExecutionResult> {
    const { adapter } = await this.apiDeliveryBootstrapService.prepare({
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName || input.processCode,
      tenantId: input.tenantId,
      userId: input.userId,
    });

    if (!adapter) {
      return {
        submitResult: {
          success: false,
          errorMessage: `No API delivery adapter is available for ${input.processCode}`,
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
            errorType: 'api_not_configured',
            reason: `No API adapter is available for ${input.processCode}`,
          },
          evidence: {
            artifactRefs: [],
            summary: `API delivery is not configured for ${input.processCode}`,
          },
          statePatch: {
            lastExecutionPath: this.path,
            currentOaSubmissionId: null,
          },
        },
      };
    }

    const result = await adapter.submit({
      flowCode: input.processCode,
      formData: input.formData,
      idempotencyKey: input.idempotencyKey,
      attachments: input.attachments,
    });

    return {
      submitResult: {
        ...result,
        metadata: {
          ...((result.metadata || {}) as Record<string, any>),
          deliveryPath: this.path,
        },
      },
      packet: {
        taskId: input.taskId,
        agentType: this.path,
        success: result.success,
        output: result.success
          ? {
              submissionId: result.submissionId,
              externalSubmissionId: result.submissionId,
              message: typeof result.metadata?.message === 'string' ? result.metadata.message : undefined,
            }
          : undefined,
        fallbackHint: result.success
          ? undefined
          : {
              shouldFallback: true,
              nextPath: URL_DELIVERY_PATH,
              errorType: 'api_submit_failed',
              reason: result.errorMessage || 'api submit failed',
            },
        evidence: {
          artifactRefs: [],
          summary: result.success
            ? `${input.processName || input.processCode} submitted through API`
            : (result.errorMessage || `${input.processName || input.processCode} API submit failed`),
        },
        statePatch: {
          lastExecutionPath: this.path,
          currentOaSubmissionId: result.submissionId || null,
        },
      },
    };
  }

  async queryStatus(input: ResolvedDeliveryStatusRequest): Promise<DeliveryStatusExecutionResult> {
    const { adapter } = await this.apiDeliveryBootstrapService.prepare({
      connectorId: input.connectorId,
      processCode: input.processCode,
      processName: input.processName || input.processCode,
      tenantId: input.tenantId,
      userId: input.userId,
    });

    if (!adapter) {
      return {
        statusResult: {
          status: 'error',
          statusDetail: {
            error: `No API delivery adapter is available for ${input.processCode}`,
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
            errorType: 'api_not_configured',
            reason: `No API adapter is available for ${input.processCode}`,
          },
          evidence: {
            artifactRefs: [],
            summary: `API status delivery is not configured for ${input.processCode}`,
          },
          statePatch: {
            lastExecutionPath: this.path,
            currentOaSubmissionId: input.submissionId,
          },
        },
      };
    }

    const result = await adapter.queryStatus(input.submissionId);
    return {
      statusResult: {
        ...result,
        statusDetail: {
          ...((result.statusDetail || {}) as Record<string, any>),
          deliveryPath: this.path,
        },
      },
      packet: {
        taskId: input.taskId,
        agentType: this.path,
        success: result.status !== 'error',
        output: result.status === 'error'
          ? undefined
          : {
              status: result.status,
              message: typeof result.statusDetail?.message === 'string' ? result.statusDetail.message : undefined,
            },
        fallbackHint: result.status === 'error'
          ? {
              shouldFallback: true,
              nextPath: URL_DELIVERY_PATH,
              errorType: 'api_status_failed',
              reason: String(result.statusDetail?.error || 'api status failed'),
            }
          : undefined,
        evidence: {
          artifactRefs: [],
          summary: result.status === 'error'
            ? String(result.statusDetail?.error || `${input.processName || input.processCode} API status failed`)
            : `${input.processName || input.processCode} status queried through API`,
        },
        statePatch: {
          lastExecutionPath: this.path,
          currentOaSubmissionId: input.submissionId,
        },
      },
    };
  }
}
