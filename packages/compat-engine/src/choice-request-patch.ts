import { z } from 'zod';
import type { InferenceLlmClient, InferenceTraceContext } from './system-inference';

const ChoiceRequestPatchSchema = z.object({
  canResolve: z.boolean(),
  shouldSelect: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  patchValue: z.any().optional(),
  signals: z.array(z.string()).default([]),
});

export interface ChoiceRequestPatchInferenceInput {
  submittedValue: any;
  currentValue: any;
  field?: {
    key?: string;
    label?: string;
    type?: string;
    multiple?: boolean;
  } | null;
  mapping?: {
    label?: string;
    optionAliases?: string[] | null;
    requestFieldName?: string;
    selector?: string;
    targetId?: string;
  } | null;
  knownOptionAliases?: string[] | null;
  candidatePath?: string | null;
  siblingOptionCount?: number;
  trace?: InferenceTraceContext;
}

export interface ChoiceRequestPatchJudgement {
  canResolve: boolean;
  shouldSelect: boolean;
  patchValue?: any;
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

interface ConventionInferenceResult {
  recognized: boolean;
  patchValue?: any;
  confidence: number;
  reason: string;
}

export class ChoiceRequestPatchInferenceEngine {
  private readonly llmClient: InferenceLlmClient | null;

  constructor(llmClient: InferenceLlmClient | null = ChoiceRequestPatchInferenceEngine.createDefaultClient()) {
    this.llmClient = llmClient;
  }

  async infer(input: ChoiceRequestPatchInferenceInput): Promise<ChoiceRequestPatchJudgement> {
    const heuristic = inferChoiceRequestPatchHeuristically(input);
    if (heuristic.confidence >= 0.9 || !this.llmClient) {
      return heuristic;
    }

    const llm = await this.tryInferWithLLM(input, heuristic);
    if (!llm) {
      return heuristic;
    }

    return this.mergeJudgements(heuristic, llm);
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
    input: ChoiceRequestPatchInferenceInput,
    heuristic: ChoiceRequestPatchJudgement,
  ): Promise<(z.infer<typeof ChoiceRequestPatchSchema> & { model?: string; usage?: ChoiceRequestPatchJudgement['usage'] }) | null> {
    if (!this.llmClient) {
      return null;
    }

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            'You infer one request-patch value for a workflow choice field (checkbox/radio/select option).',
            'Infer whether this specific option path should be selected, and what exact patchValue should be written.',
            'Prefer preserving the observed request convention from currentValue when possible, such as boolean, number, 1/0, true/false, Y/N, yes/no, on/off, checked/unchecked.',
            'Be conservative: if evidence is weak, return canResolve=false instead of inventing a protocol.',
            'Return JSON only.',
            JSON.stringify({
              canResolve: true,
              shouldSelect: true,
              confidence: 0.83,
              reason: 'why this option should be selected and which request convention should be used',
              patchValue: '1',
              signals: ['short evidence bullets'],
            }),
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify(buildLlmEvidence(input, heuristic), null, 2),
        },
      ], {
        trace: {
          scope: input.trace?.scope || 'compat.choice_request_patch',
          traceId: input.trace?.traceId,
          tenantId: input.trace?.tenantId,
          userId: input.trace?.userId,
          tags: input.trace?.tags,
          metadata: {
            ...(input.trace?.metadata || {}),
            evidenceType: 'choice_request_patch',
          },
        },
      });

      if (!response.content) {
        return null;
      }

      const parsed = parseJsonFromText(response.content);
      const validated = ChoiceRequestPatchSchema.parse(parsed);
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
    heuristic: ChoiceRequestPatchJudgement,
    llm: z.infer<typeof ChoiceRequestPatchSchema> & { model?: string; usage?: ChoiceRequestPatchJudgement['usage'] },
  ): ChoiceRequestPatchJudgement {
    const reasoning = dedupeStrings([...heuristic.reasoning, ...llm.signals, llm.reason]);

    if (!llm.canResolve) {
      return {
        ...heuristic,
        source: heuristic.source === 'heuristic' ? 'mixed' : heuristic.source,
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
          shouldSelect: llm.shouldSelect,
          patchValue: llm.patchValue,
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

    if (
      heuristic.shouldSelect === llm.shouldSelect
      && valuesRoughlyEqual(heuristic.patchValue, llm.patchValue)
    ) {
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

    if (llm.confidence >= Math.max(0.84, heuristic.confidence + 0.08)) {
      return {
        canResolve: true,
        shouldSelect: llm.shouldSelect,
        patchValue: llm.patchValue,
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

export function inferChoiceRequestPatchHeuristically(
  input: ChoiceRequestPatchInferenceInput,
): ChoiceRequestPatchJudgement {
  const selectedChoices = normalizeChoiceValues(input.submittedValue);
  const mappingAliases = collectMappingAliases(input);
  const explicitSelection = inferExplicitSelectionFromSubmittedValue(input.submittedValue);

  const aliasSelection = explicitSelection === undefined
    ? inferSelectionFromDeclaredOptionAliases(selectedChoices, mappingAliases, input.knownOptionAliases)
    : undefined;
  const effectiveSelection = explicitSelection ?? aliasSelection;

  if (effectiveSelection === undefined) {
    return {
      canResolve: false,
      shouldSelect: false,
      patchValue: undefined,
      confidence: 0.34,
      reasoning: dedupeStrings([
        selectedChoices.length > 0
          ? `提交值包含候选选项“${selectedChoices.join(' / ')}”，但当前映射未提供可精确匹配的已声明选项`
          : '提交值不是显式布尔/协议值',
        '为避免做模糊语义猜测，本轮只接受显式布尔/协议值或与已声明选项的精确匹配',
      ]),
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  const shouldSelect = effectiveSelection;
  const preferredSelectedValue = pickPreferredSelectedValue(input, mappingAliases);
  const convention = inferConventionPatchValue(
    input.currentValue,
    shouldSelect,
    preferredSelectedValue,
    input.siblingOptionCount || 0,
  );

  const selectionReason = explicitSelection !== undefined
    ? (typeof input.submittedValue === 'boolean'
    ? (shouldSelect
      ? '用户输入本身是布尔 true，当前路径按选中处理'
      : '用户输入本身是布尔 false，当前路径按未选中处理')
    : (shouldSelect
      ? '用户输入命中了显式布尔/协议型选中值'
      : '用户输入命中了显式布尔/协议型未选中值'))
    : (shouldSelect
      ? '用户提交值与当前映射的已声明选项精确匹配，当前路径按选中处理'
      : '用户提交值与同组其他已声明选项精确匹配，当前路径按未选中处理');

  if (!convention.recognized && shouldSelect && !preferredSelectedValue && (input.siblingOptionCount || 0) <= 1) {
    return {
      canResolve: false,
      shouldSelect,
      patchValue: undefined,
      confidence: Math.max(0.35, convention.confidence),
      reasoning: dedupeStrings([
        selectionReason,
        '当前请求体没有暴露明确协议字面量，当前映射也没有可安全复用的选项值；为避免伪造成功，本轮不自动猜测提交值',
      ]),
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  return {
    canResolve: convention.patchValue !== undefined || shouldSelect === false,
    shouldSelect,
    patchValue: convention.patchValue,
    confidence: convention.confidence,
    reasoning: dedupeStrings([selectionReason, convention.reason]),
    source: 'heuristic',
    llmSucceeded: false,
  };
}

function buildLlmEvidence(
  input: ChoiceRequestPatchInferenceInput,
  heuristic: ChoiceRequestPatchJudgement,
) {
  const selectedChoices = normalizeChoiceValues(input.submittedValue);
  return {
    submittedValue: summarizeValue(input.submittedValue),
    currentValue: summarizeValue(input.currentValue),
    selectedChoices,
    field: {
      key: input.field?.key || null,
      label: input.field?.label || null,
      type: input.field?.type || null,
      multiple: input.field?.multiple ?? null,
    },
    mapping: {
      label: input.mapping?.label || null,
      optionAliases: collectMappingAliases(input),
      requestFieldName: input.mapping?.requestFieldName || null,
      selector: input.mapping?.selector || null,
      targetId: input.mapping?.targetId || null,
      candidatePath: input.candidatePath || null,
      siblingOptionCount: input.siblingOptionCount || 0,
    },
    heuristicBaseline: {
      canResolve: heuristic.canResolve,
      shouldSelect: heuristic.shouldSelect,
      patchValue: summarizeValue(heuristic.patchValue),
      confidence: heuristic.confidence,
      reasoning: heuristic.reasoning,
    },
  };
}

function inferConventionPatchValue(
  currentValue: any,
  shouldSelect: boolean,
  preferredSelectedValue: string | undefined,
  siblingOptionCount: number,
): ConventionInferenceResult {
  if (typeof currentValue === 'boolean') {
    return {
      recognized: true,
      patchValue: shouldSelect,
      confidence: 0.96,
      reason: '当前请求字段已表现为布尔值，直接沿用 true/false 协议',
    };
  }

  if (typeof currentValue === 'number') {
    return {
      recognized: true,
      patchValue: shouldSelect ? 1 : 0,
      confidence: 0.95,
      reason: '当前请求字段已表现为数值值域，直接沿用 1/0 协议',
    };
  }

  const rawCurrent = normalizeString(currentValue);
  if (rawCurrent) {
    const normalized = rawCurrent.toLowerCase();
    const recognizedPatch = inferObservedStringConvention(rawCurrent, normalized, shouldSelect);
    if (recognizedPatch.recognized) {
      return recognizedPatch;
    }

    if (shouldSelect) {
      return {
        recognized: true,
        patchValue: preferredSelectedValue || currentValue,
        confidence: preferredSelectedValue ? 0.78 : 0.66,
        reason: preferredSelectedValue
          ? '当前字段是非空文本且未命中特定协议字面量，回退为该选项的优先文本值'
          : '当前字段是非空文本但协议不明确，暂时回退保留原有文本形态',
      };
    }

    return {
      recognized: true,
      patchValue: '',
      confidence: 0.76,
      reason: '当前字段是文本类型且当前路径推断为未选中，回退为空串表示取消勾选',
    };
  }

  if (!shouldSelect) {
    return {
      recognized: true,
      patchValue: '',
      confidence: siblingOptionCount > 1 ? 0.74 : 0.68,
      reason: siblingOptionCount > 1
        ? '同组存在多个选项且当前路径未选中，回退为空串补齐未选中的兄弟字段'
        : '当前路径未选中，回退为空串表示取消勾选',
    };
  }

  if (siblingOptionCount > 1) {
    return {
      recognized: true,
      patchValue: '1',
      confidence: 0.72,
      reason: '同组存在多个离散选项但请求体未暴露协议，回退到常见的勾选标记 1',
    };
  }

  if (preferredSelectedValue) {
    return {
      recognized: true,
      patchValue: preferredSelectedValue,
      confidence: 0.75,
      reason: '请求体未暴露协议字面量，回退到当前选项的显式 value/label',
    };
  }

  return {
    recognized: false,
    patchValue: undefined,
    confidence: 0.42,
    reason: '请求体未暴露协议字面量，且没有可安全复用的选项值',
  };
}

function inferObservedStringConvention(
  rawCurrent: string,
  normalized: string,
  shouldSelect: boolean,
): ConventionInferenceResult {
  if (normalized === '0' || normalized === '1') {
    return {
      recognized: true,
      patchValue: shouldSelect ? '1' : '0',
      confidence: 0.94,
      reason: '当前请求字段已表现为字符串 1/0 协议',
    };
  }

  if (normalized === 'true' || normalized === 'false') {
    return {
      recognized: true,
      patchValue: preserveCaseLike(rawCurrent, shouldSelect ? 'true' : 'false'),
      confidence: 0.94,
      reason: '当前请求字段已表现为字符串 true/false 协议',
    };
  }

  if (normalized === 'y' || normalized === 'n') {
    return {
      recognized: true,
      patchValue: preserveCaseLike(rawCurrent, shouldSelect ? 'y' : 'n'),
      confidence: 0.93,
      reason: '当前请求字段已表现为 Y/N 协议',
    };
  }

  if (normalized === 'yes' || normalized === 'no') {
    return {
      recognized: true,
      patchValue: preserveCaseLike(rawCurrent, shouldSelect ? 'yes' : 'no'),
      confidence: 0.93,
      reason: '当前请求字段已表现为 yes/no 协议',
    };
  }

  if (normalized === 'on' || normalized === 'off') {
    return {
      recognized: true,
      patchValue: preserveCaseLike(rawCurrent, shouldSelect ? 'on' : 'off'),
      confidence: 0.92,
      reason: '当前请求字段已表现为 on/off 协议',
    };
  }

  if (normalized === 'checked' || normalized === 'unchecked') {
    return {
      recognized: true,
      patchValue: preserveCaseLike(rawCurrent, shouldSelect ? 'checked' : 'unchecked'),
      confidence: 0.92,
      reason: '当前请求字段已表现为 checked/unchecked 协议',
    };
  }

  if (normalized === 'selected' || normalized === 'unselected') {
    return {
      recognized: true,
      patchValue: preserveCaseLike(rawCurrent, shouldSelect ? 'selected' : 'unselected'),
      confidence: 0.9,
      reason: '当前请求字段已表现为 selected/unselected 协议',
    };
  }

  if (normalized === '是' || normalized === '否') {
    return {
      recognized: true,
      patchValue: shouldSelect ? '是' : '否',
      confidence: 0.9,
      reason: '当前请求字段已表现为中文 是/否 协议',
    };
  }

  if (normalized === '√' || normalized === '×' || normalized === '✓' || normalized === '✗') {
    return {
      recognized: true,
      patchValue: normalized === '✓' || normalized === '✗'
        ? (shouldSelect ? '✓' : '✗')
        : (shouldSelect ? '√' : '×'),
      confidence: 0.88,
      reason: '当前请求字段已表现为符号勾选协议',
    };
  }

  return {
    recognized: false,
    patchValue: undefined,
    confidence: 0.4,
    reason: '当前文本未命中已知的勾选协议字面量',
  };
}

function inferExplicitSelectionFromSubmittedValue(value: any): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? false : undefined;
  }

  const normalized = normalizeString(value);
  if (!normalized) {
    return false;
  }

  const normalizedLower = normalized.toLowerCase();
  if ([
    'true',
    '1',
    'yes',
    'on',
    'y',
    '是',
    '选中',
    'checked',
    'selected',
    '√',
    '✓',
  ].includes(normalizedLower) || ['是', '选中', '√', '✓'].includes(normalized)) {
    return true;
  }

  if ([
    'false',
    '0',
    'no',
    'off',
    'n',
    '否',
    '未选',
    'unchecked',
    'unselected',
    '×',
    '✗',
  ].includes(normalizedLower) || ['否', '未选', '×', '✗'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function inferSelectionFromDeclaredOptionAliases(
  selectedChoices: string[],
  mappingAliases: string[],
  knownOptionAliases?: string[] | null,
): boolean | undefined {
  if (selectedChoices.length === 0 || mappingAliases.length === 0) {
    return undefined;
  }

  const normalizedSelected = new Set(selectedChoices.map((item) => normalizeComparableToken(item)).filter((item): item is string => Boolean(item)));
  const normalizedMapping = new Set(mappingAliases.map((item) => normalizeComparableToken(item)).filter((item): item is string => Boolean(item)));

  if ([...normalizedMapping].some((item) => normalizedSelected.has(item))) {
    return true;
  }

  const normalizedKnown = new Set((knownOptionAliases || [])
    .map((item) => normalizeComparableToken(item))
    .filter((item): item is string => Boolean(item)));
  if (normalizedKnown.size > 0 && [...normalizedSelected].some((item) => normalizedKnown.has(item))) {
    return false;
  }

  return undefined;
}

function normalizeChoiceValues(value: any) {
  const queue = Array.isArray(value) ? value : [value];
  const results = new Set<string>();
  for (const item of queue) {
    const normalizedItem = normalizeString(item);
    if (!normalizedItem) {
      continue;
    }
    const parts = normalizedItem
      .split(/[、,，;；\n]/)
      .map((part) => normalizeString(part))
      .filter((part): part is string => Boolean(part));
    if (parts.length === 0) {
      results.add(normalizedItem);
      continue;
    }
    for (const part of parts) {
      results.add(part);
    }
  }
  return [...results];
}

function collectMappingAliases(input: ChoiceRequestPatchInferenceInput) {
  return dedupeStrings([
    ...(input.mapping?.optionAliases || []).map((item) => normalizeString(item)).filter((item): item is string => Boolean(item)),
    normalizeString(input.mapping?.label),
  ]);
}

function pickPreferredSelectedValue(
  input: ChoiceRequestPatchInferenceInput,
  mappingAliases: string[],
) {
  const fromAliases = mappingAliases.find((alias) => Boolean(alias));
  if (fromAliases) {
    return fromAliases;
  }

  return normalizeString(input.mapping?.label);
}

function preserveCaseLike(sample: string, value: string) {
  if (!sample) {
    return value;
  }
  if (sample.toUpperCase() === sample) {
    return value.toUpperCase();
  }
  if (sample.toLowerCase() === sample) {
    return value.toLowerCase();
  }
  if (sample[0] && sample[0] === sample[0].toUpperCase()) {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
  return value;
}

function normalizeString(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function normalizeComparableToken(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  return normalized.replace(/\s+/g, '').toLowerCase();
}

function dedupeStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function valuesRoughlyEqual(left: any, right: any) {
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftList = Array.isArray(left) ? left.map((item) => String(item)) : [String(left)];
    const rightList = Array.isArray(right) ? right.map((item) => String(item)) : [String(right)];
    return leftList.length === rightList.length
      && leftList.every((item) => rightList.includes(item));
  }

  if (left === right) {
    return true;
  }

  if (left === undefined || left === null || right === undefined || right === null) {
    return false;
  }

  return String(left) === String(right);
}

function summarizeValue(value: any): any {
  if (value === undefined) {
    return null;
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => summarizeValue(item));
  }
  if (typeof value === 'object') {
    const summary: Record<string, any> = {};
    for (const [key, item] of Object.entries(value).slice(0, 12)) {
      summary[key] = summarizeValue(item);
    }
    return summary;
  }
  return String(value);
}

function parseJsonFromText(text: string) {
  const trimmed = String(text || '').trim();
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
