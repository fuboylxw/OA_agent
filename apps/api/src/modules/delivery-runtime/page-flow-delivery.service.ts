import axios, { AxiosInstance } from 'axios';
import { Injectable } from '@nestjs/common';
import { sanitizeStructuredData } from '@uniflow/agent-kernel';
import type { ArtifactReference, DeliveryPath, RpaRuntimeDefinition } from '@uniflow/shared-types';
import type { StatusResult, SubmitResult } from '@uniflow/oa-adapters';
import { BrowserRpaExecutor } from '../adapter-runtime/browser-rpa-executor';
import { LocalRpaExecutor } from '../adapter-runtime/local-rpa-executor';
import type { DeliveryStatusExecutionResult, DeliverySubmitExecutionResult } from './delivery-agent.types';
import type { UrlDeliveryExecutionContext } from './delivery-bootstrap.types';
import { UrlNetworkSubmitService } from './url-network-submit.service';

interface BasePageFlowExecutionInput {
  path: Extract<DeliveryPath, 'url'>;
  connectorId: string;
  processCode: string;
  processName: string;
  taskId: string;
  traceId?: string;
  context: UrlDeliveryExecutionContext;
}

interface PageFlowSubmitInput extends BasePageFlowExecutionInput {
  formData: Record<string, any>;
  attachments?: Array<{ filename: string; content: Buffer }>;
  idempotencyKey: string;
}

interface PageFlowStatusInput extends BasePageFlowExecutionInput {
  submissionId: string;
}

@Injectable()
export class PageFlowDeliveryService {
  private readonly client: AxiosInstance;
  private readonly localExecutor = new LocalRpaExecutor();
  private readonly browserExecutor = new BrowserRpaExecutor();

  constructor(
    private readonly urlNetworkSubmitService: UrlNetworkSubmitService,
  ) {
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async submit(input: PageFlowSubmitInput): Promise<DeliverySubmitExecutionResult> {
    const result = await this.executeAction('submit', input, {
      flowCode: input.processCode,
      formData: input.formData,
      idempotencyKey: input.idempotencyKey,
      attachments: input.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content.toString('base64'),
      })),
    }) as {
      submitResult: SubmitResult;
      artifactRefs: ArtifactReference[];
      summary: string;
    };

    return {
      submitResult: result.submitResult,
      packet: {
        taskId: input.taskId,
        agentType: input.path,
        success: result.submitResult.success,
        output: result.submitResult.success
          ? {
              submissionId: result.submitResult.submissionId,
              externalSubmissionId: result.submitResult.submissionId,
              message: result.submitResult.metadata?.message as string | undefined,
            }
          : undefined,
        fallbackHint: result.submitResult.success
          ? undefined
          : {
              shouldFallback: true,
              nextPath: undefined,
              errorType: 'page_flow_submit_failed',
              reason: result.submitResult.errorMessage || 'page flow delivery failed',
            },
        evidence: {
          artifactRefs: result.artifactRefs,
          summary: result.summary,
        },
        statePatch: {
          lastExecutionPath: input.path,
          currentOaSubmissionId: result.submitResult.submissionId || null,
        },
      },
    };
  }

  async queryStatus(input: PageFlowStatusInput): Promise<DeliveryStatusExecutionResult> {
    const result = await this.executeAction('queryStatus', input, {
      submissionId: input.submissionId,
    }) as {
      statusResult: StatusResult;
      artifactRefs: ArtifactReference[];
      summary: string;
    };

    return {
      statusResult: result.statusResult,
      packet: {
        taskId: input.taskId,
        agentType: input.path,
        success: result.statusResult.status !== 'error',
        output: result.statusResult.status === 'error'
          ? undefined
          : {
              status: result.statusResult.status,
              message: typeof result.statusResult.statusDetail?.message === 'string'
                ? result.statusResult.statusDetail.message
                : undefined,
            },
        fallbackHint: result.statusResult.status === 'error'
          ? {
              shouldFallback: true,
              nextPath: undefined,
              errorType: 'page_flow_status_failed',
              reason: String(result.statusResult.statusDetail?.error || 'page flow status failed'),
            }
          : undefined,
        evidence: {
          artifactRefs: result.artifactRefs,
          summary: result.summary,
        },
        statePatch: {
          lastExecutionPath: input.path,
          currentOaSubmissionId: input.submissionId,
        },
      },
    };
  }

  private async executeAction(
    action: 'submit' | 'queryStatus',
    input: BasePageFlowExecutionInput,
    payload: Record<string, any>,
  ): Promise<{
    submitResult?: SubmitResult;
    statusResult?: StatusResult;
    artifactRefs: ArtifactReference[];
    summary: string;
  }> {
    const definition = input.context.rpaFlow!.rpaDefinition;
    const runtime = this.buildRuntime(input.context.runtime);
    const ticket = input.context.ticket;

    if (runtime.executorMode === 'stub') {
      const metadata = sanitizeStructuredData({
        mode: 'stub',
        action,
        flowCode: input.context.rpaFlow!.processCode,
        connectorId: input.connectorId,
        jumpUrl: ticket.jumpUrl,
        ticketIssued: !!ticket.ticket,
        deliveryPath: input.path,
      });
      return action === 'submit'
        ? {
            submitResult: {
              success: true,
              submissionId: `RPA-${Date.now()}`,
              metadata,
            } satisfies SubmitResult,
            artifactRefs: [] as ArtifactReference[],
            summary: `${input.processName} submitted in stub ${input.path} mode`,
          }
        : {
            statusResult: {
              status: 'submitted',
              statusDetail: metadata,
              timeline: [],
            } satisfies StatusResult,
            artifactRefs: [] as ArtifactReference[],
            summary: `${input.processName} status queried in stub ${input.path} mode`,
          };
    }

    const endpoint = action === 'submit' ? runtime.submitEndpoint : runtime.statusEndpoint;
    if (endpoint) {
      try {
        const response = await this.client.post(
          endpoint,
          {
            connectorId: input.connectorId,
            processCode: input.context.rpaFlow!.processCode,
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
        const metadata = sanitizeStructuredData({
          ...body,
          flowCode: input.context.rpaFlow!.processCode,
          connectorId: input.connectorId,
          deliveryPath: input.path,
        });
        return action === 'submit'
          ? {
              submitResult: {
                success: body.success !== false,
                submissionId: typeof body.submissionId === 'string' ? body.submissionId : undefined,
                errorMessage: typeof body.errorMessage === 'string' ? body.errorMessage : undefined,
                metadata,
              } satisfies SubmitResult,
              artifactRefs: [] as ArtifactReference[],
              summary: `${input.processName} submitted through ${input.path} endpoint`,
            }
          : {
              statusResult: {
                status: String(body.status || 'submitted'),
                statusDetail: metadata,
                timeline: Array.isArray(body.timeline) ? body.timeline : [],
              } satisfies StatusResult,
              artifactRefs: [] as ArtifactReference[],
              summary: `${input.processName} status queried through ${input.path} endpoint`,
            };
      } catch (error: any) {
        const message = error.message || `${input.path} endpoint execution failed`;
        return action === 'submit'
          ? {
              submitResult: {
                success: false,
                errorMessage: message,
                metadata: {
                  connectorId: input.connectorId,
                  flowCode: input.context.rpaFlow!.processCode,
                  deliveryPath: input.path,
                  jumpUrl: ticket.jumpUrl,
                  ticketIssued: !!ticket.ticket,
                },
              } satisfies SubmitResult,
              artifactRefs: [] as ArtifactReference[],
              summary: message,
            }
          : {
              statusResult: {
                status: 'error',
                statusDetail: {
                  error: message,
                  connectorId: input.connectorId,
                  flowCode: input.context.rpaFlow!.processCode,
                  deliveryPath: input.path,
                },
                timeline: [],
              } satisfies StatusResult,
              artifactRefs: [] as ArtifactReference[],
              summary: message,
            };
      }
    }

    const internalNetworkDefinition = action === 'submit'
      ? runtime.networkSubmit
      : runtime.networkStatus;
    if (internalNetworkDefinition?.url) {
      try {
        return await this.urlNetworkSubmitService.execute({
          action,
          connectorId: input.connectorId,
          processCode: input.context.rpaFlow!.processCode,
          processName: input.processName,
          context: input.context,
          payload,
        });
      } catch (error: any) {
        const message = error.message || `${input.path} internal network execution failed`;
        return action === 'submit'
          ? {
              submitResult: {
                success: false,
                errorMessage: message,
                metadata: {
                  connectorId: input.connectorId,
                  flowCode: input.context.rpaFlow!.processCode,
                  deliveryPath: input.path,
                  jumpUrl: ticket.jumpUrl,
                  ticketIssued: !!ticket.ticket,
                  mode: 'url-network',
                },
              } satisfies SubmitResult,
              artifactRefs: [] as ArtifactReference[],
              summary: message,
            }
          : {
              statusResult: {
                status: 'error',
                statusDetail: {
                  error: message,
                  connectorId: input.connectorId,
                  flowCode: input.context.rpaFlow!.processCode,
                  deliveryPath: input.path,
                  mode: 'url-network',
                },
                timeline: [],
              } satisfies StatusResult,
              artifactRefs: [] as ArtifactReference[],
              summary: message,
            };
      }
    }

    const executorMode = runtime.executorMode === 'browser' ? 'browser' : 'local';
    const executor = executorMode === 'browser'
      ? this.browserExecutor
      : this.localExecutor;
    const executionResult = await executor.execute({
      action,
      flow: definition,
      runtime,
      payload: {
        ...payload,
        auth: input.context.authConfig,
      },
      ticket,
    });

    const metadata = sanitizeStructuredData({
      ...executionResult,
      mode: executorMode,
      action,
      flowCode: input.context.rpaFlow!.processCode,
      connectorId: input.connectorId,
      deliveryPath: input.path,
    });
    const artifactRefs = this.toArtifactRefs(executionResult.snapshots);
    const summary = executionResult.message
      || `${input.processName} ${action === 'submit' ? 'submitted' : 'status queried'} through ${input.path}`;

    return action === 'submit'
      ? {
          submitResult: {
            success: executionResult.success,
            submissionId: executionResult.submissionId,
            errorMessage: executionResult.success ? undefined : executionResult.message,
            metadata,
          } satisfies SubmitResult,
          artifactRefs,
          summary,
        }
      : {
          statusResult: {
            status: executionResult.success ? String(executionResult.status || 'submitted') : 'error',
            statusDetail: executionResult.success
              ? metadata
              : {
                  error: executionResult.message,
                  ...metadata,
                },
            timeline: executionResult.timeline || [],
          } satisfies StatusResult,
          artifactRefs,
          summary,
        };
  }

  private buildRuntime(runtime: RpaRuntimeDefinition | undefined) {
    return runtime || {};
  }

  private toArtifactRefs(snapshots: Array<{ snapshotId: string; title?: string; url?: string }> | undefined) {
    return (snapshots || []).map<ArtifactReference>((snapshot) => ({
      id: snapshot.snapshotId,
      kind: 'page_snapshot',
      summary: `${snapshot.title || 'Snapshot'} @ ${snapshot.url || 'unknown'}`,
    }));
  }
}
