// ============================================================
// OA Compatibility Level (OCL)
// ============================================================
export enum OCLLevel {
  OCL0 = 'OCL0', // 不可接入
  OCL1 = 'OCL1', // 只读接入
  OCL2 = 'OCL2', // 半写接入
  OCL3 = 'OCL3', // 可自动提交
  OCL4 = 'OCL4', // 深度集成
  OCL5 = 'OCL5', // 全生命周期
}

// ============================================================
// Flow Automation Level (FAL)
// ============================================================
export enum FALLevel {
  F0 = 'F0', // 仅流程指引
  F1 = 'F1', // 智能填单
  F2 = 'F2', // 半自动
  F3 = 'F3', // 全自动提交
  F4 = 'F4', // 无人值守
}

// ============================================================
// Bootstrap Job Status
// ============================================================
export enum BootstrapJobStatus {
  CREATED = 'CREATED',
  DISCOVERING = 'DISCOVERING',
  PARSING = 'PARSING',
  AUTH_PROBING = 'AUTH_PROBING',
  VALIDATING = 'VALIDATING',
  SELF_HEALING = 'SELF_HEALING',
  REVALIDATING = 'REVALIDATING',
  NORMALIZING = 'NORMALIZING',
  COMPILING = 'COMPILING',
  AUTO_RECOVERING = 'AUTO_RECOVERING',
  AUTO_RECONCILING = 'AUTO_RECONCILING',
  REPLAYING = 'REPLAYING',
  REVIEW = 'REVIEW',
  PUBLISHED = 'PUBLISHED',
  PARTIALLY_PUBLISHED = 'PARTIALLY_PUBLISHED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  CONNECTOR_DELETED = 'CONNECTOR_DELETED',
  FAILED = 'FAILED',
}

// ============================================================
// Bootstrap Source Type
// ============================================================
export enum BootstrapSourceType {
  OA_URL = 'oa_url',
  SOURCE_BUNDLE = 'source_bundle',
  OPENAPI = 'openapi',
  HAR = 'har',
  FILE = 'file',
}

// ============================================================
// OA Type
// ============================================================
export enum OAType {
  OPENAPI = 'openapi',
  FORM_PAGE = 'form-page',
  HYBRID = 'hybrid',
}

// ============================================================
// Auth Type
// ============================================================
export enum AuthType {
  OAUTH2 = 'oauth2',
  BASIC = 'basic',
  APIKEY = 'apikey',
  COOKIE = 'cookie',
}

// ============================================================
// Bootstrap Report
// ============================================================
export interface BootstrapReport {
  id: string;
  bootstrapJobId: string;
  oclLevel: OCLLevel;
  coverage: number; // 0.0-1.0
  confidence: number; // 0.0-1.0
  risk: 'low' | 'medium' | 'high';
  evidence: EvidenceItem[];
  recommendation: string;
  createdAt: Date;
}

export interface EvidenceItem {
  type: string;
  description: string;
  confidence: number;
  metadata?: Record<string, any>;
}

// ============================================================
// Intermediate Representation (IR)
// ============================================================
export interface FlowIR {
  id: string;
  bootstrapJobId: string;
  flowCode: string;
  flowName: string;
  flowCategory?: string;
  entryUrl?: string;
  submitUrl?: string;
  queryUrl?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface FieldIR {
  id: string;
  bootstrapJobId: string;
  flowCode: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: FieldType;
  required: boolean;
  defaultValue?: string;
  options?: FieldOption[];
  validation?: ValidationRule[];
  metadata?: Record<string, any>;
  createdAt: Date;
}

export enum FieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  SELECT = 'select',
  RADIO = 'radio',
  CHECKBOX = 'checkbox',
  FILE = 'file',
  TEXTAREA = 'textarea',
}

export interface FieldOption {
  label: string;
  value: string;
}

export interface ValidationRule {
  type: string;
  params?: Record<string, any>;
  message?: string;
}

export interface RuleIR {
  id: string;
  bootstrapJobId: string;
  flowCode: string;
  ruleType: 'validation' | 'calculation' | 'conditional';
  ruleExpression: string;
  errorLevel: 'error' | 'warn';
  errorMessage?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface PermissionIR {
  id: string;
  bootstrapJobId: string;
  flowCode: string;
  permissionType: 'role' | 'department' | 'custom';
  permissionRule: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

// ============================================================
// Adapter
// ============================================================
export enum AdapterType {
  API = 'api',
  RPA = 'rpa',
  HYBRID = 'hybrid',
}

export interface AdapterBuild {
  id: string;
  bootstrapJobId: string;
  adapterType: AdapterType;
  generatedCode: string;
  buildStatus: 'pending' | 'success' | 'failed';
  buildLog?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Replay Validation
// ============================================================
export interface ReplayCase {
  id: string;
  bootstrapJobId: string;
  flowCode: string;
  testData: Record<string, any>;
  expectedResult?: Record<string, any>;
  createdAt: Date;
}

export interface ReplayResult {
  id: string;
  replayCaseId: string;
  status: 'success' | 'failed' | 'error';
  actualResult?: Record<string, any>;
  errorMessage?: string;
  executedAt: Date;
}

// ============================================================
// Drift Detection
// ============================================================
export interface DriftEvent {
  id: string;
  bootstrapJobId: string;
  driftType: 'field_change' | 'url_change' | 'auth_change';
  driftDetails: Record<string, any>;
  detectedAt: Date;
  resolved: boolean;
}

export * from './worker-heartbeat';
export * from './bootstrap-runtime';

// ============================================================
// Process Template
// ============================================================
export interface ProcessTemplate {
  id: string;
  tenantId: string;
  connectorId: string;
  processCode: string;
  processName: string;
  processCategory?: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  falLevel: FALLevel;
  schema: ProcessSchema;
  rules?: ProcessRule[];
  permissions?: ProcessPermission[];
  uiHints?: Record<string, any>;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export * from './sync-utils';
export * from './probe-utils';
export * from './auth-session';
export * from './process-name';
export * from './field-presentation';

export interface ProcessSchema {
  fields: ProcessField[];
}

export interface ProcessField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  defaultValue?: any;
  options?: FieldOption[];
  validation?: ValidationRule[];
  uiHints?: Record<string, any>;
}

export interface ProcessRule {
  type: 'validation' | 'calculation' | 'conditional';
  expression: string;
  errorLevel: 'error' | 'warn';
  errorMessage?: string;
}

export interface ProcessPermission {
  type: 'role' | 'department' | 'custom';
  rule: string;
}

// ============================================================
// Submission
// ============================================================
export interface Submission {
  id: string;
  tenantId: string;
  userId: string;
  templateId: string;
  draftId?: string;
  idempotencyKey: string;
  formData: Record<string, any>;
  oaSubmissionId?: string;
  status: 'pending' | 'submitted' | 'failed' | 'cancelled';
  submitResult?: Record<string, any>;
  errorMsg?: string;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Chat Intent
// ============================================================
export enum ChatIntent {
  CREATE_SUBMISSION = 'create_submission',
  QUERY_STATUS = 'query_status',
  CANCEL_SUBMISSION = 'cancel_submission',
  URGE = 'urge',
  SUPPLEMENT = 'supplement',
  DELEGATE = 'delegate',
  SERVICE_REQUEST = 'service_request',
  UNKNOWN = 'unknown',
}

// ============================================================
// Audit Log
// ============================================================
export interface AuditLog {
  id: string;
  tenantId: string;
  traceId: string;
  userId?: string;
  action: string;
  resource?: string;
  result: 'success' | 'denied' | 'error';
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

// ============================================================
// Connector
// ============================================================
export interface Connector {
  id: string;
  tenantId: string;
  name: string;
  oaType: OAType;
  oaVendor?: string;
  oaVersion?: string;
  baseUrl: string;
  authType: AuthType;
  authConfig: Record<string, any>;
  healthCheckUrl?: string;
  oclLevel: OCLLevel;
  falLevel?: FALLevel;
  status: 'active' | 'inactive';
  lastHealthCheck?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// RPA Runtime
// ============================================================

export type RpaStepActionType =
  | 'goto'
  | 'wait'
  | 'input'
  | 'click'
  | 'select'
  | 'upload'
  | 'extract'
  | 'download'
  | 'screenshot';

export type RpaLocatorKind =
  | 'selector'
  | 'element_ref'
  | 'image'
  | 'text'
  | 'url';

export interface RpaTargetRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RpaTargetDefinition {
  kind: RpaLocatorKind;
  value: string;
  label?: string;
  description?: string;
  imageUrl?: string;
  confidenceThreshold?: number;
  region?: Partial<RpaTargetRegion>;
}

export interface RpaFieldBinding {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  selector?: string;
  defaultValue?: any;
}

export interface RpaStepDefinition {
  type: RpaStepActionType;
  selector?: string;
  fieldKey?: string;
  value?: string;
  description?: string;
  timeoutMs?: number;
  target?: RpaTargetDefinition;
  continueOnError?: boolean;
  stabilityKey?: string;
}

export interface RpaAssertionDefinition {
  type: 'text' | 'selector' | 'status_field';
  value: string;
  selector?: string;
}

export interface RpaActionDefinition {
  steps: RpaStepDefinition[];
  successAssert?: RpaAssertionDefinition;
  resultMapping?: {
    submissionIdPath?: string;
    statusPath?: string;
    messagePath?: string;
  };
}

export interface RpaPlatformDefinition {
  entryUrl?: string;
  targetSystem?: string;
  ticketBrokerUrl?: string;
  jumpUrlTemplate?: string;
  ticketHeaderName?: string;
  ticketHeaderValue?: string;
  serviceToken?: string;
  timeoutMs?: number;
}

export interface RpaRuntimeDefinition {
  executorMode?: 'stub' | 'http' | 'local' | 'browser';
  browserProvider?: 'playwright' | 'stub';
  browserExecutablePath?: string;
  headless?: boolean;
  submitEndpoint?: string;
  statusEndpoint?: string;
  timeoutMs?: number;
  stabilityTimeoutMs?: number;
  maxSteps?: number;
  maxRetries?: number;
  snapshotMode?: 'structured-text';
  headers?: Record<string, string>;
}

export const API_DELIVERY_PATH = 'api';
export const URL_DELIVERY_PATH = 'url';
export const VISION_DELIVERY_PATH = 'vision';
export const DELIVERY_PATHS = [
  API_DELIVERY_PATH,
  URL_DELIVERY_PATH,
  VISION_DELIVERY_PATH,
] as const;
export type DeliveryPath = typeof DELIVERY_PATHS[number];
export const DEFAULT_DELIVERY_PATH: DeliveryPath = API_DELIVERY_PATH;
export type DeliveryHealth = 'healthy' | 'degraded' | 'unavailable';
export type VisionStartContext =
  | 'portal_home'
  | 'attach_session'
  | 'manual_opened'
  | 'local_app';

export function isDeliveryPath(value: unknown): value is DeliveryPath {
  return typeof value === 'string'
    && (DELIVERY_PATHS as readonly string[]).includes(value);
}

export interface DeliveryCapabilityState {
  available: boolean;
  submitEnabled: boolean;
  queryEnabled: boolean;
  health: DeliveryHealth;
}

export interface DeliveryCapabilitySummary {
  api: DeliveryCapabilityState & {
    toolNames?: string[];
  };
  url: DeliveryCapabilityState & {
    entryUrl?: string;
    jumpUrlTemplate?: string;
    ticketBrokerUrl?: string;
    executorMode?: 'browser' | 'local' | 'http' | 'stub';
  };
  vision: DeliveryCapabilityState & {
    startContext?: VisionStartContext;
    templateBundleRef?: string;
    templateCount?: number;
    ocrReady?: boolean;
  };
  fallbackOrder?: DeliveryPath[];
  source?: 'delivery' | 'legacy_ui_hints' | 'inferred';
}

export interface RpaFlowDefinition {
  processCode: string;
  processName: string;
  category?: string;
  description?: string;
  fields?: RpaFieldBinding[];
  actions?: {
    submit?: RpaActionDefinition;
    queryStatus?: RpaActionDefinition;
  };
  platform?: RpaPlatformDefinition;
  runtime?: RpaRuntimeDefinition;
}

export interface ArtifactReference {
  id: string;
  kind:
    | 'screenshot'
    | 'ocr'
    | 'page_snapshot'
    | 'template_bundle'
    | 'api_trace'
    | 'execution_log'
    | 'other';
  uri?: string;
  summary?: string;
}

export interface TaskObjective {
  intent: 'submit' | 'query_status' | 'cancel' | 'urge' | 'supplement';
  processCode: string;
  processName: string;
}

export interface TaskPacket {
  taskId: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  objective: TaskObjective;
  selectedPath: DeliveryPath;
  fallbackPolicy: DeliveryPath[];
  connector: {
    connectorId: string;
    connectorName: string;
  };
  form: {
    formData: Record<string, any>;
    missingFields: Array<{ key: string; label: string }>;
  };
  capability: DeliveryCapabilitySummary;
  runtime: {
    idempotencyKey: string;
    traceId: string;
    timeoutMs: number;
  };
  artifactRefs: ArtifactReference[];
}

export interface AgentResultPacket {
  taskId: string;
  agentType: DeliveryPath;
  success: boolean;
  output?: {
    submissionId?: string;
    externalSubmissionId?: string;
    status?: string;
    message?: string;
  };
  fallbackHint?: {
    shouldFallback: boolean;
    nextPath?: DeliveryPath;
    errorType?: string;
    reason?: string;
  };
  evidence: {
    artifactRefs: ArtifactReference[];
    summary: string;
  };
  statePatch?: {
    lastExecutionPath?: DeliveryPath;
    currentOaSubmissionId?: string | null;
  };
}

export type BrowserSnapshotRegionRole =
  | 'header'
  | 'navigation'
  | 'main'
  | 'form'
  | 'table'
  | 'dialog'
  | 'sidebar'
  | 'footer'
  | 'status';

export type BrowserSnapshotElementRole =
  | 'button'
  | 'input'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'upload'
  | 'link'
  | 'textarea'
  | 'table'
  | 'dialog'
  | 'text'
  | 'status'
  | 'unknown';

export interface BrowserSnapshotElement {
  ref: string;
  role: BrowserSnapshotElementRole;
  text?: string;
  label?: string;
  fieldKey?: string;
  selector?: string;
  href?: string;
  regionId?: string;
  required?: boolean;
  disabled?: boolean;
  value?: string;
  bounds?: RpaTargetRegion;
  targetHints?: RpaTargetDefinition[];
}

export interface BrowserSnapshotRegion {
  id: string;
  role: BrowserSnapshotRegionRole;
  name: string;
  summary?: string;
  elementRefs: string[];
}

export interface BrowserSnapshotFormField {
  ref: string;
  label?: string;
  fieldKey?: string;
  required?: boolean;
}

export interface BrowserSnapshotForm {
  id: string;
  name: string;
  fieldRefs: string[];
  fields: BrowserSnapshotFormField[];
}

export interface BrowserSnapshotTable {
  id: string;
  name: string;
  summary?: string;
}

export interface BrowserSnapshotDialog {
  id: string;
  title: string;
  summary?: string;
}

export interface BrowserPageSnapshot {
  snapshotId: string;
  title: string;
  url: string;
  generatedAt: string;
  regions: BrowserSnapshotRegion[];
  forms: BrowserSnapshotForm[];
  tables: BrowserSnapshotTable[];
  dialogs: BrowserSnapshotDialog[];
  importantTexts: string[];
  interactiveElements: BrowserSnapshotElement[];
  structuredText: string;
}

export function parseRpaFlowDefinitions(input: unknown): RpaFlowDefinition[] {
  if (!input) return [];

  const normalized = typeof input === 'string'
    ? safeParseJson(input)
    : input;

  if (Array.isArray(normalized)) {
    return normalized.filter(isRpaFlowDefinition);
  }

  if (
    normalized
    && typeof normalized === 'object'
    && Array.isArray((normalized as Record<string, unknown>).flows)
  ) {
    return ((normalized as Record<string, unknown>).flows as unknown[]).filter(isRpaFlowDefinition);
  }

  return [];
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function isRpaFlowDefinition(value: unknown): value is RpaFlowDefinition {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const flow = value as Record<string, unknown>;
  return typeof flow.processCode === 'string' && typeof flow.processName === 'string';
}
