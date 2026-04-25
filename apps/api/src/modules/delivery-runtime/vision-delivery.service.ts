import { Injectable } from '@nestjs/common';
import { sanitizeStructuredData } from '@uniflow/agent-kernel';
import {
  type AgentResultPacket,
  type DeliveryPath,
  type RpaActionDefinition,
  type RpaFlowDefinition,
  URL_DELIVERY_PATH,
  VISION_DELIVERY_PATH,
} from '@uniflow/shared-types';
import type { StatusResult, SubmitResult } from '@uniflow/oa-adapters';
import type { DeliveryStatusExecutionResult, DeliverySubmitExecutionResult } from './delivery-agent.types';
import type { VisionDeliveryExecutionContext } from './delivery-bootstrap.types';
import { confirmRpaSubmitIntelligently } from './rpa-submit-confirmation.util';
import { VisionTaskRuntime } from './vision-task-runtime';

interface BaseVisionExecutionInput {
  connectorId: string;
  processCode: string;
  processName: string;
  taskId: string;
  traceId?: string;
  context: VisionDeliveryExecutionContext;
}

interface VisionSubmitInput extends BaseVisionExecutionInput {
  formData: Record<string, any>;
  attachments?: Array<{ filename: string; content: Buffer }>;
  idempotencyKey: string;
}

interface VisionStatusInput extends BaseVisionExecutionInput {
  submissionId: string;
}

@Injectable()
export class VisionDeliveryService {
  private readonly path: DeliveryPath = VISION_DELIVERY_PATH;

  constructor(private readonly visionTaskRuntime: VisionTaskRuntime) {}

  async submit(input: VisionSubmitInput): Promise<DeliverySubmitExecutionResult> {
    const actionDefinition = this.getActionDefinition(input.context.rpaFlow?.rpaDefinition, 'submit');
    if (!actionDefinition?.steps?.length) {
      return {
        submitResult: this.buildMissingSubmitResult(input),
        packet: this.buildMissingPacket(input.taskId, input.processCode, null),
      };
    }

    const ticket = input.context.ticket;
    const result = await this.visionTaskRuntime.run({
      action: 'submit',
      flow: input.context.rpaFlow!.rpaDefinition,
      runtime: input.context.runtime,
      payload: {
        flowCode: input.processCode,
        formData: input.formData,
        idempotencyKey: input.idempotencyKey,
        attachments: input.attachments,
        auth: input.context.authConfig,
      },
      ticket,
    });

    const confirmation = result.success
      ? await confirmRpaSubmitIntelligently({
          actionDefinition,
          extractedValues: result.extractedValues,
          finalSnapshot: result.finalSnapshot,
          fallbackMessage: this.resolveMessage(result.extractedValues),
        })
      : null;
    const submissionId = confirmation?.submissionId;
    const message = this.resolveMessage(result.extractedValues);
    const metadata = sanitizeStructuredData({
      connectorId: input.connectorId,
      flowCode: input.context.rpaFlow!.processCode,
      deliveryPath: this.path,
      mode: 'vision',
      jumpUrl: ticket.jumpUrl,
      ticketIssued: !!ticket.ticket,
      extractedValues: result.extractedValues,
      executedSteps: result.executedSteps,
      finalSnapshotId: result.finalSnapshot?.snapshotId,
      warnings: result.warnings,
      observation: input.context.observation,
      submitConfirmation: confirmation,
      session: {
        executor: 'browser',
        provider: result.provider,
        requestedProvider: result.requestedProvider,
        sessionId: result.sessionId,
        entryUrl: input.context.rpaFlow!.rpaDefinition.platform?.entryUrl,
        jumpUrl: ticket.jumpUrl,
        headless: input.context.runtime.headless !== false,
      },
      message,
    });

    const submitResult: SubmitResult = result.success && confirmation?.confirmed
      ? {
          success: true,
          submissionId,
          metadata,
        }
      : {
          success: false,
          errorMessage: result.errorMessage
            || confirmation?.failureReason
            || `${input.processName} vision submit failed`,
          metadata,
        };

    return {
      submitResult,
      packet: {
        taskId: input.taskId,
        agentType: this.path,
        success: submitResult.success,
        output: submitResult.success
          ? {
              submissionId: submitResult.submissionId,
              externalSubmissionId: submitResult.submissionId,
              message,
            }
          : undefined,
        fallbackHint: submitResult.success
          ? undefined
          : {
              shouldFallback: true,
              nextPath: URL_DELIVERY_PATH,
              errorType: 'vision_submit_failed',
              reason: submitResult.errorMessage || 'vision submit failed',
            },
        evidence: {
          artifactRefs: result.artifactRefs,
          summary: submitResult.success
            ? `${input.processName} submitted through vision runtime`
            : (submitResult.errorMessage || `${input.processName} vision submit failed`),
        },
        statePatch: {
          lastExecutionPath: this.path,
          currentOaSubmissionId: submitResult.submissionId || null,
        },
      },
    };
  }

  async queryStatus(input: VisionStatusInput): Promise<DeliveryStatusExecutionResult> {
    const actionDefinition = this.getActionDefinition(input.context.rpaFlow?.rpaDefinition, 'queryStatus');
    if (!actionDefinition?.steps?.length) {
      return {
        statusResult: this.buildMissingStatusResult(input),
        packet: this.buildMissingPacket(input.taskId, input.processCode, input.submissionId),
      };
    }

    const ticket = input.context.ticket;
    const result = await this.visionTaskRuntime.run({
      action: 'queryStatus',
      flow: input.context.rpaFlow!.rpaDefinition,
      runtime: input.context.runtime,
      payload: {
        submissionId: input.submissionId,
        auth: input.context.authConfig,
      },
      ticket,
    });

    const status = result.success
      ? this.resolveStatus(input.submissionId, result.extractedValues)
      : 'error';
    const message = this.resolveMessage(result.extractedValues);
    const metadata = sanitizeStructuredData({
      connectorId: input.connectorId,
      flowCode: input.context.rpaFlow!.processCode,
      deliveryPath: this.path,
      mode: 'vision',
      jumpUrl: ticket.jumpUrl,
      ticketIssued: !!ticket.ticket,
      extractedValues: result.extractedValues,
      executedSteps: result.executedSteps,
      finalSnapshotId: result.finalSnapshot?.snapshotId,
      warnings: result.warnings,
      observation: input.context.observation,
      session: {
        executor: 'browser',
        provider: result.provider,
        requestedProvider: result.requestedProvider,
        sessionId: result.sessionId,
        entryUrl: input.context.rpaFlow!.rpaDefinition.platform?.entryUrl,
        jumpUrl: ticket.jumpUrl,
        headless: input.context.runtime.headless !== false,
      },
      message,
    });

    const statusResult: StatusResult = result.success
      ? {
          status,
          statusDetail: metadata,
          timeline: [{
            timestamp: new Date().toISOString(),
            status,
            operator: 'vision_runtime',
            comment: `Vision session ${result.sessionId} executed for ${input.submissionId}`,
          }],
        }
      : {
          status: 'error',
          statusDetail: {
            ...(metadata as Record<string, any>),
            error: result.errorMessage || `${input.processName} vision status failed`,
          },
          timeline: [],
        };

    return {
      statusResult,
      packet: {
        taskId: input.taskId,
        agentType: this.path,
        success: statusResult.status !== 'error',
        output: statusResult.status === 'error'
          ? undefined
          : {
              status: statusResult.status,
              message,
            },
        fallbackHint: statusResult.status === 'error'
          ? {
              shouldFallback: true,
              nextPath: URL_DELIVERY_PATH,
              errorType: 'vision_status_failed',
              reason: String(result.errorMessage || 'vision status failed'),
            }
          : undefined,
        evidence: {
          artifactRefs: result.artifactRefs,
          summary: statusResult.status === 'error'
            ? String(result.errorMessage || `${input.processName} vision status failed`)
            : `${input.processName} status queried through vision runtime`,
        },
        statePatch: {
          lastExecutionPath: this.path,
          currentOaSubmissionId: input.submissionId,
        },
      },
    };
  }

  private buildMissingSubmitResult(input: VisionSubmitInput): SubmitResult {
    return {
      success: false,
      errorMessage: `No Vision submit flow is configured for ${input.processCode}`,
      metadata: {
        connectorId: input.connectorId,
        flowCode: input.processCode,
        deliveryPath: this.path,
      },
    };
  }

  private buildMissingStatusResult(input: VisionStatusInput): StatusResult {
    return {
      status: 'error',
      statusDetail: {
        error: `No Vision status flow is configured for ${input.processCode}`,
        connectorId: input.connectorId,
        flowCode: input.processCode,
        deliveryPath: this.path,
      },
      timeline: [],
    };
  }

  private buildMissingPacket(
    taskId: string,
    processCode: string,
    submissionId: string | null,
  ): AgentResultPacket {
    return {
      taskId,
      agentType: this.path,
      success: false,
      fallbackHint: {
        shouldFallback: true,
        nextPath: URL_DELIVERY_PATH,
        errorType: 'vision_not_configured',
        reason: `No Vision flow is configured for ${processCode}`,
      },
      evidence: {
        artifactRefs: [],
        summary: `Vision delivery is not configured for ${processCode}`,
      },
      statePatch: {
        lastExecutionPath: this.path,
        currentOaSubmissionId: submissionId,
      },
    };
  }

  private getActionDefinition(
    flow: RpaFlowDefinition | undefined,
    action: 'submit' | 'queryStatus',
  ): RpaActionDefinition | undefined {
    return action === 'submit'
      ? flow?.actions?.submit
      : flow?.actions?.queryStatus;
  }

  private resolveStatus(submissionId: string | undefined, extractedValues: Record<string, any>) {
    const explicit = extractedValues.status || extractedValues.statusText || extractedValues.currentStatus;
    if (explicit) {
      return String(explicit);
    }
    return 'submitted';
  }

  private resolveMessage(extractedValues: Record<string, any>) {
    const candidate = extractedValues.message || extractedValues.tip || extractedValues.notice;
    return candidate ? String(candidate) : undefined;
  }
}
