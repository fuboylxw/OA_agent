export declare enum OCLLevel {
    OCL0 = "OCL0",// 不可接入
    OCL1 = "OCL1",// 只读接入
    OCL2 = "OCL2",// 半写接入
    OCL3 = "OCL3",// 可自动提交
    OCL4 = "OCL4",// 深度集成
    OCL5 = "OCL5"
}
export declare enum FALLevel {
    F0 = "F0",// 仅流程指引
    F1 = "F1",// 智能填单
    F2 = "F2",// 半自动
    F3 = "F3",// 全自动提交
    F4 = "F4"
}
export declare enum BootstrapJobStatus {
    CREATED = "CREATED",
    DISCOVERING = "DISCOVERING",
    PARSING = "PARSING",
    NORMALIZING = "NORMALIZING",
    COMPILING = "COMPILING",
    REPLAYING = "REPLAYING",
    REVIEW = "REVIEW",
    PUBLISHED = "PUBLISHED",
    FAILED = "FAILED"
}
export declare enum BootstrapSourceType {
    OA_URL = "oa_url",
    SOURCE_BUNDLE = "source_bundle",
    OPENAPI = "openapi",
    HAR = "har",
    FILE = "file"
}
export declare enum OAType {
    OPENAPI = "openapi",
    FORM_PAGE = "form-page",
    HYBRID = "hybrid"
}
export declare enum AuthType {
    OAUTH2 = "oauth2",
    BASIC = "basic",
    APIKEY = "apikey",
    COOKIE = "cookie"
}
export interface BootstrapReport {
    id: string;
    bootstrapJobId: string;
    oclLevel: OCLLevel;
    coverage: number;
    confidence: number;
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
export declare enum FieldType {
    TEXT = "text",
    NUMBER = "number",
    DATE = "date",
    SELECT = "select",
    RADIO = "radio",
    CHECKBOX = "checkbox",
    FILE = "file",
    TEXTAREA = "textarea"
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
export declare enum AdapterType {
    API = "api",
    RPA = "rpa",
    HYBRID = "hybrid"
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
export interface DriftEvent {
    id: string;
    bootstrapJobId: string;
    driftType: 'field_change' | 'url_change' | 'auth_change';
    driftDetails: Record<string, any>;
    detectedAt: Date;
    resolved: boolean;
}
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
export declare enum ChatIntent {
    CREATE_SUBMISSION = "create_submission",
    QUERY_STATUS = "query_status",
    CANCEL_SUBMISSION = "cancel_submission",
    URGE = "urge",
    SUPPLEMENT = "supplement",
    DELEGATE = "delegate",
    SERVICE_REQUEST = "service_request",
    UNKNOWN = "unknown"
}
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
//# sourceMappingURL=index.d.ts.map