/**
 * 上下文类型定义
 * 基于PRD文档的上下文隔离与共享机制
 */

// 流程状态枚举
export enum ProcessStatus {
  INITIALIZED = 'initialized',
  PARAMETER_COLLECTION = 'parameter_collection',
  PENDING_CONFIRMATION = 'pending_confirmation',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// 会话上下文
export interface SessionContext {
  sessionId: string;
  userId: string;
  tenantId: string;
  conversationHistory: ConversationMessage[];
  currentProcess?: ProcessContext;
  createdAt: Date;
  expiresAt?: Date;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

// 流程上下文
export interface ProcessContext {
  processId: string;
  processType: string;
  processCode: string;
  status: ProcessStatus;
  parameters: Record<string, any>;
  collectedParams: Set<string>;
  validationErrors: ValidationError[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

// 共享上下文
export interface SharedContext {
  userId: string;
  profile: UserProfile;
  preferences: UserPreferences;
  history: UserHistory;
}

export interface UserProfile {
  employeeId: string;
  name: string;
  department?: string;
  position?: string;
  email?: string;
  phone?: string;
}

export interface UserPreferences {
  defaultApprover?: string;
  defaultCC?: string[];
  language: string;
  notificationSettings?: NotificationSettings;
}

export interface NotificationSettings {
  email: boolean;
  sms: boolean;
  inApp: boolean;
}

export interface UserHistory {
  recentRequests: RequestSummary[];
  frequentTypes: string[];
  totalSubmissions: number;
  lastActivityAt?: Date;
}

export interface RequestSummary {
  id: string;
  processCode: string;
  processName: string;
  status: string;
  createdAt: Date;
  completedAt?: Date;
}

// 参数定义
export interface ParameterDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
  validation?: ValidationRule[];
  defaultValue?: any;
  source?: ParameterSource;
  prompt?: string;
  dependencies?: string[];
}

export enum FieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  DATETIME = 'datetime',
  SELECT = 'select',
  RADIO = 'radio',
  CHECKBOX = 'checkbox',
  FILE = 'file',
  TEXTAREA = 'textarea',
  EMAIL = 'email',
  PHONE = 'phone',
  URL = 'url',
}

export enum ParameterSource {
  USER_INPUT = 'user_input',
  SHARED_CONTEXT = 'shared_context',
  SYSTEM = 'system',
  COMPUTED = 'computed',
}

export interface ValidationRule {
  type: ValidationType;
  params?: Record<string, any>;
  message?: string;
}

export enum ValidationType {
  REQUIRED = 'required',
  MIN_LENGTH = 'min_length',
  MAX_LENGTH = 'max_length',
  MIN_VALUE = 'min_value',
  MAX_VALUE = 'max_value',
  PATTERN = 'pattern',
  EMAIL = 'email',
  PHONE = 'phone',
  DATE_RANGE = 'date_range',
  CUSTOM = 'custom',
}

// 流程定义
export interface ProcessDefinition {
  processType: string;
  processCode: string;
  processName: string;
  parameters: ParameterDefinition[];
  preConditions?: Condition[];
  steps: ProcessStep[];
  postActions?: Action[];
  rollbackStrategy?: RollbackStrategy;
}

export interface Condition {
  type: string;
  expression: string;
  errorMessage?: string;
}

export interface ProcessStep {
  stepId: string;
  stepName: string;
  action: StepAction;
  config: any;
  onSuccess?: string;
  onFailure?: string;
  retryPolicy?: RetryPolicy;
}

export enum StepAction {
  VALIDATE = 'validate',
  TRANSFORM = 'transform',
  CALL_MCP = 'call_mcp',
  NOTIFY = 'notify',
  WAIT = 'wait',
  BRANCH = 'branch',
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
}

export interface Action {
  type: string;
  config: any;
}

export interface RollbackStrategy {
  enabled: boolean;
  steps: RollbackStep[];
}

export interface RollbackStep {
  stepId: string;
  action: string;
  config: any;
}

// 上下文管理器接口
export interface IContextManager {
  // 会话上下文
  getSession(sessionId: string): Promise<SessionContext | null>;
  createSession(userId: string, tenantId: string): Promise<SessionContext>;
  updateSession(sessionId: string, updates: Partial<SessionContext>): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;

  // 流程上下文
  getProcessContext(sessionId: string): Promise<ProcessContext | null>;
  createProcessContext(sessionId: string, processCode: string): Promise<ProcessContext>;
  updateProcessContext(processId: string, updates: Partial<ProcessContext>): Promise<void>;
  clearProcessContext(sessionId: string): Promise<void>;

  // 共享上下文
  getSharedContext(userId: string, tenantId: string): Promise<SharedContext>;
  updateSharedContext(userId: string, updates: Partial<SharedContext>): Promise<void>;
}
