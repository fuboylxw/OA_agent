import { z } from 'zod';

export type SystemAuthType = 'oauth2' | 'basic' | 'apikey' | 'cookie' | 'bearer' | 'none' | 'unknown';
export type SystemOaType = 'openapi' | 'form-page' | 'hybrid';
export type SystemInteractionModel = 'api' | 'page' | 'hybrid';

export interface InferenceEndpointInput {
  method?: string;
  path?: string;
  category?: string;
}

export interface InferenceProcessInput {
  processCode?: string;
  processName?: string;
  category?: string;
  endpoints?: InferenceEndpointInput[];
}

export interface AuthCandidate {
  type: SystemAuthType;
  confidence: number;
  reason: string;
  headerName?: string;
  headerPrefix?: string;
}

export interface LoginEndpointCandidate {
  method: string;
  path: string;
  confidence: number;
  reason: string;
}

export interface AuthHint {
  type?: SystemAuthType;
  headerName?: string;
  headerPrefix?: string;
}

export interface SystemShapeInference {
  oaType: SystemOaType;
  interactionModel: SystemInteractionModel;
  portalBridgeSuspected: boolean;
  confidence: number;
  reason: string;
}

export interface InferenceTraceContext {
  scope?: string;
  traceId?: string;
  tenantId?: string;
  userId?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface InferenceLlmResponse {
  content: string | null;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface InferenceLlmClient {
  chat(
    messages: Array<{ role: string; content: string | null }>,
    options?: { trace?: InferenceTraceContext },
  ): Promise<InferenceLlmResponse>;
}

export interface SystemInferenceInput {
  baseUrl?: string;
  oaUrl?: string;
  openApiUrl?: string;
  harFileUrl?: string;
  sourceBundleUrl?: string;
  apiDoc?: string | null;
  processes?: InferenceProcessInput[];
  userAuth?: Record<string, any>;
  trace?: InferenceTraceContext;
}

export interface SystemInferenceResult {
  preferredAuthType: SystemAuthType;
  oaType: SystemOaType;
  authCandidates: AuthCandidate[];
  authHint?: AuthHint;
  loginEndpoints: LoginEndpointCandidate[];
  noAuthProbeTargets: string[];
  systemShape: SystemShapeInference;
  signals: string[];
  source: 'heuristic' | 'llm' | 'mixed';
  llmSucceeded: boolean;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const AUTH_TYPES: SystemAuthType[] = ['oauth2', 'basic', 'apikey', 'cookie', 'bearer', 'none', 'unknown'];
const OA_TYPES: SystemOaType[] = ['openapi', 'form-page', 'hybrid'];
const INTERACTION_MODELS: SystemInteractionModel[] = ['api', 'page', 'hybrid'];

const LlmAuthCandidateSchema = z.object({
  type: z.enum(AUTH_TYPES as [SystemAuthType, ...SystemAuthType[]]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  headerName: z.string().optional(),
  headerPrefix: z.string().optional(),
});

const LlmLoginEndpointSchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

const LlmSystemInferenceSchema = z.object({
  preferredAuthType: z.enum(AUTH_TYPES as [SystemAuthType, ...SystemAuthType[]]),
  oaType: z.enum(OA_TYPES as [SystemOaType, ...SystemOaType[]]),
  interactionModel: z.enum(INTERACTION_MODELS as [SystemInteractionModel, ...SystemInteractionModel[]]),
  portalBridgeSuspected: z.boolean(),
  confidence: z.number().min(0).max(1).default(0.5),
  authCandidates: z.array(LlmAuthCandidateSchema).default([]),
  authHint: z.object({
    type: z.enum(AUTH_TYPES as [SystemAuthType, ...SystemAuthType[]]).optional(),
    headerName: z.string().optional(),
    headerPrefix: z.string().optional(),
  }).optional(),
  loginEndpoints: z.array(LlmLoginEndpointSchema).default([]),
  signals: z.array(z.string()).default([]),
});

type ParsedSecurityScheme = {
  name?: string;
  type?: string;
  in?: string;
  scheme?: string;
};

type ParsedDocSummary = {
  jsonDoc?: Record<string, any>;
  samplePaths: string[];
  authLikePaths: string[];
  securitySchemes: ParsedSecurityScheme[];
  serverUrls: string[];
};

export class SystemInferenceEngine {
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

  private readonly llmClient: InferenceLlmClient | null;

  constructor(llmClient: InferenceLlmClient | null = SystemInferenceEngine.createDefaultClient()) {
    this.llmClient = llmClient;
  }

  async infer(input: SystemInferenceInput): Promise<SystemInferenceResult> {
    const heuristic = this.inferHeuristically(input);
    const llmResult = await this.tryInferWithLLM(input, heuristic);

    if (!llmResult) {
      return heuristic;
    }

    return this.mergeInferenceResults(heuristic, llmResult);
  }

  private inferHeuristically(input: SystemInferenceInput): SystemInferenceResult {
    const docSummary = this.summarizeApiDoc(input.apiDoc);
    const authCandidates = new Map<SystemAuthType, AuthCandidate>();
    const signals = new Set<string>();
    const explicitAuthType = this.normalizeExplicitAuthType(input.userAuth?.authType);

    if (input.openApiUrl || docSummary.samplePaths.length > 0) {
      signals.add('Observed structured API evidence');
    }
    if (input.harFileUrl) {
      signals.add('Observed page/HAR evidence');
    }
    if ((input.processes || []).some((process) => this.processLooksPageOrVision(process))) {
      signals.add('Observed page-execution process definitions');
    }
    if (docSummary.securitySchemes.length > 0) {
      signals.add(`Observed ${docSummary.securitySchemes.length} security scheme definitions`);
    }

    for (const scheme of docSummary.securitySchemes) {
      if (scheme.type === 'oauth2') {
        this.upsertAuthCandidate(authCandidates, {
          type: 'oauth2',
          confidence: 0.92,
          reason: 'Security scheme explicitly declares oauth2',
        });
        continue;
      }
      if (scheme.type === 'http' && scheme.scheme === 'basic') {
        this.upsertAuthCandidate(authCandidates, {
          type: 'basic',
          confidence: 0.9,
          reason: 'Security scheme explicitly declares basic auth',
        });
        continue;
      }
      if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        this.upsertAuthCandidate(authCandidates, {
          type: 'bearer',
          confidence: 0.9,
          reason: 'Security scheme explicitly declares bearer auth',
          headerName: 'Authorization',
          headerPrefix: 'Bearer ',
        });
        continue;
      }
      if (scheme.type === 'apiKey' && scheme.in === 'cookie') {
        this.upsertAuthCandidate(authCandidates, {
          type: 'cookie',
          confidence: 0.88,
          reason: 'Security scheme declares cookie-carried apiKey/session',
          headerName: scheme.name,
        });
        continue;
      }
      if (scheme.type === 'apiKey') {
        this.upsertAuthCandidate(authCandidates, {
          type: 'apikey',
          confidence: 0.88,
          reason: 'Security scheme declares apiKey authentication',
          headerName: scheme.name,
        });
      }
    }

    const userAuth = input.userAuth || {};
    if (explicitAuthType && explicitAuthType !== 'unknown') {
      signals.add(`User explicitly selected auth type: ${explicitAuthType}`);
      this.upsertAuthCandidate(authCandidates, {
        type: explicitAuthType,
        confidence: 0.82,
        reason: 'User supplied an explicit auth type',
        headerName: userAuth.headerName,
        headerPrefix: userAuth.headerPrefix,
      });
    }

    if (userAuth.headerName && userAuth.token) {
      signals.add('User provided an explicit token header');
      const headerName = String(userAuth.headerName).trim();
      const headerPrefix = typeof userAuth.headerPrefix === 'string' ? userAuth.headerPrefix : undefined;
      this.upsertAuthCandidate(authCandidates, {
        type: headerName.toLowerCase() === 'authorization' && /^bearer\s*$/i.test(String(headerPrefix || '').trim())
          ? 'bearer'
          : 'apikey',
        confidence: 0.78,
        reason: 'User supplied the exact token transport header',
        headerName,
        headerPrefix,
      });
    }

    if (userAuth.username && userAuth.password && explicitAuthType === 'basic') {
      signals.add('User provided username/password credentials');
      this.upsertAuthCandidate(authCandidates, {
        type: 'basic',
        confidence: 0.8,
        reason: 'User explicitly selected basic auth and supplied username/password',
      });
    }

    const loginEndpoints = this.collectLoginEndpoints(input.processes, docSummary);
    if (loginEndpoints.length > 0) {
      signals.add(`Observed ${loginEndpoints.length} explicitly categorized auth endpoints`);
      this.upsertAuthCandidate(authCandidates, {
        type: explicitAuthType && explicitAuthType !== 'unknown' ? explicitAuthType : 'unknown',
        confidence: explicitAuthType && explicitAuthType !== 'unknown' ? 0.62 : 0.3,
        reason: 'Auth endpoint presence is explicit, but auth protocol is not inferred from endpoint text',
      });
    }

    const { oaType, interactionModel, hasStructuredApiEvidence, hasPageEvidence } = this.inferSystemShape(input, docSummary);
    const portalBridgeSuspected = this.detectPortalBridgeSuspicion(input, docSummary);
    if (portalBridgeSuspected) {
      signals.add('Observed cross-origin / SSO-like bridge signals');
    }

    if (!hasStructuredApiEvidence && !hasPageEvidence) {
      signals.add('Evidence is sparse; fallback confidence is low');
    }

    if (authCandidates.size === 0) {
      this.upsertAuthCandidate(authCandidates, {
        type: 'unknown',
        confidence: 0.2,
        reason: 'No explicit auth evidence was observed',
      });
    }

    const orderedAuthCandidates = Array.from(authCandidates.values()).sort((left, right) => right.confidence - left.confidence);
    const preferredAuthType = orderedAuthCandidates[0]?.type || 'unknown';
    const authHint = this.pickAuthHint(orderedAuthCandidates);
    const noAuthProbeTargets = this.buildNoAuthProbeTargets(input.baseUrl || input.oaUrl || '', input.processes, docSummary);

    return {
      preferredAuthType,
      oaType,
      authCandidates: orderedAuthCandidates,
      authHint,
      loginEndpoints,
      noAuthProbeTargets,
      systemShape: {
        oaType,
        interactionModel,
        portalBridgeSuspected,
        confidence: this.estimateShapeConfidence({ hasStructuredApiEvidence, hasPageEvidence, portalBridgeSuspected }),
        reason: this.describeSystemShapeReason({ oaType, hasStructuredApiEvidence, hasPageEvidence, portalBridgeSuspected }),
      },
      signals: Array.from(signals),
      source: 'heuristic',
      llmSucceeded: false,
    };
  }

  private async tryInferWithLLM(
    input: SystemInferenceInput,
    heuristic: SystemInferenceResult,
  ): Promise<(z.infer<typeof LlmSystemInferenceSchema> & { model?: string; usage?: SystemInferenceResult['usage'] }) | null> {
    if (!this.llmClient) {
      return null;
    }

    const evidenceSummary = this.buildEvidenceSummary(input, heuristic);
    const prompt = [
      'Infer the most likely system/auth shape from the evidence below.',
      'Rules:',
      '- Use only the supplied evidence.',
      '- Do not invent vendor-specific knowledge or made-up paths.',
      '- loginEndpoints must come from observed evidence only.',
      '- Prefer uncertainty over false confidence.',
      '- Return JSON only.',
      '',
      JSON.stringify(evidenceSummary, null, 2),
    ].join('\n');

    try {
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: [
            'You are a system/auth inference engine for enterprise process systems.',
            'Infer likely auth types, likely login endpoints, and whether the system is API/page/hybrid.',
            'Return a single JSON object matching this structure:',
            JSON.stringify({
              preferredAuthType: 'oauth2|basic|apikey|cookie|bearer|none|unknown',
              oaType: 'openapi|form-page|hybrid',
              interactionModel: 'api|page|hybrid',
              portalBridgeSuspected: true,
              confidence: 0.5,
              authCandidates: [
                {
                  type: 'apikey',
                  confidence: 0.8,
                  reason: 'why',
                  headerName: 'X-API-Key',
                  headerPrefix: '',
                },
              ],
              authHint: {
                type: 'apikey',
                headerName: 'Authorization',
                headerPrefix: 'Bearer ',
              },
              loginEndpoints: [
                {
                  method: 'POST',
                  path: '/api/login',
                  confidence: 0.7,
                  reason: 'why',
                },
              ],
              signals: ['short evidence-based bullets'],
            }),
          ].join('\n'),
        },
        { role: 'user', content: prompt },
      ], {
        trace: {
          scope: input.trace?.scope || 'compat.system_inference',
          traceId: input.trace?.traceId,
          tenantId: input.trace?.tenantId,
          userId: input.trace?.userId,
          tags: input.trace?.tags,
          metadata: {
            ...(input.trace?.metadata || {}),
            baseUrl: input.baseUrl || null,
            hasApiDoc: !!input.apiDoc,
            processCount: input.processes?.length || 0,
          },
        },
      });

      if (!response.content) {
        return null;
      }

      const parsed = this.parseJsonFromText(response.content);
      const validated = LlmSystemInferenceSchema.parse(parsed);
      return {
        ...validated,
        model: response.model,
        usage: response.usage,
      };
    } catch {
      return null;
    }
  }

  private mergeInferenceResults(
    heuristic: SystemInferenceResult,
    llm: z.infer<typeof LlmSystemInferenceSchema> & { model?: string; usage?: SystemInferenceResult['usage'] },
  ): SystemInferenceResult {
    const llmAuthCandidates: AuthCandidate[] = llm.authCandidates.map((candidate): AuthCandidate => ({
      type: candidate.type,
      confidence: candidate.confidence,
      reason: candidate.reason.trim(),
      headerName: candidate.headerName,
      headerPrefix: candidate.headerPrefix,
    }));
    const llmLoginEndpoints: LoginEndpointCandidate[] = llm.loginEndpoints.map((endpoint): LoginEndpointCandidate => ({
      method: endpoint.method.toUpperCase(),
      path: endpoint.path,
      confidence: endpoint.confidence,
      reason: endpoint.reason.trim(),
    }));
    const authCandidates = this.mergeAuthCandidates(heuristic.authCandidates, llmAuthCandidates);
    const loginEndpoints = this.mergeLoginEndpoints(heuristic.loginEndpoints, llmLoginEndpoints);

    const preferredAuthType = llm.preferredAuthType !== 'unknown'
      ? llm.preferredAuthType
      : authCandidates[0]?.type || heuristic.preferredAuthType;

    return {
      preferredAuthType,
      oaType: llm.oaType || heuristic.oaType,
      authCandidates,
      authHint: llm.authHint || this.pickAuthHint(authCandidates) || heuristic.authHint,
      loginEndpoints,
      noAuthProbeTargets: heuristic.noAuthProbeTargets,
      systemShape: {
        oaType: llm.oaType || heuristic.systemShape.oaType,
        interactionModel: llm.interactionModel || heuristic.systemShape.interactionModel,
        portalBridgeSuspected: llm.portalBridgeSuspected,
        confidence: Math.max(heuristic.systemShape.confidence, llm.confidence),
        reason: llm.portalBridgeSuspected === heuristic.systemShape.portalBridgeSuspected
          ? heuristic.systemShape.reason
          : `LLM revised bridge suspicion based on the combined evidence (confidence=${llm.confidence.toFixed(2)})`,
      },
      signals: Array.from(new Set([...heuristic.signals, ...llm.signals.map((signal) => signal.trim()).filter(Boolean)])),
      source: 'mixed',
      llmSucceeded: true,
      model: llm.model,
      usage: llm.usage,
    };
  }

  private mergeAuthCandidates(
    heuristic: AuthCandidate[],
    llm: AuthCandidate[],
  ): AuthCandidate[] {
    const merged = new Map<SystemAuthType, AuthCandidate>();
    for (const candidate of [...heuristic, ...llm]) {
      this.upsertAuthCandidate(merged, candidate);
    }
    return Array.from(merged.values()).sort((left, right) => right.confidence - left.confidence);
  }

  private mergeLoginEndpoints(
    heuristic: LoginEndpointCandidate[],
    llm: LoginEndpointCandidate[],
  ): LoginEndpointCandidate[] {
    const merged = new Map<string, LoginEndpointCandidate>();
    for (const endpoint of [...heuristic, ...llm]) {
      if (!endpoint.path || !endpoint.method) {
        continue;
      }
      const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
      const existing = merged.get(key);
      if (!existing || endpoint.confidence > existing.confidence) {
        merged.set(key, {
          method: endpoint.method.toUpperCase(),
          path: endpoint.path,
          confidence: endpoint.confidence,
          reason: endpoint.reason,
        });
      }
    }

    return Array.from(merged.values()).sort((left, right) => right.confidence - left.confidence);
  }

  private summarizeApiDoc(apiDoc?: string | null): ParsedDocSummary {
    const raw = this.extractPrimaryDocument(apiDoc);
    const jsonDoc = this.tryParseJson(raw);

    if (!jsonDoc || typeof jsonDoc !== 'object') {
      return {
        samplePaths: [],
        authLikePaths: [],
        securitySchemes: [],
        serverUrls: [],
      };
    }

    const allPaths = Object.keys((jsonDoc as any).paths || {});
    return {
      jsonDoc: jsonDoc as Record<string, any>,
      samplePaths: allPaths.slice(0, 60),
      authLikePaths: [],
      securitySchemes: this.collectSecuritySchemes(jsonDoc as Record<string, any>),
      serverUrls: Array.isArray((jsonDoc as any).servers)
        ? (jsonDoc as any).servers
          .map((server: any) => server?.url)
          .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
          .slice(0, 10)
        : [],
    };
  }

  private collectSecuritySchemes(doc: Record<string, any>): ParsedSecurityScheme[] {
    const schemes = doc.components?.securitySchemes || doc.securityDefinitions || {};
    const results: ParsedSecurityScheme[] = [];
    for (const [name, value] of Object.entries(schemes)) {
      const scheme = value as Record<string, any>;
      results.push({
        name: typeof scheme.name === 'string' ? scheme.name : name,
        type: typeof scheme.type === 'string' ? scheme.type : undefined,
        in: typeof scheme.in === 'string' ? scheme.in : undefined,
        scheme: typeof scheme.scheme === 'string' ? scheme.scheme.toLowerCase() : undefined,
      });
    }
    return results;
  }

  private collectLoginEndpoints(
    processes: InferenceProcessInput[] | undefined,
    docSummary: ParsedDocSummary,
  ): LoginEndpointCandidate[] {
    const results = new Map<string, LoginEndpointCandidate>();

    for (const process of processes || []) {
      for (const endpoint of process.endpoints || []) {
        const method = String(endpoint.method || 'GET').toUpperCase();
        const path = String(endpoint.path || '').trim();
        if (!path || !this.isExplicitAuthCategory(endpoint.category)) {
          continue;
        }
        const key = `${method} ${path}`;
        results.set(key, {
          method,
          path,
          confidence: 0.78,
          reason: `Observed explicit auth category in parsed process ${process.processCode || process.processName || 'unknown'}`,
        });
      }
    }

    const doc = docSummary.jsonDoc;
    if (doc?.paths && typeof doc.paths === 'object') {
      for (const [path, pathItem] of Object.entries(doc.paths)) {
        for (const method of Object.keys((pathItem as Record<string, any>) || {})) {
          const operation = (pathItem as Record<string, any>)[method] || {};
          if (!this.isExplicitAuthCategory(this.readExplicitPurpose(operation))) {
            continue;
          }
          const key = `${method.toUpperCase()} ${path}`;
          results.set(key, {
            method: method.toUpperCase(),
            path,
            confidence: 0.84,
            reason: 'Observed explicit auth category in API operation metadata',
          });
        }
      }
    }

    return Array.from(results.values()).sort((left, right) => right.confidence - left.confidence);
  }

  private inferSystemShape(
    input: SystemInferenceInput,
    docSummary: ParsedDocSummary,
  ): {
    oaType: SystemOaType;
    interactionModel: SystemInteractionModel;
    hasStructuredApiEvidence: boolean;
    hasPageEvidence: boolean;
  } {
    const hasStructuredApiEvidence = !!input.openApiUrl || docSummary.samplePaths.length > 0;
    const hasPageEvidence = !!input.harFileUrl || (input.processes || []).some((process) => this.processLooksPageOrVision(process));

    if (hasStructuredApiEvidence && hasPageEvidence) {
      return { oaType: 'hybrid', interactionModel: 'hybrid', hasStructuredApiEvidence, hasPageEvidence };
    }
    if (hasStructuredApiEvidence) {
      return { oaType: 'openapi', interactionModel: 'api', hasStructuredApiEvidence, hasPageEvidence };
    }
    return { oaType: 'form-page', interactionModel: 'page', hasStructuredApiEvidence, hasPageEvidence };
  }

  private detectPortalBridgeSuspicion(input: SystemInferenceInput, docSummary: ParsedDocSummary): boolean {
    const originSet = new Set<string>();
    for (const candidate of [input.baseUrl, input.oaUrl, input.openApiUrl, input.harFileUrl, ...docSummary.serverUrls]) {
      const origin = this.tryGetOrigin(candidate);
      if (origin) {
        originSet.add(origin);
      }
    }

    return originSet.size > 1;
  }

  private buildNoAuthProbeTargets(
    baseUrl: string,
    processes: InferenceProcessInput[] | undefined,
    docSummary: ParsedDocSummary,
  ): string[] {
    const targets = new Set<string>();

    for (const process of processes || []) {
      for (const endpoint of process.endpoints || []) {
        const method = String(endpoint.method || '').toUpperCase();
        const path = String(endpoint.path || '').trim();
        if (method !== 'GET' || !path || path.includes('{')) {
          continue;
        }
        const fullUrl = this.toAbsoluteUrl(baseUrl, path);
        if (fullUrl) {
          targets.add(fullUrl);
        }
      }
    }

    for (const path of docSummary.samplePaths) {
      if (path.includes('{')) {
        continue;
      }
      const fullUrl = this.toAbsoluteUrl(baseUrl, path);
      if (fullUrl) {
        targets.add(fullUrl);
      }
    }

    if (targets.size === 0 && baseUrl) {
      const normalizedBaseUrl = this.toAbsoluteUrl(baseUrl, '/');
      if (normalizedBaseUrl) {
        targets.add(normalizedBaseUrl);
      }
    }

    return Array.from(targets).slice(0, 20);
  }

  private buildEvidenceSummary(
    input: SystemInferenceInput,
    heuristic: SystemInferenceResult,
  ) {
    const docSummary = this.summarizeApiDoc(input.apiDoc);
    const processSamples = (input.processes || []).slice(0, 12).map((process) => ({
      processCode: process.processCode,
      processName: process.processName,
      category: process.category,
      endpointCount: process.endpoints?.length || 0,
      sampleEndpoints: (process.endpoints || []).slice(0, 6).map((endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
        category: endpoint.category,
      })),
    }));

    return {
      urls: {
        baseUrl: input.baseUrl || null,
        oaUrl: input.oaUrl || null,
        openApiUrl: input.openApiUrl || null,
        harFileUrl: input.harFileUrl || null,
        sourceBundleUrl: input.sourceBundleUrl || null,
      },
      userAuthShape: {
        explicitAuthType: input.userAuth?.authType || null,
        hasToken: !!input.userAuth?.token,
        hasUsernamePassword: !!(input.userAuth?.username && input.userAuth?.password),
        declaredHeaderName: input.userAuth?.headerName || null,
        declaredHeaderPrefix: input.userAuth?.headerPrefix || null,
      },
      apiDocSummary: {
        hasJsonDoc: !!docSummary.jsonDoc,
        pathCount: docSummary.samplePaths.length,
        samplePaths: docSummary.samplePaths.slice(0, 20),
        authLikePaths: docSummary.authLikePaths.slice(0, 10),
        securitySchemes: docSummary.securitySchemes,
        serverUrls: docSummary.serverUrls,
      },
      processSummary: {
        count: input.processes?.length || 0,
        samples: processSamples,
      },
      heuristicBaseline: {
        preferredAuthType: heuristic.preferredAuthType,
        oaType: heuristic.oaType,
        authCandidates: heuristic.authCandidates,
        loginEndpoints: heuristic.loginEndpoints,
        signals: heuristic.signals,
      },
    };
  }

  private estimateShapeConfidence(input: {
    hasStructuredApiEvidence: boolean;
    hasPageEvidence: boolean;
    portalBridgeSuspected: boolean;
  }) {
    let confidence = 0.45;
    if (input.hasStructuredApiEvidence) confidence += 0.2;
    if (input.hasPageEvidence) confidence += 0.2;
    if (input.portalBridgeSuspected) confidence += 0.05;
    return Math.min(confidence, 0.95);
  }

  private describeSystemShapeReason(input: {
    oaType: SystemOaType;
    hasStructuredApiEvidence: boolean;
    hasPageEvidence: boolean;
    portalBridgeSuspected: boolean;
  }) {
    const parts = [
      input.hasStructuredApiEvidence ? 'structured API evidence present' : 'no structured API evidence',
      input.hasPageEvidence ? 'page/runtime evidence present' : 'no page/runtime evidence',
    ];
    if (input.portalBridgeSuspected) {
      parts.push('cross-origin or SSO bridge signals present');
    }
    return `${input.oaType} inferred because ${parts.join(', ')}`;
  }

  private upsertAuthCandidate(
    collection: Map<SystemAuthType, AuthCandidate>,
    candidate: AuthCandidate,
  ) {
    const nextCandidate: AuthCandidate = {
      ...candidate,
      reason: candidate.reason.trim(),
      headerName: candidate.headerName?.trim() || undefined,
      headerPrefix: candidate.headerPrefix ?? undefined,
      confidence: Math.max(0, Math.min(candidate.confidence, 1)),
    };
    const existing = collection.get(nextCandidate.type);
    if (!existing || nextCandidate.confidence > existing.confidence) {
      collection.set(nextCandidate.type, nextCandidate);
      return;
    }
    if (existing.reason !== nextCandidate.reason) {
      collection.set(nextCandidate.type, {
        ...existing,
        reason: `${existing.reason}; ${nextCandidate.reason}`,
      });
    }
  }

  private pickAuthHint(authCandidates: AuthCandidate[]): AuthHint | undefined {
    const hinted = authCandidates.find((candidate) => candidate.headerName || candidate.headerPrefix);
    if (!hinted) {
      return authCandidates[0]
        ? { type: authCandidates[0].type }
        : undefined;
    }
    return {
      type: hinted.type,
      headerName: hinted.headerName,
      headerPrefix: hinted.headerPrefix,
    };
  }

  private processLooksPageOrVision(process: InferenceProcessInput) {
    return (process.endpoints || []).some((endpoint) => {
      const method = String(endpoint.method || '').toUpperCase();
      const path = String(endpoint.path || '');
      return method === 'RPA' || path.startsWith('rpa://') || path.startsWith('url://');
    });
  }

  private normalizeExplicitAuthType(value: unknown): SystemAuthType | null {
    const normalized = String(value || '').trim().toLowerCase();
    return (AUTH_TYPES as string[]).includes(normalized) ? normalized as SystemAuthType : null;
  }

  private isExplicitAuthCategory(value: unknown) {
    return ['auth', 'authentication', 'login', 'token', 'oauth2'].includes(String(value || '').trim().toLowerCase());
  }

  private readExplicitPurpose(operation: Record<string, any>) {
    return operation['x-uniflow-purpose']
      || operation['x-oa-purpose']
      || operation['x-purpose']
      || operation['x-capability']
      || operation.purpose
      || operation.category;
  }

  private extractPrimaryDocument(apiDoc?: string | null) {
    return String(apiDoc || '').split('\n===').shift() || '';
  }

  private tryParseJson(raw: string) {
    if (!raw.trim()) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private parseJsonFromText(text: string) {
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
            // continue to next candidate text
          }
        }
      }
    }
    throw new Error('LLM did not return valid JSON');
  }

  private tryGetOrigin(value?: string) {
    if (!value) {
      return null;
    }
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }

  private toAbsoluteUrl(baseUrl: string, path: string) {
    try {
      if (!baseUrl && /^https?:\/\//i.test(path)) {
        return path;
      }
      if (!baseUrl) {
        return null;
      }
      return new URL(path, baseUrl).toString();
    } catch {
      return null;
    }
  }
}
