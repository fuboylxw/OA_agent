import type {
  BrowserPageSnapshot,
  RpaAssertionDefinition,
} from '@uniflow/shared-types';
import { z } from 'zod';
import type { InferenceLlmClient, InferenceTraceContext } from './system-inference';

export type RuntimeSubmitOutcome = 'submitted' | 'draft' | 'failed' | 'unknown';
export type RuntimeMappedStatus = 'draft_saved' | 'pending' | 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'failed';

const SUBMISSION_ID_KEYS = [
  'submissionId',
  'submission_id',
  'billNo',
  'billNO',
  'applyNo',
  'apply_no',
  'requestId',
  'request_id',
] as const;

const INTERNAL_SUBMISSION_ID_PATTERNS = [
  /^vision[-_]/i,
  /^rpa[-_]/i,
  /^rpa-browser[-_]/i,
] as const;

const STATUS_LABELS: RuntimeMappedStatus[] = [
  'draft_saved',
  'pending',
  'submitted',
  'approved',
  'rejected',
  'cancelled',
  'failed',
];

const ExternalStatusInterpretationSchema = z.object({
  mappedStatus: z.enum(STATUS_LABELS as [RuntimeMappedStatus, ...RuntimeMappedStatus[]]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  signals: z.array(z.string()).default([]),
});

const SubmitOutcomeInterpretationSchema = z.object({
  outcome: z.enum(['submitted', 'draft', 'failed', 'unknown']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  submissionId: z.string().optional(),
  message: z.string().optional(),
  signals: z.array(z.string()).default([]),
});

export interface RuntimeStatusEvidenceInput {
  externalStatus?: string | null;
  fallbackStatus: string;
  eventType?: string | null;
  payload?: Record<string, any> | null;
  statusDetail?: Record<string, any> | null;
  source?: 'status_poll' | 'webhook' | 'unknown';
  trace?: InferenceTraceContext;
}

export interface RuntimeStatusJudgement {
  mappedStatus: string;
  source: 'heuristic' | 'llm' | 'mixed';
  confidence: number;
  reasoning: string[];
  llmSucceeded: boolean;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface RuntimeSubmitEvidenceInput {
  actionDefinition?: {
    successAssert?: RpaAssertionDefinition;
    resultMapping?: {
      submissionIdPath?: string;
      messagePath?: string;
    };
  };
  extractedValues?: Record<string, any>;
  finalSnapshot?: BrowserPageSnapshot;
  fallbackMessage?: string;
  trace?: InferenceTraceContext;
}

export interface RuntimeSubmitJudgement {
  outcome: RuntimeSubmitOutcome;
  confirmed: boolean;
  submissionId?: string;
  message?: string;
  failureReason?: string;
  matchedSuccessAssert: boolean;
  matchedSuccessText: boolean;
  matchedDraftSignal: boolean;
  matchedSignals: string[];
  source: 'heuristic' | 'llm' | 'mixed';
  confidence: number;
  llmSucceeded: boolean;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class RuntimeJudgementEngine {
  private readonly llmClient: InferenceLlmClient | null;

  constructor(llmClient: InferenceLlmClient | null = RuntimeJudgementEngine.createDefaultClient()) {
    this.llmClient = llmClient;
  }

  async interpretSubmitOutcome(input: RuntimeSubmitEvidenceInput): Promise<RuntimeSubmitJudgement> {
    const heuristic = inferSubmitOutcomeHeuristically(input);
    const llm = await this.tryInterpretSubmitOutcomeWithLLM(input, heuristic);
    if (!llm) {
      return heuristic;
    }
    return this.mergeSubmitJudgements(heuristic, llm);
  }

  async interpretExternalStatus(input: RuntimeStatusEvidenceInput): Promise<RuntimeStatusJudgement> {
    const heuristic = inferExternalStatusHeuristically(input);
    const llm = await this.tryInterpretExternalStatusWithLLM(input, heuristic);
    if (!llm) {
      return heuristic;
    }
    return this.mergeStatusJudgements(heuristic, llm, input.fallbackStatus);
  }

  private static createDefaultClient(): InferenceLlmClient | null {
    try {
      const hasExplicitApiKey = Boolean(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY);
      const hasCustomEndpoint = Boolean(process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || process.env.LLM_PROVIDER === 'ollama');
      if (!hasExplicitApiKey && !hasCustomEndpoint) {
        return null;
      }

      const agentKernel = require('@uniflow/agent-kernel') as {
        LLMClientFactory?: {
          createFromEnv?: () => InferenceLlmClient;
        };
      };
      return agentKernel.LLMClientFactory?.createFromEnv?.() || null;
    } catch {
      return null;
    }
  }

  private async tryInterpretSubmitOutcomeWithLLM(
    input: RuntimeSubmitEvidenceInput,
    heuristic: RuntimeSubmitJudgement,
  ): Promise<(z.infer<typeof SubmitOutcomeInterpretationSchema> & { model?: string; usage?: RuntimeSubmitJudgement['usage'] }) | null> {
    if (!this.llmClient) {
      return null;
    }

    const evidence = buildSubmitEvidenceSummary(input, heuristic);
    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            'You are a runtime judge for enterprise workflow submission results.',
            'Your task is to decide whether the evidence means: real submitted, only saved as draft, failed, or still unknown.',
            'Be conservative: draft beats generic success text; a real external submission id is strong evidence of real submission.',
            'Return JSON only.',
            JSON.stringify({
              outcome: 'submitted|draft|failed|unknown',
              confidence: 0.5,
              reason: 'why',
              submissionId: 'optional real external id',
              message: 'optional user-facing message',
              signals: ['short evidence bullets'],
            }),
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify(evidence, null, 2),
        },
      ], {
        trace: {
          scope: input.trace?.scope || 'compat.runtime_judgement.submit',
          traceId: input.trace?.traceId,
          tenantId: input.trace?.tenantId,
          userId: input.trace?.userId,
          tags: input.trace?.tags,
          metadata: {
            ...(input.trace?.metadata || {}),
            evidenceType: 'submit_outcome',
          },
        },
      });
      if (!response.content) {
        return null;
      }
      const parsed = parseJsonFromText(response.content);
      const validated = SubmitOutcomeInterpretationSchema.parse(parsed);
      return {
        ...validated,
        model: response.model,
        usage: response.usage,
      };
    } catch {
      return null;
    }
  }

  private async tryInterpretExternalStatusWithLLM(
    input: RuntimeStatusEvidenceInput,
    heuristic: RuntimeStatusJudgement,
  ): Promise<(z.infer<typeof ExternalStatusInterpretationSchema> & { model?: string; usage?: RuntimeStatusJudgement['usage'] }) | null> {
    if (!this.llmClient) {
      return null;
    }

    const evidence = buildStatusEvidenceSummary(input, heuristic);
    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            'You are a runtime judge for external workflow statuses.',
            'Map external status evidence into one internal platform status.',
            'Allowed values: draft_saved, pending, submitted, approved, rejected, cancelled, failed.',
            'Be conservative and prefer terminal states only when the evidence is explicit.',
            'Return JSON only.',
            JSON.stringify({
              mappedStatus: 'submitted',
              confidence: 0.5,
              reason: 'why',
              signals: ['short evidence bullets'],
            }),
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify(evidence, null, 2),
        },
      ], {
        trace: {
          scope: input.trace?.scope || 'compat.runtime_judgement.status',
          traceId: input.trace?.traceId,
          tenantId: input.trace?.tenantId,
          userId: input.trace?.userId,
          tags: input.trace?.tags,
          metadata: {
            ...(input.trace?.metadata || {}),
            evidenceType: 'external_status',
          },
        },
      });
      if (!response.content) {
        return null;
      }
      const parsed = parseJsonFromText(response.content);
      const validated = ExternalStatusInterpretationSchema.parse(parsed);
      return {
        ...validated,
        model: response.model,
        usage: response.usage,
      };
    } catch {
      return null;
    }
  }

  private mergeSubmitJudgements(
    heuristic: RuntimeSubmitJudgement,
    llm: z.infer<typeof SubmitOutcomeInterpretationSchema> & { model?: string; usage?: RuntimeSubmitJudgement['usage'] },
  ): RuntimeSubmitJudgement {
    const normalizedSubmissionId = normalizeExternalSubmissionId(llm.submissionId) || heuristic.submissionId;
    const mergedSignals = dedupeStrings([...heuristic.matchedSignals, ...llm.signals]);

    if (heuristic.matchedDraftSignal) {
      return {
        ...heuristic,
        matchedSignals: mergedSignals,
        source: 'mixed',
        confidence: Math.max(heuristic.confidence, llm.confidence),
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    if (heuristic.confirmed && heuristic.submissionId) {
      return {
        ...heuristic,
        matchedSignals: mergedSignals,
        source: 'mixed',
        confidence: Math.max(heuristic.confidence, llm.confidence),
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    if (heuristic.outcome === 'unknown') {
      return buildSubmitJudgementFromOutcome({
        outcome: llm.outcome,
        submissionId: normalizedSubmissionId,
        message: llm.message || heuristic.message,
        matchedSuccessAssert: heuristic.matchedSuccessAssert,
        matchedSuccessText: heuristic.matchedSuccessText,
        matchedDraftSignal: heuristic.matchedDraftSignal,
        matchedSignals: mergedSignals,
        source: 'llm',
        confidence: llm.confidence,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      });
    }

    if (heuristic.confirmed && !heuristic.submissionId && (llm.outcome === 'draft' || llm.outcome === 'failed') && llm.confidence >= 0.7) {
      return buildSubmitJudgementFromOutcome({
        outcome: llm.outcome,
        submissionId: normalizedSubmissionId,
        message: llm.message || heuristic.message,
        matchedSuccessAssert: heuristic.matchedSuccessAssert,
        matchedSuccessText: heuristic.matchedSuccessText,
        matchedDraftSignal: llm.outcome === 'draft' || heuristic.matchedDraftSignal,
        matchedSignals: mergedSignals,
        source: 'mixed',
        confidence: llm.confidence,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      });
    }

    if (heuristic.outcome === 'failed' && llm.outcome === 'submitted' && llm.confidence >= 0.85 && normalizedSubmissionId) {
      return buildSubmitJudgementFromOutcome({
        outcome: 'submitted',
        submissionId: normalizedSubmissionId,
        message: llm.message || heuristic.message,
        matchedSuccessAssert: heuristic.matchedSuccessAssert,
        matchedSuccessText: true,
        matchedDraftSignal: false,
        matchedSignals: mergedSignals,
        source: 'mixed',
        confidence: llm.confidence,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      });
    }

    return {
      ...heuristic,
      matchedSignals: mergedSignals,
      source: 'mixed',
      confidence: Math.max(heuristic.confidence, llm.confidence),
      llmSucceeded: true,
      model: llm.model,
      usage: llm.usage,
    };
  }

  private mergeStatusJudgements(
    heuristic: RuntimeStatusJudgement,
    llm: z.infer<typeof ExternalStatusInterpretationSchema> & { model?: string; usage?: RuntimeStatusJudgement['usage'] },
    fallbackStatus: string,
  ): RuntimeStatusJudgement {
    const mergedReasoning = dedupeStrings([...heuristic.reasoning, ...llm.signals, llm.reason]);
    const heuristicIsTerminal = isTerminalStatus(heuristic.mappedStatus);
    const llmIsTerminal = isTerminalStatus(llm.mappedStatus);

    if (heuristic.mappedStatus === fallbackStatus && llm.mappedStatus !== fallbackStatus) {
      return {
        mappedStatus: llm.mappedStatus,
        source: 'llm',
        confidence: llm.confidence,
        reasoning: mergedReasoning,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    if (!heuristicIsTerminal && llmIsTerminal && llm.confidence >= 0.72) {
      return {
        mappedStatus: llm.mappedStatus,
        source: 'mixed',
        confidence: llm.confidence,
        reasoning: mergedReasoning,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    if (heuristic.mappedStatus === 'submitted' && llm.mappedStatus === 'approved' && llm.confidence >= 0.72) {
      return {
        mappedStatus: llm.mappedStatus,
        source: 'mixed',
        confidence: llm.confidence,
        reasoning: mergedReasoning,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    return {
      ...heuristic,
      source: 'mixed',
      confidence: Math.max(heuristic.confidence, llm.confidence),
      reasoning: mergedReasoning,
      llmSucceeded: true,
      model: llm.model,
      usage: llm.usage,
    };
  }
}

export function inferSubmitOutcomeHeuristically(input: RuntimeSubmitEvidenceInput): RuntimeSubmitJudgement {
  const extractedValues = input.extractedValues || {};
  const submissionId = resolveSubmissionId(input.actionDefinition, extractedValues);
  const message = resolveMessage(input.actionDefinition, extractedValues) || input.fallbackMessage;
  const matchedSignals: string[] = [];

  const successAssertMatched = matchesSuccessAssert(
    input.actionDefinition?.successAssert,
    extractedValues,
    input.finalSnapshot,
    [
      ...collectSnapshotTexts(input.finalSnapshot),
      ...collectPrimitiveStrings(extractedValues),
      input.fallbackMessage,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
  );
  if (successAssertMatched && input.actionDefinition?.successAssert?.value) {
    matchedSignals.push(String(input.actionDefinition.successAssert.value));
  }

  if (submissionId || successAssertMatched) {
    return buildSubmitJudgementFromOutcome({
      outcome: 'submitted',
      submissionId,
      message,
      matchedSuccessAssert: successAssertMatched,
      matchedSuccessText: false,
      matchedDraftSignal: false,
      matchedSignals,
      source: 'heuristic',
      confidence: submissionId ? 0.93 : 0.72,
      llmSucceeded: false,
    });
  }

  return buildSubmitJudgementFromOutcome({
    outcome: 'unknown',
    submissionId,
    message,
    matchedSuccessAssert: successAssertMatched,
    matchedSuccessText: false,
    matchedDraftSignal: false,
    matchedSignals,
    source: 'heuristic',
    confidence: 0.28,
    llmSucceeded: false,
  });
}

export function inferExternalStatusHeuristically(input: RuntimeStatusEvidenceInput): RuntimeStatusJudgement {
  const normalizedStatus = String(input.externalStatus || '').trim().toLowerCase();
  const reasoning: string[] = [];

  const pushReason = (reason: string) => {
    if (!reasoning.includes(reason)) {
      reasoning.push(reason);
    }
  };

  if (!normalizedStatus) {
    pushReason('No explicit external status; using fallback status');
    return {
      mappedStatus: input.fallbackStatus,
      source: 'heuristic',
      confidence: 0.2,
      reasoning,
      llmSucceeded: false,
    };
  }

  const exactStatusMap: Record<string, RuntimeMappedStatus> = {
    failed: 'failed',
    failure: 'failed',
    error: 'failed',
    timeout: 'failed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    revoked: 'cancelled',
    terminated: 'cancelled',
    rejected: 'rejected',
    reject: 'rejected',
    denied: 'rejected',
    refused: 'rejected',
    approved: 'approved',
    approve: 'approved',
    completed: 'approved',
    complete: 'approved',
    pending: 'submitted',
    submitted: 'submitted',
    processing: 'submitted',
    in_progress: 'submitted',
    draft: 'draft_saved',
    draft_saved: 'draft_saved',
  };

  const exactMappedStatus = exactStatusMap[normalizedStatus];
  if (exactMappedStatus) {
    pushReason(`Mapped explicit external status literal "${normalizedStatus}"`);
    return {
      mappedStatus: exactMappedStatus,
      source: 'heuristic',
      confidence: 0.9,
      reasoning,
      llmSucceeded: false,
    };
  }

  pushReason('Could not confidently map external status; using fallback status');
  return {
    mappedStatus: input.fallbackStatus,
    source: 'heuristic',
    confidence: 0.3,
    reasoning,
    llmSucceeded: false,
  };
}

export function normalizeExternalSubmissionId(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = typeof value === 'string'
    ? value.trim()
    : (typeof value === 'number' || typeof value === 'bigint')
      ? String(value)
      : '';

  if (!normalized) {
    return undefined;
  }

  if (INTERNAL_SUBMISSION_ID_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return undefined;
  }

  return normalized;
}

function buildSubmitJudgementFromOutcome(input: {
  outcome: RuntimeSubmitOutcome;
  submissionId?: string;
  message?: string;
  matchedSuccessAssert: boolean;
  matchedSuccessText: boolean;
  matchedDraftSignal: boolean;
  matchedSignals: string[];
  source: 'heuristic' | 'llm' | 'mixed';
  confidence: number;
  llmSucceeded: boolean;
  model?: string;
  usage?: RuntimeSubmitJudgement['usage'];
}): RuntimeSubmitJudgement {
  if (input.outcome === 'submitted') {
    return {
      outcome: 'submitted',
      confirmed: true,
      submissionId: input.submissionId,
      message: input.message,
      matchedSuccessAssert: input.matchedSuccessAssert,
      matchedSuccessText: input.matchedSuccessText,
      matchedDraftSignal: false,
      matchedSignals: dedupeStrings(input.matchedSignals),
      source: input.source,
      confidence: input.confidence,
      llmSucceeded: input.llmSucceeded,
      model: input.model,
      usage: input.usage,
    };
  }

  return {
    outcome: input.outcome,
    confirmed: false,
    submissionId: input.submissionId,
    message: input.message,
    failureReason: input.outcome === 'draft'
      ? 'RPA 仅完成了保存待发/草稿动作，未真正送审到 OA 审批流'
      : input.outcome === 'failed'
        ? 'RPA 执行结束，但识别到失败或异常信号'
        : 'RPA 执行结束，但未识别到真实提交成功信号',
    matchedSuccessAssert: input.matchedSuccessAssert,
    matchedSuccessText: input.matchedSuccessText,
    matchedDraftSignal: input.matchedDraftSignal,
    matchedSignals: dedupeStrings(input.matchedSignals),
    source: input.source,
    confidence: input.confidence,
    llmSucceeded: input.llmSucceeded,
    model: input.model,
    usage: input.usage,
  };
}

function buildSubmitEvidenceSummary(input: RuntimeSubmitEvidenceInput, heuristic: RuntimeSubmitJudgement) {
  return {
    baseline: {
      outcome: heuristic.outcome,
      confirmed: heuristic.confirmed,
      submissionId: heuristic.submissionId || null,
      confidence: heuristic.confidence,
      matchedSignals: heuristic.matchedSignals,
      matchedDraftSignal: heuristic.matchedDraftSignal,
      matchedSuccessAssert: heuristic.matchedSuccessAssert,
      matchedSuccessText: heuristic.matchedSuccessText,
      failureReason: heuristic.failureReason || null,
    },
    actionDefinition: {
      successAssert: input.actionDefinition?.successAssert || null,
      resultMapping: input.actionDefinition?.resultMapping || null,
    },
    extractedValues: sanitizeEvidenceRecord(input.extractedValues || {}),
    finalSnapshot: summarizeSnapshot(input.finalSnapshot),
    fallbackMessage: input.fallbackMessage || null,
  };
}

function buildStatusEvidenceSummary(input: RuntimeStatusEvidenceInput, heuristic: RuntimeStatusJudgement) {
  return {
    baseline: {
      mappedStatus: heuristic.mappedStatus,
      confidence: heuristic.confidence,
      reasoning: heuristic.reasoning,
    },
    source: input.source || 'unknown',
    externalStatus: input.externalStatus || null,
    eventType: input.eventType || null,
    fallbackStatus: input.fallbackStatus,
    payload: sanitizeEvidenceRecord(input.payload || {}),
    statusDetail: sanitizeEvidenceRecord(input.statusDetail || {}),
  };
}

function summarizeSnapshot(snapshot: BrowserPageSnapshot | undefined) {
  if (!snapshot) {
    return null;
  }

  return {
    title: snapshot.title,
    url: snapshot.url,
    importantTexts: snapshot.importantTexts || [],
    structuredText: snapshot.structuredText || null,
    dialogs: (snapshot.dialogs || []).map((dialog) => ({
      title: dialog.title,
      summary: dialog.summary,
    })),
    interactiveElements: (snapshot.interactiveElements || []).slice(0, 20).map((element) => ({
      text: element.text,
      selector: element.selector,
      role: element.role,
    })),
  };
}

function sanitizeEvidenceRecord(record: Record<string, any>) {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (/(password|token|secret|cookie|authorization)/i.test(key)) {
      result[key] = '[redacted]';
      continue;
    }

    if (typeof value === 'string') {
      result[key] = value.length > 500 ? `${value.slice(0, 500)}...<truncated>` : value;
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value.slice(0, 20).map((item) => stringifySafely(item).slice(0, 200));
      continue;
    }

    if (value && typeof value === 'object') {
      result[key] = stringifySafely(value).slice(0, 800);
      continue;
    }

    result[key] = value;
  }
  return result;
}

function resolveSubmissionId(
  actionDefinition: RuntimeSubmitEvidenceInput['actionDefinition'],
  extractedValues: Record<string, any>,
) {
  const mapped = readMappedValue(extractedValues, actionDefinition?.resultMapping?.submissionIdPath);
  if (mapped !== undefined && mapped !== null) {
    return normalizeExternalSubmissionId(mapped);
  }

  for (const key of SUBMISSION_ID_KEYS) {
    if (Object.prototype.hasOwnProperty.call(extractedValues, key)) {
      const normalized = normalizeExternalSubmissionId(extractedValues[key]);
      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

function resolveMessage(
  actionDefinition: RuntimeSubmitEvidenceInput['actionDefinition'],
  extractedValues: Record<string, any>,
) {
  const mapped = coerceString(readMappedValue(extractedValues, actionDefinition?.resultMapping?.messagePath));
  if (mapped) {
    return mapped;
  }

  for (const key of ['message', 'tip', 'notice']) {
    if (Object.prototype.hasOwnProperty.call(extractedValues, key)) {
      const value = coerceString(extractedValues[key]);
      if (value) {
        return value;
      }
    }
  }

  return undefined;
}

function matchesSuccessAssert(
  assertion: RpaAssertionDefinition | undefined,
  extractedValues: Record<string, any>,
  snapshot: BrowserPageSnapshot | undefined,
  candidateTexts: string[],
) {
  if (!assertion || !assertion.value) {
    return false;
  }

  const expected = normalizeText(assertion.value);
  if (!expected) {
    return false;
  }

  if (assertion.type === 'selector') {
    const selector = assertion.selector || assertion.value;
    const normalizedSelector = normalizeText(selector);
    return (snapshot?.interactiveElements || []).some((element) =>
      normalizeText(element.selector).includes(normalizedSelector),
    );
  }

  if (assertion.type === 'status_field') {
    const statusCandidates = [
      extractedValues.status,
      extractedValues.statusText,
      extractedValues.currentStatus,
      extractedValues.current_status,
    ]
      .map((value) => coerceString(value))
      .filter((value): value is string => Boolean(value));

    return statusCandidates.some((value) => normalizeText(value).includes(expected));
  }

  return candidateTexts.some((value) => normalizeText(value).includes(expected));
}

function collectSnapshotTexts(snapshot: BrowserPageSnapshot | undefined) {
  if (!snapshot) {
    return [] as string[];
  }

  const texts = [
    snapshot.title,
    snapshot.structuredText,
    ...(snapshot.importantTexts || []),
  ];

  for (const dialog of snapshot.dialogs || []) {
    texts.push(...[dialog.title, dialog.summary].filter((value): value is string => typeof value === 'string'));
  }

  for (const element of snapshot.interactiveElements || []) {
    texts.push(...[element.text, element.selector].filter((value): value is string => typeof value === 'string'));
  }

  return texts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function collectPrimitiveStrings(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    return [value];
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPrimitiveStrings(item));
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, any>).flatMap((item) => collectPrimitiveStrings(item));
  }

  return [];
}

function readMappedValue(values: Record<string, any>, path: string | undefined) {
  if (!path) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(values, path)) {
    return values[path];
  }

  return path.split('.').reduce<any>((current, key) => current?.[key], values);
}

function coerceString(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return typeof value === 'string' ? value : String(value);
}

function normalizeText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))];
}

function stringifySafely(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isTerminalStatus(status: string) {
  return ['approved', 'rejected', 'cancelled', 'failed'].includes(String(status || '').trim().toLowerCase());
}

function parseJsonFromText(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  const candidateTexts = [fencedMatch?.[1], text].filter((value): value is string => !!value);
  for (const candidate of candidateTexts) {
    try {
      return JSON.parse(candidate.trim());
    } catch {
      const firstBrace = candidate.indexOf('{');
      const lastBrace = candidate.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
        } catch {
          // continue
        }
      }
    }
  }
  throw new Error('LLM did not return valid JSON');
}
