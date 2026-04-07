import type {
  BrowserPageSnapshot,
  RpaFlowDefinition,
  RpaLocatorKind,
  RpaRuntimeDefinition,
  RpaStepActionType,
} from '@uniflow/shared-types';

export type RpaExecutionAction = 'submit' | 'queryStatus';
export type RpaExecutorMode = 'local' | 'browser';

export interface RpaExecutionTicket {
  ticket?: string;
  jumpUrl?: string;
  headers?: Record<string, string>;
  metadata?: Record<string, any>;
}

export interface RpaExecutionInput {
  action: RpaExecutionAction;
  flow: RpaFlowDefinition;
  runtime: RpaRuntimeDefinition;
  payload: Record<string, any>;
  ticket: RpaExecutionTicket;
}

export interface RpaExecutionTimelineItem {
  timestamp: string;
  status: string;
  operator?: string;
  comment?: string;
}

export interface RpaExecutedStep {
  index: number;
  type: RpaStepActionType;
  selector?: string;
  fieldKey?: string;
  status: 'simulated' | 'planned' | 'executed' | 'recovered' | 'failed';
  value?: any;
  description?: string;
  elementRef?: string;
  targetKind?: RpaLocatorKind;
  snapshotId?: string;
  errorMessage?: string;
}

export interface RpaRecoveryAttempt {
  stepIndex: number;
  reason: string;
  recovered: boolean;
  snapshotId?: string;
}

export interface RpaExecutionResult {
  success: boolean;
  submissionId?: string;
  status?: string;
  message?: string;
  timeline?: RpaExecutionTimelineItem[];
  executedSteps: RpaExecutedStep[];
  jumpUrl?: string;
  ticketIssued: boolean;
  ticketMetadata?: Record<string, any>;
  snapshots?: BrowserPageSnapshot[];
  finalSnapshot?: BrowserPageSnapshot;
  recoveryAttempts?: RpaRecoveryAttempt[];
  session?: {
    executor: RpaExecutorMode;
    provider?: string;
    requestedProvider?: string;
    sessionId?: string;
    entryUrl?: string;
    jumpUrl?: string;
    headless?: boolean;
  };
}

export interface RpaExecutor {
  execute(input: RpaExecutionInput): Promise<RpaExecutionResult>;
}
