import { z } from 'zod';

// ============================================================
// Bootstrap Job Schemas
// ============================================================

export const CreateBootstrapJobSchema = z.object({
  oaUrl: z.string().url().optional(),
  sourceBundleUrl: z.string().url().optional(),
  openApiUrl: z.string().url().optional(),
  harFileUrl: z.string().url().optional(),
  uploadedFiles: z.array(z.string()).optional(),
});

export type CreateBootstrapJobInput = z.infer<typeof CreateBootstrapJobSchema>;

export const BootstrapReportSchema = z.object({
  oclLevel: z.enum(['OCL0', 'OCL1', 'OCL2', 'OCL3', 'OCL4', 'OCL5']),
  coverage: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  risk: z.enum(['low', 'medium', 'high']),
  evidence: z.array(z.object({
    type: z.string(),
    description: z.string(),
    confidence: z.number(),
    metadata: z.record(z.any()).optional(),
  })),
  recommendation: z.string(),
});

export type BootstrapReportOutput = z.infer<typeof BootstrapReportSchema>;

// ============================================================
// Agent Schemas
// ============================================================

// OA Discovery Agent
export const OADiscoveryInputSchema = z.object({
  oaUrl: z.string().url().optional(),
  sourceBundleUrl: z.string().url().optional(),
  openApiUrl: z.string().url().optional(),
  harFileUrl: z.string().url().optional(),
  oaToken: z.string().optional(),
});

export const OADiscoveryOutputSchema = z.object({
  oaVendor: z.string(),
  oaVersion: z.string().optional(),
  oaType: z.enum(['openapi', 'form-page', 'hybrid']),
  authType: z.enum(['oauth2', 'basic', 'apikey', 'cookie']),
  authConfig: z.record(z.any()),
  discoveredFlows: z.array(z.object({
    flowCode: z.string(),
    flowName: z.string(),
    entryUrl: z.string().optional(),
    submitUrl: z.string().optional(),
    queryUrl: z.string().optional(),
  })),
  oclLevel: z.enum(['OCL0', 'OCL1', 'OCL2', 'OCL3', 'OCL4', 'OCL5']),
  confidence: z.number().min(0).max(1),
});

export type OADiscoveryInput = z.infer<typeof OADiscoveryInputSchema>;
export type OADiscoveryOutput = z.infer<typeof OADiscoveryOutputSchema>;

// Intent Agent
export const IntentAgentInputSchema = z.object({
  message: z.string(),
  context: z.object({
    userId: z.string(),
    tenantId: z.string(),
    sessionId: z.string(),
  }),
});

export const IntentAgentOutputSchema = z.object({
  intent: z.enum([
    'create_submission',
    'query_status',
    'cancel_submission',
    'urge',
    'supplement',
    'delegate',
    'service_request',
    'unknown',
  ]),
  confidence: z.number().min(0).max(1),
  extractedEntities: z.record(z.any()).optional(),
});

export type IntentAgentInput = z.infer<typeof IntentAgentInputSchema>;
export type IntentAgentOutput = z.infer<typeof IntentAgentOutputSchema>;

// Flow Agent
export const FlowAgentInputSchema = z.object({
  intent: z.string(),
  message: z.string(),
  availableFlows: z.array(z.object({
    processCode: z.string(),
    processName: z.string(),
    processCategory: z.string().optional(),
  })),
});

export const FlowAgentOutputSchema = z.object({
  matchedFlow: z.object({
    processCode: z.string(),
    processName: z.string(),
    confidence: z.number().min(0).max(1),
  }).optional(),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().optional(),
});

export type FlowAgentInput = z.infer<typeof FlowAgentInputSchema>;
export type FlowAgentOutput = z.infer<typeof FlowAgentOutputSchema>;

// Form Agent
export const FormAgentInputSchema = z.object({
  processCode: z.string(),
  processSchema: z.object({
    fields: z.array(z.object({
      key: z.string(),
      label: z.string(),
      type: z.string(),
      required: z.boolean(),
      options: z.array(z.object({
        label: z.string(),
        value: z.string(),
      })).optional(),
    })),
  }),
  userMessage: z.string(),
  currentFormData: z.record(z.any()).optional(),
});

export const FormAgentOutputSchema = z.object({
  extractedFields: z.record(z.any()),
  missingFields: z.array(z.object({
    key: z.string(),
    label: z.string(),
    question: z.string(),
  })),
  isComplete: z.boolean(),
});

export type FormAgentInput = z.infer<typeof FormAgentInputSchema>;
export type FormAgentOutput = z.infer<typeof FormAgentOutputSchema>;

// Rule Agent
export const RuleAgentInputSchema = z.object({
  processCode: z.string(),
  formData: z.record(z.any()),
  rules: z.array(z.object({
    type: z.string(),
    expression: z.string(),
    errorLevel: z.enum(['error', 'warn']),
    errorMessage: z.string().optional(),
  })),
});

export const RuleAgentOutputSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({
    field: z.string().optional(),
    message: z.string(),
    level: z.enum(['error', 'warn']),
  })),
});

export type RuleAgentInput = z.infer<typeof RuleAgentInputSchema>;
export type RuleAgentOutput = z.infer<typeof RuleAgentOutputSchema>;

// Permission Agent (Auth Agent)
export const PermissionAgentInputSchema = z.object({
  userId: z.string(),
  processCode: z.string(),
  action: z.enum(['view', 'submit', 'cancel', 'urge']),
  context: z.record(z.any()).optional(),
});

export const PermissionAgentOutputSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  platformCheck: z.object({
    passed: z.boolean(),
    reason: z.string(),
  }),
  oaCheck: z.object({
    passed: z.boolean(),
    reason: z.string(),
  }).optional(),
});

export type PermissionAgentInput = z.infer<typeof PermissionAgentInputSchema>;
export type PermissionAgentOutput = z.infer<typeof PermissionAgentOutputSchema>;

// Submit Agent
export const SubmitAgentInputSchema = z.object({
  connectorId: z.string(),
  processCode: z.string(),
  formData: z.record(z.any()),
  idempotencyKey: z.string(),
});

export const SubmitAgentOutputSchema = z.object({
  success: z.boolean(),
  oaSubmissionId: z.string().optional(),
  errorMessage: z.string().optional(),
  submitResult: z.record(z.any()).optional(),
});

export type SubmitAgentInput = z.infer<typeof SubmitAgentInputSchema>;
export type SubmitAgentOutput = z.infer<typeof SubmitAgentOutputSchema>;

// Status Agent
export const StatusAgentInputSchema = z.object({
  connectorId: z.string(),
  oaSubmissionId: z.string(),
});

export const StatusAgentOutputSchema = z.object({
  status: z.string(),
  statusDetail: z.record(z.any()).optional(),
  timeline: z.array(z.object({
    timestamp: z.string(),
    status: z.string(),
    operator: z.string().optional(),
    comment: z.string().optional(),
  })).optional(),
});

export type StatusAgentInput = z.infer<typeof StatusAgentInputSchema>;
export type StatusAgentOutput = z.infer<typeof StatusAgentOutputSchema>;

// Schema Parser Agent
export const SchemaParserAgentInputSchema = z.object({
  sourceType: z.enum(['openapi', 'har', 'manual']),
  sourceData: z.record(z.any()),
});

export const SchemaParserAgentOutputSchema = z.object({
  flows: z.array(z.object({
    flowCode: z.string(),
    flowName: z.string(),
    fields: z.array(z.object({
      key: z.string(),
      label: z.string(),
      type: z.string(),
      required: z.boolean(),
      options: z.array(z.object({
        label: z.string(),
        value: z.string(),
      })).optional(),
    })),
  })),
});

export type SchemaParserAgentInput = z.infer<typeof SchemaParserAgentInputSchema>;
export type SchemaParserAgentOutput = z.infer<typeof SchemaParserAgentOutputSchema>;

// Mapping Agent
export const MappingAgentInputSchema = z.object({
  sourceSchema: z.record(z.any()),
  targetSchema: z.record(z.any()),
});

export const MappingAgentOutputSchema = z.object({
  mappings: z.array(z.object({
    sourceField: z.string(),
    targetField: z.string(),
    confidence: z.number().min(0).max(1),
    transformRule: z.string().optional(),
  })),
});

export type MappingAgentInput = z.infer<typeof MappingAgentInputSchema>;
export type MappingAgentOutput = z.infer<typeof MappingAgentOutputSchema>;

// Audit Agent
export const AuditAgentInputSchema = z.object({
  action: z.string(),
  resource: z.string().optional(),
  result: z.enum(['success', 'denied', 'error']),
  details: z.record(z.any()).optional(),
});

export const AuditAgentOutputSchema = z.object({
  logged: z.boolean(),
  auditId: z.string(),
});

export type AuditAgentInput = z.infer<typeof AuditAgentInputSchema>;
export type AuditAgentOutput = z.infer<typeof AuditAgentOutputSchema>;

// ============================================================
// Chat Schemas
// ============================================================

export const ChatMessageSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
});

export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;

export const ChatResponseSchema = z.object({
  message: z.string(),
  draftId: z.string().optional(),
  needsInput: z.boolean(),
  suggestedActions: z.array(z.string()).optional(),
});

export type ChatResponseOutput = z.infer<typeof ChatResponseSchema>;

// ============================================================
// Submission Schemas
// ============================================================

export const CreateSubmissionSchema = z.object({
  draftId: z.string(),
  idempotencyKey: z.string(),
});

export type CreateSubmissionInput = z.infer<typeof CreateSubmissionSchema>;
