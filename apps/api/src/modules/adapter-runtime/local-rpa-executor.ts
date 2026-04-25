import type { RpaActionDefinition, RpaFlowDefinition, RpaStepDefinition } from '@uniflow/shared-types';
import type { RpaExecutionInput, RpaExecutionResult, RpaExecutor } from './rpa-executor';
import {
  detectAuthCredentialFieldKind,
  resolveAuthCredentialValue,
} from '../common/auth-field.util';

export class LocalRpaExecutor implements RpaExecutor {
  async execute(input: RpaExecutionInput): Promise<RpaExecutionResult> {
    const actionDefinition = this.getActionDefinition(input.flow, input.action);
    const executedSteps = (actionDefinition?.steps || []).map((step, index) =>
      this.toExecutedStep(step, index, input.payload),
    );

    if (input.action === 'submit') {
      const submissionId = this.deriveSubmissionId(input.flow.processCode, input.payload);
      return {
        success: true,
        submissionId,
        status: 'submitted',
        message: `${input.flow.processName} submitted through local RPA executor`,
        executedSteps,
        jumpUrl: input.ticket.jumpUrl,
        ticketIssued: !!input.ticket.ticket,
        ticketMetadata: input.ticket.metadata,
        session: {
          executor: 'local',
          provider: 'in-process',
          entryUrl: input.flow.platform?.entryUrl,
          jumpUrl: input.ticket.jumpUrl,
        },
      };
    }

    const status = this.deriveStatus(input.payload.submissionId);
    return {
      success: true,
      status,
      message: `${input.flow.processName} status queried through local RPA executor`,
      timeline: [{
        timestamp: new Date().toISOString(),
        status,
        operator: 'local_rpa_executor',
        comment: `Derived from local simulation for ${input.payload.submissionId || 'unknown submission'}`,
      }],
      executedSteps,
      jumpUrl: input.ticket.jumpUrl,
      ticketIssued: !!input.ticket.ticket,
      ticketMetadata: input.ticket.metadata,
      session: {
        executor: 'local',
        provider: 'in-process',
        entryUrl: input.flow.platform?.entryUrl,
        jumpUrl: input.ticket.jumpUrl,
      },
    };
  }

  private getActionDefinition(flow: RpaFlowDefinition, action: 'submit' | 'queryStatus'): RpaActionDefinition | undefined {
    if (action === 'submit') {
      return flow.actions?.submit;
    }
    return flow.actions?.queryStatus;
  }

  private toExecutedStep(step: RpaStepDefinition, index: number, payload: Record<string, any>) {
    const authKind = step.fieldKey
      ? detectAuthCredentialFieldKind({
          key: step.fieldKey,
          label: step.target?.label,
          description: step.description,
        })
      : null;
    const fieldValue = step.fieldKey
      ? payload.formData?.[step.fieldKey]
        ?? (authKind ? resolveAuthCredentialValue(authKind, payload.auth) : undefined)
        ?? payload[step.fieldKey]
      : undefined;
    return {
      index,
      type: step.type,
      selector: step.selector,
      fieldKey: step.fieldKey,
      status: 'simulated' as const,
      value: fieldValue ?? step.value,
      description: step.description,
    };
  }

  private deriveSubmissionId(processCode: string, payload: Record<string, any>) {
    const idempotencyKey = payload.idempotencyKey || 'local';
    const suffix = String(idempotencyKey).replace(/[^a-zA-Z0-9]/g, '').slice(-10) || Date.now().toString();
    return `RPA-${processCode.toUpperCase()}-${suffix}`;
  }

  private deriveStatus(submissionId: string | undefined) {
    return 'submitted';
  }
}
