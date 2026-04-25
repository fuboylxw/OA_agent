import type {
  BrowserPageSnapshot,
  BrowserSnapshotElement,
  BrowserSnapshotElementRole,
  RpaFieldBinding,
  RpaStepDefinition,
} from '@uniflow/shared-types';
import { z } from 'zod';
import type { InferenceLlmClient, InferenceTraceContext } from './system-inference';

const BrowserStepRepairSchema = z.object({
  canRepair: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  repairedTargetRef: z.string().optional(),
  signals: z.array(z.string()).default([]),
});

type StepRepairKind = 'none' | 'rebind_element' | 'semantic_retarget';

interface FieldDescriptor {
  key: string;
  aliases: string[];
}

interface RepairCandidate {
  element: BrowserSnapshotElement;
  score: number;
  reasons: string[];
}

export interface BrowserStepRepairInput {
  step: RpaStepDefinition;
  reason: string;
  snapshot?: BrowserPageSnapshot | null;
  processCode?: string | null;
  processName?: string | null;
  fields?: Array<Pick<RpaFieldBinding, 'key' | 'label' | 'type'>> | null;
  formData?: Record<string, any> | null;
  preferredRegionId?: string | null;
  preferredFormId?: string | null;
  preferredFrameUrl?: string | null;
  anchorElementRef?: string | null;
  trace?: InferenceTraceContext;
}

export interface BrowserStepRepairJudgement {
  canRepair: boolean;
  repairedStep?: RpaStepDefinition;
  matchedElementRef?: string;
  matchedSelector?: string;
  repairKind: StepRepairKind;
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

export class BrowserStepRepairEngine {
  private readonly llmClient: InferenceLlmClient | null;

  constructor(llmClient: InferenceLlmClient | null = BrowserStepRepairEngine.createDefaultClient()) {
    this.llmClient = llmClient;
  }

  async repair(input: BrowserStepRepairInput): Promise<BrowserStepRepairJudgement> {
    const heuristic = inferBrowserStepRepairHeuristically(input);
    const llm = await this.tryRepairWithLLM(input, heuristic);
    if (!llm) {
      return heuristic;
    }
    return this.mergeRepairJudgements(input, heuristic, llm);
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

  private async tryRepairWithLLM(
    input: BrowserStepRepairInput,
    heuristic: BrowserStepRepairJudgement,
  ): Promise<(z.infer<typeof BrowserStepRepairSchema> & { model?: string; usage?: BrowserStepRepairJudgement['usage'] }) | null> {
    if (!this.llmClient || !isRepairableStep(input.step)) {
      return null;
    }

    const candidatePool = collectRepairCandidates(input, 24);
    if (candidatePool.length === 0) {
      return null;
    }

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            'You are a browser runtime recovery planner for enterprise workflow automation.',
            'A browser step failed. Your task is to decide whether the step can be safely rebound to one existing page element.',
            'You must choose only from the provided candidate element refs. Do not invent a new selector or a new workflow.',
            'Be conservative: return canRepair=false when evidence is weak or ambiguous.',
            'Keep the original step type. Only choose the best existing page element ref for retargeting.',
            'Return JSON only.',
            JSON.stringify({
              canRepair: true,
              confidence: 0.72,
              reason: 'why the candidate matches the failed step',
              repairedTargetRef: 'e12',
              signals: ['short evidence bullets'],
            }),
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify(buildLlmEvidence(input, heuristic, candidatePool), null, 2),
        },
      ], {
        trace: {
          scope: input.trace?.scope || 'compat.browser_step_repair',
          traceId: input.trace?.traceId,
          tenantId: input.trace?.tenantId,
          userId: input.trace?.userId,
          tags: input.trace?.tags,
          metadata: {
            ...(input.trace?.metadata || {}),
            evidenceType: 'browser_step_repair',
          },
        },
      });

      if (!response.content) {
        return null;
      }

      const parsed = parseJsonFromText(response.content);
      const validated = BrowserStepRepairSchema.parse(parsed);
      return {
        ...validated,
        model: response.model,
        usage: response.usage,
      };
    } catch {
      return null;
    }
  }

  private mergeRepairJudgements(
    input: BrowserStepRepairInput,
    heuristic: BrowserStepRepairJudgement,
    llm: z.infer<typeof BrowserStepRepairSchema> & { model?: string; usage?: BrowserStepRepairJudgement['usage'] },
  ): BrowserStepRepairJudgement {
    const reasoning = dedupeStrings([...heuristic.reasoning, ...llm.signals, llm.reason]);
    const llmElement = (input.snapshot?.interactiveElements || []).find((element) => element.ref === llm.repairedTargetRef);
    const llmJudgement = llm.canRepair && llmElement
      ? buildRepairJudgementFromElement(input, llmElement, 'llm', llm.confidence, reasoning, true, llm.model, llm.usage)
      : buildNoRepairJudgement({
          confidence: Math.max(heuristic.confidence, llm.confidence),
          source: heuristic.canRepair ? 'mixed' : 'llm',
          reasoning,
          llmSucceeded: true,
          model: llm.model,
          usage: llm.usage,
        });

    if (!llm.canRepair || !llmElement) {
      if (heuristic.canRepair) {
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
      return llmJudgement;
    }

    if (!heuristic.canRepair) {
      if (llm.confidence >= 0.72) {
        return {
          ...llmJudgement,
          source: 'llm',
          llmSucceeded: true,
          model: llm.model,
          usage: llm.usage,
        };
      }
      return {
        ...llmJudgement,
        canRepair: false,
        repairedStep: undefined,
        matchedElementRef: undefined,
        matchedSelector: undefined,
        repairKind: 'none',
      };
    }

    if (heuristic.matchedElementRef && heuristic.matchedElementRef === llmJudgement.matchedElementRef) {
      return {
        ...heuristic,
        source: 'mixed',
        confidence: Math.max(heuristic.confidence, llmJudgement.confidence),
        reasoning,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    if (llmJudgement.confidence >= Math.max(0.82, heuristic.confidence + 0.08)) {
      return {
        ...llmJudgement,
        source: 'mixed',
        reasoning,
        llmSucceeded: true,
        model: llm.model,
        usage: llm.usage,
      };
    }

    return {
      ...heuristic,
      source: 'mixed',
      confidence: Math.max(heuristic.confidence, llmJudgement.confidence),
      reasoning,
      llmSucceeded: true,
      model: llm.model,
      usage: llm.usage,
    };
  }
}

export function inferBrowserStepRepairHeuristically(input: BrowserStepRepairInput): BrowserStepRepairJudgement {
  if (!isRepairableStep(input.step)) {
    return buildNoRepairJudgement({
      reasoning: ['当前步骤类型不适合做页面元素重绑定修复'],
      confidence: 0.18,
    });
  }

  const candidates = collectExactRepairCandidates(input);
  const best = candidates[0];
  if (!best || best.score < 0.72) {
    return buildNoRepairJudgement({
      confidence: best ? Math.min(0.66, best.score) : 0.2,
      reasoning: best
        ? [`存在精确候选元素 ${best.element.ref}，但匹配证据仍不足：${best.reasons.join('；')}`]
        : ['页面快照中没有 selector、fieldKey、element_ref 或显式目标文本的精确候选，未做工程化语义修复'],
    });
  }

  return buildRepairJudgementFromElement(
    input,
    best.element,
    'heuristic',
    best.score,
    best.reasons,
    false,
  );
}

function collectExactRepairCandidates(input: BrowserStepRepairInput, limit = 12): RepairCandidate[] {
  const snapshot = input.snapshot;
  if (!snapshot?.interactiveElements?.length) {
    return [];
  }

  return snapshot.interactiveElements
    .map((element) => scoreExactRepairCandidate(
      input.step,
      element,
      input.snapshot || null,
      input.preferredRegionId || undefined,
      input.preferredFormId || undefined,
      input.preferredFrameUrl || undefined,
      input.anchorElementRef || undefined,
    ))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function collectRepairCandidates(input: BrowserStepRepairInput, limit = 12): RepairCandidate[] {
  return collectExactRepairCandidates(input, limit);
}

function scoreExactRepairCandidate(
  step: RpaStepDefinition,
  element: BrowserSnapshotElement,
  snapshot: BrowserPageSnapshot | null,
  preferredRegionId?: string,
  preferredFormId?: string,
  preferredFrameUrl?: string,
  anchorElementRef?: string,
): RepairCandidate {
  let score = 0;
  let hasExactTargetEvidence = false;
  const reasons: string[] = [];
  const compatibleRoles = getCompatibleRoles(step.type);

  if (!(compatibleRoles.has(element.role) || element.role === 'unknown')) {
    return {
      element,
      score: 0,
      reasons: [],
    };
  }

  score += 0.12;
  reasons.push(`元素角色 ${element.role || 'unknown'} 与步骤类型 ${step.type} 兼容`);

  if (step.selector && element.selector && normalizeText(step.selector) === normalizeText(element.selector)) {
    score += 0.76;
    hasExactTargetEvidence = true;
    reasons.push('页面中存在与失败步骤 selector 完全匹配的元素');
  }

  if (step.fieldKey && element.fieldKey && normalizeText(step.fieldKey) === normalizeText(element.fieldKey)) {
    score += 0.8;
    hasExactTargetEvidence = true;
    reasons.push('页面中存在与失败步骤 fieldKey 完全匹配的元素');
  }

  if (
    step.target?.kind === 'element_ref'
    && step.target.value
    && element.ref
    && normalizeText(step.target.value) === normalizeText(element.ref)
  ) {
    score += 0.82;
    hasExactTargetEvidence = true;
    reasons.push('页面中存在与失败步骤 element_ref 完全匹配的元素');
  }

  const targetText = step.target?.kind === 'text' ? normalizeText(step.target.value) : '';
  if (
    targetText
    && (
      (element.text && normalizeText(element.text) === targetText)
      || (element.label && normalizeText(element.label) === targetText)
    )
  ) {
    score += 0.76;
    hasExactTargetEvidence = true;
    reasons.push('页面中存在与失败步骤显式目标文本完全匹配的元素');
  }

  if (!hasExactTargetEvidence) {
    return {
      element,
      score: 0,
      reasons: [],
    };
  }

  if (preferredRegionId && element.regionId && normalizeText(preferredRegionId) === normalizeText(element.regionId)) {
    score += 0.12;
    reasons.push('元素位于当前活跃区域内');
  }

  const candidateFormId = resolveElementFormId(snapshot, element);
  if (preferredFormId && candidateFormId && normalizeText(preferredFormId) === normalizeText(candidateFormId)) {
    score += 0.16;
    reasons.push('元素位于当前活跃表单内');
  }

  const candidateFrameUrl = resolveElementFrameUrl(element);
  if (
    preferredFrameUrl
    && candidateFrameUrl
    && normalizeText(preferredFrameUrl) === normalizeText(candidateFrameUrl)
  ) {
    score += 0.16;
    reasons.push('元素位于当前活跃 frame 内');
  }

  if (anchorElementRef && element.ref && normalizeText(anchorElementRef) === normalizeText(element.ref)) {
    score += 0.1;
    reasons.push('元素与当前作用域锚点一致');
  }

  if (element.disabled) {
    score -= 0.28;
    reasons.push('元素当前处于禁用态，降低修复置信度');
  }

  return {
    element,
    score: Math.max(0, score),
    reasons: dedupeStrings(reasons),
  };
}

function buildRequestedFieldDescriptor(input: BrowserStepRepairInput): FieldDescriptor | null {
  const stepField = String(input.step.fieldKey || '').trim();
  const explicitField = stepField
    ? (input.fields || []).find((field) => String(field.key || '').trim() === stepField)
    : undefined;

  const labelCandidate = explicitField?.label
    || input.step.target?.label
    || input.step.description
    || input.step.target?.value
    || input.step.fieldKey;

  const presentation = describeLocalFieldPresentation({
    key: explicitField?.key || input.step.fieldKey,
    label: labelCandidate,
    type: explicitField?.type || input.step.type,
  });

  if (!presentation.aliases.length) {
    return null;
  }

  return {
    key: normalizeText(explicitField?.key || input.step.fieldKey),
    aliases: dedupeStrings([
      explicitField?.label || '',
      input.step.target?.label || '',
      input.step.target?.value || '',
      input.step.description || '',
      ...presentation.aliases,
    ]).map(normalizeText).filter(Boolean),
  };
}

function buildRepairJudgementFromElement(
  input: BrowserStepRepairInput,
  element: BrowserSnapshotElement,
  source: BrowserStepRepairJudgement['source'],
  confidence: number,
  reasoning: string[],
  llmSucceeded: boolean,
  model?: string,
  usage?: BrowserStepRepairJudgement['usage'],
): BrowserStepRepairJudgement {
  return {
    canRepair: true,
    repairedStep: buildRepairedStep(input, element),
    matchedElementRef: element.ref,
    matchedSelector: element.selector,
    repairKind: inferRepairKind(input.step, element),
    source,
    confidence: clamp(confidence, 0, 0.99),
    reasoning: dedupeStrings(reasoning),
    llmSucceeded,
    model,
    usage,
  };
}

function buildRepairedStep(
  input: BrowserStepRepairInput,
  element: BrowserSnapshotElement,
): RpaStepDefinition {
  const step = input.step;
  const preferredFormId = resolveElementFormId(input.snapshot || null, element) || input.preferredFormId || undefined;
  const preferredFrameUrl = resolveElementFrameUrl(element) || input.preferredFrameUrl || undefined;
  return {
    ...step,
    options: {
      ...(step.options || {}),
      __runtime: {
        ...((((step.options || {}) as Record<string, any>).__runtime || {}) as Record<string, any>),
        repairedElementRole: element.role,
        repairedElementRef: element.ref,
        preferredRegionId: element.regionId || input.preferredRegionId || undefined,
        preferredFormId,
        preferredFrameUrl,
        anchorElementRef: element.ref || input.anchorElementRef || undefined,
      },
    },
    selector: element.selector || step.selector,
    target: {
      kind: 'element_ref',
      value: element.ref,
      label: element.label || element.text || step.target?.label,
      description: step.target?.description || step.description,
    },
  };
}

function inferRepairKind(step: RpaStepDefinition, element: BrowserSnapshotElement): StepRepairKind {
  if (step.selector && element.selector && normalizeText(step.selector) === normalizeText(element.selector)) {
    return 'rebind_element';
  }

  if (step.fieldKey && element.fieldKey && normalizeText(step.fieldKey) === normalizeText(element.fieldKey)) {
    return 'rebind_element';
  }

  return 'semantic_retarget';
}

function buildNoRepairJudgement(input: {
  confidence?: number;
  source?: BrowserStepRepairJudgement['source'];
  reasoning?: string[];
  llmSucceeded?: boolean;
  model?: string;
  usage?: BrowserStepRepairJudgement['usage'];
} = {}): BrowserStepRepairJudgement {
  return {
    canRepair: false,
    repairKind: 'none',
    source: input.source || 'heuristic',
    confidence: clamp(input.confidence ?? 0.2, 0, 0.99),
    reasoning: dedupeStrings(input.reasoning || ['当前证据不足，未生成安全的步骤修复方案']),
    llmSucceeded: Boolean(input.llmSucceeded),
    model: input.model,
    usage: input.usage,
  };
}

function buildLlmEvidence(
  input: BrowserStepRepairInput,
  heuristic: BrowserStepRepairJudgement,
  candidates: RepairCandidate[],
) {
  const formFieldLabels = Object.keys(input.formData || {}).slice(0, 20);
  const desiredValues = resolveDesiredValues(input);
  return {
    process: {
      processCode: input.processCode,
      processName: input.processName,
    },
    failedStep: {
      type: input.step.type,
      selector: input.step.selector,
      fieldKey: input.step.fieldKey,
      description: input.step.description,
      target: input.step.target,
    },
    failureReason: input.reason,
    desiredValues,
    heuristic: {
      canRepair: heuristic.canRepair,
      confidence: heuristic.confidence,
      matchedElementRef: heuristic.matchedElementRef,
      reasoning: heuristic.reasoning,
    },
    preferredScope: {
      regionId: input.preferredRegionId,
      formId: input.preferredFormId,
      frameUrl: input.preferredFrameUrl,
      anchorElementRef: input.anchorElementRef,
    },
    page: {
      title: input.snapshot?.title,
      url: input.snapshot?.url,
      importantTexts: (input.snapshot?.importantTexts || []).slice(0, 12),
      formNames: (input.snapshot?.forms || []).map((form) => form.name).slice(0, 8),
      candidateElements: candidates.map((candidate) => ({
        ref: candidate.element.ref,
        role: candidate.element.role,
        selector: candidate.element.selector,
        fieldKey: candidate.element.fieldKey,
        label: candidate.element.label,
        text: candidate.element.text,
        required: candidate.element.required,
        disabled: candidate.element.disabled,
        regionId: candidate.element.regionId,
        formId: resolveElementFormId(input.snapshot || null, candidate.element),
        frameUrl: resolveElementFrameUrl(candidate.element),
        heuristicScore: Number(clamp(candidate.score, 0, 0.99).toFixed(2)),
        heuristicReasons: candidate.reasons.slice(0, 4),
      })),
    },
    availablePayloadKeys: formFieldLabels,
  };
}

function isRepairableStep(step: RpaStepDefinition) {
  return ['input', 'select', 'click', 'upload', 'extract', 'download'].includes(step.type);
}

function resolveElementFrameUrl(element: BrowserSnapshotElement) {
  return (element.targetHints || []).find((hint) =>
    hint.kind === 'url' && hint.label === 'scope:frame',
  )?.value;
}

function resolveElementFormId(
  snapshot: BrowserPageSnapshot | null,
  element: BrowserSnapshotElement,
) {
  if (!snapshot || !element.ref) {
    return undefined;
  }

  return snapshot.forms.find((form) => (form.fieldRefs || []).includes(element.ref))?.id;
}

function resolveDesiredValues(input: BrowserStepRepairInput) {
  const rawValue = input.step.fieldKey
    ? input.formData?.[input.step.fieldKey] ?? input.step.value
    : input.step.value;

  if (Array.isArray(rawValue)) {
    return dedupeStrings(rawValue.flatMap((item) => normalizeCandidateValue(item)));
  }

  return normalizeCandidateValue(rawValue);
}

function normalizeCandidateValue(value: any): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (typeof value === 'object') {
    if (typeof value.label === 'string' || typeof value.value === 'string' || typeof value.name === 'string') {
      return dedupeStrings([value.label, value.value, value.name]);
    }
    return [];
  }

  const normalized = String(value || '').trim();
  if (!normalized) {
    return [];
  }

  const segments = normalized
    .split(/[,\n，、]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return dedupeStrings(segments.length > 0 ? segments : [normalized]);
}

function getCompatibleRoles(type: RpaStepDefinition['type']) {
  switch (type) {
    case 'input':
      return new Set<BrowserSnapshotElementRole>(['input', 'textarea']);
    case 'select':
      return new Set<BrowserSnapshotElementRole>(['select', 'radio', 'checkbox']);
    case 'click':
      return new Set<BrowserSnapshotElementRole>(['button', 'link', 'checkbox', 'radio', 'upload', 'unknown']);
    case 'upload':
      return new Set<BrowserSnapshotElementRole>(['upload', 'button', 'input']);
    case 'extract':
      return new Set<BrowserSnapshotElementRole>(['text', 'status', 'input', 'select', 'textarea', 'link']);
    case 'download':
      return new Set<BrowserSnapshotElementRole>(['button', 'link']);
    default:
      return new Set<BrowserSnapshotElementRole>();
  }
}

function describeFieldDescriptor(input: {
  key?: string | null;
  label?: string | null;
  type?: string | null;
  processCode?: string | null;
}): FieldDescriptor {
  const presentation = describeLocalFieldPresentation({
    key: input.key,
    label: input.label,
    type: input.type,
  });

  return {
    key: normalizeText(input.key),
    aliases: presentation.aliases.map((alias) => normalizeText(alias)).filter(Boolean),
  };
}

function describeLocalFieldPresentation(input: {
  key?: string | null;
  label?: string | null;
  type?: string | null;
}) {
  const key = String(input.key || '').trim();
  const rawLabel = String(input.label || key || '').trim();
  const aliases = dedupeStrings([
    key,
    rawLabel,
    humanizeIdentifier(key),
    humanizeIdentifier(rawLabel),
  ]);

  return {
    aliases,
  };
}

function humanizeIdentifier(value: string) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function dedupeStrings(values: Array<string | undefined | null>) {
  return Array.from(new Set(
    values
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseJsonFromText(text: string) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(fencedMatch[1].trim());
      } catch {
        return null;
      }
    }

    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch?.[0]) {
      return null;
    }

    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}
