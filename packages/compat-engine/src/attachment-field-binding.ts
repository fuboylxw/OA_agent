import { z } from 'zod';
import type { InferenceLlmClient, InferenceTraceContext } from './system-inference';

const AttachmentFieldBindingSchema = z.object({
  canResolve: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  fieldKey: z.string().optional(),
  signals: z.array(z.string()).default([]),
});

export interface AttachmentFieldBindingCandidate {
  fieldKey: string;
  label: string;
  description?: string;
  example?: string;
  required?: boolean;
  missing?: boolean;
  multiple?: boolean;
  currentAttachmentCount?: number;
}

export interface AttachmentFieldBindingInput {
  userMessage?: string | null;
  attachment: {
    fileName?: string | null;
    mimeType?: string | null;
  };
  candidates?: AttachmentFieldBindingCandidate[] | null;
  trace?: InferenceTraceContext;
}

export interface AttachmentFieldBindingJudgement {
  canResolve: boolean;
  matchedFieldKey?: string;
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

interface ScoredAttachmentFieldCandidate {
  candidate: AttachmentFieldBindingCandidate;
  score: number;
  reasons: string[];
  deterministic: boolean;
}

export class AttachmentFieldBindingInferenceEngine {
  private readonly llmClient: InferenceLlmClient | null;

  constructor(llmClient: InferenceLlmClient | null = AttachmentFieldBindingInferenceEngine.createDefaultClient()) {
    this.llmClient = llmClient;
  }

  async infer(input: AttachmentFieldBindingInput): Promise<AttachmentFieldBindingJudgement> {
    const heuristic = inferAttachmentFieldBindingHeuristically(input);
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
    input: AttachmentFieldBindingInput,
    heuristic: AttachmentFieldBindingJudgement,
  ): Promise<(z.infer<typeof AttachmentFieldBindingSchema> & { model?: string; usage?: AttachmentFieldBindingJudgement['usage'] }) | null> {
    if (!this.llmClient) {
      return null;
    }

    const candidates = collectAttachmentFieldCandidates(input, 20);
    if (candidates.length === 0) {
      return null;
    }

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            'You infer which existing file field should receive an uploaded attachment during workflow parameter collection.',
            'Choose at most one existing fieldKey from the provided candidates.',
            'Prefer the candidate whose label/description/example/user message best matches the attachment file name and current missing field context.',
            'Be conservative: if evidence is weak or ambiguous, return canResolve=false.',
            'Return JSON only.',
            JSON.stringify({
              canResolve: true,
              confidence: 0.84,
              reason: 'why this uploaded file best matches the target file field',
              fieldKey: 'invoice_attachment',
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
          scope: input.trace?.scope || 'compat.attachment_field_binding',
          traceId: input.trace?.traceId,
          tenantId: input.trace?.tenantId,
          userId: input.trace?.userId,
          tags: input.trace?.tags,
          metadata: {
            ...(input.trace?.metadata || {}),
            evidenceType: 'attachment_field_binding',
          },
        },
      });

      if (!response.content) {
        return null;
      }

      const parsed = parseJsonFromText(response.content);
      const validated = AttachmentFieldBindingSchema.parse(parsed);
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
    input: AttachmentFieldBindingInput,
    heuristic: AttachmentFieldBindingJudgement,
    llm: z.infer<typeof AttachmentFieldBindingSchema> & { model?: string; usage?: AttachmentFieldBindingJudgement['usage'] },
  ): AttachmentFieldBindingJudgement {
    const reasoning = dedupeStrings([...heuristic.reasoning, ...llm.signals, llm.reason]);
    const llmCandidate = (input.candidates || []).find((candidate) => candidate.fieldKey === llm.fieldKey);

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
          matchedFieldKey: llmCandidate.fieldKey,
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

    if (heuristic.matchedFieldKey === llmCandidate.fieldKey) {
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
        matchedFieldKey: llmCandidate.fieldKey,
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

export function inferAttachmentFieldBindingHeuristically(
  input: AttachmentFieldBindingInput,
): AttachmentFieldBindingJudgement {
  const candidates = collectAttachmentFieldCandidates(input);
  const best = candidates[0];

  if (!best) {
    return {
      canResolve: false,
      confidence: 0.2,
      reasoning: ['没有可用的文件字段候选，无法推断附件应绑定到哪个字段'],
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  if (candidates.length === 1) {
    return {
      canResolve: true,
      matchedFieldKey: best.candidate.fieldKey,
      confidence: Math.max(0.78, best.score),
      reasoning: dedupeStrings([
        `当前只有一个可绑定的文件字段 ${best.candidate.fieldKey}`,
        ...best.reasons,
      ]),
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  const missingCandidates = candidates.filter((candidate) => candidate.candidate.missing);
  if (missingCandidates.length === 1) {
    const match = missingCandidates[0];
    return {
      canResolve: true,
      matchedFieldKey: match.candidate.fieldKey,
      confidence: Math.max(0.74, match.score),
      reasoning: dedupeStrings([
        `当前只有一个缺失的文件字段 ${match.candidate.fieldKey}`,
        ...match.reasons,
      ]),
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  return {
    canResolve: false,
    confidence: Math.min(0.62, best.score),
    reasoning: dedupeStrings([
      '存在多个文件字段，但当前只有结构性信息，缺少唯一可确认的显式指向',
      best.reasons.length > 0
        ? `当前最接近的候选是 ${best.candidate.fieldKey}，但这些信号不足以单独决策：${best.reasons.join('；')}`
        : undefined,
    ]),
    source: 'heuristic',
    llmSucceeded: false,
  };
}

function collectAttachmentFieldCandidates(
  input: AttachmentFieldBindingInput,
  maxCount = 50,
): ScoredAttachmentFieldCandidate[] {
  return (input.candidates || [])
    .filter((candidate): candidate is AttachmentFieldBindingCandidate =>
      Boolean(candidate && typeof candidate === 'object' && String(candidate.fieldKey || '').trim()))
    .slice(0, maxCount)
    .map((candidate) => scoreCandidate(input, candidate))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return Number(Boolean(right.candidate.missing)) - Number(Boolean(left.candidate.missing));
    });
}

function scoreCandidate(
  input: AttachmentFieldBindingInput,
  candidate: AttachmentFieldBindingCandidate,
): ScoredAttachmentFieldCandidate {
  const reasons: string[] = [];
  let score = 0.08;

  if (candidate.missing) {
    score += 0.08;
    reasons.push('该字段当前仍缺失，优先级提升');
  }

  if (candidate.required) {
    score += 0.04;
    reasons.push('该字段为必填文件字段');
  }

  if ((candidate.currentAttachmentCount || 0) === 0) {
    score += 0.02;
    reasons.push('该字段当前还没有已绑定文件');
  }

  if (candidate.multiple) {
    score += 0.01;
    reasons.push('字段支持多附件，兼容性更高');
  }

  return {
    candidate,
    score: clamp(score, 0, 0.99),
    reasons,
    deterministic: false,
  };
}

function buildLlmEvidence(
  input: AttachmentFieldBindingInput,
  heuristic: AttachmentFieldBindingJudgement,
  candidates: ScoredAttachmentFieldCandidate[],
) {
  return {
    userMessage: normalizeString(input.userMessage) || null,
    attachment: {
      fileName: normalizeString(input.attachment.fileName) || null,
      mimeType: normalizeString(input.attachment.mimeType) || null,
    },
    heuristicBaseline: {
      canResolve: heuristic.canResolve,
      matchedFieldKey: heuristic.matchedFieldKey || null,
      confidence: heuristic.confidence,
      reasoning: heuristic.reasoning,
    },
    candidates: candidates.slice(0, 20).map((item) => ({
      fieldKey: item.candidate.fieldKey,
      label: item.candidate.label,
      description: item.candidate.description || null,
      example: item.candidate.example || null,
      required: Boolean(item.candidate.required),
      missing: Boolean(item.candidate.missing),
      multiple: Boolean(item.candidate.multiple),
      currentAttachmentCount: item.candidate.currentAttachmentCount || 0,
      heuristicScore: item.score,
      heuristicReasons: item.reasons,
    })),
  };
}

function normalizeString(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function dedupeStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseJsonFromText(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('empty llm response');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1].trim());
    }

    const objectMatch = trimmed.match(/\{[\s\S]*\}$/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    throw new Error('unable to parse llm json');
  }
}
