import axios, { AxiosInstance } from 'axios';
import type {
  OAAdapter,
  DiscoverResult,
  HealthCheckResult,
  SubmitRequest,
  SubmitResult,
  StatusResult,
  CancelResult,
  UrgeResult,
  DelegateRequest,
  DelegateResult,
  SupplementRequest,
  SupplementResult,
} from '@uniflow/oa-adapters';
import type { AdapterLifecycle } from '@uniflow/oa-adapters';
import { sanitizeStructuredData } from '@uniflow/agent-kernel';
import type { RpaFlowDefinition } from '@uniflow/shared-types';
import type { LoadedRpaFlow } from './prisma-rpa-flow-loader';
import { PlatformTicketBroker } from './platform-ticket-broker';
import { LocalRpaExecutor } from './local-rpa-executor';
import { BrowserRpaExecutor } from './browser-rpa-executor';

export interface RpaAdapterConfig {
  connectorId: string;
  baseUrl: string;
  authType: string;
  authConfig: Record<string, any>;
  oaVendor?: string;
  oaVersion?: string;
  oaType: 'openapi' | 'form-page' | 'hybrid';
}

export class RpaAdapter implements OAAdapter, AdapterLifecycle {
  private readonly client: AxiosInstance;
  private readonly flowMap = new Map<string, LoadedRpaFlow>();

  constructor(
    private readonly config: RpaAdapterConfig,
    private readonly flows: LoadedRpaFlow[],
    private readonly ticketBroker: PlatformTicketBroker,
    private readonly localExecutor: LocalRpaExecutor,
    private readonly browserExecutor: BrowserRpaExecutor,
  ) {
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async init(): Promise<void> {
    for (const flow of this.flows) {
      this.flowMap.set(flow.processCode, flow);
    }
  }

  async destroy(): Promise<void> {
    this.flowMap.clear();
  }

  async discover(): Promise<DiscoverResult> {
    return {
      oaVendor: this.config.oaVendor || 'RPA',
      oaVersion: this.config.oaVersion,
      oaType: this.config.oaType,
      authType: this.config.authType as any,
      discoveredFlows: this.flows.map((flow) => ({
        flowCode: flow.processCode,
        flowName: flow.processName,
        entryUrl: flow.rpaDefinition.platform?.entryUrl,
        submitUrl: flow.rpaDefinition.runtime?.submitEndpoint,
        queryUrl: flow.rpaDefinition.runtime?.statusEndpoint,
      })),
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      healthy: this.flows.length > 0,
      latencyMs: 0,
      message: this.flows.length > 0
        ? `Loaded ${this.flows.length} RPA flow definitions`
        : 'No RPA flow definitions configured',
    };
  }

  async submit(request: SubmitRequest): Promise<SubmitResult> {
    const flow = this.flowMap.get(request.flowCode);
    if (!flow?.rpaDefinition.actions?.submit) {
      return {
        success: false,
        errorMessage: `No RPA submit flow configured for ${request.flowCode}`,
      };
    }

    return this.executeAction('submit', flow, {
      flowCode: request.flowCode,
      formData: request.formData,
      idempotencyKey: request.idempotencyKey,
      attachments: request.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content.toString('base64'),
      })),
    });
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    const flow = this.findFlowForAction('queryStatus');
    if (!flow?.rpaDefinition.actions?.queryStatus) {
      return {
        status: 'error',
        statusDetail: { error: 'No RPA status query flow configured' },
      };
    }

    const result = await this.executeAction('queryStatus', flow, {
      submissionId,
    });
    if (!result.success) {
      return {
        status: 'error',
        statusDetail: { error: result.errorMessage, metadata: result.metadata },
      };
    }

    return {
      status: String(result.metadata?.status || 'submitted'),
      statusDetail: result.metadata || {},
      timeline: Array.isArray(result.metadata?.timeline) ? result.metadata.timeline : [],
    };
  }

  async cancel(_submissionId: string): Promise<CancelResult> {
    return { success: false, message: 'RPA cancel is not configured' };
  }

  async urge(_submissionId: string): Promise<UrgeResult> {
    return { success: false, message: 'RPA urge is not configured' };
  }

  async delegate(_request: DelegateRequest): Promise<DelegateResult> {
    return { success: false, message: 'RPA delegate is not configured' };
  }

  async supplement(_request: SupplementRequest): Promise<SupplementResult> {
    return { success: false, message: 'RPA supplement is not configured' };
  }

  private findFlowForAction(action: 'submit' | 'queryStatus') {
    return this.flows.find((flow) => {
      if (action === 'submit') {
        return !!flow.rpaDefinition.actions?.submit;
      }
      return !!flow.rpaDefinition.actions?.queryStatus;
    });
  }

  private async executeAction(
    action: 'submit' | 'queryStatus',
    flow: LoadedRpaFlow,
    payload: Record<string, any>,
  ): Promise<SubmitResult> {
    const definition = flow.rpaDefinition;
    const runtime = definition.runtime || {};
    const ticket = await this.ticketBroker.issueTicket({
      connectorId: this.config.connectorId,
      processCode: flow.processCode,
      action,
      authConfig: this.config.authConfig,
      flow: definition,
    });

    if (runtime.executorMode === 'stub') {
      return {
        success: true,
        submissionId: action === 'submit' ? `RPA-${Date.now()}` : undefined,
        metadata: sanitizeStructuredData({
          mode: 'stub',
          action,
          flowCode: flow.processCode,
          connectorId: this.config.connectorId,
          jumpUrl: ticket.jumpUrl,
          ticketIssued: !!ticket.ticket,
          deliveryPath: this.classifyDeliveryPath(definition),
          status: action === 'queryStatus' ? 'submitted' : undefined,
        }),
      };
    }

    const endpoint = action === 'submit' ? runtime.submitEndpoint : runtime.statusEndpoint;
    if (endpoint) {
      try {
        const response = await this.client.post(
          endpoint,
          {
            connectorId: this.config.connectorId,
            processCode: flow.processCode,
            action,
            jumpUrl: ticket.jumpUrl,
            ticket: ticket.ticket,
            definition,
            payload,
          },
          {
            timeout: runtime.timeoutMs || 30000,
            headers: {
              ...(runtime.headers || {}),
              ...(ticket.headers || {}),
            },
          },
        );

        const body = (response.data || {}) as Record<string, any>;
        return {
          success: body.success !== false,
          submissionId: typeof body.submissionId === 'string' ? body.submissionId : undefined,
          errorMessage: typeof body.errorMessage === 'string' ? body.errorMessage : undefined,
          metadata: sanitizeStructuredData({
            ...body,
            flowCode: flow.processCode,
            connectorId: this.config.connectorId,
            deliveryPath: this.classifyDeliveryPath(definition),
          }),
        };
      } catch (error: any) {
        return {
          success: false,
          errorMessage: error.message,
          metadata: sanitizeStructuredData({
            flowCode: flow.processCode,
            connectorId: this.config.connectorId,
            deliveryPath: this.classifyDeliveryPath(definition),
            jumpUrl: ticket.jumpUrl,
            ticketIssued: !!ticket.ticket,
          }),
        };
      }
    }

    const executorMode = runtime.executorMode === 'browser' ? 'browser' : 'local';
    const executor = executorMode === 'browser'
      ? this.browserExecutor
      : this.localExecutor;

    const localResult = await executor.execute({
      action,
      flow: definition,
      runtime,
      payload: {
        ...payload,
        auth: this.config.authConfig,
      },
      ticket,
    });

    return {
      success: localResult.success,
      submissionId: localResult.submissionId,
      errorMessage: localResult.success ? undefined : localResult.message,
      metadata: sanitizeStructuredData({
        ...localResult,
        mode: executorMode,
        action,
        flowCode: flow.processCode,
        connectorId: this.config.connectorId,
        deliveryPath: this.classifyDeliveryPath(definition),
      }),
    };
  }

  private classifyDeliveryPath(flow: RpaFlowDefinition): 'url' | 'vision' {
    const steps = [
      ...(flow.actions?.submit?.steps || []),
      ...(flow.actions?.queryStatus?.steps || []),
    ];
    return steps.some((step) => step.target?.kind === 'image') ? 'vision' : 'url';
  }
}
