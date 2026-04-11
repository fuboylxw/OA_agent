// ============================================================
// API Parse Pipeline — 统一类型定义
// ============================================================

// ── Stage 1: 文档标准化输出 ──────────────────────────────────

export type DocFormat =
  | 'openapi'
  | 'swagger'
  | 'postman'
  | 'har'
  | 'unknown-json'
  | 'unknown-text';

export interface NormalizedEndpoint {
  path: string;
  method: string;
  summary: string;
  tags: string[];
  parameters: NormalizedParam[];
  requestBody?: {
    contentType: string;
    schema: Record<string, any>;
  };
  responseSchema?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface NormalizedParam {
  name: string;
  in: 'query' | 'path' | 'header' | 'body';
  type: string;
  required: boolean;
  description: string;
  enum?: any[];
  default?: any;
}

export interface NormalizeResult {
  format: DocFormat;
  baseUrl?: string;
  authHint?: {
    type: string;
    headerName?: string;
  };
  endpoints: NormalizedEndpoint[];
  rawEndpointCount: number;
}

// ── Stage 2: 业务流程识别输出 ────────────────────────────────

export type EndpointRole =
  | 'submit'
  | 'query'
  | 'cancel'
  | 'urge'
  | 'approve'
  | 'list'
  | 'status_query'
  | 'batch_query'
  | 'webhook_register'
  | 'reference_data'
  | 'auth_login'
  | 'flow_list'
  | 'other';

export interface WorkflowEndpoint {
  role: EndpointRole;
  endpoint: NormalizedEndpoint;
}

export interface IdentifiedWorkflow {
  processCode: string;
  processName: string;
  category: string;
  description: string;
  confidence: number;
  endpoints: WorkflowEndpoint[];
}

export interface DetectedSyncCapabilities {
  webhookEndpoint?: {
    path: string;
    method: string;
    description: string;
  };
  batchQueryEndpoint?: {
    path: string;
    method: string;
    description: string;
  };
  singleQueryEndpoints: Array<{
    processCode: string;
    path: string;
    method: string;
  }>;
  /** 流程列表接口 — 用于运行时动态发现流程类型 */
  flowListEndpoint?: {
    path: string;
    method: string;
    description: string;
    /** LLM 推断的响应中流程列表字段路径，如 "data.items" */
    responseListPath?: string;
    /** LLM 推断的每个流程项中的关键字段映射 */
    fieldMapping?: {
      code?: string;   // 流程编码字段，如 "formType"、"templateId"
      name?: string;   // 流程名称字段，如 "name"、"title"
      category?: string; // 分类字段
    };
  };
}

export interface IdentifyResult {
  workflows: IdentifiedWorkflow[];
  syncCapabilities: DetectedSyncCapabilities;
  filteredCount: number;
}

// ── Stage 3: 端点验证输出 ────────────────────────────────────

export type ProbeStatus =
  | 'reachable'
  | 'unreachable'
  | 'auth_failed'
  | 'not_found'
  | 'server_error'
  | 'unknown';

export interface ProbeResult {
  path: string;
  method: string;
  status: ProbeStatus;
  statusCode?: number;
  responseTimeMs?: number;
  error?: string;
}

export interface ValidationReport {
  overall: 'passed' | 'partial' | 'failed' | 'skipped';
  connectivity: boolean;
  authValid: boolean;
  endpoints: ProbeResult[];
  summary: {
    total: number;
    reachable: number;
    unreachable: number;
    unknown: number;
  };
}

// ── Stage 4: MCP 生成输出 ────────────────────────────────────

export interface GeneratedTool {
  toolName: string;
  toolDescription: string;
  category: string;
  flowCode: string | null;
  apiEndpoint: string;
  httpMethod: string;
  validated?: ProbeStatus;
}

export interface GenerateResult {
  connectorId: string;
  tools: GeneratedTool[];
  processTemplates: Array<{
    processCode: string;
    processName: string;
    category: string;
    templateId: string;
  }>;
  syncStrategy: SyncStrategy;
}

// ── 同步相关类型 ─────────────────────────────────────────────

export type SyncPrimary = 'webhook' | 'batch_polling' | 'single_polling' | 'manual';

export interface SyncStrategy {
  primary: SyncPrimary;
  fallback: SyncPrimary | null;
  pollingIntervalMs: number;
  webhookRegisterToolName?: string;
  statusQueryToolName?: string;
  batchQueryToolName?: string;
}

export interface StatusMappingConfig {
  statusFieldPath: string;
  rules: Array<{
    match: string;
    localStatus: string;
  }>;
  defaultStatus: string;
}

export interface InferredStatusMapping {
  statusFieldPath: string;
  rules: Array<{
    remoteValue: string;
    localStatus: string;
    confidence: number;
  }>;
}

// ── 编排层输入/输出 ──────────────────────────────────────────

export interface ParseAndGenerateInput {
  tenantId: string;
  connectorId: string;
  docContent?: string;
  docUrl?: string;
  baseUrl?: string;
  authConfig?: Record<string, any>;
  autoValidate?: boolean;
}

export interface ParseAndGenerateOutput {
  detectedFormat: DocFormat;
  totalEndpoints: number;
  identifiedWorkflows: number;
  generatedTools: number;
  workflows: Array<{
    processCode: string;
    processName: string;
    category: string;
    confidence: number;
    tools: Array<{
      toolName: string;
      category: string;
      validated?: ProbeStatus;
    }>;
  }>;
  syncStrategy: SyncStrategy;
  validation?: ValidationReport;
  warnings: string[];
}
