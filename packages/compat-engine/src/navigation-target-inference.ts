import { z } from 'zod';
import type { InferenceLlmClient, InferenceTraceContext } from './system-inference';

const NavigationTargetSchema = z.object({
  canResolve: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  candidateId: z.string().optional(),
  signals: z.array(z.string()).default([]),
});

export interface NavigationTargetCandidate {
  candidateId: string;
  url: string;
  sourcePhase?: 'preflight' | 'submit' | 'queryStatus' | 'unknown';
  stepIndex?: number;
}

export interface NavigationTargetInferenceInput {
  action: 'submit' | 'queryStatus';
  connectorId?: string;
  processCode?: string;
  processName?: string;
  portalUrl?: string | null;
  preferredOrigins?: string[] | null;
  candidates?: NavigationTargetCandidate[] | null;
  trace?: InferenceTraceContext;
}

export interface NavigationTargetJudgement {
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

interface ScoredNavigationCandidate {
  candidate: NavigationTargetCandidate;
  score: number;
  reasons: string[];
}

export class NavigationTargetInferenceEngine {
  private readonly llmClient: InferenceLlmClient | null;

  constructor(llmClient: InferenceLlmClient | null = NavigationTargetInferenceEngine.createDefaultClient()) {
    this.llmClient = llmClient;
  }

  async infer(input: NavigationTargetInferenceInput): Promise<NavigationTargetJudgement> {
    const heuristic = inferNavigationTargetHeuristically(input);
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
    input: NavigationTargetInferenceInput,
    heuristic: NavigationTargetJudgement,
  ): Promise<(z.infer<typeof NavigationTargetSchema> & { model?: string; usage?: NavigationTargetJudgement['usage'] }) | null> {
    if (!this.llmClient) {
      return null;
    }

    const candidates = collectNavigationCandidates(input, 20);
    if (candidates.length === 0) {
      return null;
    }

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            'You infer the best business target URL candidate for a portal-to-business SSO bridge.',
            'Select at most one existing candidateId from the provided candidates.',
            'The correct target should usually be a concrete business page for the current action, not a portal home page, shell page, login page, CAS/OAuth page, or generic landing page.',
            'Be conservative: return canResolve=false when evidence is weak or ambiguous.',
            'Return JSON only.',
            JSON.stringify({
              canResolve: true,
              confidence: 0.82,
              reason: 'why this candidate is the most likely concrete business target page',
              candidateId: 'submit:2',
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
          scope: input.trace?.scope || 'compat.navigation_target',
          traceId: input.trace?.traceId,
          tenantId: input.trace?.tenantId,
          userId: input.trace?.userId,
          tags: input.trace?.tags,
          metadata: {
            ...(input.trace?.metadata || {}),
            evidenceType: 'navigation_target',
          },
        },
      });

      if (!response.content) {
        return null;
      }

      const parsed = parseJsonFromText(response.content);
      const validated = NavigationTargetSchema.parse(parsed);
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
    input: NavigationTargetInferenceInput,
    heuristic: NavigationTargetJudgement,
    llm: z.infer<typeof NavigationTargetSchema> & { model?: string; usage?: NavigationTargetJudgement['usage'] },
  ): NavigationTargetJudgement {
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

export function inferNavigationTargetHeuristically(
  input: NavigationTargetInferenceInput,
): NavigationTargetJudgement {
  const candidates = collectNavigationCandidates(input);
  const best = candidates[0];
  const second = candidates[1];

  if (!best) {
    return {
      canResolve: false,
      confidence: 0.2,
      reasoning: ['没有可用的导航候选 URL，无法推断桥接后的目标业务页'],
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  const gap = second ? best.score - second.score : best.score;
  const canResolve = best.score >= 0.6 && gap >= 0.04;
  const ambiguityReason = second && gap < 0.04
    ? `存在接近候选 ${second.candidate.candidateId}（置信差值 ${gap.toFixed(2)}）`
    : undefined;

  if (!canResolve) {
    return {
      canResolve: false,
      matchedCandidateId: undefined,
      confidence: Math.min(0.68, best.score),
      reasoning: dedupeStrings([
        `当前最佳候选是 ${best.candidate.candidateId}，但证据仍不足以安全确认：${best.reasons.join('；')}`,
        ambiguityReason,
      ]),
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  return {
    canResolve: true,
    matchedCandidateId: best.candidate.candidateId,
    confidence: best.score,
    reasoning: dedupeStrings([
      `候选 ${best.candidate.candidateId} 最符合“桥接后的真实业务页面”特征`,
      ...best.reasons,
      ambiguityReason,
    ]),
    source: 'heuristic',
    llmSucceeded: false,
  };
}

function collectNavigationCandidates(
  input: NavigationTargetInferenceInput,
  maxCount = 50,
): ScoredNavigationCandidate[] {
  const rawCandidates = (input.candidates || [])
    .filter((candidate): candidate is NavigationTargetCandidate =>
      Boolean(candidate && typeof candidate === 'object' && typeof candidate.url === 'string' && candidate.url.trim()))
    .slice(0, maxCount);

  const seen = new Set<string>();
  const uniqueCandidates: NavigationTargetCandidate[] = [];
  for (const candidate of rawCandidates) {
    const normalizedUrl = normalizeAbsoluteUrl(candidate.url);
    if (!normalizedUrl) {
      continue;
    }
    const key = `${candidate.sourcePhase || 'unknown'}::${normalizedUrl}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueCandidates.push({
      ...candidate,
      url: normalizedUrl,
    });
  }

  const maxStepIndex = uniqueCandidates.reduce((max, candidate) =>
    Math.max(max, typeof candidate.stepIndex === 'number' ? candidate.stepIndex : -1), -1);

  return uniqueCandidates
    .map((candidate) => scoreCandidate(input, candidate, maxStepIndex))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return (right.candidate.stepIndex || 0) - (left.candidate.stepIndex || 0);
    });
}

function scoreCandidate(
  input: NavigationTargetInferenceInput,
  candidate: NavigationTargetCandidate,
  maxStepIndex: number,
): ScoredNavigationCandidate {
  const reasons: string[] = [];
  let score = 0.08;
  const candidateUrl = safeParseUrl(candidate.url);
  const portalUrl = safeParseUrl(input.portalUrl || undefined);
  const preferredOrigins = new Set((input.preferredOrigins || [])
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => Boolean(origin)));

  const origin = candidateUrl?.origin;
  const normalizedUrl = candidateUrl?.toString() || candidate.url;
  const normalizedLower = normalizedUrl.toLowerCase();

  if (origin && preferredOrigins.has(origin)) {
    score += 0.34;
    reasons.push('命中了业务系统优先 origin');
  }

  if (portalUrl?.origin && origin) {
    if (portalUrl.origin !== origin) {
      score += 0.14;
      reasons.push('候选页面已脱离门户 origin');
    } else if (!preferredOrigins.has(origin)) {
      score -= 0.22;
      reasons.push('候选仍停留在门户 origin');
    }
  }

  if (candidate.sourcePhase === input.action) {
    score += 0.22;
    reasons.push(`候选来自当前动作 ${input.action} 的导航步骤`);
  } else if (candidate.sourcePhase === 'preflight') {
    score += 0.08;
    reasons.push('候选来自 preflight 导航，通常是后续业务页入口');
  } else if (candidate.sourcePhase && candidate.sourcePhase !== 'unknown') {
    score -= 0.05;
    reasons.push(`候选来自另一条动作分支 ${candidate.sourcePhase}`);
  }

  if (looksLikeAuthOrLoginUrl(normalizedLower)) {
    score -= 0.6;
    reasons.push('URL 更像登录/认证/SSO 跳转页');
  }

  if (hasStrongRecordIdentifiers(normalizedLower)) {
    score += 0.12;
    reasons.push('URL 中包含强业务标识参数（如 templateId / formId / recordId）');
  }

  if (candidateUrl && !isRootLikePath(candidateUrl.pathname)) {
    score += 0.08;
    reasons.push('URL 不是根路径壳页');
  } else if (candidateUrl) {
    score -= 0.14;
    reasons.push('URL 更像根路径壳页');
  }

  if (typeof candidate.stepIndex === 'number' && maxStepIndex >= 0) {
    const stepWeight = maxStepIndex === 0 ? 1 : candidate.stepIndex / Math.max(1, maxStepIndex);
    if (stepWeight > 0) {
      score += 0.06 * stepWeight;
      reasons.push('候选位于较靠后的导航步骤，更可能是最终目标页');
    }
  }

  return {
    candidate,
    score: clamp(score, 0, 0.99),
    reasons,
  };
}

function buildLlmEvidence(
  input: NavigationTargetInferenceInput,
  heuristic: NavigationTargetJudgement,
  candidates: ScoredNavigationCandidate[],
) {
  return {
    action: input.action,
    connectorId: input.connectorId || null,
    processCode: input.processCode || null,
    processName: input.processName || null,
    portalUrl: input.portalUrl || null,
    preferredOrigins: (input.preferredOrigins || []).filter(Boolean),
    heuristicBaseline: {
      canResolve: heuristic.canResolve,
      matchedCandidateId: heuristic.matchedCandidateId || null,
      confidence: heuristic.confidence,
      reasoning: heuristic.reasoning,
    },
    candidates: candidates.slice(0, 20).map((item) => ({
      candidateId: item.candidate.candidateId,
      url: item.candidate.url,
      sourcePhase: item.candidate.sourcePhase || 'unknown',
      stepIndex: item.candidate.stepIndex ?? null,
      heuristicScore: item.score,
      heuristicReasons: item.reasons,
    })),
  };
}

function looksLikeAuthOrLoginUrl(text: string) {
  return /(login|logout|oauth|cas|sso|token|authorize|auth\/|signin|sign-in)/i.test(text);
}

function hasStrongRecordIdentifiers(text: string) {
  return /(templateid|formid|recordid|summaryid|workflowid|processid|flowid|bizid|affairid)=/i.test(text);
}

function isRootLikePath(pathname?: string) {
  const normalized = String(pathname || '').trim();
  return !normalized || normalized === '/' || normalized === '/index' || normalized === '/index.html';
}

function normalizeAbsoluteUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) {
    return undefined;
  }
  try {
    return new URL(raw).toString();
  } catch {
    return undefined;
  }
}

function safeParseUrl(value?: string | null) {
  const normalized = normalizeAbsoluteUrl(value);
  if (!normalized) {
    return undefined;
  }
  try {
    return new URL(normalized);
  } catch {
    return undefined;
  }
}

function normalizeOrigin(value?: string | null) {
  const url = safeParseUrl(value);
  return url?.origin;
}

function dedupeStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
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
