import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AttachmentFieldBindingInferenceEngine } from '@uniflow/compat-engine';
import { PrismaService } from '../common/prisma.service';
import { IntentAgent } from './agents/intent.agent';
import { FlowAgent } from './agents/flow.agent';
import { FormAgent } from './agents/form.agent';
import { ConnectorRouter } from './agents/connector-router';
import { PermissionService } from '../permission/permission.service';
import { AuditService } from '../audit/audit.service';
import { ProcessLibraryService } from '../process-library/process-library.service';
import { SubmissionService } from '../submission/submission.service';
import { AttachmentBindingService } from '../attachment/attachment-binding.service';
import { AttachmentService } from '../attachment/attachment.service';
import { TenantUserResolverService } from '../common/tenant-user-resolver.service';
import { AuthBindingService } from '../auth-binding/auth-binding.service';
import {
  ChatIntent,
  DeliveryPath,
  resolveAssistantFieldPresentation,
} from '@uniflow/shared-types';
import { TaskPlanAgent } from './agents/task-plan.agent';
import {
  ACTIVE_SUBMISSION_STATUSES,
  getSubmissionStatusText,
  normalizeSubmissionStatus,
} from '../common/submission-status.util';
import {
  ChatProcessStatus as ProcessStatus,
  ReworkHint,
  isTerminalChatProcessStatus,
  mapSubmissionStatusToChatProcessStatus,
  requiresUserAction,
} from '../common/chat-process-state';
import { isAuthCredentialField } from '../common/auth-field.util';
import { normalizeAttachmentRef } from '../attachment/attachment.utils';
import {
  buildChatRetentionWindow,
  getRestoreStatusForProcess,
  isConversationRestorable,
  shouldApplyChatRetention,
} from '../common/chat-retention.util';
import { LLMClientFactory } from '@uniflow/agent-kernel';

interface ChatInput {
  tenantId: string;
  userId: string;
  sessionId?: string;
  message: string;
  attachments?: ChatAttachment[];
  requestedTemplateId?: string;
  requestedConnectorId?: string;
  identityType?: string;
  roles?: string[];
}

interface ChatAttachment {
  attachmentId: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fieldKey?: string | null;
  bindScope?: 'field' | 'general';
  previewStatus?: string;
  canPreview?: boolean;
  previewUrl?: string;
  downloadUrl?: string;
}

export interface ActionButton {
  label: string;
  action: string; // confirm | cancel | modify
  type: 'primary' | 'default' | 'danger';
}

type ProcessFieldOrigin = 'user' | 'derived' | 'prefill';

interface AuthChallenge {
  connectorId: string;
  connectorName?: string;
  provider: string;
  startUrl: string;
  statusUrl: string;
}

export interface ProcessCardField {
  key: string;
  label: string;
  value: any;
  displayValue: any;
  type: string;
  required?: boolean;
  description?: string;
  example?: string;
  multiple?: boolean;
  options?: Array<{ label: string; value: string }>;
  origin?: ProcessFieldOrigin;
  tagLabel?: string;
  tagTone?: 'sky' | 'amber' | 'slate';
  hint?: string;
}

type ProcessCardStage =
  | 'collecting'
  | 'confirming'
  | 'executing'
  | 'draft'
  | 'submitted'
  | 'rework'
  | 'completed'
  | 'failed'
  | 'cancelled';

type ProcessCardActionState = 'available' | 'readonly';

interface ProcessCard {
  processInstanceId: string;
  processCode: string;
  processName: string;
  processCategory?: string | null;
  processStatus?: ProcessStatus;
  stage: ProcessCardStage;
  actionState: ProcessCardActionState;
  canContinue: boolean;
  statusText: string;
  summary?: string;
  formData?: Record<string, any>;
  fields: ProcessCardField[];
  missingFields?: Array<{
    key: string;
    label: string;
    question: string;
    type?: string;
    description?: string;
    example?: string;
    multiple?: boolean;
    options?: Array<{ label: string; value: string }>;
  }>;
  actionButtons?: ActionButton[];
  needsAttachment?: boolean;
  draftId?: string;
  submissionId?: string;
  oaSubmissionId?: string | null;
  reworkHint?: ReworkHint;
  reworkReason?: string | null;
  updatedAt: string;
}

export interface SessionState {
  hasActiveProcess: boolean;
  processInstanceId?: string;
  processCode?: string;
  processName?: string;
  processCategory?: string | null;
  processStatus?: ProcessStatus;
  stage?: ProcessCardStage;
  reworkHint?: ReworkHint;
  reworkReason?: string | null;
  isTerminal?: boolean;
  activeProcessCard?: ProcessCard | null;
  canRestoreConversation?: boolean;
}

export interface ChatResponse {
  sessionId: string;
  message: string;
  intent?: string;
  draftId?: string;
  needsInput: boolean;
  suggestedActions?: string[];
  actionButtons?: ActionButton[];
  formData?: Record<string, any>;
  missingFields?: Array<{
    key: string;
    label: string;
    question: string;
    type?: string;
    description?: string;
    example?: string;
    multiple?: boolean;
    options?: Array<{ label: string; value: string }>;
  }>;
  processStatus?: ProcessStatus;
  needsAttachment?: boolean;
  authChallenge?: AuthChallenge;
  processCard?: ProcessCard;
  sessionState?: SessionState;
}

// 上下文类型定义
interface SessionContext {
  sessionId: string;
  userId: string;
  tenantId: string;
  conversationHistory: any[];
  currentProcess?: ProcessContext;
  createdAt: Date;
}

interface ProcessContext {
  processId: string;
  processType: string;
  processCode: string;
  status: ProcessStatus;
  parameters: Record<string, any>;
  collectedParams: Set<string>;
  validationErrors: any[];
  createdAt: Date;
  updatedAt: Date;
}

interface SharedContext {
  userId: string;
  profile: {
    employeeId: string;
    name: string;
    department?: string;
    position?: string;
  };
  preferences: {
    defaultApprover?: string;
    defaultCC?: string[];
    language: string;
  };
  history: {
    recentRequests: any[];
    frequentTypes: string[];
  };
}

type PendingAssistantAction = 'cancel' | 'urge' | 'supplement' | 'delegate' | 'detail';

interface PendingSubmissionSelection {
  submissionId: string;
  oaSubmissionId?: string | null;
  processName?: string;
}

interface PendingConnectorSelection {
  id: string;
  name: string;
}

interface PendingFlowSelection {
  processCode: string;
  processName: string;
}

interface PendingFlowSelectionContext {
  originalMessage?: string;
  clarificationQuestion?: string;
}

interface PendingConnectorSelectionContext {
  originalMessage?: string;
  processCode?: string;
  processName?: string;
}

interface SubmissionResolution {
  flows: Array<{
    id: string;
    processCode: string;
    processName: string;
    processCategory: string | null;
    connector?: {
      id: string;
      name: string;
      oaType: string;
      oclLevel: string;
    } | null;
  }>;
  matchedFlow?: {
    processCode: string;
    processName: string;
    confidence: number;
  };
  flowCandidates?: PendingFlowSelection[];
  connectorId?: string | null;
  connectorName?: string | null;
  needsConnectorSelection: boolean;
  connectorCandidates?: PendingConnectorSelection[];
  connectorSelectionQuestion?: string;
  needsFlowClarification: boolean;
  flowClarificationQuestion?: string;
}

interface PendingActionExecutionContext {
  action: 'supplement' | 'delegate';
  submissionId: string;
  oaSubmissionId?: string | null;
  processName?: string;
}

type PendingSelectionKind = 'submission' | 'connector' | 'flow';

type PendingSelectionCandidate = {
  id: string;
  label: string;
  aliases?: string[];
};

type PendingSelectionResolution =
  | { action: 'select'; candidateId: string }
  | { action: 'cancel' | 'retry' | 'unknown' };

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly attachmentFieldBindingInference = new AttachmentFieldBindingInferenceEngine();
  private readonly llmClient = LLMClientFactory.createFromEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentAgent: IntentAgent,
    private readonly flowAgent: FlowAgent,
    private readonly formAgent: FormAgent,
    private readonly connectorRouter: ConnectorRouter,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
    private readonly processLibraryService: ProcessLibraryService,
    private readonly submissionService: SubmissionService,
    private readonly taskPlanAgent: TaskPlanAgent,
    private readonly attachmentService: AttachmentService,
    private readonly attachmentBindingService: AttachmentBindingService,
    private readonly tenantUserResolver: TenantUserResolverService,
    private readonly authBindingService: AuthBindingService,
  ) {}

  async chat(input: ChatInput): Promise<ChatResponse> {
    const traceId = this.auditService.generateTraceId();

    try {
      // Get or create session (may resolve userId to a valid one)
      const session = await this.getOrCreateSession(input);
      await this.applyRequestedRoutingContext(session, input);

      // Use the session's actual userId for all subsequent operations
      const resolvedUserId = session.userId;

      // Load shared context for user
      const sharedContext = await this.loadSharedContext(resolvedUserId, input.tenantId);
      const normalizedAttachments = input.attachments?.length
        ? await this.attachmentService.normalizeAttachmentRefs(
            input.tenantId,
            resolvedUserId,
            input.attachments as any,
          )
        : [];

      // Save user message
      await this.prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'user',
          content: input.message,
          metadata: normalizedAttachments.length
            ? { attachments: normalizedAttachments as any }
            : undefined,
        },
      });

      // If user sent attachments during parameter collection, store them in form data
      if (normalizedAttachments.length) {
        const processContext = this.extractProcessContext(session);
        if (
          processContext
          && [ProcessStatus.PARAMETER_COLLECTION, ProcessStatus.REWORK_REQUIRED].includes(processContext.status)
        ) {
          const currentFormData = { ...processContext.parameters };
          const template = await this.findTemplateForResolvedFlow(
            input.tenantId,
            processContext.processCode,
            {
              identityType: input.identityType,
              roles: input.roles,
            },
            ((session.metadata || {}) as Record<string, any>).currentConnectorId || null,
          );
          if (!template) {
            return {
              sessionId: session.id,
              message: '流程模板不存在，请联系管理员。',
              needsInput: false,
            };
          }
          const schema = template.schema as any;
          const fileFields = (schema?.fields || []).filter((f: any) => f.type === 'file');
          const fileFieldMap = new Map(fileFields.map((field: any) => [field.key, field]));
          const missingFileFields = (((session.metadata || {}) as Record<string, any>).missingFields || [])
            .filter((field: any) => field?.type === 'file');
          const missingFileFieldKeys = new Set<string>(missingFileFields.map((field: any) => field.key));

          let autoAssignedCount = 0;
          for (const attachment of normalizedAttachments) {
            const explicitFieldKey = attachment.fieldKey && fileFieldMap.has(attachment.fieldKey)
              ? attachment.fieldKey
              : null;

            let targetFieldKey = explicitFieldKey;
            if (!targetFieldKey) {
              if (fileFields.length === 1) {
                targetFieldKey = fileFields[0].key;
              } else if (missingFileFieldKeys.size === 1) {
                targetFieldKey = [...missingFileFieldKeys][0];
              } else if (fileFields.length > 1) {
                targetFieldKey = await this.inferAttachmentTargetFieldKey({
                  attachment,
                  fileFields,
                  missingFileFieldKeys,
                  currentFormData,
                  userMessage: input.message,
                  processCode: processContext.processCode,
                });
              }
            }

            if (!targetFieldKey && attachment.bindScope === 'general') {
              const currentGeneralAttachments = Array.isArray(currentFormData.attachments)
                ? currentFormData.attachments
                : [];
              currentFormData.attachments = [...currentGeneralAttachments, { ...attachment, bindScope: 'general' }];
              autoAssignedCount += 1;
              continue;
            }

            if (!targetFieldKey) {
              continue;
            }

            const existingFiles = Array.isArray(currentFormData[targetFieldKey])
              ? currentFormData[targetFieldKey]
              : [];

            currentFormData[targetFieldKey] = [...existingFiles, { ...attachment, fieldKey: targetFieldKey }];
            autoAssignedCount += 1;
          }

          const meta = (session.metadata || {}) as Record<string, any>;
          await this.prisma.chatSession.update({
            where: { id: session.id },
            data: {
              metadata: {
                ...meta,
                currentFormData,
              },
            },
          });
          session.metadata = { ...meta, currentFormData };
          await this.attachmentBindingService.bindSessionAttachments({
            tenantId: input.tenantId,
            userId: resolvedUserId,
            sessionId: session.id,
            attachments: normalizedAttachments,
          });

          if (autoAssignedCount !== normalizedAttachments.length) {
            this.logger.warn(
              `Only auto-bound ${autoAssignedCount}/${normalizedAttachments.length} attachments for session ${session.id}`,
            );
          }
        }
      }

      const pendingActionResponse = await this.tryHandlePendingActionSelection(
        { ...input, userId: resolvedUserId },
        session,
        traceId,
      );
      if (pendingActionResponse) {
        const enrichedResponse = await this.enrichChatResponse(
          pendingActionResponse,
          session,
          input.tenantId,
        );
        await this.saveAssistantMessage(session.id, enrichedResponse);
        return enrichedResponse;
      }

      const pendingConnectorResponse = await this.tryHandlePendingConnectorSelection(
        { ...input, userId: resolvedUserId },
        session,
        sharedContext,
        traceId,
      );
      if (pendingConnectorResponse) {
        const enrichedResponse = await this.enrichChatResponse(
          pendingConnectorResponse,
          session,
          input.tenantId,
        );
        await this.saveAssistantMessage(session.id, enrichedResponse);
        return enrichedResponse;
      }

      const pendingFlowResponse = await this.tryHandlePendingFlowSelection(
        { ...input, userId: resolvedUserId },
        session,
        sharedContext,
        traceId,
      );
      if (pendingFlowResponse) {
        const enrichedResponse = await this.enrichChatResponse(
          pendingFlowResponse,
          session,
          input.tenantId,
        );
        await this.saveAssistantMessage(session.id, enrichedResponse);
        return enrichedResponse;
      }

      const pendingActionExecutionResponse = await this.tryHandlePendingActionExecution(
        { ...input, userId: resolvedUserId, attachments: normalizedAttachments as any },
        session,
        traceId,
      );
      if (pendingActionExecutionResponse) {
        const enrichedResponse = await this.enrichChatResponse(
          pendingActionExecutionResponse,
          session,
          input.tenantId,
        );
        await this.saveAssistantMessage(session.id, enrichedResponse);
        return enrichedResponse;
      }

      // Check if we're in the middle of a process
      const processContext = this.extractProcessContext(session);

      let response: ChatResponse;

      // If in parameter collection, check if user wants to switch to a different flow
      if (processContext && processContext.status === ProcessStatus.AUTH_REQUIRED) {
        response = await this.handleDelegatedAuthResume(
          { ...input, userId: resolvedUserId },
          session,
          processContext,
          sharedContext,
          traceId,
        );
      } else if (
        processContext
        && [ProcessStatus.PARAMETER_COLLECTION, ProcessStatus.REWORK_REQUIRED].includes(processContext.status)
      ) {
        // 先检测用户是否想发起新流程（意图切换检测）
        const switchCheck = await this.intentAgent.detectIntent(input.message, {
          userId: resolvedUserId,
          tenantId: input.tenantId,
          sessionId: session.id,
        });

        if (
          switchCheck.intent === ChatIntent.CREATE_SUBMISSION &&
          switchCheck.confidence >= 0.7
        ) {
          // 用户可能想发起新流程，检查是否匹配到不同的流程
          const allFlows = await this.processLibraryService.list(input.tenantId, undefined, undefined, {
            identityType: input.identityType,
            roles: input.roles,
          });
          const sessionMeta = (session.metadata || {}) as Record<string, any>;
          const scopedFlows = sessionMeta.routedConnectorId
            ? allFlows.filter(f => f.connector?.id === sessionMeta.routedConnectorId)
            : allFlows;
          const scopedCandidates = scopedFlows.map(f => ({
            processCode: f.processCode,
            processName: f.processName,
            processCategory: f.processCategory || '',
          }));
          let flowResult = await this.flowAgent.matchFlow(
            switchCheck.intent,
            input.message,
            scopedCandidates,
          );

          if (
            !flowResult.matchedFlow
            && sessionMeta.routedConnectorId
            && scopedFlows.length !== allFlows.length
          ) {
            flowResult = await this.flowAgent.matchFlow(
              switchCheck.intent,
              input.message,
              allFlows.map(f => ({
                processCode: f.processCode,
                processName: f.processName,
                processCategory: f.processCategory || '',
              })),
            );
          }

          if (
            flowResult.matchedFlow &&
            flowResult.matchedFlow.processCode !== processContext.processCode
          ) {
            // 确认是不同的流程，中断当前流程，重新走意图路由
            this.logger.log(
              `用户在 ${processContext.processCode} 参数收集中切换到 ${flowResult.matchedFlow.processCode}`,
            );
            await this.rollbackProcess(session, traceId);
            // 清空 processContext，让下面走正常的意图路由
            const resolvedInput = { ...input, userId: resolvedUserId };
            response = await this.handleCreateSubmission(
              resolvedInput,
              session,
              switchCheck,
              sharedContext,
              traceId,
            );
            const enrichedResponse = await this.enrichChatResponse(
              response,
              session,
              input.tenantId,
            );
            await this.saveAssistantMessage(session.id, enrichedResponse);
            return enrichedResponse;
          }
        }

        // 不是意图切换，继续当前流程的参数收集
        response = await this.continueParameterCollection(
          { ...input, userId: resolvedUserId },
          session,
          processContext,
          sharedContext,
          traceId,
        );
      } else if (processContext && processContext.status === ProcessStatus.PENDING_CONFIRMATION) {
        // If pending confirmation, handle confirmation
        response = await this.handleConfirmation(
          { ...input, userId: resolvedUserId },
          session,
          processContext,
          traceId,
        );
      } else {
        // Step 1: Detect intent
        const intentResult = await this.intentAgent.detectIntent(input.message, {
          userId: resolvedUserId,
          tenantId: input.tenantId,
          sessionId: session.id,
        });

        // Log intent detection
        await this.auditService.createLog({
          tenantId: input.tenantId,
          traceId,
          userId: resolvedUserId,
          action: 'intent_detection',
          result: 'success',
          details: { intent: intentResult.intent, confidence: intentResult.confidence },
        });

        // Create a modified input with resolved userId
        const resolvedInput = { ...input, userId: resolvedUserId };

        switch (intentResult.intent) {
          case ChatIntent.CREATE_SUBMISSION:
            response = await this.handleCreateSubmission(
              resolvedInput,
              session,
              intentResult,
              sharedContext,
              traceId,
            );
            break;
          case ChatIntent.QUERY_STATUS:
            response = await this.handleQueryStatus(resolvedInput, session, traceId);
            break;
          case ChatIntent.CANCEL_SUBMISSION:
            response = await this.handleAction(resolvedInput, session, 'cancel', traceId);
            break;
          case ChatIntent.URGE:
            response = await this.handleAction(resolvedInput, session, 'urge', traceId);
            break;
          case ChatIntent.SUPPLEMENT:
            response = await this.handleAction(resolvedInput, session, 'supplement', traceId);
            break;
          case ChatIntent.DELEGATE:
            response = await this.handleAction(resolvedInput, session, 'delegate', traceId);
            break;
          case ChatIntent.SERVICE_REQUEST:
            response = await this.handleServiceRequest(resolvedInput, session, traceId);
            break;
          default:
            response = {
              sessionId: session.id,
              message: '抱歉，我没有理解您的意图。您可以尝试：\n- 发起申请（如"帮我办理一个流程"）\n- 查询进度（如"我的申请到哪了"）\n- 撤回申请\n- 催办\n- 补件\n- 转办',
              needsInput: true,
              suggestedActions: ['发起申请', '查询进度', '查看流程列表'],
            };
        }
      }

      // Save assistant response (unified for all branches)
      response = await this.enrichChatResponse(response, session, input.tenantId);
      await this.saveAssistantMessage(session.id, response);
      return response;
    } catch (err: any) {
      this.logger.error(' chat error:', err.message, err.stack);

      // Log error
      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'chat_error',
        result: 'error',
        details: { error: err.message, stack: err.stack },
      });

      return {
        sessionId: input.sessionId || 'error',
        message: '抱歉，处理您的请求时出现了问题，请稍后再试。',
        needsInput: true,
      };
    }
  }

  // 加载共享上下文
  private async loadSharedContext(userId: string, tenantId: string): Promise<SharedContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // 获取用户最近的提交记录
    const recentSubmissions = await this.prisma.submission.findMany({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // 获取模板信息
    const templateIds = [...new Set(recentSubmissions.map(s => s.templateId))];
    const templates = await this.prisma.processTemplate.findMany({
      where: { id: { in: templateIds } },
    });

    const templateMap = new Map(templates.map(t => [t.id, t]));

    // 统计常用流程类型
    const frequentTypes = recentSubmissions
      .map(s => {
        const template = templateMap.get(s.templateId);
        return template?.processCode;
      })
      .filter(Boolean)
      .reduce((acc, code) => {
        if (code) {
          acc[code] = (acc[code] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);

    const sortedTypes = Object.entries(frequentTypes)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([code]) => code);

    return {
      userId,
      profile: {
        employeeId: user.id,
        name: user.displayName || user.username || 'User',
        department: undefined,
        position: undefined,
      },
      preferences: {
        defaultApprover: undefined,
        defaultCC: [],
        language: 'zh-CN',
      },
      history: {
        recentRequests: recentSubmissions.map(s => {
          const template = templateMap.get(s.templateId);
          return {
            id: s.id,
            processCode: template?.processCode || '',
            processName: template?.processName || '',
            status: s.status,
            createdAt: s.createdAt,
          };
        }),
        frequentTypes: sortedTypes,
      },
    };
  }

  private async saveAssistantMessage(sessionId: string, response: ChatResponse) {
    await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content: response.message,
        metadata: {
          messageKind: response.processCard ? 'process_card' : 'text',
          processStatus: response.processStatus,
          draftId: response.draftId,
          actionButtons: response.actionButtons as any,
          formData: response.formData,
          missingFields: response.missingFields as any,
          needsAttachment: response.needsAttachment,
          authChallenge: response.authChallenge as any,
          processCard: response.processCard as any,
          sessionState: response.sessionState as any,
        },
      },
    });
  }

  private async enrichChatResponse(
    response: ChatResponse,
    session: any,
    tenantId: string,
  ): Promise<ChatResponse> {
    const metadata = ((session.metadata || {}) as Record<string, any>) || {};
    let processCard = response.processCard;
    if (!processCard && (response.formData || response.processStatus)) {
      const template = await this.findTemplateForProcess(
        tenantId,
        metadata.currentTemplateId,
        metadata.currentProcessCode,
      );

      processCard = this.buildProcessCard({
        processInstanceId: metadata.processId || metadata.pendingDraftId || session.id,
        processCode: metadata.currentProcessCode || 'unknown_process',
        processName: metadata.currentProcessName || template?.processName || metadata.currentProcessCode || '流程申请',
        processCategory: metadata.currentProcessCategory || template?.processCategory || null,
        processStatus: response.processStatus,
        template,
        summary: (metadata.currentProcessSummary as string | undefined) || undefined,
        formData: response.formData,
        fieldOrigins: (metadata.currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined) || {},
        missingFields: response.missingFields,
        actionButtons: response.actionButtons,
        needsAttachment: response.needsAttachment,
        draftId: response.draftId || metadata.pendingDraftId,
        reworkHint: (metadata.reworkHint as ReworkHint | undefined) || undefined,
        reworkReason: (metadata.reworkReason as string | undefined) || undefined,
      });
    }

    let sessionState = await this.buildSessionState(session, tenantId);
    if (
      response.processStatus === ProcessStatus.PENDING_CONFIRMATION
      && processCard
      && sessionState.activeProcessCard
    ) {
      const displayProcessName = this.resolveDisplayProcessName(
        session,
        sessionState.processName,
        processCard.processCode,
      );
      const confirmationSummary = this.buildConfirmationSummary(
        displayProcessName,
        (metadata.currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined) || {},
      );

      processCard = {
        ...processCard,
        processName: displayProcessName,
        summary: confirmationSummary,
      };
      sessionState = {
        ...sessionState,
        processName: displayProcessName,
        activeProcessCard: {
          ...sessionState.activeProcessCard,
          processName: displayProcessName,
          summary: confirmationSummary,
        },
      };

      if (response.message.startsWith('已为您整理好“')) {
        response = {
          ...response,
          message: `已为您整理好“${displayProcessName}”。请重点核对下方表单，确认无误后提交。`,
        };
      }
    }

    return {
      ...response,
      processCard,
      sessionState,
    };
  }

  private async buildSessionState(session: any, tenantId: string): Promise<SessionState> {
    const metadata = ((session.metadata || {}) as Record<string, any>) || {};
    const processCode = metadata.currentProcessCode as string | undefined;
    const metadataProcessStatus = metadata.processStatus as ProcessStatus | undefined;
    const currentSubmissionId = metadata.currentSubmissionId as string | undefined;

    if (!processCode) {
      return { hasActiveProcess: false, activeProcessCard: null };
    }

    const [template, currentSubmission] = await Promise.all([
      this.findTemplateForProcess(
        tenantId,
        metadata.currentTemplateId,
        processCode,
      ),
      currentSubmissionId
        ? this.prisma.submission.findUnique({
            where: { id: currentSubmissionId },
            select: {
              status: true,
              submitResult: true,
              oaSubmissionId: true,
            },
          })
        : Promise.resolve(null),
    ]);
    const effectiveSubmissionStatus = currentSubmission
      ? normalizeSubmissionStatus(currentSubmission.status, {
          submitResult: currentSubmission.submitResult,
        })
      : '';
    const processStatus = effectiveSubmissionStatus
      ? mapSubmissionStatusToChatProcessStatus(effectiveSubmissionStatus)
      : metadataProcessStatus;

    if (!processStatus) {
      return { hasActiveProcess: false, activeProcessCard: null };
    }

    const reworkHint = (metadata.reworkHint as ReworkHint | undefined) || undefined;
    const reworkReason = (metadata.reworkReason as string | undefined) || undefined;
    const activeProcessCard = this.buildProcessCard({
      processInstanceId: metadata.processId || metadata.pendingDraftId || session.id,
      processCode,
      processName: metadata.currentProcessName || template?.processName || processCode,
      processCategory: metadata.currentProcessCategory || template?.processCategory || null,
      processStatus,
      template,
      summary: (metadata.currentProcessSummary as string | undefined) || undefined,
      formData: (metadata.currentFormData || {}) as Record<string, any>,
      fieldOrigins: (metadata.currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined) || {},
      missingFields: Array.isArray(metadata.missingFields) ? metadata.missingFields : [],
      draftId: metadata.pendingDraftId as string | undefined,
      submissionId: currentSubmissionId,
      oaSubmissionId: currentSubmission?.oaSubmissionId || (metadata.currentOaSubmissionId as string | undefined) || null,
      updatedAt: metadata.processUpdatedAt as string | undefined,
      actionState: [ProcessStatus.PENDING_CONFIRMATION, ProcessStatus.AUTH_REQUIRED].includes(processStatus)
        ? 'available'
        : 'readonly',
      canContinue: requiresUserAction(processStatus),
      reworkHint,
      reworkReason,
    });

    return {
      hasActiveProcess: requiresUserAction(processStatus),
      processInstanceId: activeProcessCard.processInstanceId,
      processCode,
      processName: activeProcessCard.processName,
      processCategory: activeProcessCard.processCategory,
      processStatus,
      stage: activeProcessCard.stage,
      reworkHint,
      reworkReason,
      isTerminal: isTerminalChatProcessStatus(processStatus),
      activeProcessCard,
    };
  }

  private async findTemplateForProcess(
    tenantId: string,
    templateId?: string,
    processCode?: string,
  ) {
    if (templateId) {
      const template = await this.prisma.processTemplate.findUnique({
        where: { id: templateId },
      });
      if (template) {
        return template;
      }
    }

    if (!processCode) {
      return null;
    }

    return this.prisma.processTemplate.findFirst({
      where: {
        tenantId,
        processCode,
        status: 'published',
      },
      orderBy: { version: 'desc' },
    });
  }

  private buildProcessCard(params: {
    processInstanceId: string;
    processCode: string;
    processName: string;
    processCategory?: string | null;
    processStatus?: ProcessStatus;
    template?: any | null;
    summary?: string;
    formData?: Record<string, any>;
    fieldOrigins?: Record<string, ProcessFieldOrigin>;
  missingFields?: Array<{
    key: string;
    label: string;
    question: string;
    type?: string;
    options?: Array<{ label: string; value: string }>;
  }>;
    actionButtons?: ActionButton[];
    needsAttachment?: boolean;
    draftId?: string;
    submissionId?: string;
    oaSubmissionId?: string | null;
    updatedAt?: string;
    actionState?: ProcessCardActionState;
    canContinue?: boolean;
    reworkHint?: ReworkHint;
    reworkReason?: string | null;
  }): ProcessCard {
    const stage = this.mapProcessStatusToStage(params.processStatus);
    const fields = this.buildFormDataWithLabels(
      params.formData || {},
      params.template,
      params.fieldOrigins || {},
    ).map((field) => ({
      ...field,
      required: Boolean(field.required),
    }));

    return {
      processInstanceId: params.processInstanceId,
      processCode: params.processCode,
      processName: params.processName,
      processCategory: params.processCategory || null,
      processStatus: params.processStatus,
      stage,
      actionState: params.actionState || (params.actionButtons?.length ? 'available' : 'readonly'),
      canContinue: params.canContinue ?? requiresUserAction(params.processStatus || ProcessStatus.INITIALIZED),
      statusText: this.getProcessCardStatusText(params.processStatus, params.reworkHint),
      summary: params.summary,
      formData: params.formData,
      fields,
      missingFields: params.missingFields,
      actionButtons: params.actionButtons,
      needsAttachment: params.needsAttachment,
      draftId: params.draftId,
      submissionId: params.submissionId,
      oaSubmissionId: params.oaSubmissionId,
      reworkHint: params.reworkHint,
      reworkReason: params.reworkReason || null,
      updatedAt: params.updatedAt || new Date().toISOString(),
    };
  }

  private mapProcessStatusToStage(processStatus?: ProcessStatus): ProcessCardStage {
    switch (processStatus) {
      case ProcessStatus.AUTH_REQUIRED:
      case ProcessStatus.PARAMETER_COLLECTION:
        return 'collecting';
      case ProcessStatus.PENDING_CONFIRMATION:
        return 'confirming';
      case ProcessStatus.EXECUTING:
        return 'executing';
      case ProcessStatus.DRAFT_SAVED:
        return 'draft';
      case ProcessStatus.SUBMITTED:
        return 'submitted';
      case ProcessStatus.REWORK_REQUIRED:
        return 'rework';
      case ProcessStatus.COMPLETED:
        return 'completed';
      case ProcessStatus.FAILED:
        return 'failed';
      case ProcessStatus.CANCELLED:
        return 'cancelled';
      default:
        return 'collecting';
    }
  }

  private getProcessCardStatusText(
    processStatus?: ProcessStatus,
    reworkHint?: ReworkHint,
  ) {
    switch (processStatus) {
      case ProcessStatus.AUTH_REQUIRED:
        return '待完成授权';
      case ProcessStatus.PARAMETER_COLLECTION:
        return '待补充信息';
      case ProcessStatus.PENDING_CONFIRMATION:
        return '待确认提交';
      case ProcessStatus.EXECUTING:
        return '提交执行中';
      case ProcessStatus.DRAFT_SAVED:
        return '已保存待发';
      case ProcessStatus.SUBMITTED:
        return '审批中';
      case ProcessStatus.REWORK_REQUIRED:
        if (reworkHint === 'supplement') {
          return '待补件';
        }
        if (reworkHint === 'modify') {
          return '打回修改';
        }
        return '驳回待处理';
      case ProcessStatus.COMPLETED:
        return '已完成';
      case ProcessStatus.FAILED:
        return '处理失败';
      case ProcessStatus.CANCELLED:
        return '已取消';
      default:
        return '处理中';
    }
  }

  // 提取流程上下文
  private async handleDelegatedAuthResume(
    input: ChatInput,
    session: any,
    processContext: ProcessContext,
    sharedContext: SharedContext,
    traceId: string,
  ): Promise<ChatResponse> {
    const message = input.message.trim();
    if (message === '__ACTION_CANCEL__' || this.isAbortPendingSelectionMessage(message)) {
      const processName = (session.metadata?.currentProcessName as string) || processContext.processCode;
      const processCategory = (session.metadata?.currentProcessCategory as string) || null;
      await this.rollbackProcess(session, traceId);
      return {
        sessionId: session.id,
        message: '已取消本次流程办理。如需重新发起，请告诉我。',
        needsInput: false,
        formData: processContext.parameters,
        processStatus: ProcessStatus.CANCELLED,
        processCard: this.buildProcessCard({
          processInstanceId: processContext.processId,
          processCode: processContext.processCode,
          processName,
          processCategory,
          processStatus: ProcessStatus.CANCELLED,
          formData: processContext.parameters,
          actionState: 'readonly',
          canContinue: false,
        }),
      };
    }

    const template = await this.findTemplateForResolvedFlow(
      input.tenantId,
      processContext.processCode,
      {
        identityType: input.identityType,
        roles: input.roles,
      },
      ((session.metadata || {}) as Record<string, any>).currentConnectorId || null,
    );
    const currentFieldOrigins: Record<string, ProcessFieldOrigin> = {
      ...(((session.metadata || {}) as Record<string, any>).currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined),
    };
    const currentFormData = {
      ...processContext.parameters,
    };

    this.prefillFromSharedContext(currentFormData, template.schema as any, sharedContext, currentFieldOrigins);

    const delegatedAuthResponse = await this.ensureDelegatedAuthorization({
      input,
      session,
      template,
      processId: processContext.processId,
      currentFormData,
      currentFieldOrigins,
    });
    if (delegatedAuthResponse) {
      if (message === '__ACTION_AUTHORIZED__') {
        return {
          ...delegatedAuthResponse,
          message: `${delegatedAuthResponse.authChallenge?.connectorName || '当前系统'}授权结果还在同步，请稍等几秒后重试，或再次点击授权按钮。`,
        };
      }
      return delegatedAuthResponse;
    }

    return this.generateConfirmation(input, session, template, currentFormData, traceId);
  }

  private async ensureDelegatedAuthorization(params: {
    input: ChatInput;
    session: any;
    template: any;
    processId: string;
    currentFormData: Record<string, any>;
    currentFieldOrigins: Record<string, ProcessFieldOrigin>;
  }): Promise<ChatResponse | null> {
    const delegatedAuth = await this.readDelegatedAuthConfig(
      params.input.tenantId,
      params.template,
      params.session,
    );
    if (!delegatedAuth) {
      return null;
    }

    const bindingStatus = await this.authBindingService.hasUsableBinding({
      tenantId: params.input.tenantId,
      connectorId: delegatedAuth.connectorId,
      userId: params.input.userId,
    });
    if (bindingStatus.authorized) {
      return null;
    }

    const displayProcessName = this.resolveDisplayProcessName(
      params.session,
      params.template?.processName,
      params.template?.processCode,
    );
    const actionButtons: ActionButton[] = [
      {
        label: `去${delegatedAuth.connectorName}授权`,
        action: 'authorize',
        type: 'primary',
      },
    ];
    const authChallenge = this.buildAuthChallenge({
      connectorId: delegatedAuth.connectorId,
      connectorName: delegatedAuth.connectorName,
      provider: delegatedAuth.provider,
      sessionId: params.session.id,
      processCode: params.template?.processCode,
    });
    const updatedMetadata = {
      ...((params.session.metadata || {}) as Record<string, any>),
      processId: params.processId,
      processType: ChatIntent.CREATE_SUBMISSION,
      currentTemplateId: params.template.id,
      currentConnectorId: delegatedAuth.connectorId,
      currentConnectorName: delegatedAuth.connectorName,
      currentProcessCode: params.template.processCode,
      currentProcessName: displayProcessName,
      currentProcessCategory: params.template.processCategory || null,
      currentFormData: params.currentFormData,
      currentFieldOrigins: params.currentFieldOrigins,
      currentProcessSummary: null,
      currentInteractionMode: null,
      missingFields: [],
      processStatus: ProcessStatus.AUTH_REQUIRED,
      processCreatedAt: ((params.session.metadata || {}) as Record<string, any>).processCreatedAt || new Date().toISOString(),
      processUpdatedAt: new Date().toISOString(),
    };

    await this.prisma.chatSession.update({
      where: { id: params.session.id },
      data: { metadata: updatedMetadata },
    });
    params.session.metadata = updatedMetadata;

    return {
      sessionId: params.session.id,
      message: `办理“${displayProcessName}”前，需要先完成${delegatedAuth.connectorName}授权。请点击下方按钮，在新窗口完成登录。`,
      intent: ChatIntent.CREATE_SUBMISSION,
      needsInput: true,
      formData: params.currentFormData,
      missingFields: [],
      processStatus: ProcessStatus.AUTH_REQUIRED,
      actionButtons,
      suggestedActions: actionButtons.map((button) => button.label),
      authChallenge,
    };
  }

  private async readDelegatedAuthConfig(
    tenantId: string,
    template: any | null | undefined,
    session: any,
  ): Promise<{ connectorId: string; connectorName: string; provider: string } | null> {
    const embeddedConnector = template?.connector
      ? {
          id: template.connector.id,
          name: template.connector.name,
          authConfig: template.connector.authConfig,
        }
      : null;
    const metadata = ((session?.metadata || {}) as Record<string, any>) || {};
    const connectorId = embeddedConnector?.id
      || template?.connectorId
      || metadata.currentConnectorId
      || metadata.routedConnectorId;

    let connector = embeddedConnector;
    if (!connector && connectorId) {
      connector = await this.prisma.connector.findFirst({
        where: {
          id: connectorId,
          tenantId,
        },
        select: {
          id: true,
          name: true,
          authConfig: true,
        },
      });
    }

    if (!connector) {
      return null;
    }

    const authConfig = (
      connector.authConfig
      && typeof connector.authConfig === 'object'
      && !Array.isArray(connector.authConfig)
    )
      ? connector.authConfig as Record<string, any>
      : {};
    const delegatedAuth = (
      authConfig.delegatedAuth
      && typeof authConfig.delegatedAuth === 'object'
      && !Array.isArray(authConfig.delegatedAuth)
    )
      ? authConfig.delegatedAuth as Record<string, any>
      : null;

    if (!delegatedAuth || delegatedAuth.enabled !== true) {
      return null;
    }

    return {
      connectorId: connector.id,
      connectorName: connector.name,
      provider: typeof delegatedAuth.provider === 'string' && delegatedAuth.provider.trim()
        ? delegatedAuth.provider.trim()
        : 'delegated_oauth2',
    };
  }

  private buildAuthChallenge(input: {
    connectorId: string;
    connectorName: string;
    provider: string;
    sessionId: string;
    processCode?: string;
  }): AuthChallenge {
    const query = new URLSearchParams({
      sessionId: input.sessionId,
      ...(input.processCode ? { processCode: input.processCode } : {}),
    });

    return {
      connectorId: input.connectorId,
      connectorName: input.connectorName,
      provider: input.provider,
      startUrl: `/api/v1/connectors/${input.connectorId}/delegated-auth/start?${query.toString()}`,
      statusUrl: `/api/v1/connectors/${input.connectorId}/delegated-auth/status?sessionId=${encodeURIComponent(input.sessionId)}`,
    };
  }

  private buildMissingFieldsPrompt(
    missingFields: Array<{
      key: string;
      label: string;
      question: string;
      type?: string;
      options?: Array<{ label: string; value: string }>;
    }>,
    processName?: string,
  ) {
    if (missingFields.length === 0) {
      return '请按下方提示继续补充信息。';
    }

    const prefix = processName
      ? `正在为您填写“${processName}”`
      : '当前流程';

    return `${prefix}，还差 ${missingFields.length} 项信息，请按下方提示补充。`;
  }

  private async resolveSubmissionTarget(
    input: ChatInput,
    session: any,
    intentResult: any,
  ): Promise<SubmissionResolution> {
    const sessionMeta = (session.metadata || {}) as Record<string, any>;
    const allFlows = await this.processLibraryService.list(input.tenantId, undefined, undefined, {
      identityType: input.identityType,
      roles: input.roles,
    });
    const requestedTemplateId = typeof sessionMeta.requestedTemplateId === 'string'
      ? sessionMeta.requestedTemplateId.trim()
      : '';
    const requestedTemplate = requestedTemplateId
      ? allFlows.find((flow) => flow.id === requestedTemplateId)
      : undefined;

    if (requestedTemplate) {
      return {
        flows: [requestedTemplate],
        matchedFlow: {
          processCode: requestedTemplate.processCode,
          processName: requestedTemplate.processName,
          confidence: 1,
        },
        connectorId: requestedTemplate.connector?.id || null,
        connectorName: requestedTemplate.connector?.name || null,
        needsConnectorSelection: false,
        needsFlowClarification: false,
      };
    }

    const explicitConnectorId = sessionMeta.routedConnectorId || null;

    let scopedFlows = allFlows;
    if (explicitConnectorId) {
      const connectorScoped = allFlows.filter((flow) => flow.connector?.id === explicitConnectorId);
      if (connectorScoped.length > 0) {
        scopedFlows = connectorScoped;
      }
    }

    const uniqueFlowCandidates = this.dedupeFlowCandidates(scopedFlows);

    let matchedFlow = uniqueFlowCandidates.length === 1
      ? {
        processCode: uniqueFlowCandidates[0].processCode,
        processName: uniqueFlowCandidates[0].processName,
        confidence: 0.99,
      }
      : undefined;
    let flowClarificationQuestion: string | undefined;
    let needsFlowClarification = false;
    let clarificationCandidates: PendingFlowSelection[] | undefined;

    if (!matchedFlow) {
      const flowResult = await this.flowAgent.matchFlow(
        intentResult.intent,
        input.message,
        uniqueFlowCandidates.map((flow) => ({
          processCode: flow.processCode,
          processName: flow.processName,
          processCategory: flow.processCategory || '',
        })),
      );

      matchedFlow = flowResult.matchedFlow;
      needsFlowClarification = flowResult.needsClarification || !flowResult.matchedFlow;
      flowClarificationQuestion = flowResult.clarificationQuestion;
      clarificationCandidates = this.dedupePendingFlowCandidates(
        Array.isArray(flowResult.candidateFlows) && flowResult.candidateFlows.length > 0
          ? flowResult.candidateFlows
          : uniqueFlowCandidates.map((flow) => ({
              processCode: flow.processCode,
              processName: flow.processName,
            })),
      );
    }

    if (!matchedFlow) {
      return {
        flows: allFlows,
        flowCandidates: clarificationCandidates,
        needsConnectorSelection: false,
        needsFlowClarification: true,
        flowClarificationQuestion,
      };
    }

    const matchedTemplates = allFlows.filter((flow) => flow.processCode === matchedFlow.processCode);
    const availableConnectors = this.dedupeConnectorCandidates(
      matchedTemplates
        .map((flow) => flow.connector)
        .filter((connector): connector is NonNullable<typeof matchedTemplates[number]['connector']> => Boolean(connector)),
    );

    if (availableConnectors.length === 0) {
      return {
        flows: allFlows,
        matchedFlow,
        needsConnectorSelection: false,
        needsFlowClarification: true,
        flowClarificationQuestion: `流程“${matchedFlow.processName}”当前没有可用系统，请联系管理员检查配置。`,
      };
    }

    const routedConnector = explicitConnectorId
      ? availableConnectors.find((connector) => connector.id === explicitConnectorId) || null
      : null;

    if (routedConnector) {
      return {
        flows: matchedTemplates.filter((flow) => flow.connector?.id === routedConnector.id),
        matchedFlow,
        connectorId: routedConnector.id,
        connectorName: routedConnector.name,
        needsConnectorSelection: false,
        needsFlowClarification: false,
      };
    }

    if (availableConnectors.length === 1) {
      return {
        flows: matchedTemplates.filter((flow) => flow.connector?.id === availableConnectors[0].id),
        matchedFlow,
        connectorId: availableConnectors[0].id,
        connectorName: availableConnectors[0].name,
        needsConnectorSelection: false,
        needsFlowClarification: false,
      };
    }

    const routeResult = await this.connectorRouter.route(
      input.tenantId,
      input.userId,
      input.message,
      explicitConnectorId,
      matchedTemplates
        .map((flow) => flow.connector)
        .filter((connector): connector is NonNullable<typeof matchedTemplates[number]['connector']> => Boolean(connector)),
    );

    if (routeResult.connectorId) {
      return {
        flows: matchedTemplates.filter((flow) => flow.connector?.id === routeResult.connectorId),
        matchedFlow,
        connectorId: routeResult.connectorId,
        connectorName: routeResult.connectorName || null,
        needsConnectorSelection: false,
        needsFlowClarification: false,
      };
    }

    return {
      flows: matchedTemplates,
      matchedFlow,
      needsConnectorSelection: true,
      connectorCandidates: routeResult.candidates || availableConnectors,
      connectorSelectionQuestion: routeResult.selectionQuestion,
      needsFlowClarification: false,
    };
  }

  private dedupeFlowCandidates(flows: Array<{
    id: string;
    processCode: string;
    processName: string;
    processCategory: string | null;
    connector?: {
      id: string;
      name: string;
      oaType: string;
      oclLevel: string;
    } | null;
  }>) {
    const seen = new Map<string, typeof flows[number]>();
    for (const flow of flows) {
      if (!seen.has(flow.processCode)) {
        seen.set(flow.processCode, flow);
      }
    }
    return [...seen.values()];
  }

  private dedupeConnectorCandidates(connectors: Array<{
    id: string;
    name: string;
    oaType: string;
    oclLevel: string;
  }>) {
    const seen = new Map<string, PendingConnectorSelection>();
    for (const connector of connectors) {
      if (!seen.has(connector.id)) {
        seen.set(connector.id, {
          id: connector.id,
          name: connector.name,
        });
      }
    }
    return [...seen.values()];
  }

  private async findTemplateForResolvedFlow(
    tenantId: string,
    processCode: string,
    access?: { identityType?: string; roles?: string[] },
    connectorId?: string | null,
  ) {
    if (connectorId) {
      const template = await this.prisma.processTemplate.findFirst({
        where: {
          tenantId,
          processCode,
          connectorId,
          status: 'published',
          connector: {
            is: {
              ...(access?.roles?.some((role) => role === 'admin' || role === 'flow_manager')
                ? {}
                : {
                    identityScope: {
                      in: access?.identityType === 'teacher' || access?.identityType === 'student'
                        ? ['both', access.identityType]
                        : ['both'],
                    },
                  }),
            },
          },
        },
        include: {
          connector: true,
        },
        orderBy: {
          version: 'desc',
        },
      });

      if (template) {
        return template;
      }
    }

    return this.processLibraryService.getByCode(
      tenantId,
      processCode,
      undefined,
      undefined,
      access,
    );
  }

  private extractProcessContext(session: any): ProcessContext | null {
    const metadata = session.metadata || {};
    if (!metadata.currentProcessCode) {
      return null;
    }

    return {
      processId: metadata.processId || `process_${Date.now()}`,
      processType: metadata.processType || 'submission',
      processCode: metadata.currentProcessCode,
      status: metadata.processStatus || ProcessStatus.INITIALIZED,
      parameters: metadata.currentFormData || {},
      collectedParams: new Set(Object.keys(metadata.currentFormData || {})),
      validationErrors: metadata.validationErrors || [],
      createdAt: new Date(metadata.processCreatedAt || Date.now()),
      updatedAt: new Date(),
    };
  }

  // 继续参数收集流程
  private async continueParameterCollection(
    input: ChatInput,
    session: any,
    processContext: ProcessContext,
    sharedContext: SharedContext,
    traceId: string,
  ): Promise<ChatResponse> {
    try {
      const template = await this.findTemplateForResolvedFlow(
        input.tenantId,
        processContext.processCode,
        {
          identityType: input.identityType,
          roles: input.roles,
        },
        ((session.metadata || {}) as Record<string, any>).currentConnectorId || null,
      );
      if (!template) {
        return {
          sessionId: session.id,
          message: '流程模板不存在，请联系管理员。',
          needsInput: false,
        };
      }

      const schema = template.schema as any;
      const interactionMode = (((session.metadata || {}) as Record<string, any>).currentInteractionMode as string | undefined) || null;

      if (interactionMode === 'modify') {
        return await this.handleModificationCollection(
          input,
          session,
          processContext,
          sharedContext,
          template,
          traceId,
        );
      }

      let modifiedFields: Record<string, any> = {};
      let modifiedFieldOrigins: Record<string, ProcessFieldOrigin> = {};
      if (Object.keys(processContext.parameters || {}).length > 0) {
        const modificationResult = await this.formAgent.extractModifications(
          processContext.processCode,
          schema,
          input.message,
          processContext.parameters,
        );
        modifiedFields = this.filterChangedFormFields(
          processContext.parameters,
          modificationResult.modifiedFields,
        );
        modifiedFieldOrigins = Object.fromEntries(
          Object.keys(modifiedFields).map((key) => [
            key,
            modificationResult.fieldOrigins[key] || 'user',
          ]),
        );
      }

      // 提取用户输入的字段值
      const formResult = await this.formAgent.extractFields(
        processContext.processCode,
        schema,
        input.message,
        {
          ...processContext.parameters,
          ...modifiedFields,
        },
      );

      // 合并表单数据
      const currentFormData = {
        ...processContext.parameters,
        ...modifiedFields,
        ...formResult.extractedFields,
      };
      const currentFieldOrigins: Record<string, ProcessFieldOrigin> = {
        ...(((session.metadata || {}) as Record<string, any>).currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined),
        ...modifiedFieldOrigins,
        ...formResult.fieldOrigins,
      };

      // 从共享上下文预填充默认值
      this.prefillFromSharedContext(currentFormData, schema, sharedContext, currentFieldOrigins);

      if (formResult.isComplete) {
        const delegatedAuthResponse = await this.ensureDelegatedAuthorization({
          input,
          session,
          template,
          processId: ((session.metadata || {}) as Record<string, any>).processId || processContext.processId,
          currentFormData,
          currentFieldOrigins,
        });
        if (delegatedAuthResponse) {
          return delegatedAuthResponse;
        }
      }

      // 更新会话元数据
      const updatedMetadata = {
        ...session.metadata,
        currentFormData,
        currentFieldOrigins,
        currentProcessSummary: null,
        currentInteractionMode: null,
        missingFields: formResult.isComplete ? [] : formResult.missingFields,
        processStatus: formResult.isComplete
          ? ProcessStatus.PENDING_CONFIRMATION
          : ProcessStatus.PARAMETER_COLLECTION,
        processUpdatedAt: new Date().toISOString(),
      };
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { metadata: updatedMetadata },
      });
      session.metadata = updatedMetadata;

      // 如果还有缺失字段，一次性列出所有缺失信息
      if (!formResult.isComplete) {
        const hasFileField = formResult.missingFields.some(f => f.type === 'file');
        let message = this.buildMissingFieldsPrompt(
          formResult.missingFields,
          this.resolveDisplayProcessName(session, template.processName, processContext.processCode),
        );
        if (Object.keys(modifiedFields).length > 0) {
          message = `已按您的意思更新已填写内容。\n\n${message}`;
        }
        return {
          sessionId: session.id,
          message,
          intent: ChatIntent.CREATE_SUBMISSION,
          needsInput: true,
          formData: currentFormData,
          missingFields: formResult.missingFields,
          processStatus: ProcessStatus.PARAMETER_COLLECTION,
          needsAttachment: hasFileField,
        };
      }

      // 参数收集完成，生成确认摘要
      return await this.generateConfirmation(input, session, template, currentFormData, traceId);
    } catch (error: any) {
      this.logger.error(' continueParameterCollection error:', error.message);

      // 回滚到初始状态
      await this.rollbackProcess(session, traceId);

      return {
        sessionId: session.id,
        message: `参数收集失败：${error.message}\n\n请重新开始。`,
        needsInput: false,
        processStatus: ProcessStatus.FAILED,
      };
    }
  }

  private async handleModificationCollection(
    input: ChatInput,
    session: any,
    processContext: ProcessContext,
    sharedContext: SharedContext,
    template: any,
    traceId: string,
  ): Promise<ChatResponse> {
    const schema = template.schema as any;
    const modificationResult = await this.formAgent.extractModifications(
      processContext.processCode,
      schema,
      input.message,
      processContext.parameters,
    );

    if (Object.keys(modificationResult.modifiedFields).length === 0) {
      return {
        sessionId: session.id,
        message: '我还没识别到您要调整的具体字段。可以直接说“把结束时间改成下周一”或“把选项改成第二个”。',
        needsInput: true,
        formData: processContext.parameters,
        processStatus: ProcessStatus.PARAMETER_COLLECTION,
      };
    }

    const updatedFormData = {
      ...processContext.parameters,
      ...modificationResult.modifiedFields,
    };
    const updatedFieldOrigins: Record<string, ProcessFieldOrigin> = {
      ...(((session.metadata || {}) as Record<string, any>).currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined),
      ...modificationResult.fieldOrigins,
    };

    this.prefillFromSharedContext(updatedFormData, schema, sharedContext, updatedFieldOrigins);

    const updatedMeta = {
      ...session.metadata,
      currentFormData: updatedFormData,
      currentFieldOrigins: updatedFieldOrigins,
      currentInteractionMode: null,
      currentProcessSummary: null,
      processStatus: ProcessStatus.PENDING_CONFIRMATION,
      processUpdatedAt: new Date().toISOString(),
    };
    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: { metadata: updatedMeta },
    });
    session.metadata = updatedMeta;

    await this.auditService.createLog({
      tenantId: input.tenantId,
      traceId,
      userId: input.userId,
      action: 'modify_application',
      result: 'success',
      details: {
        processCode: processContext.processCode,
        modifiedFields: Object.keys(modificationResult.modifiedFields),
      },
    });

    return await this.generateConfirmation(input, session, template, updatedFormData, traceId);
  }

  // 处理确认（支持按钮点击和自然语言回复）
  private async handleConfirmation(
    input: ChatInput,
    session: any,
    processContext: ProcessContext,
    traceId: string,
  ): Promise<ChatResponse> {
    const message = input.message.trim();

    // 1. 按钮点击：前端传来的 action 标识（精确匹配）
    if (message === '__ACTION_CONFIRM__') {
      return await this.executeSubmission(input, session, processContext, traceId);
    }
    if (message === '__ACTION_CANCEL__') {
      const processName = (session.metadata?.currentProcessName as string) || processContext.processCode;
      const processCategory = (session.metadata?.currentProcessCategory as string) || null;
      await this.rollbackProcess(session, traceId);
      return {
        sessionId: session.id,
        message: '已取消申请。如需重新发起，请告诉我。',
        needsInput: false,
        formData: processContext.parameters,
        processStatus: ProcessStatus.CANCELLED,
        processCard: this.buildProcessCard({
          processInstanceId: processContext.processId,
          processCode: processContext.processCode,
          processName,
          processCategory,
          processStatus: ProcessStatus.CANCELLED,
          formData: processContext.parameters,
          actionState: 'readonly',
          canContinue: false,
        }),
      };
    }
    if (message === '__ACTION_MODIFY__') {
      return await this.enterModifyMode(session, processContext);
    }

    // 2. 自然语言回复：用 LLM 判断用户意图
    const confirmIntent = await this.detectConfirmIntent(message, processContext);

    switch (confirmIntent.action) {
      case 'confirm':
        return await this.executeSubmission(input, session, processContext, traceId);

      case 'cancel':
        {
          const processName = (session.metadata?.currentProcessName as string) || processContext.processCode;
          const processCategory = (session.metadata?.currentProcessCategory as string) || null;
        await this.rollbackProcess(session, traceId);
        return {
          sessionId: session.id,
          message: '已取消申请。如需重新发起，请告诉我。',
          needsInput: false,
          formData: processContext.parameters,
          processStatus: ProcessStatus.CANCELLED,
          processCard: this.buildProcessCard({
            processInstanceId: processContext.processId,
            processCode: processContext.processCode,
            processName,
            processCategory,
            processStatus: ProcessStatus.CANCELLED,
            formData: processContext.parameters,
            actionState: 'readonly',
            canContinue: false,
          }),
        };
        }

      case 'modify':
        {
          const template = await this.findTemplateForResolvedFlow(
            input.tenantId,
            processContext.processCode,
            {
              identityType: input.identityType,
              roles: input.roles,
            },
            ((session.metadata || {}) as Record<string, any>).currentConnectorId || null,
          );
          if (!template) {
            this.logger.warn(`Template not found for processCode=${processContext.processCode}`);
            return {
              sessionId: session.id,
              message: '流程模板未找到，无法修改。',
              needsInput: true,
            };
          }
          const modificationResult = await this.formAgent.extractModifications(
            processContext.processCode,
            template.schema as any,
            message,
            processContext.parameters,
          );

          if (Object.keys(modificationResult.modifiedFields).length > 0) {
            return await this.applyModificationsAndReconfirm(
              input,
              session,
              processContext,
              modificationResult.modifiedFields,
              traceId,
              modificationResult.fieldOrigins,
            );
          }
        }
        return await this.enterModifyMode(session, processContext);

      default:
        // 无法判断，温和地再次提示
        return {
          sessionId: session.id,
          message: '没太明白您的意思，您可以点击下方按钮操作，或者直接告诉我要修改什么。',
          needsInput: true,
          actionButtons: [
            { label: '确认提交', action: 'confirm', type: 'primary' },
            { label: '修改内容', action: 'modify', type: 'default' },
            { label: '取消', action: 'cancel', type: 'danger' },
          ],
          formData: processContext.parameters,
          processStatus: ProcessStatus.PENDING_CONFIRMATION,
        };
    }
  }

  // 用 LLM 判断确认阶段的用户意图
  private async detectConfirmIntent(
    message: string,
    processContext: ProcessContext,
  ): Promise<{ action: 'confirm' | 'cancel' | 'modify' | 'unknown'; modifications?: Record<string, any> }> {
    try {
      const { LLMClientFactory } = await import('@uniflow/agent-kernel');
      const llmClient = LLMClientFactory.createFromEnv();

      const currentFields = Object.entries(processContext.parameters)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');

      const messages = [
        {
          role: 'system' as const,
          content: `你是一个表单确认助手。用户正在确认一份申请表单，当前表单内容如下：
${currentFields}

判断用户的回复属于以下哪种意图：
1. confirm - 确认提交（如"好的"、"没问题"、"提交吧"、"确认"、"可以"、"行"、"对"、"嗯"）
2. cancel - 取消申请（如"算了"、"不要了"、"取消"、"不提交了"）
3. modify - 修改内容（如"把日期改成明天"、"金额改为2000"、"把选项改成第二个"）

如果是 modify，请同时提取用户想修改的字段和新值。

返回JSON：
{
  "action": "confirm" | "cancel" | "modify" | "unknown",
  "modifications": { "field_key": "new_value" },
  "reasoning": "判断依据"
}`,
        },
        {
          role: 'user' as const,
          content: `今天是 ${new Date().toISOString().split('T')[0]}。\n用户回复: "${message}"`,
        },
      ];

      const response = await llmClient.chat(messages, {
        trace: {
          scope: 'assistant.confirm.detect',
          metadata: {
            processCode: processContext.processCode,
          },
        },
      });
      let jsonStr = response.content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const result = JSON.parse(jsonStr);
      return {
        action: result.action || 'unknown',
        modifications: result.modifications,
      };
    } catch (error: any) {
      this.logger.error(' detectConfirmIntent LLM failed:', error.message);
      return { action: 'unknown' };
    }
  }

  // 进入修改模式
  private async enterModifyMode(
    session: any,
    processContext: ProcessContext,
  ): Promise<ChatResponse> {
    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata: {
          ...session.metadata,
          currentInteractionMode: 'modify',
          processStatus: ProcessStatus.PARAMETER_COLLECTION,
        },
      },
    });
    session.metadata = {
      ...session.metadata,
      currentInteractionMode: 'modify',
      processStatus: ProcessStatus.PARAMETER_COLLECTION,
    };

    return {
      sessionId: session.id,
      message: '好的，请告诉我您要修改什么，比如"把日期改成下周一"。',
      needsInput: true,
      formData: processContext.parameters,
      processStatus: ProcessStatus.PARAMETER_COLLECTION,
    };
  }

  // 应用修改并重新确认
  private async applyModificationsAndReconfirm(
    input: ChatInput,
    session: any,
    processContext: ProcessContext,
    modifications: Record<string, any>,
    traceId: string,
    fieldOrigins?: Record<string, ProcessFieldOrigin>,
  ): Promise<ChatResponse> {
    // 合并修改
    const updatedFormData = {
      ...processContext.parameters,
      ...modifications,
    };
    const updatedFieldOrigins: Record<string, ProcessFieldOrigin> = {
      ...(((session.metadata || {}) as Record<string, any>).currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined),
    };
    for (const key of Object.keys(modifications)) {
      updatedFieldOrigins[key] = fieldOrigins?.[key] || 'user';
    }

    // 获取模板用于格式化
    const template = await this.findTemplateForResolvedFlow(
      input.tenantId,
      processContext.processCode,
      {
        identityType: input.identityType,
        roles: input.roles,
      },
      ((session.metadata || {}) as Record<string, any>).currentConnectorId || null,
    );

    // 更新会话中的表单数据
    const updatedMeta = {
      ...session.metadata,
      currentFormData: updatedFormData,
      currentFieldOrigins: updatedFieldOrigins,
      currentInteractionMode: null,
      currentProcessSummary: null,
      processStatus: ProcessStatus.PENDING_CONFIRMATION,
    };
    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: { metadata: updatedMeta },
    });
    session.metadata = updatedMeta;

    // 重新生成确认
    return await this.generateConfirmation(input, session, template, updatedFormData, traceId);
  }

  // 从共享上下文预填充
  private prefillFromSharedContext(
    formData: Record<string, any>,
    schema: any,
    sharedContext: SharedContext,
    fieldOrigins?: Record<string, ProcessFieldOrigin>,
  ): void {
    const fields = schema?.fields || [];

    for (const field of fields) {
      // 如果字段已有值，跳过
      if (formData[field.key] !== undefined) {
        continue;
      }

      // 根据字段名称从共享上下文填充
      switch (field.key) {
        case 'employeeId':
        case 'applicantId':
          formData[field.key] = sharedContext.profile.employeeId;
          if (fieldOrigins) fieldOrigins[field.key] = 'prefill';
          break;
        case 'applicantName':
        case 'name':
          formData[field.key] = sharedContext.profile.name;
          if (fieldOrigins) fieldOrigins[field.key] = 'prefill';
          break;
        case 'department':
          if (sharedContext.profile.department) {
            formData[field.key] = sharedContext.profile.department;
            if (fieldOrigins) fieldOrigins[field.key] = 'prefill';
          }
          break;
        case 'approver':
        case 'approverId':
          if (sharedContext.preferences.defaultApprover) {
            formData[field.key] = sharedContext.preferences.defaultApprover;
            if (fieldOrigins) fieldOrigins[field.key] = 'prefill';
          }
          break;
        case 'cc':
        case 'ccList':
          if (sharedContext.preferences.defaultCC?.length) {
            formData[field.key] = sharedContext.preferences.defaultCC;
            if (fieldOrigins) fieldOrigins[field.key] = 'prefill';
          }
          break;
      }
    }
  }

  // 生成确认摘要
  private async generateConfirmation(
    input: ChatInput,
    session: any,
    template: any,
    formData: Record<string, any>,
    traceId: string,
  ): Promise<ChatResponse> {
    const displayProcessName = this.resolveDisplayProcessName(
      session,
      template.processName,
      template.processCode,
    );
    const currentFieldOrigins = {
      ...(((session.metadata || {}) as Record<string, any>).currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined),
    };
    const confirmationSummary = this.buildConfirmationSummary(
      displayProcessName,
      currentFieldOrigins,
    );

    // 创建草稿
    const draft = await this.prisma.processDraft.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        templateId: template.id,
        sessionId: session.id,
        formData: formData,
        status: 'ready',
      },
    });

    await this.attachmentBindingService.syncDraftBindings({
      tenantId: input.tenantId,
      userId: input.userId,
      sessionId: session.id,
      draftId: draft.id,
      formData,
    });

    // 更新会话状态
    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata: {
          ...session.metadata,
          pendingDraftId: draft.id,
          currentProcessName: displayProcessName,
          currentFieldOrigins,
          currentProcessSummary: confirmationSummary,
          currentInteractionMode: null,
          missingFields: [],
          processStatus: ProcessStatus.PENDING_CONFIRMATION,
        },
      },
    });
    session.metadata = {
      ...session.metadata,
      pendingDraftId: draft.id,
      currentProcessName: displayProcessName,
      currentFieldOrigins,
      currentProcessSummary: confirmationSummary,
      currentInteractionMode: null,
      missingFields: [],
      processStatus: ProcessStatus.PENDING_CONFIRMATION,
    };

    return {
      sessionId: session.id,
      message: `已为您整理好“${displayProcessName}”。请重点核对下方表单，确认无误后提交。`,
      intent: ChatIntent.CREATE_SUBMISSION,
      draftId: draft.id,
      needsInput: true,
      formData: formData,
      processCard: this.buildProcessCard({
        processInstanceId: ((session.metadata || {}) as Record<string, any>).processId || draft.id,
        processCode: template.processCode,
        processName: displayProcessName,
        processCategory: template.processCategory,
        processStatus: ProcessStatus.PENDING_CONFIRMATION,
        template,
        summary: confirmationSummary,
        formData,
        fieldOrigins: currentFieldOrigins,
        draftId: draft.id,
        actionButtons: [
          { label: '确认提交', action: 'confirm', type: 'primary' },
          { label: '修改内容', action: 'modify', type: 'default' },
          { label: '取消', action: 'cancel', type: 'danger' },
        ],
        canContinue: true,
      }),
      actionButtons: [
        { label: '确认提交', action: 'confirm', type: 'primary' },
        { label: '修改内容', action: 'modify', type: 'default' },
        { label: '取消', action: 'cancel', type: 'danger' },
      ],
      suggestedActions: ['确认提交', '修改内容', '取消'],
      processStatus: ProcessStatus.PENDING_CONFIRMATION,
    };
  }

  // 执行提交
  private async executeSubmission(
    input: ChatInput,
    session: any,
    processContext: ProcessContext,
    traceId: string,
  ): Promise<ChatResponse> {
    const draftId = session.metadata?.pendingDraftId;
    if (!draftId) {
      return {
        sessionId: session.id,
        message: '没有待提交的草稿。',
        needsInput: false,
        processStatus: ProcessStatus.FAILED,
      };
    }

    let draft: any = null;
    let selectedPath: DeliveryPath | null = null;
    let fallbackPolicy: DeliveryPath[] = [];
    try {
      // 获取草稿
      draft = await this.prisma.processDraft.findUnique({
        where: { id: draftId },
        include: {
          template: {
            include: {
              connector: true,
            },
          },
        },
      });

      if (!draft?.template) {
        throw new Error('草稿或流程模板不存在');
      }

      const displayProcessName = this.resolveDisplayProcessName(
        session,
        draft.template.processName,
        draft.template.processCode,
      );

      const taskPlan = await this.taskPlanAgent.buildSubmitTaskPacketFromDraft({
        tenantId: input.tenantId,
        userId: input.userId,
        sessionId: session.id,
        draftId: draft.id,
        idempotencyKey: `${draft.id}-${Date.now()}`,
        traceId,
      });

      if (taskPlan.needsClarification || !taskPlan.taskPacket) {
        return {
          sessionId: session.id,
          message: taskPlan.clarificationQuestion || '当前无法确定提交流程的交付路径，请检查初始化配置。',
          needsInput: false,
          processStatus: ProcessStatus.PENDING_CONFIRMATION,
          formData: draft.formData as Record<string, any>,
          processCard: this.buildProcessCard({
            processInstanceId: processContext.processId,
            processCode: draft.template.processCode,
            processName: displayProcessName,
            processCategory: draft.template.processCategory,
            processStatus: ProcessStatus.PENDING_CONFIRMATION,
            template: draft.template,
            summary: (((session.metadata || {}) as Record<string, any>).currentProcessSummary as string | undefined) || undefined,
            formData: draft.formData as Record<string, any>,
            fieldOrigins: ((((session.metadata || {}) as Record<string, any>).currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined) || {}),
            draftId: draft.id,
            actionButtons: [
              { label: '确认提交', action: 'confirm', type: 'primary' },
              { label: '修改内容', action: 'modify', type: 'default' },
              { label: '取消', action: 'cancel', type: 'danger' },
            ],
            canContinue: true,
          }),
        };
      }

      selectedPath = taskPlan.taskPacket.selectedPath;
      fallbackPolicy = taskPlan.taskPacket.fallbackPolicy || [selectedPath];

      const submitOutcome = await this.submissionService.submit({
        tenantId: input.tenantId,
        userId: input.userId,
        draftId: draft.id,
        idempotencyKey: taskPlan.taskPacket.runtime.idempotencyKey,
        traceId,
        selectedPath,
        fallbackPolicy,
      });

      const submission = await this.waitForSubmissionSettlement(
        submitOutcome.submissionId,
        this.resolveSubmissionSettlementWaitOptions(selectedPath),
      );

      if (!submission) {
        throw new Error('提交记录创建失败');
      }

      const effectiveSubmissionStatus = normalizeSubmissionStatus(submission.status, {
        submitResult: submission.submitResult,
      }) || submission.status;
      const nextProcessStatus = mapSubmissionStatusToChatProcessStatus(effectiveSubmissionStatus);
      const processUpdatedAt = new Date().toISOString();
      const fallbackPolicyToPersist = fallbackPolicy.length
        ? fallbackPolicy
        : (selectedPath ? [selectedPath] : []);
      const orchestrationContext = {
        ...(((session.metadata || {}) as Record<string, any>).orchestrationContext || {}),
        sessionId: session.id,
        currentConnectorId: draft.template.connectorId,
        currentConnectorName: draft.template.connector?.name || null,
        currentProcessCode: draft.template.processCode,
        currentProcessName: displayProcessName,
        currentTemplateId: draft.template.id,
        currentSubmissionId: submission.id,
        currentOaSubmissionId: submission.oaSubmissionId || null,
        currentFormData: (draft.formData as Record<string, any>) || {},
        missingFields: [],
        selectedPath,
        fallbackPolicy: fallbackPolicyToPersist,
        processStatus: nextProcessStatus,
        updatedAt: processUpdatedAt,
      };
      const submittedMetadata: Record<string, any> = {
        ...((session.metadata || {}) as Record<string, any>),
        currentTemplateId: draft.template.id,
        currentProcessCode: draft.template.processCode,
        currentProcessName: displayProcessName,
        currentProcessCategory: draft.template.processCategory || null,
        currentFormData: draft.formData as Record<string, any>,
        currentSubmissionId: submission.id,
        currentOaSubmissionId: submission.oaSubmissionId || null,
        lastSubmissionStatus: effectiveSubmissionStatus,
        processStatus: nextProcessStatus,
        processUpdatedAt,
        missingFields: [],
        reworkHint: null,
        reworkReason: null,
        selectedDeliveryPath: selectedPath,
        deliveryFallbackPolicy: fallbackPolicyToPersist,
        orchestrationContext,
      };
      delete submittedMetadata.pendingDraftId;
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { metadata: submittedMetadata },
      });
      session.metadata = submittedMetadata;

      // 记录审计日志
      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'submit_application',
        result: 'success',
        details: {
          submissionId: submission.id,
          oaSubmissionId: submission.oaSubmissionId,
          processCode: draft.template.processCode,
          selectedPath,
          fallbackPolicy: fallbackPolicyToPersist,
          submitStatus: effectiveSubmissionStatus,
          initialSubmitStatus: submitOutcome.status,
        },
      });

      const pathLabel = this.formatDeliveryPathLabel(selectedPath);
      const submissionRef = submission.oaSubmissionId || submission.id;
      const message = nextProcessStatus === ProcessStatus.DRAFT_SAVED
        ? `申请内容已通过${pathLabel}通道写入 OA 待发箱，尚未正式送审。\n\n申请编号：${submissionRef}\n流程：${displayProcessName}\n\n如需进入审批流，请在流程模板中配置真正的“提交”动作或补充状态查询能力。`
        : nextProcessStatus === ProcessStatus.FAILED
          ? `申请处理失败。\n\n申请编号：${submissionRef}\n流程：${displayProcessName}\n\n请稍后重试，或联系管理员检查该流程的交付配置。`
        : nextProcessStatus === ProcessStatus.EXECUTING
          ? `申请已受理，正在通过${pathLabel}通道提交。\n\n申请编号：${submissionRef}\n流程：${displayProcessName}\n\n可稍后查询进度。`
          : `申请已提交成功，已通过${pathLabel}通道完成交付。\n\n申请编号：${submissionRef}\n流程：${displayProcessName}\n\n您可以随时查询申请进度。`;

      return {
        sessionId: session.id,
        message,
        needsInput: false,
        suggestedActions: ['查询进度', '发起新申请'],
        processStatus: nextProcessStatus,
        processCard: this.buildProcessCard({
          processInstanceId: processContext.processId,
          processCode: draft.template.processCode,
          processName: displayProcessName,
          processCategory: draft.template.processCategory,
          processStatus: nextProcessStatus,
          template: draft.template,
          summary: (submittedMetadata.currentProcessSummary as string | undefined) || undefined,
          formData: draft.formData as Record<string, any>,
          fieldOrigins: (submittedMetadata.currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined) || {},
          submissionId: submission.id,
          oaSubmissionId: submission.oaSubmissionId,
          draftId: draft.id,
          actionState: 'readonly',
          canContinue: false,
        }),
      };
    } catch (error: any) {
      this.logger.error(' 提交失败:', error.message, error.stack);

      // 记录失败日志
      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'submit_application',
        result: 'error',
        details: {
          error: error.message,
          selectedPath,
          fallbackPolicy,
        },
      });

      const failedAt = new Date().toISOString();
      const failedMetadata: Record<string, any> = {
        ...((session.metadata || {}) as Record<string, any>),
        processStatus: ProcessStatus.FAILED,
        processUpdatedAt: failedAt,
        selectedDeliveryPath: selectedPath || ((session.metadata || {}) as Record<string, any>).selectedDeliveryPath || null,
        deliveryFallbackPolicy: fallbackPolicy.length
          ? fallbackPolicy
          : ((((session.metadata || {}) as Record<string, any>).deliveryFallbackPolicy as DeliveryPath[]) || []),
        orchestrationContext: {
          ...(((session.metadata || {}) as Record<string, any>).orchestrationContext || {}),
          sessionId: session.id,
          selectedPath: selectedPath || ((session.metadata || {}) as Record<string, any>).selectedDeliveryPath || null,
          fallbackPolicy: fallbackPolicy.length
            ? fallbackPolicy
            : ((((session.metadata || {}) as Record<string, any>).deliveryFallbackPolicy as DeliveryPath[]) || []),
          processStatus: ProcessStatus.FAILED,
          updatedAt: failedAt,
        },
      };

      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          metadata: failedMetadata,
        },
      });
      session.metadata = failedMetadata;

      return {
        sessionId: session.id,
        message: `提交失败：${error.message}\n\n请稍后重试或联系管理员。`,
        needsInput: false,
        suggestedActions: ['重试', '取消'],
        processStatus: ProcessStatus.FAILED,
        formData: (draft?.formData as Record<string, any> | undefined) || processContext.parameters,
        processCard: this.buildProcessCard({
          processInstanceId: processContext.processId,
          processCode: draft?.template?.processCode || processContext.processCode,
          processName: this.resolveDisplayProcessName(
            session,
            draft?.template?.processName,
            draft?.template?.processCode || processContext.processCode,
          ),
          processCategory: draft?.template?.processCategory || session.metadata?.currentProcessCategory || null,
          processStatus: ProcessStatus.FAILED,
          template: draft?.template,
          summary: (((session.metadata || {}) as Record<string, any>).currentProcessSummary as string | undefined) || undefined,
          formData: (draft?.formData as Record<string, any> | undefined) || processContext.parameters,
          fieldOrigins: ((((session.metadata || {}) as Record<string, any>).currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined) || {}),
          draftId: draft?.id || draftId,
          actionState: 'readonly',
          canContinue: false,
        }),
      };
    }
  }

  private async waitForSubmissionSettlement(
    submissionId: string,
    options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
    },
  ): Promise<{
    id: string;
    status: string;
    submitResult?: unknown;
    oaSubmissionId?: string | null;
  } | null> {
    const timeoutMs = Math.max(0, options?.timeoutMs ?? 4000);
    const pollIntervalMs = Math.max(50, options?.pollIntervalMs ?? 200);
    const startedAt = Date.now();

    while (true) {
      const submission = await this.prisma.submission.findUnique({
        where: { id: submissionId },
        select: {
          id: true,
          status: true,
          submitResult: true,
          oaSubmissionId: true,
        },
      });

      if (!submission) {
        return null;
      }

      const effectiveStatus = normalizeSubmissionStatus(submission.status, {
        submitResult: submission.submitResult,
      });

      if (effectiveStatus && effectiveStatus !== 'pending') {
        return submission;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        return submission;
      }

      await this.sleep(pollIntervalMs);
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private resolveSubmissionSettlementWaitOptions(path?: DeliveryPath | null) {
    switch (path) {
      case 'url':
        return {
          timeoutMs: 5000,
          pollIntervalMs: 250,
        };
      case 'api':
        return {
          timeoutMs: 8000,
          pollIntervalMs: 200,
        };
      default:
        return {
          timeoutMs: 4000,
          pollIntervalMs: 200,
        };
    }
  }

  // 回滚流程
  private async rollbackProcess(session: any, traceId: string): Promise<void> {
    try {
      const metadata: Record<string, any> = {
        ...((session.metadata || {}) as Record<string, any>),
        processStatus: ProcessStatus.CANCELLED,
        processUpdatedAt: new Date().toISOString(),
        currentInteractionMode: null,
        currentProcessSummary: null,
        missingFields: [],
        reworkHint: null,
        reworkReason: null,
      };
      delete metadata.pendingDraftId;
      delete metadata.currentProcessCode;
      delete metadata.currentTemplateId;
      delete metadata.pendingFlowSelection;
      delete metadata.flowCandidates;
      delete metadata.pendingFlowSelectionContext;

      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          metadata,
        },
      });
      session.metadata = metadata;

      this.logger.log(` 流程已回滚: sessionId=${session.id}`);
    } catch (error: any) {
      this.logger.error(' 回滚流程失败:', error.message);
    }
  }

  private async handleCreateSubmission(
    input: ChatInput,
    session: any,
    intentResult: any,
    sharedContext: SharedContext,
    traceId: string,
  ): Promise<ChatResponse> {
    try {
      const sessionMeta = (session.metadata || {}) as Record<string, any>;
      const resolution = await this.resolveSubmissionTarget(input, session, intentResult);

      if (resolution.needsFlowClarification || !resolution.matchedFlow) {
        const suggestedFlows = this.dedupeFlowCandidates(resolution.flows || [])
          .slice(0, 5)
          .map((flow) => flow.processName);
        if (Array.isArray(resolution.flowCandidates) && resolution.flowCandidates.length > 1) {
          const pendingFlowMetadata = {
            ...sessionMeta,
            pendingFlowSelection: true,
            flowCandidates: resolution.flowCandidates.map((flow) => ({
              processCode: flow.processCode,
              processName: flow.processName,
            })),
            pendingFlowSelectionContext: {
              originalMessage: input.message,
              clarificationQuestion: resolution.flowClarificationQuestion,
            },
          } as Record<string, any>;
          await this.prisma.chatSession.update({
            where: { id: session.id },
            data: {
              metadata: pendingFlowMetadata,
            },
          });
          session.metadata = pendingFlowMetadata;
        }
        return {
          sessionId: session.id,
          message: Array.isArray(resolution.flowCandidates) && resolution.flowCandidates.length > 1
            ? this.buildPendingFlowPrompt(
                session.id,
                resolution.flowCandidates,
                resolution.flowClarificationQuestion,
              ).message
            : (resolution.flowClarificationQuestion || '请问您想办理哪个流程？'),
          needsInput: true,
          suggestedActions: Array.isArray(resolution.flowCandidates) && resolution.flowCandidates.length > 0
            ? resolution.flowCandidates.slice(0, 5).map((flow) => flow.processName)
            : suggestedFlows,
        };
      }

      if (resolution.needsConnectorSelection) {
        const pendingConnectorMetadata = {
          ...sessionMeta,
          pendingConnectorSelection: true,
          connectorCandidates: (resolution.connectorCandidates || []).map((connector) => ({
            id: connector.id,
            name: connector.name,
          })),
          pendingConnectorSelectionContext: {
            originalMessage: input.message,
            processCode: resolution.matchedFlow.processCode,
            processName: resolution.matchedFlow.processName,
          },
        } as Record<string, any>;
        await this.prisma.chatSession.update({
          where: { id: session.id },
          data: {
            metadata: pendingConnectorMetadata,
          },
        });
        session.metadata = pendingConnectorMetadata;
        return {
          sessionId: session.id,
          message: resolution.connectorSelectionQuestion
            || this.buildPendingConnectorPrompt(
              session.id,
              resolution.connectorCandidates || [],
              resolution.matchedFlow.processName,
            ).message,
          needsInput: true,
          suggestedActions: resolution.connectorCandidates?.map((connector) => connector.name),
        };
      }

      if (resolution.connectorId && resolution.connectorId !== sessionMeta.routedConnectorId) {
        await this.prisma.chatSession.update({
          where: { id: session.id },
          data: {
            metadata: {
              ...sessionMeta,
              routedConnectorId: resolution.connectorId,
              routedConnectorName: resolution.connectorName,
            },
          },
        });
        session.metadata = {
          ...sessionMeta,
          routedConnectorId: resolution.connectorId,
          routedConnectorName: resolution.connectorName,
        };
      }

      const permResult = await this.permissionService.check({
        tenantId: input.tenantId,
        userId: input.userId,
        processCode: resolution.matchedFlow.processCode,
        action: 'submit',
        traceId,
      });

      if (!permResult.allowed) {
        return {
          sessionId: session.id,
          message: `抱歉，您没有权限发起"${resolution.matchedFlow.processName}"。\n原因：${permResult.reason}`,
          needsInput: false,
        };
      }

      const template = await this.findTemplateForResolvedFlow(
        input.tenantId,
        resolution.matchedFlow.processCode,
        {
          identityType: input.identityType,
          roles: input.roles,
        },
        resolution.connectorId,
      );
      if (!template) {
        return {
          sessionId: session.id,
          message: '流程模板不存在，请联系管理员。',
          needsInput: false,
        };
      }

      const schema = template.schema as any;
      const formResult = await this.formAgent.extractFields(
        resolution.matchedFlow.processCode,
        schema,
        input.message,
        {},
      );

      // Merge form data and prefill from shared context
      const currentFormData = { ...formResult.extractedFields };
      const currentFieldOrigins: Record<string, ProcessFieldOrigin> = {
        ...formResult.fieldOrigins,
      };
      this.prefillFromSharedContext(currentFormData, schema, sharedContext, currentFieldOrigins);
      const processId = `process_${Date.now()}`;
      const displayProcessName = this.resolveDisplayProcessName(
        session,
        resolution.matchedFlow.processName,
        resolution.matchedFlow.processCode,
      );

      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'process_initialized',
        result: 'success',
        details: {
          processId,
          processCode: resolution.matchedFlow.processCode,
          extractedFields: Object.keys(currentFormData),
        },
      });

      if (formResult.isComplete) {
        const delegatedAuthResponse = await this.ensureDelegatedAuthorization({
          input,
          session,
          template,
          processId,
          currentFormData,
          currentFieldOrigins,
        });
        if (delegatedAuthResponse) {
          return delegatedAuthResponse;
        }
      }

      // Initialize process context
      const newMetadata = {
        ...((session.metadata || {}) as Record<string, any>),
        processId,
        processType: ChatIntent.CREATE_SUBMISSION,
        currentTemplateId: template.id,
        currentConnectorId: template.connectorId,
        currentConnectorName: template.connector?.name || resolution.connectorName || null,
        currentProcessCode: resolution.matchedFlow.processCode,
        currentProcessName: displayProcessName,
        currentProcessCategory: template.processCategory || null,
        currentFormData,
        currentFieldOrigins,
        currentProcessSummary: null,
        currentInteractionMode: null,
        missingFields: formResult.isComplete ? [] : formResult.missingFields,
        processStatus: formResult.isComplete
          ? ProcessStatus.PENDING_CONFIRMATION
          : ProcessStatus.PARAMETER_COLLECTION,
        processCreatedAt: new Date().toISOString(),
        processUpdatedAt: new Date().toISOString(),
      };
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { metadata: newMetadata },
      });
      // 同步更新 session 对象，避免后续方法使用旧 metadata
      session.metadata = newMetadata;

      if (!formResult.isComplete) {
        const hasFileField = formResult.missingFields.some(f => f.type === 'file');
        return {
          sessionId: session.id,
          message: this.buildMissingFieldsPrompt(
            formResult.missingFields,
            resolution.matchedFlow.processName,
          ),
          intent: ChatIntent.CREATE_SUBMISSION,
          needsInput: true,
          formData: currentFormData,
          missingFields: formResult.missingFields,
          processStatus: ProcessStatus.PARAMETER_COLLECTION,
          needsAttachment: hasFileField,
        };
      }

      // All parameters collected, generate confirmation
      return await this.generateConfirmation(input, session, template, currentFormData, traceId);
    } catch (error: any) {
      this.logger.error(' handleCreateSubmission error:', error.message, error.stack);

      // Log error
      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'create_submission_error',
        result: 'error',
        details: { error: error.message },
      });

      return {
        sessionId: session.id,
        message: '抱歉，处理您的申请时出现了问题，请稍后再试。',
        needsInput: true,
      };
    }
  }

  private async handleQueryStatus(
    input: ChatInput,
    session: any,
    traceId: string,
  ): Promise<ChatResponse> {
    try {
      // Get user's recent submissions
      const submissions = (await this.submissionService.listSubmissions(
        input.tenantId,
        input.userId,
      ))
        .filter((submission) => submission.sourceType === 'submission')
        .slice(0, 5);

      if (submissions.length === 0) {
        return {
          sessionId: session.id,
          message: '您目前没有进行中的申请。',
          needsInput: false,
          suggestedActions: ['发起新申请', '查看流程列表'],
        };
      }

      if (this.isDetailFollowUpMessage(input.message)) {
        const detailCandidates = submissions.map((submission) => ({
          submissionId: submission.id,
          oaSubmissionId: submission.oaSubmissionId,
          processName: submission.processName || '未知流程',
        }));

        const updatedMetadata = {
          ...(session.metadata || {}),
          pendingAction: 'detail',
          pendingSubmissionSelection: detailCandidates,
        };
        await this.prisma.chatSession.update({
          where: { id: session.id },
          data: {
            metadata: updatedMetadata,
          },
        });
        session.metadata = updatedMetadata;

        return this.buildPendingActionPrompt(session.id, 'detail', detailCandidates);
      }

      // 获取模板信息
      const statusList = submissions
        .map((s, i) => {
          const statusText = getSubmissionStatusText(s.status);
          const date = new Date(s.createdAt).toLocaleDateString('zh-CN');
          return `${i + 1}. ${s.processName || '未知流程'} - ${statusText} (${date})`;
        })
        .join('\n');

      // Log query
      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'query_status',
        result: 'success',
        details: { count: submissions.length },
      });

      return {
        sessionId: session.id,
        message: `您最近的申请：\n${statusList}`,
        needsInput: false,
        suggestedActions: ['查看详情', '催办', '发起新申请'],
      };
    } catch (error: any) {
      this.logger.error(' handleQueryStatus error:', error.message);

      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'query_status',
        result: 'error',
        details: { error: error.message },
      });

      return {
        sessionId: session.id,
        message: '查询失败，请稍后重试。',
        needsInput: false,
      };
    }
  }

  private async handleAction(
    input: ChatInput,
    session: any,
    action: string,
    traceId: string,
  ): Promise<ChatResponse> {
    const actionNames: Record<string, string> = {
      cancel: '撤回',
      urge: '催办',
      supplement: '补件',
      delegate: '转办',
    };

    try {
      // 尝试从消息中提取申请编号
      const submissionId = this.extractSubmissionIdentifier(input.message);

      if (submissionId) {

        // 查找申请
        const submission = await this.prisma.submission.findFirst({
          where: {
            OR: [
              { id: submissionId },
              { oaSubmissionId: submissionId },
            ],
            tenantId: input.tenantId,
            userId: input.userId,
          },
          include: {
            template: true,
          },
        });

        if (!submission) {
          return {
            sessionId: session.id,
            message: `未找到申请编号为 ${submissionId} 的申请。`,
            needsInput: false,
            suggestedActions: ['查看我的申请'],
          };
        }

        // 执行对应操作
        return await this.executeAction(input, session, submission, action, traceId);
      }

      // 如果没有提供编号，列出最近的申请供选择
      const recentSubmissions = await this.prisma.submission.findMany({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          status: { in: [...ACTIVE_SUBMISSION_STATUSES] },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      if (recentSubmissions.length === 0) {
        return {
          sessionId: session.id,
          message: `您目前没有可${actionNames[action]}的申请。`,
          needsInput: false,
        };
      }

      // 获取模板信息
      const templateIds = [...new Set(recentSubmissions.map(s => s.templateId))];
      const templates = await this.prisma.processTemplate.findMany({
        where: { id: { in: templateIds } },
      });
      const templateMap = new Map(templates.map(t => [t.id, t]));

      const submissionList = recentSubmissions
        .map((s, i) => {
          const template = templateMap.get(s.templateId);
          const date = new Date(s.createdAt).toLocaleDateString('zh-CN');
          return `${i + 1}. ${template?.processName || '未知流程'} - ${s.oaSubmissionId || s.id} (${date})`;
        })
        .join('\n');

      const updatedMetadata = {
        ...(session.metadata || {}),
        pendingAction: action,
        pendingSubmissionSelection: recentSubmissions.map((submission) => {
          const template = templateMap.get(submission.templateId);
          return {
            submissionId: submission.id,
            oaSubmissionId: submission.oaSubmissionId,
            processName: template?.processName || '未知流程',
          };
        }),
      };
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          metadata: updatedMetadata,
        },
      });
      session.metadata = updatedMetadata;

      return {
        sessionId: session.id,
        message: `请选择要${actionNames[action]}的申请：\n${submissionList}\n\n请回复序号或申请编号。`,
        needsInput: true,
        suggestedActions: recentSubmissions.map(s => s.oaSubmissionId || s.id),
      };
    } catch (error: any) {
      this.logger.error(`handleAction(${action}) error: ${error.message}`);

      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: `action_${action}`,
        result: 'error',
        details: { error: error.message },
      });

      return {
        sessionId: session.id,
        message: `${actionNames[action]}操作失败，请稍后重试。`,
        needsInput: false,
      };
    }
  }

  private async executeAction(
    input: ChatInput,
    session: any,
    submission: any,
    action: string,
    traceId: string,
    options?: {
      supplementData?: Record<string, any>;
      targetUserId?: string;
      reason?: string;
    },
  ): Promise<ChatResponse> {
    const actionNames: Record<string, string> = {
      cancel: '撤回',
      urge: '催办',
      supplement: '补件',
      delegate: '转办',
    };
    const processName = submission.template?.processName || '未知流程';

    try {
      let resultMessage = '';
      if (action === 'cancel') {
        await this.submissionService.cancel(submission.id, input.tenantId, input.userId, traceId);
        resultMessage = `${actionNames[action]}操作已成功执行！\n\n申请：${processName}\n编号：${submission.oaSubmissionId || submission.id}`;
      } else if (action === 'urge') {
        await this.submissionService.urge(submission.id, input.tenantId, input.userId, traceId);
        resultMessage = `${actionNames[action]}操作已成功执行！\n\n申请：${processName}\n编号：${submission.oaSubmissionId || submission.id}`;
      } else if (action === 'supplement') {
        const supplementData = options?.supplementData || this.buildSupplementPayload(input);
        if (!supplementData || Object.keys(supplementData).length === 0) {
          await this.persistPendingActionExecution(session, {
            action: 'supplement',
            submissionId: submission.id,
            oaSubmissionId: submission.oaSubmissionId,
            processName: processName,
          });
          return {
            sessionId: session.id,
            message: `已选中“${processName}”。请直接发送要补充的说明、字段内容，或上传补件附件后再发送一次消息。`,
            needsInput: true,
            suggestedActions: ['补充说明', '上传附件后发送', '取消'],
          };
        }

        await this.submissionService.supplement(
          submission.id,
          input.tenantId,
          input.userId,
          supplementData,
          traceId,
        );
        await this.clearPendingActionExecution(session);
        resultMessage = `${actionNames[action]}操作已成功执行！\n\n申请：${processName}\n编号：${submission.oaSubmissionId || submission.id}`;
      } else if (action === 'delegate') {
        const delegateInput = this.parseDelegateActionInput(input.message);
        const targetUserId = options?.targetUserId || delegateInput.targetUserId;
        const reason = options?.reason || delegateInput.reason || 'assistant_delegate';
        if (!targetUserId) {
          await this.persistPendingActionExecution(session, {
            action: 'delegate',
            submissionId: submission.id,
            oaSubmissionId: submission.oaSubmissionId,
            processName: processName,
          });
          return {
            sessionId: session.id,
            message: `已选中“${processName}”。请按“目标用户ID=xxx，原因=xxx”的格式回复，我再为您发起转办。`,
            needsInput: true,
            suggestedActions: ['目标用户ID=', '取消'],
          };
        }

        await this.submissionService.delegate(
          submission.id,
          input.tenantId,
          input.userId,
          targetUserId,
          reason,
          traceId,
        );
        await this.clearPendingActionExecution(session);
        resultMessage = `${actionNames[action]}操作已成功执行！\n\n申请：${processName}\n编号：${submission.oaSubmissionId || submission.id}`;
      } else {
        return {
          sessionId: session.id,
          message: `该流程暂不支持${actionNames[action]}操作。`,
          needsInput: false,
        };
      }

      await this.clearPendingActionSelection(session);

      // 记录审计日志
      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: `action_${action}`,
        result: 'success',
        details: {
          submissionId: submission.id,
          oaSubmissionId: submission.oaSubmissionId,
          actionOptions: options || null,
        },
      });

      return {
        sessionId: session.id,
        message: resultMessage,
        needsInput: false,
        suggestedActions: ['查询进度', '发起新申请'],
      };
    } catch (error: any) {
      this.logger.error(`executeAction(${action}) error: ${error.message}`);

      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: `action_${action}`,
        result: 'error',
        details: { error: error.message },
      });

      return {
        sessionId: session.id,
        message: `${actionNames[action]}操作失败：${error.message}`,
        needsInput: false,
        suggestedActions: ['重试', '查看申请'],
      };
    }
  }

  private async tryHandlePendingActionSelection(
    input: ChatInput,
    session: any,
    traceId: string,
  ): Promise<ChatResponse | null> {
    const sessionMeta = (session.metadata || {}) as Record<string, any>;
    if (sessionMeta.currentProcessCode) {
      return null;
    }

    const pendingAction = this.parsePendingAction(sessionMeta.pendingAction);
    const candidates = Array.isArray(sessionMeta.pendingSubmissionSelection)
      ? sessionMeta.pendingSubmissionSelection as PendingSubmissionSelection[]
      : [];

    if (!pendingAction || candidates.length === 0) {
      return null;
    }

    const selectionResolution = await this.resolvePendingSelectionWithLlm(
      'submission',
      input.message,
      candidates.map((candidate, index) => ({
        id: candidate.submissionId,
        label: `${index + 1}. ${candidate.processName || '未知流程'} - ${candidate.oaSubmissionId || candidate.submissionId}`,
        aliases: [candidate.oaSubmissionId || '', candidate.processName || ''],
      })),
    );

    if (selectionResolution.action === 'cancel' || this.isAbortPendingSelectionMessage(input.message)) {
      await this.clearPendingActionSelection(session);
      return {
        sessionId: session.id,
        message: `已取消本次${this.getActionDisplayName(pendingAction)}操作。`,
        needsInput: false,
      };
    }

    if (selectionResolution.action === 'unknown' && !this.isSelectionLikeInput(input.message)) {
      await this.clearPendingActionSelection(session);
      return null;
    }

    const selected = this.resolvePendingSubmissionSelection(
      input.message,
      candidates,
      selectionResolution.action === 'select' ? selectionResolution.candidateId : undefined,
    );
    if (!selected) {
      return this.buildPendingActionPrompt(session.id, pendingAction, candidates);
    }

    const whereClauses = [
      { id: selected.submissionId },
      ...(selected.oaSubmissionId ? [{ oaSubmissionId: selected.oaSubmissionId }] : []),
    ];
    const submission = await this.prisma.submission.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        OR: whereClauses,
      },
      include: {
        template: true,
      },
    });

    if (!submission) {
      await this.clearPendingActionSelection(session);
      return {
        sessionId: session.id,
        message: '未找到您选择的申请，请重新发起操作。',
        needsInput: false,
        suggestedActions: ['查看我的申请'],
      };
    }

    const processName = submission.template?.processName || '未知流程';

    if (pendingAction === 'detail') {
      await this.clearPendingActionSelection(session);
      return this.buildSubmissionDetailResponse(session.id, submission.id, input.tenantId);
    }

    if (pendingAction === 'supplement' || pendingAction === 'delegate') {
      await this.clearPendingActionSelection(session);
      await this.persistPendingActionExecution(session, {
        action: pendingAction,
        submissionId: submission.id,
        oaSubmissionId: submission.oaSubmissionId,
        processName: processName,
      });
      return this.buildPendingActionExecutionPrompt(
        session.id,
        pendingAction,
        processName,
      );
    }

    await this.clearPendingActionSelection(session);
    return this.executeAction(input, session, submission, pendingAction, traceId);
  }

  private async tryHandlePendingActionExecution(
    input: ChatInput,
    session: any,
    traceId: string,
  ): Promise<ChatResponse | null> {
    const sessionMeta = (session.metadata || {}) as Record<string, any>;
    const pendingExecution = this.parsePendingActionExecution(sessionMeta.pendingActionExecution);
    if (!pendingExecution) {
      return null;
    }

    if (this.isAbortPendingSelectionMessage(input.message)) {
      await this.clearPendingActionExecution(session);
      return {
        sessionId: session.id,
        message: `已取消本次${this.getActionDisplayName(pendingExecution.action)}操作。`,
        needsInput: false,
      };
    }

    const submission = await this.prisma.submission.findFirst({
      where: {
        id: pendingExecution.submissionId,
        tenantId: input.tenantId,
        userId: input.userId,
      },
      include: {
        template: true,
      },
    });

    if (!submission) {
      await this.clearPendingActionExecution(session);
      return {
        sessionId: session.id,
        message: '未找到待处理的申请，请重新发起操作。',
        needsInput: false,
        suggestedActions: ['查看我的申请'],
      };
    }

    if (pendingExecution.action === 'supplement') {
      const supplementData = this.buildSupplementPayload(input);
      if (!supplementData || Object.keys(supplementData).length === 0) {
        return {
          sessionId: session.id,
          message: '还没有识别到补件内容。请继续发送补充说明，或上传附件后再发送一次消息。',
          needsInput: true,
          suggestedActions: ['补充说明', '取消'],
        };
      }

      return this.executeAction(
        input,
        session,
        submission,
        'supplement',
        traceId,
        { supplementData },
      );
    }

    const delegateInput = this.parseDelegateActionInput(input.message);
    if (!delegateInput.targetUserId) {
      return {
        sessionId: session.id,
        message: '请按“目标用户ID=xxx，原因=xxx”的格式回复转办信息。',
        needsInput: true,
        suggestedActions: ['目标用户ID=', '取消'],
      };
    }

    return this.executeAction(
      input,
      session,
      submission,
      'delegate',
      traceId,
      {
        targetUserId: delegateInput.targetUserId,
        reason: delegateInput.reason || 'assistant_delegate',
      },
    );
  }

  private async tryHandlePendingConnectorSelection(
    input: ChatInput,
    session: any,
    sharedContext: SharedContext,
    traceId: string,
  ): Promise<ChatResponse | null> {
    const sessionMeta = (session.metadata || {}) as Record<string, any>;
    const pendingConnectorSelection = sessionMeta.pendingConnectorSelection;
    const candidates = Array.isArray(sessionMeta.connectorCandidates)
      ? sessionMeta.connectorCandidates as PendingConnectorSelection[]
      : [];

    if (!pendingConnectorSelection || candidates.length === 0) {
      return null;
    }

    const selectionResolution = await this.resolvePendingSelectionWithLlm(
      'connector',
      input.message,
      candidates.map((candidate, index) => ({
        id: candidate.id,
        label: `${index + 1}. ${candidate.name}`,
        aliases: [candidate.name],
      })),
    );

    if (selectionResolution.action === 'cancel' || this.isAbortPendingSelectionMessage(input.message)) {
      await this.clearPendingConnectorSelection(session);
      return {
        sessionId: session.id,
        message: '已取消本次系统选择。如需继续办理，请重新告诉我您要办什么。',
        needsInput: false,
      };
    }

    const selected = this.resolvePendingConnectorSelection(
      input.message,
      candidates,
      selectionResolution.action === 'select' ? selectionResolution.candidateId : undefined,
    );
    if (!selected) {
      const context = this.parsePendingConnectorSelectionContext(
        sessionMeta.pendingConnectorSelectionContext,
      );
      return this.buildPendingConnectorPrompt(session.id, candidates, context?.processName);
    }

    const context = this.parsePendingConnectorSelectionContext(
      sessionMeta.pendingConnectorSelectionContext,
    );
    const nextMetadata = {
      ...sessionMeta,
      routedConnectorId: selected.id,
      routedConnectorName: selected.name,
    } as Record<string, any>;
    delete nextMetadata.pendingConnectorSelection;
    delete nextMetadata.connectorCandidates;
    delete nextMetadata.pendingConnectorSelectionContext;

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata: nextMetadata,
      },
    });
    session.metadata = nextMetadata;

    const followupIntent = {
      intent: ChatIntent.CREATE_SUBMISSION,
      confidence: 0.9,
      extractedEntities: {
        ...(context?.processCode ? { flowCode: context.processCode } : {}),
      },
    };

    return this.handleCreateSubmission(
      {
        ...input,
        message: context?.originalMessage || input.message,
      },
      session,
      followupIntent,
      sharedContext,
      traceId,
    );
  }

  private async tryHandlePendingFlowSelection(
    input: ChatInput,
    session: any,
    sharedContext: SharedContext,
    traceId: string,
  ): Promise<ChatResponse | null> {
    const sessionMeta = (session.metadata || {}) as Record<string, any>;
    const pendingFlowSelection = sessionMeta.pendingFlowSelection;
    const candidates = Array.isArray(sessionMeta.flowCandidates)
      ? sessionMeta.flowCandidates as PendingFlowSelection[]
      : [];

    if (!pendingFlowSelection || candidates.length === 0) {
      return null;
    }

    const selectionResolution = await this.resolvePendingSelectionWithLlm(
      'flow',
      input.message,
      candidates.map((candidate, index) => ({
        id: candidate.processCode,
        label: `${index + 1}. ${candidate.processName}`,
        aliases: [candidate.processName],
      })),
    );

    if (selectionResolution.action === 'cancel' || this.isAbortPendingSelectionMessage(input.message)) {
      await this.clearPendingFlowSelection(session);
      return {
        sessionId: session.id,
        message: '已取消本次流程选择。如需继续办理，请重新告诉我您要办什么。',
        needsInput: false,
      };
    }

    const selected = this.resolvePendingFlowSelection(
      input.message,
      candidates,
      selectionResolution.action === 'select' ? selectionResolution.candidateId : undefined,
    );
    if (!selected) {
      const context = this.parsePendingFlowSelectionContext(
        sessionMeta.pendingFlowSelectionContext,
      );
      return this.buildPendingFlowPrompt(session.id, candidates, context?.clarificationQuestion);
    }

    const context = this.parsePendingFlowSelectionContext(
      sessionMeta.pendingFlowSelectionContext,
    );
    const nextMetadata = {
      ...sessionMeta,
    } as Record<string, any>;
    delete nextMetadata.pendingFlowSelection;
    delete nextMetadata.flowCandidates;
    delete nextMetadata.pendingFlowSelectionContext;

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata: nextMetadata,
      },
    });
    session.metadata = nextMetadata;

    return this.handleCreateSubmission(
      {
        ...input,
        message: context?.originalMessage || input.message,
      },
      session,
      {
        intent: ChatIntent.CREATE_SUBMISSION,
        confidence: 0.9,
        extractedEntities: {
          flowCode: selected.processCode,
        },
      },
      sharedContext,
      traceId,
    );
  }

  private async handleServiceRequest(
    input: ChatInput,
    session: any,
    traceId: string,
  ): Promise<ChatResponse> {
    try {
      const flows = await this.processLibraryService.list(input.tenantId, undefined, undefined, {
        identityType: input.identityType,
        roles: input.roles,
      });

      if (flows.length === 0) {
        return {
          sessionId: session.id,
          message: '当前没有可用的办事流程。请先通过初始化中心导入OA系统。',
          needsInput: false,
          suggestedActions: ['初始化系统'],
        };
      }

      // 按 connector → 类别 两级分组
      const connectorGroups = new Map<string, { name: string; flows: any[] }>();
      for (const flow of flows) {
        const connName = flow.connector?.name || '未知系统';
        const connId = flow.connector?.id || 'unknown';
        if (!connectorGroups.has(connId)) {
          connectorGroups.set(connId, { name: connName, flows: [] });
        }
        connectorGroups.get(connId)!.flows.push(flow);
      }

      let flowList = '';
      if (connectorGroups.size === 1) {
        // 单系统：只按类别分组，不显示系统名
        const groupedFlows = flows.reduce((acc, flow) => {
          const category = flow.processCategory || '其他';
          if (!acc[category]) acc[category] = [];
          acc[category].push(flow);
          return acc;
        }, {} as Record<string, any[]>);

        for (const [category, categoryFlows] of Object.entries(groupedFlows)) {
          flowList += `\n【${category}】\n`;
          flowList += (categoryFlows as any[]).map(f => `  - ${f.processName}`).join('\n');
        }
      } else {
        // 多系统：按系统 → 类别两级分组
        for (const [, group] of connectorGroups) {
          flowList += `\n📌 ${group.name}\n`;
          const byCategory = group.flows.reduce((acc, flow) => {
            const cat = flow.processCategory || '其他';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(flow);
            return acc;
          }, {} as Record<string, any[]>);

          for (const [category, categoryFlows] of Object.entries(byCategory)) {
            flowList += `  【${category}】\n`;
            flowList += (categoryFlows as any[]).map(f => `    - ${f.processName}`).join('\n');
            flowList += '\n';
          }
        }
      }

      // 记录审计日志
      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'service_request',
        result: 'success',
        details: { flowCount: flows.length },
      });

      return {
        sessionId: session.id,
        message: `以下是可用的办事流程：${flowList}\n\n请告诉我您想办理哪个流程。`,
        needsInput: true,
        suggestedActions: flows.slice(0, 5).map(f => f.processName),
      };
    } catch (error: any) {
      this.logger.error(' handleServiceRequest error:', error.message);

      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'service_request',
        result: 'error',
        details: { error: error.message },
      });

      return {
        sessionId: session.id,
        message: '获取流程列表失败，请稍后重试。',
        needsInput: false,
      };
    }
  }

  private async getOrCreateSession(input: ChatInput) {
    if (input.sessionId) {
      const existing = await this.prisma.chatSession.findUnique({
        where: { id: input.sessionId },
      });
      if (existing) {
        if (existing.tenantId !== input.tenantId || existing.userId !== input.userId) {
          this.logger.warn(`Session ${input.sessionId} does not belong to tenant=${input.tenantId} user=${input.userId}`);
          throw new Error('无权访问该会话');
        }
        if (existing.status === 'archived') {
          await this.restoreSession(existing, null);
          return this.prisma.chatSession.findUnique({
            where: { id: input.sessionId },
          });
        }
        return existing;
      }
    }

    const resolvedUser = await this.tenantUserResolver.resolve({
      tenantId: input.tenantId,
      userId: input.userId,
      allowFallback: true,
    });

    return this.prisma.chatSession.create({
      data: {
        tenantId: input.tenantId,
        userId: resolvedUser.id,
        status: 'active',
      },
    });
  }

  private async applyRequestedRoutingContext(session: any, input: ChatInput) {
    const requestedTemplateId = String(input.requestedTemplateId || '').trim();
    const requestedConnectorId = String(input.requestedConnectorId || '').trim();
    if (!requestedTemplateId && !requestedConnectorId) {
      return;
    }

    const currentMetadata = ((session.metadata || {}) as Record<string, any>) || {};
    if (currentMetadata.currentProcessCode || currentMetadata.pendingDraftId) {
      return;
    }

    let resolvedTemplateId = requestedTemplateId || '';
    let resolvedConnectorId = requestedConnectorId || '';

    if (requestedTemplateId) {
      try {
        const template = await this.processLibraryService.getById(requestedTemplateId, input.tenantId, {
          identityType: input.identityType,
          roles: input.roles,
        });
        resolvedTemplateId = template.id;
        resolvedConnectorId = resolvedConnectorId || template.connectorId;
      } catch {
        resolvedTemplateId = '';
      }
    }

    if (!resolvedTemplateId && !resolvedConnectorId) {
      return;
    }

    const nextMetadata = {
      ...currentMetadata,
      ...(resolvedTemplateId ? { requestedTemplateId: resolvedTemplateId } : {}),
      ...(resolvedConnectorId ? { routedConnectorId: resolvedConnectorId } : {}),
    };

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata: nextMetadata,
      },
    });
    session.metadata = nextMetadata;
  }

  async listSessions(tenantId: string, userId: string) {
    const sessions = await this.prisma.chatSession.findMany({
      where: {
        tenantId,
        userId,
        status: 'active',
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          where: { role: 'user' },
          select: { content: true },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    // 同时获取每个会话的最后一条非内部消息
    const sessionIds = sessions.map(s => s.id);
    const lastMessages = await Promise.all(
      sessionIds.map(id =>
        this.prisma.chatMessage.findFirst({
          where: {
            sessionId: id,
            NOT: { content: { startsWith: '__ACTION_' } },
          },
          orderBy: { createdAt: 'desc' },
          select: { content: true, role: true, createdAt: true, metadata: true },
        }),
      ),
    );
    const sessionStates = await Promise.all(
      sessions.map((session) => this.buildSessionState(session, tenantId)),
    );

    return sessions.map((s, i) => {
      const firstUserMsg = s.messages[0]?.content || '';
      const lastMsg = lastMessages[i];
      const lastMeta = ((lastMsg?.metadata || {}) as Record<string, any>) || {};
      const lastProcessCard = (lastMeta.processCard as Record<string, any> | undefined) || undefined;
      const sessionState = sessionStates[i];
      const processStatus = sessionState.processStatus || lastMeta.processStatus || lastProcessCard?.processStatus || null;
      const reworkHint = sessionState.reworkHint || lastProcessCard?.reworkHint || null;
      const processStatusText = sessionState.activeProcessCard?.statusText
        || (processStatus
          ? this.getProcessCardStatusText(processStatus as ProcessStatus, reworkHint || undefined)
          : null);
      return {
        id: s.id,
        title: firstUserMsg.length > 30 ? firstUserMsg.substring(0, 30) + '...' : firstUserMsg || '新对话',
        lastMessage: lastMsg?.role === 'user'
          ? lastMsg.content.substring(0, 50)
          : (lastMsg?.content || '').substring(0, 50),
        messageCount: s._count.messages,
        status: s.status,
        archivedAt: (s as any).archivedAt || null,
        archivedSource: (s as any).archivedSource || null,
        restorableUntil: (s as any).restorableUntil || null,
        timestamp: s.updatedAt,
        createdAt: s.createdAt,
        hasActiveProcess: sessionState.hasActiveProcess,
        processName: sessionState.processName || lastProcessCard?.processName || null,
        processStatus,
        processStatusText,
        processStage: sessionState.stage || lastProcessCard?.stage || null,
        reworkHint,
        hasBusinessRecord: Boolean(
          sessionState.processCode
          || lastProcessCard?.processCode
          || ((s.metadata || {}) as Record<string, any>).pendingDraftId
          || ((s.metadata || {}) as Record<string, any>).currentSubmissionId,
        ),
        canRestoreConversation: this.canRestoreConversationSession(s, processStatus),
      };
    });
  }

  async getMessages(sessionId: string, tenantId: string, userId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, tenantId, userId },
    });
    if (!session) {
      return {
        session: null,
        messages: [],
      };
    }

    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });

    const sessionState = await this.buildSessionState(session, session.tenantId);

    return {
      session: {
        id: session.id,
        status: session.status,
        updatedAt: session.updatedAt,
        sessionState,
      },
      messages: this.decorateMessagesForSession(session, messages, sessionState),
    };
  }

  async updatePendingFormField(input: {
    sessionId: string;
    tenantId: string;
    userId: string;
    fieldKey: string;
    value: string;
    identityType?: string;
    roles?: string[];
  }) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: input.sessionId, tenantId: input.tenantId, userId: input.userId },
    });
    if (!session) {
      throw new BadRequestException('对话不存在或无权访问');
    }

    const processContext = this.extractProcessContext(session);
    if (!processContext || processContext.status !== ProcessStatus.PENDING_CONFIRMATION) {
      throw new BadRequestException('当前阶段暂不支持直接修改表单字段');
    }

    const metadata = ((session.metadata || {}) as Record<string, any>) || {};
    const pendingDraftId = typeof metadata.pendingDraftId === 'string' ? metadata.pendingDraftId.trim() : '';
    if (!pendingDraftId) {
      throw new BadRequestException('当前确认表单未找到可更新的草稿');
    }

    const template = await this.findTemplateForResolvedFlow(
      input.tenantId,
      processContext.processCode,
      {
        identityType: input.identityType,
        roles: input.roles,
      },
      (metadata.currentConnectorId as string | null | undefined) || null,
    );
    if (!template) {
      throw new BadRequestException('流程模板不存在，请联系管理员');
    }

    const schema = template.schema as any;
    const schemaField = (schema?.fields || []).find((field: any) => field?.key === input.fieldKey);
    if (!schemaField) {
      throw new BadRequestException('要修改的字段不存在');
    }
    if (String(schemaField.type || '').trim().toLowerCase() === 'file') {
      throw new BadRequestException('附件字段请通过上传入口修改');
    }

    const normalizedValue = this.formAgent.normalizeDirectFieldValue(
      processContext.processCode,
      schema,
      input.fieldKey,
      input.value,
    );
    if (normalizedValue === undefined) {
      throw new BadRequestException('输入内容暂时无法识别为有效字段值，请调整后重试');
    }

    const updatedFormData = {
      ...processContext.parameters,
      [input.fieldKey]: normalizedValue,
    };
    const updatedFieldOrigins: Record<string, ProcessFieldOrigin> = {
      ...((metadata.currentFieldOrigins as Record<string, ProcessFieldOrigin> | undefined) || {}),
      [input.fieldKey]: 'user',
    };
    const updatedSummary = this.buildConfirmationSummary(
      this.resolveDisplayProcessName(session, template.processName, template.processCode),
      updatedFieldOrigins,
    );
    const updatedMetadata = {
      ...metadata,
      currentFormData: updatedFormData,
      currentFieldOrigins: updatedFieldOrigins,
      currentProcessSummary: updatedSummary,
      currentInteractionMode: null,
      missingFields: [],
      processStatus: ProcessStatus.PENDING_CONFIRMATION,
      processUpdatedAt: new Date().toISOString(),
    };

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata: updatedMetadata,
      },
    });

    await this.prisma.processDraft.update({
      where: { id: pendingDraftId },
      data: {
        formData: updatedFormData,
        status: 'ready',
      },
    });

    return this.getMessages(session.id, input.tenantId, input.userId);
  }

  async deleteSession(
    sessionId: string,
    tenantId: string,
    userId: string,
    mode: 'archive' | 'purge' = 'archive',
  ): Promise<{ mode: 'archive' | 'purge'; restorable: boolean; archivedAt?: string | null }> {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, tenantId, userId },
    });
    if (!session) {
      return { mode, restorable: false, archivedAt: null };
    }

    const metadata = ((session.metadata || {}) as Record<string, any>) || {};
    const hasBusinessRecord = await this.hasRestorableBusinessRecord(session, metadata);
    if (mode === 'archive' && hasBusinessRecord) {
      const now = new Date();
      const processStatus = metadata.processStatus as ProcessStatus | undefined;
      const retentionWindow = shouldApplyChatRetention(processStatus)
        ? buildChatRetentionWindow(now)
        : null;
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          status: 'archived',
          archivedAt: now,
          archivedSource: 'chat',
          archiveReason: 'user_removed_from_history',
          restorableUntil: retentionWindow?.restoreExpiresAt || null,
          retainedUntil: retentionWindow?.retainedUntil || null,
        } as any,
      });
      this.logger.log(`Session archived: ${sessionId}`);
      return {
        mode: 'archive',
        restorable: true,
        archivedAt: now.toISOString(),
      };
    }

    if (mode === 'purge' && hasBusinessRecord) {
      throw new BadRequestException('该对话已关联业务记录，请使用“从历史中移除”，并通过“我的申请”恢复');
    }

    await this.prisma.chatMessage.deleteMany({
      where: { sessionId },
    });

    await this.prisma.chatSession.delete({
      where: { id: sessionId },
    });

    this.logger.log(`Session permanently deleted: ${sessionId}`);
    return { mode: 'purge', restorable: false, archivedAt: null };
  }

  async restoreSessionFromBusinessRecord(input: {
    sessionId?: string | null;
    submissionId?: string | null;
    draftId?: string | null;
    tenantId: string;
    userId: string;
  }) {
    let reusableSession: any | null = null;
    const candidateSessionId = (input.sessionId || '').trim();
    if (candidateSessionId) {
      const session = await this.prisma.chatSession.findFirst({
        where: {
          id: candidateSessionId,
          tenantId: input.tenantId,
          userId: input.userId,
          status: { in: ['active', 'archived'] },
        },
      });
      if (session) {
        if (this.hasRestorableProcessContext(session)) {
          await this.restoreSession(session, input.submissionId || null);
          return this.getMessages(session.id, input.tenantId, input.userId);
        }
        reusableSession = session;
      }
    }

    const candidateDraftId = (input.draftId || '').trim();
    if (candidateDraftId) {
      const draft = await this.prisma.processDraft.findFirst({
        where: {
          id: candidateDraftId,
          tenantId: input.tenantId,
          userId: input.userId,
        },
        include: {
          template: true,
        },
      });
      if (!draft) {
        throw new BadRequestException('草稿记录不存在');
      }

      if (draft.sessionId) {
        const session = await this.prisma.chatSession.findFirst({
          where: {
            id: draft.sessionId,
            tenantId: input.tenantId,
            userId: input.userId,
            status: { in: ['active', 'archived'] },
          },
        });
        if (session) {
          if (this.hasRestorableProcessContext(session)) {
            await this.restoreSession(session, input.submissionId || null);
            return this.getMessages(session.id, input.tenantId, input.userId);
          }
          reusableSession = reusableSession || session;
        }
      }

      return this.restoreDraftConversation({
        draft,
        tenantId: input.tenantId,
        userId: input.userId,
        existingSession: reusableSession,
      });
    }

    if (!input.submissionId) {
      throw new BadRequestException('缺少可恢复的业务记录');
    }

    const submission = await this.prisma.submission.findFirst({
      where: {
        id: input.submissionId,
        tenantId: input.tenantId,
        userId: input.userId,
      },
      include: {
        template: true,
      },
    });
    if (!submission) {
      throw new BadRequestException('申请记录不存在');
    }

    return this.restoreSubmissionConversation({
      submission,
      tenantId: input.tenantId,
      userId: input.userId,
      existingSession: reusableSession,
    });
  }

  async resetSession(sessionId: string, tenantId: string, userId: string): Promise<void> {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, tenantId, userId },
      select: { id: true },
    });
    if (!session) {
      return;
    }

    // Clear session metadata (process context)
    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata: {},
        status: 'active',
      },
    });

    this.logger.log(` Session reset: ${sessionId}`);
  }

  private parsePendingAction(action: unknown): PendingAssistantAction | null {
    if (action === 'cancel' || action === 'urge' || action === 'supplement' || action === 'delegate' || action === 'detail') {
      return action;
    }
    return null;
  }

  private parsePendingActionExecution(input: unknown): PendingActionExecutionContext | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }

    const record = input as Record<string, any>;
    if (
      (record.action === 'supplement' || record.action === 'delegate')
      && typeof record.submissionId === 'string'
      && record.submissionId
    ) {
      return {
        action: record.action,
        submissionId: record.submissionId,
        oaSubmissionId: typeof record.oaSubmissionId === 'string' ? record.oaSubmissionId : null,
        processName: typeof record.processName === 'string' ? record.processName : undefined,
      };
    }

    return null;
  }

  private getActionDisplayName(action: string) {
    const actionNames: Record<string, string> = {
      cancel: '撤回',
      urge: '催办',
      supplement: '补件',
      delegate: '转办',
      detail: '查看详情',
    };
    return actionNames[action] || action;
  }

  private extractSubmissionIdentifier(message: string) {
    const uuidMatch = message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) {
      return uuidMatch[0];
    }

    const tokenMatch = message.match(/[A-Za-z0-9][A-Za-z0-9_-]{9,}/);
    return tokenMatch?.[0] || null;
  }

  private isSelectionLikeInput(message: string) {
    const trimmed = message.trim();
    if (/^\d+$/.test(trimmed)) {
      return true;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      return true;
    }
    return /^[A-Za-z0-9][A-Za-z0-9_-]{9,}$/.test(trimmed);
  }

  private isAbortPendingSelectionMessage(message: string) {
    const trimmed = message.trim();
    return trimmed === '__ACTION_CANCEL__';
  }

  private async resolvePendingSelectionWithLlm(
    kind: PendingSelectionKind,
    message: string,
    candidates: PendingSelectionCandidate[],
  ): Promise<PendingSelectionResolution> {
    const trimmed = message.trim();
    if (!trimmed) {
      return { action: 'unknown' };
    }

    try {
      const candidateList = candidates
        .map((candidate, index) => {
          const aliasText = Array.isArray(candidate.aliases)
            ? candidate.aliases.map((alias) => String(alias || '').trim()).filter(Boolean).join(' / ')
            : '';
          return `- 序号: ${index + 1} | id: ${candidate.id} | 名称: ${candidate.label}${aliasText ? ` | 别名: ${aliasText}` : ''}`;
        })
        .join('\n');

      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: `你是一个对话候选项选择助手。

任务：
根据用户回复，判断用户是在：
1. select: 选择某一个候选项
2. cancel: 放弃当前选择
3. retry: 表示还不确定、想重新看看选项
4. unknown: 无法判断

规则：
- 优先理解自然语言，不要只做关键词命中。
- 用户可能说“第二个”“科员那个”“网信处那个”“最新那条”“还是第一个吧”“不要了”“算了”“重新看下选项”等。
- 只有在能明确对应到一个候选项时，才返回 select。
- 如果用户表达放弃、取消、不要继续当前选择，返回 cancel。
- 如果用户表达想重新看选项、还没决定、想再确认，返回 retry。
- 不要编造不存在的候选项。

返回 JSON：
{
  "action": "select" | "cancel" | "retry" | "unknown",
  "candidateId": "候选项id，仅当 action=select 时提供",
  "reasoning": "简要说明"
}`,
        },
        {
          role: 'user',
          content: `选择类型：${kind}\n候选项：\n${candidateList}\n\n用户回复：\"${trimmed}\"\n\n请返回 JSON。`,
        },
      ], {
        trace: {
          scope: 'assistant.pending_selection.resolve',
          metadata: {
            kind,
            candidateCount: candidates.length,
          },
        },
      });

      let jsonStr = response.content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const result = JSON.parse(jsonStr);
      const action = String(result.action || '').trim().toLowerCase();

      if (action === 'cancel' || action === 'retry' || action === 'unknown') {
        return { action };
      }

      if (action === 'select') {
        const candidateId = String(result.candidateId || '').trim();
        if (candidateId && candidates.some((candidate) => candidate.id === candidateId)) {
          return { action: 'select', candidateId };
        }
      }
    } catch (error: any) {
      this.logger.warn(`Pending selection resolution LLM failed: ${error.message}`);
    }

    return { action: 'unknown' };
  }

  private resolvePendingSubmissionSelection(
    message: string,
    candidates: PendingSubmissionSelection[],
    explicitSelectionId?: string,
  ) {
    const trimmed = message.trim();

    if (explicitSelectionId) {
      return candidates.find((candidate) => candidate.submissionId === explicitSelectionId) || null;
    }

    if (/^\d+$/.test(trimmed)) {
      const index = Number(trimmed) - 1;
      return index >= 0 && index < candidates.length ? candidates[index] : null;
    }

    const identifier = (this.extractSubmissionIdentifier(trimmed) || trimmed).toLowerCase();
    return candidates.find(candidate =>
      [candidate.submissionId, candidate.oaSubmissionId]
        .filter((value): value is string => Boolean(value))
        .some(value => value.toLowerCase() === identifier)
    ) || null;
  }

  private parsePendingConnectorSelectionContext(input: unknown): PendingConnectorSelectionContext | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }

    const record = input as Record<string, any>;
    return {
      originalMessage: typeof record.originalMessage === 'string' ? record.originalMessage : undefined,
      processCode: typeof record.processCode === 'string' ? record.processCode : undefined,
      processName: typeof record.processName === 'string' ? record.processName : undefined,
    };
  }

  private parsePendingFlowSelectionContext(input: unknown): PendingFlowSelectionContext | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }

    const record = input as Record<string, any>;
    return {
      originalMessage: typeof record.originalMessage === 'string' ? record.originalMessage : undefined,
      clarificationQuestion: typeof record.clarificationQuestion === 'string'
        ? record.clarificationQuestion
        : undefined,
    };
  }

  private dedupePendingFlowCandidates(candidates: PendingFlowSelection[]) {
    const seen = new Map<string, PendingFlowSelection>();
    for (const candidate of candidates) {
      if (!candidate?.processCode || !candidate?.processName) {
        continue;
      }
      if (!seen.has(candidate.processCode)) {
        seen.set(candidate.processCode, {
          processCode: candidate.processCode,
          processName: candidate.processName,
        });
      }
    }
    return [...seen.values()];
  }

  private resolvePendingFlowSelection(
    message: string,
    candidates: PendingFlowSelection[],
    explicitSelectionId?: string,
  ) {
    const trimmed = message.trim();

    if (explicitSelectionId) {
      return candidates.find((candidate) => candidate.processCode === explicitSelectionId) || null;
    }

    if (/^\d+$/.test(trimmed)) {
      const index = Number(trimmed) - 1;
      return index >= 0 && index < candidates.length ? candidates[index] : null;
    }

    const normalized = trimmed.toLowerCase();
    return candidates.find((candidate) => candidate.processCode.toLowerCase() === normalized) || null;
  }

  private resolvePendingConnectorSelection(
    message: string,
    candidates: PendingConnectorSelection[],
    explicitSelectionId?: string,
  ) {
    const trimmed = message.trim();

    if (explicitSelectionId) {
      return candidates.find((candidate) => candidate.id === explicitSelectionId) || null;
    }

    if (/^\d+$/.test(trimmed)) {
      const index = Number(trimmed) - 1;
      return index >= 0 && index < candidates.length ? candidates[index] : null;
    }

    const normalized = trimmed.toLowerCase();
    return candidates.find((candidate) => candidate.id.toLowerCase() === normalized) || null;
  }

  private buildPendingActionPrompt(
    sessionId: string,
    action: PendingAssistantAction,
    candidates: PendingSubmissionSelection[],
  ): ChatResponse {
    const selectionList = candidates
      .map((candidate, index) =>
        `${index + 1}. ${candidate.processName || '未知流程'} - ${candidate.oaSubmissionId || candidate.submissionId}`
      )
      .join('\n');

    return {
      sessionId,
      message: `请选择要${this.getActionDisplayName(action)}的申请：\n${selectionList}\n\n请回复序号或申请编号。`,
      needsInput: true,
      suggestedActions: candidates.map(candidate => candidate.oaSubmissionId || candidate.submissionId),
    };
  }

  private buildPendingConnectorPrompt(
    sessionId: string,
    candidates: PendingConnectorSelection[],
    processName?: string,
  ): ChatResponse {
    const selectionList = candidates
      .map((candidate, index) => `${index + 1}. ${candidate.name}`)
      .join('\n');
    const prefix = processName
      ? `我已经识别到您要办理“${processName}”，但这个流程在多个系统中都可能存在。请选择要使用的系统：`
      : '请选择要使用的系统：';

    return {
      sessionId,
      message: `${prefix}\n${selectionList}\n\n请回复序号或系统ID。`,
      needsInput: true,
      suggestedActions: candidates.map((candidate) => candidate.id),
    };
  }

  private buildPendingFlowPrompt(
    sessionId: string,
    candidates: PendingFlowSelection[],
    clarificationQuestion?: string,
  ): ChatResponse {
    const selectionList = candidates
      .map((candidate, index) => `${index + 1}. ${candidate.processName}`)
      .join('\n');
    const prefix = clarificationQuestion || '当前有多个相近流程，请选择您要办理的流程：';

    return {
      sessionId,
      message: `${prefix}\n${selectionList}\n\n请回复序号或流程编码。`,
      needsInput: true,
      suggestedActions: candidates.map((candidate) => candidate.processCode),
    };
  }

  private isDetailFollowUpMessage(message: string) {
    const trimmed = message.trim().toLowerCase();
    return /^(查看详情|详情|详细信息|明细|detail|details)$/.test(trimmed);
  }

  private async buildSubmissionDetailResponse(
    sessionId: string,
    submissionId: string,
    tenantId: string,
  ): Promise<ChatResponse> {
    const submission = await this.submissionService.getSubmission(submissionId, tenantId);
    if (!submission) {
      return {
        sessionId,
        message: '未找到对应的申请详情，请重新查询后再试。',
        needsInput: false,
        suggestedActions: ['查询进度'],
      };
    }

    const fieldLines = Array.isArray(submission.formDataWithLabels)
      ? submission.formDataWithLabels
          .slice(0, 8)
          .map((field: any) => `${field.label}：${field.displayValue ?? field.value ?? '-'}`)
      : [];
    const timelineLines = Array.isArray(submission.statusRecords)
      ? submission.statusRecords
          .slice(0, 3)
          .map((record: any) => {
            const at = new Date(record.queriedAt).toLocaleString('zh-CN');
            return `${at} - ${getSubmissionStatusText(record.status)}`;
          })
      : [];

    const detailSections = [
      `流程：${submission.processName || '未知流程'}`,
      `状态：${submission.statusText || getSubmissionStatusText(submission.status)}`,
      `申请编号：${submission.oaSubmissionId || submission.id}`,
      `提交时间：${new Date(submission.createdAt).toLocaleString('zh-CN')}`,
    ];

    if (fieldLines.length > 0) {
      detailSections.push(`表单信息：\n${fieldLines.join('\n')}`);
    }

    if (timelineLines.length > 0) {
      detailSections.push(`最近状态：\n${timelineLines.join('\n')}`);
    }

    return {
      sessionId,
      message: `申请详情：\n${detailSections.join('\n\n')}`,
      needsInput: false,
      suggestedActions: ['查询进度', '催办', '发起新申请'],
    };
  }

  private buildPendingActionExecutionPrompt(
    sessionId: string,
    action: PendingActionExecutionContext['action'],
    processName?: string | null,
  ): ChatResponse {
    const resolvedProcessName = processName || '\u672a\u77e5\u6d41\u7a0b';

    if (action === 'supplement') {
      return {
        sessionId,
        message: `\u5df2\u9009\u4e2d\u201c${resolvedProcessName}\u201d\u3002\u8bf7\u76f4\u63a5\u53d1\u9001\u8981\u8865\u5145\u7684\u8bf4\u660e\u3001\u5b57\u6bb5\u5185\u5bb9\uff0c\u6216\u4e0a\u4f20\u8865\u4ef6\u9644\u4ef6\u540e\u518d\u53d1\u9001\u4e00\u6b21\u6d88\u606f\u3002`,
        needsInput: true,
        suggestedActions: [
          '\u8865\u5145\u8bf4\u660e',
          '\u4e0a\u4f20\u9644\u4ef6\u540e\u53d1\u9001',
          '\u53d6\u6d88',
        ],
      };
    }

    return {
      sessionId,
      message: `\u5df2\u9009\u4e2d\u201c${resolvedProcessName}\u201d\u3002\u8bf7\u6309\u201c\u76ee\u6807\u7528\u6237ID=xxx\uff0c\u539f\u56e0=xxx\u201d\u7684\u683c\u5f0f\u56de\u590d\uff0c\u6211\u518d\u4e3a\u60a8\u53d1\u8d77\u8f6c\u529e\u3002`,
      needsInput: true,
      suggestedActions: ['\u76ee\u6807\u7528\u6237ID=', '\u53d6\u6d88'],
    };
  }

  private async persistPendingActionExecution(session: any, execution: PendingActionExecutionContext) {
    const metadata = {
      ...((session.metadata || {}) as Record<string, any>),
      pendingActionExecution: {
        action: execution.action,
        submissionId: execution.submissionId,
        oaSubmissionId: execution.oaSubmissionId || null,
        processName: execution.processName || null,
      } as Record<string, any>,
    };

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata,
      },
    });
    session.metadata = metadata;
  }

  private async clearPendingActionSelection(session: any) {
    const metadata = { ...((session.metadata || {}) as Record<string, any>) };
    delete metadata.pendingAction;
    delete metadata.pendingSubmissionSelection;

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata,
      },
    });
    session.metadata = metadata;
  }

  private async clearPendingConnectorSelection(session: any) {
    const metadata = { ...((session.metadata || {}) as Record<string, any>) };
    delete metadata.pendingConnectorSelection;
    delete metadata.connectorCandidates;
    delete metadata.pendingConnectorSelectionContext;

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata,
      },
    });
    session.metadata = metadata;
  }

  private async clearPendingFlowSelection(session: any) {
    const metadata = { ...((session.metadata || {}) as Record<string, any>) };
    delete metadata.pendingFlowSelection;
    delete metadata.flowCandidates;
    delete metadata.pendingFlowSelectionContext;

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata,
      },
    });
    session.metadata = metadata;
  }

  private async clearPendingActionExecution(session: any) {
    const metadata = { ...((session.metadata || {}) as Record<string, any>) };
    delete metadata.pendingActionExecution;

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata,
      },
    });
    session.metadata = metadata;
  }

  private buildSupplementPayload(input: ChatInput) {
    const payload: Record<string, any> = {};
    const trimmed = input.message.trim();
    if (trimmed) {
      payload.supplementNote = trimmed;
    }

    if (Array.isArray(input.attachments) && input.attachments.length > 0) {
      payload.attachments = input.attachments.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        fileId: attachment.fileId,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
        fieldKey: attachment.fieldKey || null,
        bindScope: attachment.bindScope || 'general',
      }));
    }

    return payload;
  }

  private parseDelegateActionInput(message: string): { targetUserId?: string; reason?: string } {
    const normalized = message.trim();
    if (!normalized) {
      return {};
    }

    const structured = normalized.match(/目标用户ID\s*[:=：]\s*([A-Za-z0-9._@-]+)/i);
    const reasonMatch = normalized.match(/原因\s*[:=：]\s*(.+)$/i);
    if (structured?.[1]) {
      return {
        targetUserId: structured[1],
        reason: reasonMatch?.[1]?.trim(),
      };
    }

    const compact = normalized.match(/^([A-Za-z0-9._@-]+)(?:\s+|,|，|;|；)(.+)$/);
    if (compact?.[1]) {
      return {
        targetUserId: compact[1],
        reason: compact[2]?.trim(),
      };
    }

    if (/^[A-Za-z0-9._@-]+$/.test(normalized)) {
      return { targetUserId: normalized };
    }

    return {};
  }

  private decorateMessagesForSession(
    session: any,
    messages: any[],
    sessionState?: SessionState | null,
  ) {
    const metadata = ((session.metadata || {}) as Record<string, any>) || {};
    const activeProcessId = metadata.currentProcessCode
      ? (metadata.processId || metadata.pendingDraftId || session.id)
      : null;
    const processStatus = metadata.processStatus as ProcessStatus | undefined;
    const latestTrackedProcessMessageId = sessionState?.activeProcessCard?.processInstanceId
      ? [...messages]
        .reverse()
        .find((message) => {
          const messageMeta = ((message.metadata || {}) as Record<string, any>) || {};
          const processCard = (messageMeta.processCard as Record<string, any> | undefined) || undefined;
          return Boolean(
            message.role === 'assistant'
            && processCard?.processInstanceId === sessionState.activeProcessCard?.processInstanceId,
          );
        })?.id || null
      : null;

    const latestActionableMessageId = activeProcessId &&
      requiresUserAction(processStatus || ProcessStatus.INITIALIZED)
      ? [...messages]
        .reverse()
        .find((message) => {
          const messageMeta = ((message.metadata || {}) as Record<string, any>) || {};
          const processCard = (messageMeta.processCard as Record<string, any> | undefined) || undefined;
          return Boolean(
            message.role === 'assistant' &&
            processCard?.processInstanceId === activeProcessId &&
            Array.isArray(messageMeta.actionButtons) &&
            messageMeta.actionButtons.length > 0,
          );
        })?.id || null
      : null;

    return messages
      .filter((message) => !message.content.startsWith('__ACTION_'))
      .map((message) => {
        const messageMeta = ((message.metadata || {}) as Record<string, any>) || {};
        const storedProcessCard = (messageMeta.processCard as Record<string, any> | undefined) || undefined;
        const belongsToActiveProcess = Boolean(
          activeProcessId &&
          storedProcessCard?.processInstanceId === activeProcessId,
        );
        const actionAvailable = Boolean(
          belongsToActiveProcess &&
          latestActionableMessageId === message.id,
        );
        const currentProcessCard = sessionState?.activeProcessCard
          && latestTrackedProcessMessageId === message.id
          && storedProcessCard?.processInstanceId === sessionState.activeProcessCard.processInstanceId
          ? sessionState.activeProcessCard
          : null;
        const resolvedContent = this.resolveDecoratedProcessMessageContent({
          originalContent: message.content,
          storedProcessCard,
          currentProcessCard,
        });

        const processCard = (currentProcessCard || storedProcessCard)
          ? {
            ...(storedProcessCard || {}),
            ...(currentProcessCard || {}),
            actionState: actionAvailable ? 'available' : 'readonly',
            canContinue: belongsToActiveProcess && requiresUserAction(processStatus || ProcessStatus.INITIALIZED),
          }
          : undefined;

        return {
          id: message.id,
          role: message.role,
          content: resolvedContent,
          createdAt: message.createdAt,
          messageKind: processCard ? 'process_card' : (messageMeta.messageKind || 'text'),
          attachments: message.role === 'user'
            ? this.normalizeResponseAttachments(messageMeta.attachments)
            : undefined,
          actionButtons: actionAvailable ? messageMeta.actionButtons : undefined,
          formData: messageMeta.formData,
          processStatus: processCard?.processStatus || messageMeta.processStatus,
          needsAttachment: messageMeta.needsAttachment,
          authChallenge: messageMeta.authChallenge,
          missingFields: messageMeta.missingFields,
          processCard,
        };
      });
  }

  private resolveDecoratedProcessMessageContent(input: {
    originalContent: string;
    storedProcessCard?: Record<string, any> | null;
    currentProcessCard?: ProcessCard | null;
  }) {
    const currentStatus = input.currentProcessCard?.processStatus;
    const storedStatus = String(input.storedProcessCard?.processStatus || '').trim();
    if (!currentStatus || currentStatus === storedStatus) {
      return input.originalContent;
    }

    const processName = String(
      input.currentProcessCard?.processName
      || input.storedProcessCard?.processName
      || '当前申请',
    ).trim() || '当前申请';
    const submissionRef = String(
      input.currentProcessCard?.oaSubmissionId
      || input.currentProcessCard?.submissionId
      || '',
    ).trim();
    const submissionLine = submissionRef ? `\n申请编号：${submissionRef}` : '';
    const reworkReason = String(input.currentProcessCard?.reworkReason || '').trim();

    switch (currentStatus) {
      case ProcessStatus.DRAFT_SAVED:
        return `${processName}已保存到 OA 待发箱，尚未正式送审。${submissionLine}`;
      case ProcessStatus.SUBMITTED:
        return `${processName}已提交成功，当前为审批中。${submissionLine}`;
      case ProcessStatus.COMPLETED:
        return `${processName}已在 OA 系统审批通过，当前申请已完成。${submissionLine}`;
      case ProcessStatus.CANCELLED:
        return `${processName}已在 OA 系统中取消或撤回。${submissionLine}`;
      case ProcessStatus.FAILED:
        return `${processName}处理失败，请稍后重试。${submissionLine}`;
      case ProcessStatus.REWORK_REQUIRED:
        return `${processName}已被退回，请在当前会话继续处理。${submissionLine}${reworkReason ? `\n驳回原因：${reworkReason}` : ''}`;
      default:
        return input.originalContent;
    }
  }

  private formatFormData(formData: Record<string, any>, schema: any, processCode?: string): string {
    const fields = schema?.fields || [];
    return Object.entries(formData)
      .map(([key, value]) => {
        const field = fields.find((f: any) => f.key === key);
        const normalizedOptions = this.normalizeFieldOptions(field?.options);
        const presentation = resolveAssistantFieldPresentation({
          key,
          label: field?.label || key,
          type: field?.type,
          options: normalizedOptions,
          processCode,
        });
        const label = presentation.label;
        const normalizedAttachmentValue = this.normalizeAttachmentFieldValue(value);
        // 文件类型字段显示文件名列表
        if (Array.isArray(normalizedAttachmentValue) && normalizedAttachmentValue.length > 0 && normalizedAttachmentValue[0]?.fileName) {
          const fileNames = normalizedAttachmentValue.map((f: any) => f.fileName).join('、');
          return `  ${label}: ${fileNames}`;
        }
        if (normalizedOptions.length > 0) {
          const option = normalizedOptions.find((candidate) => candidate.value === value);
          if (option) {
            return `  ${label}: ${option.label}`;
          }
        }
        return `  ${label}: ${value}`;
      })
      .join('\n');
  }

  private formatDeliveryPathLabel(path?: DeliveryPath | null): string {
    switch (path) {
      case 'api':
        return '接口';
      case 'url':
        return 'URL';
      case 'vision':
        return '图片定位';
      default:
        return '默认';
    }
  }

  private buildFormDataWithLabels(
    formData: Record<string, any>,
    template: any | null | undefined,
    fieldOrigins: Record<string, ProcessFieldOrigin> = {},
  ): ProcessCardField[] {
    const schema = template?.schema as any;
    const fields: any[] = schema?.fields || [];
    const orderedKeys = [
      ...fields.map((field: any) => field.key).filter((key: string) => Object.prototype.hasOwnProperty.call(formData, key)),
      ...Object.keys(formData).filter((key) => !fields.some((field: any) => field.key === key)),
    ].filter((key) => {
      const field = fields.find((item: any) => item.key === key);
      return !isAuthCredentialField({
        key,
        label: field?.label || key,
        description: field?.description,
      });
    });

    return orderedKeys.map((key) => {
      const value = this.normalizeAttachmentFieldValue(formData[key]);
      const field = fields.find((item: any) => item.key === key);
      const normalizedOptions = this.normalizeFieldOptions(field?.options);
      const presentation = resolveAssistantFieldPresentation({
        key,
        label: field?.label || key,
        type: field?.type,
        options: normalizedOptions,
        processCode: template?.processCode,
      });
      let displayValue = value;

      if (Array.isArray(value) && value.length > 0 && value[0]?.fileName) {
        displayValue = value.map((file: any) => file.fileName).join('、');
      } else if (normalizedOptions.length > 0) {
        if (Array.isArray(value)) {
          displayValue = value
            .map((item) => {
              const option = normalizedOptions.find((candidate) => candidate.value === item);
              return option?.label || item;
            })
            .join('、');
        } else {
          const option = normalizedOptions.find((candidate) => candidate.value === value);
          if (option) {
            displayValue = option.label;
          }
        }
      }

      const originMeta = this.getFieldOriginMeta(fieldOrigins[key]);

      return {
        key,
        label: presentation.label,
        value,
        displayValue,
        type: presentation.type,
        required: Boolean(field?.required),
        description: typeof field?.description === 'string' ? field.description : undefined,
        example: typeof field?.example === 'string' ? field.example : undefined,
        multiple: field?.multiple === true,
        options: normalizedOptions.length > 0 ? normalizedOptions : undefined,
        origin: fieldOrigins[key],
        tagLabel: originMeta?.tagLabel,
        tagTone: originMeta?.tagTone,
        hint: originMeta?.hint,
      };
    });
  }

  private normalizeAttachmentFieldValue(value: any) {
    if (!Array.isArray(value) || value.length === 0 || !value[0]?.fileName) {
      return value;
    }

    return value.map((item: any) => normalizeAttachmentRef(item) || item);
  }

  private normalizeResponseAttachments(attachments: any) {
    if (!Array.isArray(attachments)) {
      return attachments;
    }

    return attachments.map((item) => normalizeAttachmentRef(item) || item);
  }

  private filterChangedFormFields(
    currentFormData: Record<string, any>,
    nextValues: Record<string, any>,
  ) {
    return Object.fromEntries(
      Object.entries(nextValues || {}).filter(([key, value]) =>
        !this.areFormValuesEquivalent(currentFormData?.[key], value),
      ),
    );
  }

  private areFormValuesEquivalent(left: any, right: any): boolean {
    if (left === right) {
      return true;
    }

    if (Array.isArray(left) && Array.isArray(right)) {
      return left.length === right.length && JSON.stringify(left) === JSON.stringify(right);
    }

    if (
      left
      && right
      && typeof left === 'object'
      && typeof right === 'object'
      && !Array.isArray(left)
      && !Array.isArray(right)
    ) {
      return JSON.stringify(left) === JSON.stringify(right);
    }

    return String(left ?? '').trim() === String(right ?? '').trim();
  }

  private async hasRestorableBusinessRecord(session: any, metadata: Record<string, any>) {
    const pendingDraftId = typeof metadata.pendingDraftId === 'string' ? metadata.pendingDraftId.trim() : '';
    if (pendingDraftId) {
      return true;
    }

    const currentSubmissionId = typeof metadata.currentSubmissionId === 'string'
      ? metadata.currentSubmissionId.trim()
      : '';
    if (currentSubmissionId) {
      return true;
    }

    const linkedDraft = await this.prisma.processDraft.findFirst({
      where: {
        tenantId: session.tenantId,
        userId: session.userId,
        sessionId: session.id,
      },
      select: { id: true },
    });
    if (linkedDraft) {
      return true;
    }

    return false;
  }

  private canRestoreConversationSession(session: any, processStatus?: string | null) {
    return session.status === 'archived' && isConversationRestorable({
      status: processStatus,
      restoreStatus: getRestoreStatusForProcess(processStatus),
      restoreExpiresAt: (session as any).restorableUntil || null,
      retainedUntil: (session as any).retainedUntil || null,
    });
  }

  private async restoreSession(session: any, submissionId?: string | null) {
    if (session.status !== 'archived') {
      return session;
    }

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        status: 'active',
        archivedAt: null,
        archivedSource: null,
        archiveReason: null,
        recoverySubmissionId: submissionId || (session as any).recoverySubmissionId || null,
      } as any,
    });

    return {
      ...session,
      status: 'active',
      archivedAt: null,
      archivedSource: null,
      archiveReason: null,
      recoverySubmissionId: submissionId || (session as any).recoverySubmissionId || null,
    };
  }

  private hasRestorableProcessContext(session: any) {
    const metadata = ((session?.metadata || {}) as Record<string, any>) || {};
    return Boolean(
      metadata.currentProcessCode
      || metadata.currentSubmissionId
      || metadata.pendingDraftId
      || metadata.processId,
    );
  }

  private async restoreSubmissionConversation(input: {
    submission: any;
    tenantId: string;
    userId: string;
    existingSession?: any | null;
  }) {
    const now = new Date();
    const retentionWindow = buildChatRetentionWindow(now);
    const formData = (input.submission.formData as Record<string, any>) || {};
    const processStatus = mapSubmissionStatusToChatProcessStatus(
      normalizeSubmissionStatus(input.submission.status, { submitResult: input.submission.submitResult }),
    );
    const processName = input.submission.template?.processName || '当前申请';
    const processCategory = input.submission.template?.processCategory || null;
    const metadata = {
      processId: input.submission.id,
      processType: 'submission',
      currentTemplateId: input.submission.templateId,
      currentProcessCode: input.submission.template?.processCode || null,
      currentProcessName: processName,
      currentProcessCategory: processCategory,
      currentFormData: formData,
      currentSubmissionId: input.submission.id,
      currentOaSubmissionId: input.submission.oaSubmissionId || null,
      processStatus,
      processUpdatedAt: now.toISOString(),
    } as Record<string, any>;

    const session = input.existingSession
      ? await this.prisma.chatSession.update({
          where: { id: input.existingSession.id },
          data: {
            status: 'active',
            archivedAt: null,
            archivedSource: null,
            archiveReason: null,
            recoverySubmissionId: input.submission.id,
            restorableUntil: retentionWindow.restoreExpiresAt,
            retainedUntil: retentionWindow.retainedUntil,
            metadata: metadata as any,
          } as any,
        })
      : await this.prisma.chatSession.create({
          data: {
            tenantId: input.tenantId,
            userId: input.userId,
            status: 'active',
            recoverySubmissionId: input.submission.id,
            restorableUntil: retentionWindow.restoreExpiresAt,
            retainedUntil: retentionWindow.retainedUntil,
            metadata: metadata as any,
          } as any,
        });

    const restoredCard = this.buildProcessCard({
      processInstanceId: input.submission.id,
      processCode: input.submission.template?.processCode || 'unknown_process',
      processName,
      processCategory,
      processStatus,
      template: input.submission.template,
      formData,
      submissionId: input.submission.id,
      oaSubmissionId: input.submission.oaSubmissionId || null,
      actionState: 'readonly',
      canContinue: requiresUserAction(processStatus),
    });

    await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: `已为您恢复“${processName}”的办理对话。`,
        metadata: {
          messageKind: 'process_card',
          processStatus,
          submissionId: input.submission.id,
          oaSubmissionId: input.submission.oaSubmissionId,
          formData,
          processCard: restoredCard as any,
        } as any,
      },
    });

    return this.getMessages(session.id, input.tenantId, input.userId);
  }

  private async restoreDraftConversation(input: {
    draft: any;
    tenantId: string;
    userId: string;
    existingSession?: any | null;
  }) {
    const now = new Date();
    const formData = (input.draft.formData as Record<string, any>) || {};
    const processStatus = input.draft.status === 'ready'
      ? ProcessStatus.PENDING_CONFIRMATION
      : ProcessStatus.PARAMETER_COLLECTION;
    const metadata = {
      processId: input.draft.id,
      processType: 'draft',
      currentTemplateId: input.draft.templateId,
      currentProcessCode: input.draft.template?.processCode || null,
      currentProcessName: input.draft.template?.processName || null,
      currentProcessCategory: input.draft.template?.processCategory || null,
      currentFormData: formData,
      pendingDraftId: input.draft.id,
      processStatus,
      processUpdatedAt: now.toISOString(),
      processCreatedAt: input.draft.createdAt?.toISOString?.() || now.toISOString(),
    } as Record<string, any>;
    const draftSession = input.existingSession
      ? await this.prisma.chatSession.update({
          where: { id: input.existingSession.id },
          data: {
            status: 'active',
            archivedAt: null,
            archivedSource: null,
            archiveReason: null,
            metadata: metadata as any,
          } as any,
        })
      : await this.prisma.chatSession.create({
          data: {
            tenantId: input.tenantId,
            userId: input.userId,
            status: 'active',
            metadata: metadata as any,
          } as any,
        });

    await this.prisma.processDraft.update({
      where: { id: input.draft.id },
      data: {
        sessionId: draftSession.id,
      },
    });

    const restoredCard = this.buildProcessCard({
      processInstanceId: input.draft.id,
      processCode: input.draft.template?.processCode || 'unknown_process',
      processName: input.draft.template?.processName || '流程申请',
      processCategory: input.draft.template?.processCategory || null,
      processStatus,
      template: input.draft.template,
      formData,
      draftId: input.draft.id,
      actionButtons: input.draft.status === 'ready'
        ? [
            { label: '确认提交', action: 'confirm', type: 'primary' },
            { label: '修改内容', action: 'modify', type: 'default' },
            { label: '取消', action: 'cancel', type: 'danger' },
          ]
        : undefined,
      actionState: input.draft.status === 'ready' ? 'available' : 'readonly',
      canContinue: true,
    });

    await this.prisma.chatMessage.create({
      data: {
        sessionId: draftSession.id,
        role: 'assistant',
        content: input.draft.status === 'ready'
          ? `已为您恢复“${input.draft.template?.processName || '当前流程'}”的待确认内容，可继续核对后提交。`
          : `已为您恢复“${input.draft.template?.processName || '当前流程'}”的办理上下文，请继续补充信息。`,
        metadata: {
          messageKind: 'process_card',
          processStatus,
          draftId: input.draft.id,
          formData,
          processCard: restoredCard as any,
          actionButtons: input.draft.status === 'ready'
            ? [
                { label: '确认提交', action: 'confirm', type: 'primary' },
                { label: '修改内容', action: 'modify', type: 'default' },
                { label: '取消', action: 'cancel', type: 'danger' },
              ]
            : undefined,
        } as any,
      },
    });

    return this.getMessages(draftSession.id, input.tenantId, input.userId);
  }

  private normalizeFieldOptions(options?: Array<{ label: string; value: string } | string>) {
    if (!Array.isArray(options) || options.length === 0) {
      return [] as Array<{ label: string; value: string }>;
    }

    return options
      .map((option) => {
        if (typeof option === 'string') {
          const trimmed = option.trim();
          return trimmed ? { label: trimmed, value: trimmed } : null;
        }

        const label = String(option?.label || option?.value || '').trim();
        const value = String(option?.value || option?.label || '').trim();
        return label && value ? { label, value } : null;
      })
      .filter((option): option is { label: string; value: string } => Boolean(option));
  }

  private getFieldOriginMeta(origin?: ProcessFieldOrigin) {
    switch (origin) {
      case 'derived':
        return {
          tagLabel: '自动推导',
          tagTone: 'amber' as const,
          hint: '根据已识别的时间或时长自动补全，可直接修改。',
        };
      case 'prefill':
        return {
          tagLabel: '系统带出',
          tagTone: 'slate' as const,
          hint: '根据您的账号资料或默认设置自动补全。',
        };
      default:
        return null;
    }
  }

  private buildConfirmationSummary(
    processName: string,
    fieldOrigins: Record<string, ProcessFieldOrigin>,
  ) {
    const originList = Object.values(fieldOrigins);
    const derivedCount = originList.filter((origin) => origin === 'derived').length;
    const prefillCount = originList.filter((origin) => origin === 'prefill').length;
    const notes: string[] = [];

    if (derivedCount > 0) {
      notes.push(`${derivedCount}项为自动推导`);
    }
    if (prefillCount > 0) {
      notes.push(`${prefillCount}项为系统带出`);
    }

    if (notes.length === 0) {
      return `已为您整理好“${processName}”，请逐项核对后再提交。`;
    }

    return `已为您整理好“${processName}”，其中${notes.join('，')}，如需修改可直接告诉我。`;
  }

  private async inferAttachmentTargetFieldKey(input: {
    attachment: {
      fileName?: string | null;
      mimeType?: string | null;
    };
    fileFields: any[];
    missingFileFieldKeys: Set<string>;
    currentFormData: Record<string, any>;
    userMessage: string;
    processCode: string;
  }) {
    const candidates = input.fileFields
      .filter((field) => field && typeof field === 'object')
      .map((field) => ({
        fieldKey: String(field.key || '').trim(),
        label: String(field.label || field.key || '').trim(),
        description: typeof field.description === 'string' ? field.description.trim() : undefined,
        example: typeof field.example === 'string' ? field.example.trim() : undefined,
        required: Boolean(field.required),
        missing: input.missingFileFieldKeys.has(String(field.key || '').trim()),
        multiple: field.multiple === true,
        currentAttachmentCount: Array.isArray(input.currentFormData[String(field.key || '').trim()])
          ? input.currentFormData[String(field.key || '').trim()].length
          : 0,
      }))
      .filter((candidate) => candidate.fieldKey && candidate.label);

    if (candidates.length === 0) {
      return null;
    }

    const judgement = await this.attachmentFieldBindingInference.infer({
      userMessage: input.userMessage,
      attachment: {
        fileName: input.attachment.fileName,
        mimeType: input.attachment.mimeType,
      },
      candidates,
      trace: {
        scope: 'assistant.attachment_field_binding',
        metadata: {
          processCode: input.processCode,
          attachmentFileName: input.attachment.fileName || null,
        },
      },
    });

    return judgement.canResolve && judgement.matchedFieldKey
      ? judgement.matchedFieldKey
      : null;
  }

  private resolveDisplayProcessName(
    session: any,
    fallbackName?: string | null,
    fallbackCode?: string | null,
  ) {
    const metadata = ((session?.metadata || {}) as Record<string, any>) || {};
    const sessionName = typeof metadata.currentProcessName === 'string'
      ? metadata.currentProcessName.trim()
      : '';
    if (sessionName) {
      return sessionName;
    }

    const normalizedFallbackName = typeof fallbackName === 'string'
      ? fallbackName.trim()
      : '';
    if (normalizedFallbackName) {
      return normalizedFallbackName;
    }

    const normalizedFallbackCode = typeof fallbackCode === 'string'
      ? fallbackCode.trim()
      : '';
    return normalizedFallbackCode || '流程申请';
  }
}
