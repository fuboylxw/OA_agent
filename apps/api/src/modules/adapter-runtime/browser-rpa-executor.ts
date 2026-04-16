import type { RpaActionDefinition, RpaFlowDefinition } from '@uniflow/shared-types';
import { BrowserTaskRuntime } from '../browser-runtime/browser-task-runtime';
import { confirmRpaSubmit } from '../delivery-runtime/rpa-submit-confirmation.util';
import type { RpaExecutionInput, RpaExecutionResult, RpaExecutor } from './rpa-executor';

export class BrowserRpaExecutor implements RpaExecutor {
  constructor(
    private readonly browserTaskRuntime = new BrowserTaskRuntime(),
  ) {}

  async execute(input: RpaExecutionInput): Promise<RpaExecutionResult> {
    const actionDefinition = this.getActionDefinition(input.flow, input.action);
    const taskResult = await this.browserTaskRuntime.run({
      action: input.action,
      flow: input.flow,
      runtime: input.runtime,
      payload: input.payload,
      ticket: input.ticket,
    });
    const provider = taskResult.provider;
    const session = {
      executor: 'browser' as const,
      provider,
      requestedProvider: taskResult.requestedProvider,
      sessionId: taskResult.sessionId,
      entryUrl: input.flow.platform?.entryUrl,
      jumpUrl: input.ticket.jumpUrl,
      headless: input.runtime.headless !== false,
    };

    if (!taskResult.success) {
      return {
        success: false,
        status: input.action === 'queryStatus' ? 'error' : undefined,
        message: taskResult.errorMessage || `${input.flow.processName} failed in browser runtime`,
        executedSteps: taskResult.executedSteps,
        jumpUrl: input.ticket.jumpUrl,
        ticketIssued: !!input.ticket.ticket,
        ticketMetadata: input.ticket.metadata,
        snapshots: taskResult.snapshots,
        finalSnapshot: taskResult.finalSnapshot,
        recoveryAttempts: taskResult.recoveryAttempts,
        session,
      };
    }

    if (input.action === 'submit') {
      const message = this.resolveMessage(actionDefinition, taskResult.extractedValues)
        || `${input.flow.processName} submitted through browser runtime`;
      const confirmation = confirmRpaSubmit({
        actionDefinition,
        extractedValues: taskResult.extractedValues,
        finalSnapshot: taskResult.finalSnapshot,
        fallbackMessage: message,
      });
      const status = confirmation.confirmed
        ? (this.resolveStatus(actionDefinition, input.payload.submissionId, taskResult.extractedValues) || 'submitted')
        : undefined;
      return {
        success: confirmation.confirmed,
        submissionId: confirmation.submissionId,
        status,
        message: confirmation.confirmed ? message : (confirmation.failureReason || message),
        executedSteps: taskResult.executedSteps,
        jumpUrl: input.ticket.jumpUrl,
        ticketIssued: !!input.ticket.ticket,
        ticketMetadata: input.ticket.metadata,
        snapshots: taskResult.snapshots,
        finalSnapshot: taskResult.finalSnapshot,
        recoveryAttempts: taskResult.recoveryAttempts,
        session,
      };
    }

    const status = this.resolveStatus(actionDefinition, input.payload.submissionId, taskResult.extractedValues)
      || this.deriveStatus(input.payload.submissionId);
    const message = this.resolveMessage(actionDefinition, taskResult.extractedValues)
      || `${input.flow.processName} status queried through browser runtime`;
    return {
      success: true,
      status,
      message,
      timeline: [{
        timestamp: new Date().toISOString(),
        status,
        operator: 'browser_rpa_runtime',
        comment: `Browser session ${taskResult.sessionId} executed for ${input.payload.submissionId || 'unknown submission'}`,
      }],
      executedSteps: taskResult.executedSteps,
      jumpUrl: input.ticket.jumpUrl,
      ticketIssued: !!input.ticket.ticket,
      ticketMetadata: input.ticket.metadata,
      snapshots: taskResult.snapshots,
      finalSnapshot: taskResult.finalSnapshot,
      recoveryAttempts: taskResult.recoveryAttempts,
      session,
    };
  }

  private getActionDefinition(flow: RpaFlowDefinition, action: 'submit' | 'queryStatus'): RpaActionDefinition | undefined {
    if (action === 'submit') {
      return flow.actions?.submit;
    }
    return flow.actions?.queryStatus;
  }

  private resolveSubmissionId(
    actionDefinition: RpaActionDefinition | undefined,
    processCode: string,
    payload: Record<string, any>,
    extractedValues: Record<string, any>,
  ) {
    return this.coerceString(
      this.readMappedValue(extractedValues, actionDefinition?.resultMapping?.submissionIdPath)
      ?? this.readFirstDefined(extractedValues, [
        'submissionId',
        'submission_id',
        'billNo',
        'applyNo',
        'apply_no',
      ]),
    ) || this.deriveSubmissionId(processCode, payload);
  }

  private resolveStatus(
    actionDefinition: RpaActionDefinition | undefined,
    submissionId: string | undefined,
    extractedValues: Record<string, any>,
  ) {
    return this.coerceString(
      this.readMappedValue(extractedValues, actionDefinition?.resultMapping?.statusPath)
      ?? this.readFirstDefined(extractedValues, [
        'status',
        'statusText',
        'currentStatus',
      ]),
    ) || this.deriveStatus(submissionId);
  }

  private resolveMessage(
    actionDefinition: RpaActionDefinition | undefined,
    extractedValues: Record<string, any>,
  ) {
    return this.coerceString(
      this.readMappedValue(extractedValues, actionDefinition?.resultMapping?.messagePath)
      ?? this.readFirstDefined(extractedValues, [
        'message',
        'tip',
        'notice',
      ]),
    );
  }

  private readMappedValue(values: Record<string, any>, path: string | undefined) {
    if (!path) {
      return undefined;
    }

    if (Object.prototype.hasOwnProperty.call(values, path)) {
      return values[path];
    }

    return this.readByPath(values, path);
  }

  private readFirstDefined(values: Record<string, any>, keys: string[]) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== undefined && values[key] !== null) {
        return values[key];
      }
    }
    return undefined;
  }

  private readByPath(values: Record<string, any>, path: string) {
    return path.split('.').reduce<any>((current, key) => current?.[key], values);
  }

  private coerceString(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return typeof value === 'string' ? value : String(value);
  }

  private deriveSubmissionId(processCode: string, payload: Record<string, any>) {
    const idempotencyKey = payload.idempotencyKey || 'browser';
    const suffix = String(idempotencyKey).replace(/[^a-zA-Z0-9]/g, '').slice(-10) || Date.now().toString();
    return `RPA-BROWSER-${processCode.toUpperCase()}-${suffix}`;
  }

  private deriveStatus(submissionId: string | undefined) {
    const value = String(submissionId || '').toLowerCase();
    if (value.includes('reject') || value.includes('fail')) {
      return 'rejected';
    }
    if (value.includes('approve') || value.includes('done')) {
      return 'approved';
    }
    if (value.includes('process') || value.includes('pending')) {
      return 'processing';
    }
    return 'submitted';
  }
}
