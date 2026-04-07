import type { BrowserPageSnapshot, RpaFlowDefinition, RpaRuntimeDefinition } from '@uniflow/shared-types';
import type {
  RpaExecutedStep,
  RpaExecutionAction,
  RpaExecutionTicket,
  RpaRecoveryAttempt,
} from '../adapter-runtime/rpa-executor';

export interface BrowserTaskRequest {
  action: RpaExecutionAction;
  flow: RpaFlowDefinition;
  runtime: RpaRuntimeDefinition;
  payload: Record<string, any>;
  ticket: RpaExecutionTicket;
}

export interface BrowserTaskWarning {
  code: string;
  message: string;
}

export interface BrowserCapturedRegion {
  id: string;
  role: 'header' | 'navigation' | 'main' | 'form' | 'table' | 'dialog' | 'sidebar' | 'footer' | 'status';
  name: string;
  summary?: string;
  elementSelectors?: string[];
}

export interface BrowserCapturedFormField {
  label?: string;
  fieldKey?: string;
  required?: boolean;
  selector?: string;
}

export interface BrowserCapturedForm {
  id: string;
  name: string;
  fields: BrowserCapturedFormField[];
}

export interface BrowserCapturedTable {
  id: string;
  name: string;
  summary?: string;
}

export interface BrowserCapturedDialog {
  id: string;
  title: string;
  summary?: string;
}

export interface BrowserPageCapture {
  title: string;
  url: string;
  regions?: BrowserCapturedRegion[];
  forms?: BrowserCapturedForm[];
  tables?: BrowserCapturedTable[];
  dialogs?: BrowserCapturedDialog[];
  importantTexts?: string[];
  interactiveElements: Array<Omit<BrowserPageSnapshot['interactiveElements'][number], 'ref'>>;
}

export interface BrowserTabRecord {
  tabId: string;
  url: string;
  title: string;
  action: RpaExecutionAction;
  flow: RpaFlowDefinition;
  payload: Record<string, any>;
  ticket: RpaExecutionTicket;
  history: string[];
  formValues: Record<string, any>;
  uploads: Array<{ fieldKey?: string; filename: string }>;
  extractedValues: Record<string, any>;
  artifacts: Record<string, any>;
  pageVersion: number;
  lastSnapshotId?: string;
  lastInteractionAt: string;
}

export interface BrowserSessionRecord {
  sessionId: string;
  provider: string;
  requestedProvider: string;
  browserExecutablePath?: string;
  headless: boolean;
  createdAt: string;
  activeTabId: string;
  tabs: Map<string, BrowserTabRecord>;
  warnings: BrowserTaskWarning[];
}

export interface BrowserTaskRunResult {
  success: boolean;
  errorMessage?: string;
  sessionId: string;
  provider: string;
  requestedProvider: string;
  snapshots: BrowserPageSnapshot[];
  finalSnapshot?: BrowserPageSnapshot;
  executedSteps: RpaExecutedStep[];
  recoveryAttempts: RpaRecoveryAttempt[];
  warnings: BrowserTaskWarning[];
  extractedValues: Record<string, any>;
}
