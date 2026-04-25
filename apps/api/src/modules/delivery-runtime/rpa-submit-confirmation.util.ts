import {
  RuntimeJudgementEngine,
  inferSubmitOutcomeHeuristically,
  normalizeExternalSubmissionId as normalizeExternalSubmissionIdShared,
} from '@uniflow/compat-engine';
import type {
  BrowserPageSnapshot,
  RpaActionDefinition,
} from '@uniflow/shared-types';

const runtimeJudgementEngine = new RuntimeJudgementEngine();

export interface SubmitConfirmationInput {
  actionDefinition?: RpaActionDefinition;
  extractedValues?: Record<string, any>;
  finalSnapshot?: BrowserPageSnapshot;
  fallbackMessage?: string;
}

export interface SubmitConfirmationResult {
  confirmed: boolean;
  submissionId?: string;
  message?: string;
  failureReason?: string;
  matchedSuccessAssert: boolean;
  matchedSuccessText: boolean;
  matchedDraftSignal: boolean;
  matchedSignals: string[];
  source?: 'heuristic' | 'llm' | 'mixed';
  confidence?: number;
  llmSucceeded?: boolean;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export function confirmRpaSubmit(input: SubmitConfirmationInput): SubmitConfirmationResult {
  return inferSubmitOutcomeHeuristically(input);
}

export async function confirmRpaSubmitIntelligently(
  input: SubmitConfirmationInput,
  engine = runtimeJudgementEngine,
): Promise<SubmitConfirmationResult> {
  return engine.interpretSubmitOutcome(input);
}

export function normalizeExternalSubmissionId(value: unknown): string | undefined {
  return normalizeExternalSubmissionIdShared(value);
}
