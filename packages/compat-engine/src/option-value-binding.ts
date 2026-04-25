import { z } from 'zod';
import type { InferenceLlmClient, InferenceTraceContext } from './system-inference';

const OptionValueBindingSchema = z.object({
  canResolve: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  resolvedValue: z.union([z.string(), z.array(z.string())]).optional(),
  signals: z.array(z.string()).default([]),
});

export interface OptionValueBindingInput {
  submittedValue: any;
  userMessage?: string | null;
  field?: {
    key?: string;
    label?: string;
    type?: string;
    multiple?: boolean;
    description?: string;
    example?: string;
  } | null;
  options?: Array<{ label: string; value: string }> | null;
  trace?: InferenceTraceContext;
}

export interface OptionValueBindingJudgement {
  canResolve: boolean;
  resolvedValue?: string | string[];
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

interface OptionMatchCandidate {
  option: { label: string; value: string };
  score: number;
  reason: string;
}

export class OptionValueBindingInferenceEngine {
  private readonly llmClient: InferenceLlmClient | null;

  constructor(llmClient: InferenceLlmClient | null = OptionValueBindingInferenceEngine.createDefaultClient()) {
    this.llmClient = llmClient;
  }

  async infer(input: OptionValueBindingInput): Promise<OptionValueBindingJudgement> {
    const heuristic = inferOptionValueBindingHeuristically(input);
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
    input: OptionValueBindingInput,
    heuristic: OptionValueBindingJudgement,
  ): Promise<(z.infer<typeof OptionValueBindingSchema> & { model?: string; usage?: OptionValueBindingJudgement['usage'] }) | null> {
    if (!this.llmClient) {
      return null;
    }

    const options = normalizeOptions(input.options);
    if (options.length === 0) {
      return null;
    }

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            'You infer which provided option value(s) a user-supplied field value refers to.',
            'Choose only from the provided options.',
            'If evidence is weak, ambiguous, or the value does not clearly map to an option, return canResolve=false.',
            'For multi-select fields, resolvedValue may be an array of exact option values; otherwise return one exact option value string.',
            'Return JSON only.',
            JSON.stringify({
              canResolve: true,
              confidence: 0.86,
              reason: 'why the submitted value maps to the chosen option values',
              resolvedValue: ['option_value'],
              signals: ['short evidence bullets'],
            }),
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify(buildLlmEvidence(input, heuristic, options), null, 2),
        },
      ], {
        trace: {
          scope: input.trace?.scope || 'compat.option_value_binding',
          traceId: input.trace?.traceId,
          tenantId: input.trace?.tenantId,
          userId: input.trace?.userId,
          tags: input.trace?.tags,
          metadata: {
            ...(input.trace?.metadata || {}),
            evidenceType: 'option_value_binding',
          },
        },
      });

      if (!response.content) {
        return null;
      }

      const parsed = parseJsonFromText(response.content);
      const validated = OptionValueBindingSchema.parse(parsed);
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
    input: OptionValueBindingInput,
    heuristic: OptionValueBindingJudgement,
    llm: z.infer<typeof OptionValueBindingSchema> & { model?: string; usage?: OptionValueBindingJudgement['usage'] },
  ): OptionValueBindingJudgement {
    const reasoning = dedupeStrings([...heuristic.reasoning, ...llm.signals, llm.reason]);
    const normalizedLlmValue = normalizeResolvedValue(llm.resolvedValue, Boolean(input.field?.multiple));

    if (!llm.canResolve || normalizedLlmValue === undefined || !resolvedValueExists(normalizedLlmValue, input.options)) {
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
          resolvedValue: normalizedLlmValue,
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

    if (resolvedValuesRoughlyEqual(heuristic.resolvedValue, normalizedLlmValue)) {
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
        resolvedValue: normalizedLlmValue,
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

export function inferOptionValueBindingHeuristically(
  input: OptionValueBindingInput,
): OptionValueBindingJudgement {
  const options = normalizeOptions(input.options);
  if (options.length === 0) {
    return {
      canResolve: false,
      confidence: 0.2,
      reasoning: ['字段没有可用选项，无法做选项值绑定推断'],
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  const tokens = extractSubmittedTokens(input.submittedValue, Boolean(input.field?.multiple));
  if (tokens.length === 0) {
    return {
      canResolve: false,
      confidence: 0.24,
      reasoning: ['提交值为空或不可解析，无法绑定到已有选项'],
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  const resolvedValues: string[] = [];
  const reasoning: string[] = [];

  for (const token of tokens) {
    const rankedMatches = rankMatches(token, options);
    const best = rankedMatches[0];
    const second = rankedMatches[1];
    const gap = best && second ? best.score - second.score : best?.score || 0;

    if (!best || best.score < 0.88 || gap < 0.05) {
      return {
        canResolve: false,
        confidence: clamp(best?.score || 0.34, 0.2, 0.72),
        reasoning: dedupeStrings([
          `候选值“${token}”无法与现有选项形成足够明确的一一对应`,
          best ? best.reason : undefined,
          second ? second.reason : undefined,
        ]),
        source: 'heuristic',
        llmSucceeded: false,
      };
    }

    resolvedValues.push(best.option.value);
    reasoning.push(`候选值“${token}”匹配到选项“${best.option.label}”`);
    reasoning.push(best.reason);
  }

  const deduped = resolvedValues.filter((value, index, list) => list.indexOf(value) === index);
  const multiple = Boolean(input.field?.multiple);
  const resolvedValue = multiple ? deduped : deduped[0];

  return {
    canResolve: true,
    resolvedValue,
    confidence: clamp(0.88 + (tokens.length > 1 ? 0.04 : 0), 0.88, 0.97),
    reasoning: dedupeStrings(reasoning),
    source: 'heuristic',
    llmSucceeded: false,
  };
}

function rankMatches(
  rawToken: string,
  options: Array<{ label: string; value: string }>,
): OptionMatchCandidate[] {
  return options
    .map((option) => scoreOptionMatch(rawToken, option))
    .filter((candidate): candidate is OptionMatchCandidate => Boolean(candidate))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.option.label.length - left.option.label.length;
    });
}

function scoreOptionMatch(
  rawToken: string,
  option: { label: string; value: string },
): OptionMatchCandidate | null {
  const token = normalizeString(rawToken);
  if (!token) {
    return null;
  }

  const normalizedToken = compactText(token);
  const normalizedLabel = compactText(option.label);
  const normalizedValue = compactText(option.value);

  if (!normalizedToken || (!normalizedLabel && !normalizedValue)) {
    return null;
  }

  if (token === option.label || token === option.value) {
    return {
      option,
      score: 0.99,
      reason: `候选值与选项原始值完全一致：${option.label}`,
    };
  }

  if (normalizedToken === normalizedLabel || normalizedToken === normalizedValue) {
    return {
      option,
      score: 0.95,
      reason: `候选值与选项归一化后完全一致：${option.label}`,
    };
  }

  return null;
}

function buildLlmEvidence(
  input: OptionValueBindingInput,
  heuristic: OptionValueBindingJudgement,
  options: Array<{ label: string; value: string }>,
) {
  return {
    submittedValue: input.submittedValue,
    userMessage: normalizeString(input.userMessage) || null,
    field: {
      key: normalizeString(input.field?.key) || null,
      label: normalizeString(input.field?.label) || null,
      type: normalizeString(input.field?.type) || null,
      multiple: Boolean(input.field?.multiple),
      description: normalizeString(input.field?.description) || null,
      example: normalizeString(input.field?.example) || null,
    },
    heuristicBaseline: {
      canResolve: heuristic.canResolve,
      resolvedValue: heuristic.resolvedValue ?? null,
      confidence: heuristic.confidence,
      reasoning: heuristic.reasoning,
    },
    options,
  };
}

function normalizeOptions(options?: Array<{ label: string; value: string }> | null) {
  return (options || [])
    .filter((option): option is { label: string; value: string } =>
      Boolean(option && normalizeString(option.label) && normalizeString(option.value)))
    .map((option) => ({
      label: normalizeString(option.label)!,
      value: normalizeString(option.value)!,
    }));
}

function normalizeResolvedValue(rawValue: unknown, multiple: boolean): string | string[] | undefined {
  if (multiple) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const normalized = values
      .map((value) => normalizeString(value))
      .filter((value): value is string => Boolean(value))
      .filter((value, index, list) => list.indexOf(value) === index);
    return normalized.length > 0 ? normalized : undefined;
  }

  if (Array.isArray(rawValue)) {
    return normalizeString(rawValue[0]);
  }

  return normalizeString(rawValue);
}

function resolvedValueExists(
  resolvedValue: string | string[],
  options?: Array<{ label: string; value: string }> | null,
) {
  const knownValues = new Set(normalizeOptions(options).map((option) => option.value));
  const values = Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue];
  return values.every((value) => knownValues.has(value));
}

function resolvedValuesRoughlyEqual(left: unknown, right: unknown) {
  const leftValues = Array.isArray(left) ? left.map((value) => normalizeString(value)).filter(Boolean) : [normalizeString(left)].filter(Boolean);
  const rightValues = Array.isArray(right) ? right.map((value) => normalizeString(value)).filter(Boolean) : [normalizeString(right)].filter(Boolean);

  if (leftValues.length !== rightValues.length) {
    return false;
  }

  const normalizedLeft = [...leftValues].sort();
  const normalizedRight = [...rightValues].sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function extractSubmittedTokens(rawValue: any, multiple: boolean) {
  const list = Array.isArray(rawValue)
    ? rawValue
    : [rawValue];

  const results: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string' && typeof entry !== 'number') {
      continue;
    }

    const text = String(entry).trim();
    if (!text) {
      continue;
    }

    if (multiple) {
      for (const segment of text.split(/[、,，;；]/).map((item) => item.trim()).filter(Boolean)) {
        results.push(segment);
      }
      continue;
    }

    results.push(text);
  }

  return results.filter((value, index, listValues) => listValues.indexOf(value) === index);
}

function compactText(value: unknown) {
  return normalizeString(value)?.toLowerCase().replace(/[\s_\-./\\,，。;；:：'"“”‘’()（）【】\[\]]+/g, '') || '';
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
