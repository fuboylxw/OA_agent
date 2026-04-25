import type { BrowserSnapshotElement } from '@uniflow/shared-types';
import { z } from 'zod';
import type { InferenceLlmClient, InferenceTraceContext } from './system-inference';

const BrowserUploadLocatorSchema = z.object({
  canResolve: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  candidateId: z.string().optional(),
  signals: z.array(z.string()).default([]),
});

export interface BrowserUploadLocatorCandidate {
  candidateId: string;
  scopeDescription?: string;
  scopeUrl?: string;
  requestFieldName?: string;
  inputName?: string;
  inputId?: string;
  directMeta?: string;
  nearbyText?: string;
  fileInputCountInScope?: number;
}

export interface BrowserUploadLocatorInput {
  element?: Pick<BrowserSnapshotElement, 'ref' | 'fieldKey' | 'label' | 'text' | 'targetHints'> | null;
  labels?: string[] | null;
  candidates?: BrowserUploadLocatorCandidate[] | null;
  preferredFrameUrl?: string | null;
  trace?: InferenceTraceContext;
}

export interface BrowserUploadLocatorJudgement {
  canResolve: boolean;
  matchedCandidateId?: string;
  confidence: number;
  reasoning: string[];
  source: 'heuristic' | 'llm' | 'mixed';
  llmSucceeded: boolean;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface ScoredUploadCandidate {
  candidate: BrowserUploadLocatorCandidate;
  score: number;
  reasons: string[];
}

export class BrowserUploadLocatorInferenceEngine {
  private readonly llmClient: InferenceLlmClient | null;

  constructor(llmClient: InferenceLlmClient | null = BrowserUploadLocatorInferenceEngine.createDefaultClient()) {
    this.llmClient = llmClient;
  }

  async infer(input: BrowserUploadLocatorInput): Promise<BrowserUploadLocatorJudgement> {
    const heuristic = inferBrowserUploadLocatorHeuristically(input);
    const llm = await this.tryInferWithLLM(input, heuristic);
    if (!llm) {
      return heuristic;
    }
    return this.mergeJudgements(input, heuristic, llm);
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

  private async tryInferWithLLM(
    input: BrowserUploadLocatorInput,
    heuristic: BrowserUploadLocatorJudgement,
  ): Promise<(z.infer<typeof BrowserUploadLocatorSchema> & { model?: string; usage?: BrowserUploadLocatorJudgement['usage'] }) | null> {
    if (!this.llmClient) {
      return null;
    }

    const candidates = collectUploadCandidates(input, 20);
    if (candidates.length === 0) {
      return null;
    }

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            'You are a browser upload-target inference engine for enterprise workflow automation.',
            'Select at most one existing file-input candidate that best matches the requested upload field.',
            'Choose only from the provided candidateId values. Do not invent selectors or steps.',
            'Be conservative: return canResolve=false when evidence is weak or ambiguous.',
            'Return JSON only.',
            JSON.stringify({
              canResolve: true,
              confidence: 0.78,
              reason: 'why this upload candidate matches the requested field',
              candidateId: 'scope-1:0',
              signals: ['short evidence bullets'],
            }),
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify(buildLlmEvidence(input, heuristic, candidates), null, 2),
        },
      ], {
        trace: {
          scope: input.trace?.scope || 'compat.browser_upload_locator',
          traceId: input.trace?.traceId,
          tenantId: input.trace?.tenantId,
          userId: input.trace?.userId,
          tags: input.trace?.tags,
          metadata: {
            ...(input.trace?.metadata || {}),
            evidenceType: 'browser_upload_locator',
          },
        },
      });

      if (!response.content) {
        return null;
      }

      const parsed = parseJsonFromText(response.content);
      const validated = BrowserUploadLocatorSchema.parse(parsed);
      return {
        ...validated,
        model: response.model,
        usage: response.usage,
      };
    } catch {
      return null;
    }
  }

  private mergeJudgements(
    input: BrowserUploadLocatorInput,
    heuristic: BrowserUploadLocatorJudgement,
    llm: z.infer<typeof BrowserUploadLocatorSchema> & { model?: string; usage?: BrowserUploadLocatorJudgement['usage'] },
  ): BrowserUploadLocatorJudgement {
    const reasoning = dedupeStrings([...heuristic.reasoning, ...llm.signals, llm.reason]);
    const llmCandidate = (input.candidates || []).find((candidate) => candidate.candidateId === llm.candidateId);

    if (!llm.canResolve || !llmCandidate) {
      if (heuristic.canResolve) {
        return {
          ...heuristic,
          source: 'mixed',
          confidence: Math.max(heuristic.confidence, llm.confidence),
          reasoning,
          llmSucceeded: true,
          model: llm.model,
          usage: llm.usage,
        };
      }

      return {
        ...heuristic,
        source: 'llm',
        confidence: Math.max(heuristic.confidence, llm.confidence),
        reasoning,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    if (!heuristic.canResolve) {
      if (llm.confidence >= 0.72) {
        return {
          canResolve: true,
          matchedCandidateId: llmCandidate.candidateId,
          confidence: llm.confidence,
          reasoning,
          source: 'llm',
          llmSucceeded: true,
          model: llm.model,
          usage: llm.usage,
        };
      }

      return {
        ...heuristic,
        source: 'mixed',
        confidence: Math.max(heuristic.confidence, llm.confidence),
        reasoning,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    if (heuristic.matchedCandidateId === llmCandidate.candidateId) {
      return {
        ...heuristic,
        source: 'mixed',
        confidence: Math.max(heuristic.confidence, llm.confidence),
        reasoning,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    if (llm.confidence >= Math.max(0.82, heuristic.confidence + 0.08)) {
      return {
        canResolve: true,
        matchedCandidateId: llmCandidate.candidateId,
        confidence: llm.confidence,
        reasoning,
        source: 'mixed',
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    return {
      ...heuristic,
      source: 'mixed',
      confidence: Math.max(heuristic.confidence, llm.confidence),
      reasoning,
      llmSucceeded: true,
      model: llm.model,
      usage: llm.usage,
    };
  }
}

export function inferBrowserUploadLocatorHeuristically(
  input: BrowserUploadLocatorInput,
): BrowserUploadLocatorJudgement {
  const candidates = collectUploadCandidates(input);
  const best = candidates[0];
  if (!best || best.score < 0.9) {
    return {
      canResolve: false,
      confidence: best ? Math.min(0.66, best.score) : 0.2,
      matchedCandidateId: undefined,
      reasoning: best
        ? [`存在候选上传控件 ${best.candidate.candidateId}，但没有精确协议键可确认：${best.reasons.join('；')}`]
        : ['当前页面没有可确定的上传控件候选，无法安全定位上传入口'],
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  return {
    canResolve: true,
    matchedCandidateId: best.candidate.candidateId,
    confidence: clamp(best.score, 0, 0.99),
    reasoning: dedupeStrings(best.reasons),
    source: 'heuristic',
    llmSucceeded: false,
  };
}

function collectUploadCandidates(input: BrowserUploadLocatorInput, limit = 12) {
  const scored = (input.candidates || [])
    .map((candidate) => scoreUploadCandidate(input, candidate))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
  return scored;
}

function scoreUploadCandidate(
  input: BrowserUploadLocatorInput,
  candidate: BrowserUploadLocatorCandidate,
): ScoredUploadCandidate {
  const reasons: string[] = [];
  let score = 0;

  const requestedTexts = dedupeStrings([
    input.element?.fieldKey || '',
    ...((input.element?.targetHints || []).flatMap((hint) => [hint.value || ''])),
  ]).map(normalizeText).filter(Boolean);

  const normalizedFieldKey = normalizeText(input.element?.fieldKey);
  const preferredFrameUrl = normalizeText(input.preferredFrameUrl);
  const candidateFrameUrl = normalizeText(candidate.scopeUrl);
  const directMeta = normalizeText([
    candidate.requestFieldName,
    candidate.inputName,
    candidate.inputId,
    candidate.directMeta,
  ].filter(Boolean).join(' '));

  if (preferredFrameUrl && candidateFrameUrl && preferredFrameUrl === candidateFrameUrl) {
    score += 0.26;
    reasons.push('候选上传控件位于当前活跃 frame 内');
  }

  if (normalizedFieldKey) {
    if (normalizeText(candidate.requestFieldName) === normalizedFieldKey) {
      score += 0.9;
      reasons.push('上传控件请求字段名与目标 fieldKey 完全一致');
    }
  }

  for (const requestedText of requestedTexts) {
    if (!requestedText) {
      continue;
    }

    if (directMeta && directMeta === requestedText) {
      score += 0.9;
      reasons.push(`上传控件元信息与协议键“${requestedText}”完全一致`);
      break;
    }
  }

  if (candidate.fileInputCountInScope === 1 && score > 0) {
    score += 0.08;
    reasons.push('当前作用域内只有一个 file input，可作为弱证据');
  }

  return {
    candidate,
    score: Math.max(0, score),
    reasons: dedupeStrings(reasons),
  };
}

function buildLlmEvidence(
  input: BrowserUploadLocatorInput,
  heuristic: BrowserUploadLocatorJudgement,
  candidates: ScoredUploadCandidate[],
) {
  return {
    requestedUploadField: {
      ref: input.element?.ref,
      fieldKey: input.element?.fieldKey,
      label: input.element?.label,
      text: input.element?.text,
      targetHints: input.element?.targetHints,
      labels: input.labels || [],
      preferredFrameUrl: input.preferredFrameUrl,
    },
    heuristic: {
      canResolve: heuristic.canResolve,
      confidence: heuristic.confidence,
      matchedCandidateId: heuristic.matchedCandidateId,
      reasoning: heuristic.reasoning,
    },
    candidates: candidates.map((entry) => ({
      candidateId: entry.candidate.candidateId,
      scopeDescription: entry.candidate.scopeDescription,
      scopeUrl: entry.candidate.scopeUrl,
      requestFieldName: entry.candidate.requestFieldName,
      inputName: entry.candidate.inputName,
      inputId: entry.candidate.inputId,
      directMeta: entry.candidate.directMeta,
      nearbyText: entry.candidate.nearbyText,
      fileInputCountInScope: entry.candidate.fileInputCountInScope,
      heuristicScore: Number(clamp(entry.score, 0, 0.99).toFixed(2)),
      heuristicReasons: entry.reasons.slice(0, 4),
    })),
  };
}

function parseJsonFromText(value: string) {
  const trimmed = String(value || '').trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fencedMatch ? fencedMatch[1] : trimmed;
  return JSON.parse(raw);
}

function dedupeStrings(values: string[]) {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}
