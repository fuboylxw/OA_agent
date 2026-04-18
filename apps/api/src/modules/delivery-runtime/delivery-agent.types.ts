import type { StatusResult, SubmitResult } from '@uniflow/oa-adapters';
import type { AgentResultPacket, DeliveryPath } from '@uniflow/shared-types';

export interface DeliverySubmitRequest {
  connectorId: string;
  processCode: string;
  processName?: string;
  tenantId?: string;
  userId?: string;
  formData: Record<string, any>;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    mimeType?: string;
    fieldKey?: string | null;
  }>;
  idempotencyKey: string;
  selectedPath?: DeliveryPath | null;
  fallbackPolicy?: DeliveryPath[];
  traceId?: string;
}

export interface DeliveryStatusRequest {
  connectorId: string;
  processCode: string;
  processName?: string;
  tenantId?: string;
  userId?: string;
  submissionId: string;
  selectedPath?: DeliveryPath | null;
  fallbackPolicy?: DeliveryPath[];
  traceId?: string;
}

export interface DeliveryResolvedContext {
  taskId: string;
  templateId: string;
  processName: string;
  uiHints: Record<string, any>;
}

export interface ResolvedDeliverySubmitRequest
  extends Omit<DeliverySubmitRequest, 'processName'>, DeliveryResolvedContext {}

export interface ResolvedDeliveryStatusRequest
  extends Omit<DeliveryStatusRequest, 'processName'>, DeliveryResolvedContext {}

export interface DeliverySubmitExecutionResult {
  packet: AgentResultPacket;
  submitResult: SubmitResult;
}

export interface DeliveryStatusExecutionResult {
  packet: AgentResultPacket;
  statusResult: StatusResult;
}

export interface DeliveryAgent {
  readonly path: DeliveryPath;
  submit(input: ResolvedDeliverySubmitRequest): Promise<DeliverySubmitExecutionResult>;
  queryStatus(input: ResolvedDeliveryStatusRequest): Promise<DeliveryStatusExecutionResult>;
}
