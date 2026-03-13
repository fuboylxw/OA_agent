import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { IntentAgent } from './agents/intent.agent';
import { FlowAgent } from './agents/flow.agent';
import { FormAgent } from './agents/form.agent';
import { ConnectorRouter } from './agents/connector-router';
import { PermissionService } from '../permission/permission.service';
import { AuditService } from '../audit/audit.service';
import { ProcessLibraryService } from '../process-library/process-library.service';
import { MCPService } from '../mcp/mcp.service';
import { MCPExecutorService } from '../mcp/mcp-executor.service';
import { SubmissionService } from '../submission/submission.service';
import { AttachmentBindingService } from '../attachment/attachment-binding.service';
import { AttachmentService } from '../attachment/attachment.service';
import { TenantUserResolverService } from '../common/tenant-user-resolver.service';
import { ChatIntent } from '@uniflow/shared-types';
import {
  ACTIVE_SUBMISSION_STATUSES,
  getSubmissionStatusText,
} from '../common/submission-status.util';
import {
  ChatProcessStatus as ProcessStatus,
  ReworkHint,
  isTerminalChatProcessStatus,
  requiresUserAction,
} from '../common/chat-process-state';

interface ChatInput {
  tenantId: string;
  userId: string;
  sessionId?: string;
  message: string;
  attachments?: ChatAttachment[];
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

interface ActionButton {
  label: string;
  action: string; // confirm | cancel | modify
  type: 'primary' | 'default' | 'danger';
}

interface ProcessCardField {
  key: string;
  label: string;
  value: any;
  displayValue: any;
  type: string;
  required?: boolean;
}

type ProcessCardStage =
  | 'collecting'
  | 'confirming'
  | 'executing'
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
  formData?: Record<string, any>;
  fields: ProcessCardField[];
  missingFields?: Array<{ key: string; label: string; question: string; type?: string }>;
  actionButtons?: ActionButton[];
  needsAttachment?: boolean;
  draftId?: string;
  submissionId?: string;
  oaSubmissionId?: string | null;
  reworkHint?: ReworkHint;
  reworkReason?: string | null;
  updatedAt: string;
}

interface SessionState {
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
  missingFields?: Array<{ key: string; label: string; question: string; type?: string }>;
  processStatus?: ProcessStatus;
  needsAttachment?: boolean;
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

type PendingAssistantAction = 'cancel' | 'urge' | 'supplement' | 'delegate';

interface PendingSubmissionSelection {
  submissionId: string;
  oaSubmissionId?: string | null;
  processName?: string;
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

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
    private readonly mcpService: MCPService,
    private readonly mcpExecutor: MCPExecutorService,
    private readonly attachmentService: AttachmentService,
    private readonly attachmentBindingService: AttachmentBindingService,
    private readonly tenantUserResolver: TenantUserResolverService,
  ) {}

  async chat(input: ChatInput): Promise<ChatResponse> {
    const traceId = this.auditService.generateTraceId();

    try {
      // Get or create session (may resolve userId to a valid one)
      const session = await this.getOrCreateSession(input);

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
          const template = await this.processLibraryService.getByCode(
            input.tenantId,
            processContext.processCode,
          );
          const schema = template.schema as any;
          const fileFields = (schema?.fields || []).filter((f: any) => f.type === 'file');
          const fileFieldMap = new Map(fileFields.map((field: any) => [field.key, field]));
            const missingFileFieldKeys = new Set<string>(
              (((session.metadata || {}) as Record<string, any>).missingFields || [])
                .filter((field: any) => field?.type === 'file')
                .map((field: any) => field.key),
            );

          let autoAssignedCount = 0;
          for (const attachment of normalizedAttachments) {
            if (attachment.bindScope === 'general') {
              const currentGeneralAttachments = Array.isArray(currentFormData.attachments)
                ? currentFormData.attachments
                : [];
              currentFormData.attachments = [...currentGeneralAttachments, { ...attachment, bindScope: 'general' }];
              autoAssignedCount += 1;
              continue;
            }

            const explicitFieldKey = attachment.fieldKey && fileFieldMap.has(attachment.fieldKey)
              ? attachment.fieldKey
              : null;

            let targetFieldKey = explicitFieldKey;
            if (!targetFieldKey) {
              if (fileFields.length === 1) {
                targetFieldKey = fileFields[0].key;
              } else if (missingFileFieldKeys.size === 1) {
                targetFieldKey = [...missingFileFieldKeys][0];
              }
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

      // Check if we're in the middle of a process
      const processContext = this.extractProcessContext(session);

      let response: ChatResponse;

      // If in parameter collection, check if user wants to switch to a different flow
      if (
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
          const allFlows = await this.processLibraryService.list(input.tenantId);
          const sessionMeta = (session.metadata || {}) as Record<string, any>;
          const scopedFlows = sessionMeta.routedConnectorId
            ? allFlows.filter(f => f.connector?.id === sessionMeta.routedConnectorId)
            : allFlows;
          const flowResult = await this.flowAgent.matchFlow(
            switchCheck.intent,
            input.message,
            scopedFlows.map(f => ({
              processCode: f.processCode,
              processName: f.processName,
              processCategory: f.processCategory || '',
            })),
          );

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
              message: '抱歉，我没有理解您的意图。您可以尝试：\n- 发起申请（如"我要报销差旅费"）\n- 查询进度（如"我的请假申请到哪了"）\n- 撤回申请\n- 催办\n- 补件\n- 转办',
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
    let processCard = response.processCard;
    if (!processCard && (response.formData || response.processStatus)) {
      const metadata = ((session.metadata || {}) as Record<string, any>) || {};
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
        formData: response.formData,
        missingFields: response.missingFields,
        actionButtons: response.actionButtons,
        needsAttachment: response.needsAttachment,
        draftId: response.draftId || metadata.pendingDraftId,
        reworkHint: (metadata.reworkHint as ReworkHint | undefined) || undefined,
        reworkReason: (metadata.reworkReason as string | undefined) || undefined,
      });
    }

    const sessionState = await this.buildSessionState(session, tenantId);
    return {
      ...response,
      processCard,
      sessionState,
    };
  }

  private async buildSessionState(session: any, tenantId: string): Promise<SessionState> {
    const metadata = ((session.metadata || {}) as Record<string, any>) || {};
    const processCode = metadata.currentProcessCode as string | undefined;
    const processStatus = metadata.processStatus as ProcessStatus | undefined;

    if (!processCode || !processStatus) {
      return { hasActiveProcess: false, activeProcessCard: null };
    }

    const template = await this.findTemplateForProcess(
      tenantId,
      metadata.currentTemplateId,
      processCode,
    );
    const reworkHint = (metadata.reworkHint as ReworkHint | undefined) || undefined;
    const reworkReason = (metadata.reworkReason as string | undefined) || undefined;
    const activeProcessCard = this.buildProcessCard({
      processInstanceId: metadata.processId || metadata.pendingDraftId || session.id,
      processCode,
      processName: metadata.currentProcessName || template?.processName || processCode,
      processCategory: metadata.currentProcessCategory || template?.processCategory || null,
      processStatus,
      template,
      formData: (metadata.currentFormData || {}) as Record<string, any>,
      missingFields: Array.isArray(metadata.missingFields) ? metadata.missingFields : [],
      draftId: metadata.pendingDraftId as string | undefined,
      submissionId: metadata.currentSubmissionId as string | undefined,
      oaSubmissionId: (metadata.currentOaSubmissionId as string | undefined) || null,
      updatedAt: metadata.processUpdatedAt as string | undefined,
      actionState: processStatus === ProcessStatus.PENDING_CONFIRMATION ? 'available' : 'readonly',
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
    formData?: Record<string, any>;
    missingFields?: Array<{ key: string; label: string; question: string; type?: string }>;
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
      case ProcessStatus.PARAMETER_COLLECTION:
        return 'collecting';
      case ProcessStatus.PENDING_CONFIRMATION:
        return 'confirming';
      case ProcessStatus.EXECUTING:
        return 'executing';
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
      case ProcessStatus.PARAMETER_COLLECTION:
        return '待补充信息';
      case ProcessStatus.PENDING_CONFIRMATION:
        return '待确认提交';
      case ProcessStatus.EXECUTING:
        return '提交执行中';
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
      // 获取流程模板
      const template = await this.processLibraryService.getByCode(
        input.tenantId,
        processContext.processCode,
      );

      const schema = template.schema as any;

      // 提取用户输入的字段值
      const formResult = await this.formAgent.extractFields(
        processContext.processCode,
        schema,
        input.message,
        processContext.parameters,
      );

      // 合并表单数据
      const currentFormData = {
        ...processContext.parameters,
        ...formResult.extractedFields,
      };

      // 从共享上下文预填充默认值
      this.prefillFromSharedContext(currentFormData, schema, sharedContext);

      // 更新会话元数据
      const updatedMetadata = {
        ...session.metadata,
        currentFormData,
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
        let message: string;
        if (formResult.missingFields.length === 1) {
          // 只剩一个字段，直接问
          message = formResult.missingFields[0].question;
        } else {
          // 多个字段，编号列出
          const allQuestions = formResult.missingFields
            .map((f, i) => `${i + 1}. ${f.question}`)
            .join('\n');
          message = `还需要以下信息：\n\n${allQuestions}\n\n您可以一次性告诉我，也可以逐个回答。`;
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
        // 如果 LLM 同时提取了修改内容，直接应用修改
        if (confirmIntent.modifications && Object.keys(confirmIntent.modifications).length > 0) {
          return await this.applyModificationsAndReconfirm(
            input, session, processContext, confirmIntent.modifications, traceId,
          );
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
3. modify - 修改内容（如"把日期改成明天"、"金额改为2000"、"请假类型改成年假"）

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
      // LLM 失败时回退到简单规则
      const lower = message.toLowerCase();
      if (/^(确认|提交|是|好|ok|yes|没问题|可以|行|对|嗯)$/i.test(lower)) {
        return { action: 'confirm' };
      }
      if (/^(取消|不|no|算了|不要)$/i.test(lower)) {
        return { action: 'cancel' };
      }
      if (/修改|改|换/.test(lower)) {
        return { action: 'modify' };
      }
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
          processStatus: ProcessStatus.PARAMETER_COLLECTION,
        },
      },
    });
    session.metadata = {
      ...session.metadata,
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
  ): Promise<ChatResponse> {
    // 合并修改
    const updatedFormData = {
      ...processContext.parameters,
      ...modifications,
    };

    // 获取模板用于格式化
    const template = await this.processLibraryService.getByCode(
      input.tenantId,
      processContext.processCode,
    );

    // 更新会话中的表单数据
    const updatedMeta = {
      ...session.metadata,
      currentFormData: updatedFormData,
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
          break;
        case 'applicantName':
        case 'name':
          formData[field.key] = sharedContext.profile.name;
          break;
        case 'department':
          if (sharedContext.profile.department) {
            formData[field.key] = sharedContext.profile.department;
          }
          break;
        case 'approver':
        case 'approverId':
          if (sharedContext.preferences.defaultApprover) {
            formData[field.key] = sharedContext.preferences.defaultApprover;
          }
          break;
        case 'cc':
        case 'ccList':
          if (sharedContext.preferences.defaultCC?.length) {
            formData[field.key] = sharedContext.preferences.defaultCC;
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
          missingFields: [],
          processStatus: ProcessStatus.PENDING_CONFIRMATION,
        },
      },
    });
    session.metadata = {
      ...session.metadata,
      pendingDraftId: draft.id,
      missingFields: [],
      processStatus: ProcessStatus.PENDING_CONFIRMATION,
    };

    const schema = template.schema as any;
    const formattedData = this.formatFormData(formData, schema);

    return {
      sessionId: session.id,
      message: `"${template.processName}"草稿已生成。\n\n表单内容：\n${formattedData}\n\n请确认是否提交，也可以直接告诉我要修改的内容。`,
      intent: ChatIntent.CREATE_SUBMISSION,
      draftId: draft.id,
      needsInput: true,
      formData: formData,
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
    try {
      // 更新流程状态为执行中
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          metadata: {
            ...session.metadata,
            processStatus: ProcessStatus.EXECUTING,
          },
        },
      });
      session.metadata = {
        ...session.metadata,
        processStatus: ProcessStatus.EXECUTING,
      };

      // 获取草稿
      draft = await this.prisma.processDraft.findUnique({
        where: { id: draftId },
        include: { template: true },
      });

      if (!draft) {
        throw new Error('草稿不存在');
      }

      // 获取连接器
      const connector = await this.prisma.connector.findUnique({
        where: { id: draft.template.connectorId },
      });

      if (!connector) {
        throw new Error('连接器不存在');
      }

      const { sanitizedFormData, mcpAttachments } = await this.attachmentService.prepareSubmissionPayload({
        tenantId: input.tenantId,
        userId: input.userId,
        formData: draft.formData as Record<string, any>,
        schema: draft.template.schema as any,
      });

      // 查找提交工具
      const submitTool = await this.mcpService.getToolByCategory(
        connector.id,
        draft.template.processCode,
        'submit',
      );

      let toolName: string;
      if (!submitTool) {
        // 回退：尝试查找任何提交工具
        const allSubmitTools = await this.mcpService.listTools(connector.id, 'submit');
        if (allSubmitTools.length === 0) {
          throw new Error('未找到提交工具');
        }
        toolName = allSubmitTools[0].toolName;
        this.logger.log(` 使用回退提交工具: ${toolName}`);
      } else {
        toolName = submitTool.toolName;
      }

      // 执行MCP工具
      const result = await this.mcpExecutor.executeTool(
        toolName,
        {
          ...sanitizedFormData,
          attachments: mcpAttachments,
        },
        connector.id,
      );

      this.logger.log(` MCP工具执行结果:`, result);

      // 创建提交记录
      const submission = await this.prisma.submission.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          templateId: draft.template.id,
          draftId: draft.id,
          idempotencyKey: `${draft.id}-${Date.now()}`,
          formData: draft.formData,
          status: 'submitted',
          submittedAt: new Date(),
          oaSubmissionId: result.submissionId || result.data?.id || result.data,
        },
      });

      await this.attachmentBindingService.syncSubmissionBindings({
        tenantId: input.tenantId,
        userId: input.userId,
        draftId: draft.id,
        submissionId: submission.id,
        formData: draft.formData as Record<string, any>,
        phase: 'submit',
      });

      // 更新草稿状态
      await this.prisma.processDraft.update({
        where: { id: draft.id },
        data: { status: 'submitted' },
      });

      const submittedMetadata: Record<string, any> = {
        ...((session.metadata || {}) as Record<string, any>),
        currentTemplateId: draft.template.id,
        currentProcessCode: draft.template.processCode,
        currentProcessName: draft.template.processName,
        currentProcessCategory: draft.template.processCategory || null,
        currentFormData: draft.formData as Record<string, any>,
        currentSubmissionId: submission.id,
        currentOaSubmissionId: submission.oaSubmissionId || null,
        lastSubmissionStatus: submission.status,
        processStatus: ProcessStatus.SUBMITTED,
        processUpdatedAt: new Date().toISOString(),
        missingFields: [],
        reworkHint: null,
        reworkReason: null,
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
        },
      });

      return {
        sessionId: session.id,
        message: `申请已提交成功！\n\n申请编号：${submission.oaSubmissionId || submission.id}\n流程：${draft.template.processName}\n\n您可以随时查询申请进度。`,
        needsInput: false,
        suggestedActions: ['查询进度', '发起新申请'],
        processStatus: ProcessStatus.SUBMITTED,
        processCard: this.buildProcessCard({
          processInstanceId: processContext.processId,
          processCode: draft.template.processCode,
          processName: draft.template.processName,
          processCategory: draft.template.processCategory,
          processStatus: ProcessStatus.SUBMITTED,
          template: draft.template,
          formData: draft.formData as Record<string, any>,
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
        details: { error: error.message },
      });

      // 更新流程状态为失败
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          metadata: {
            ...session.metadata,
            processStatus: ProcessStatus.FAILED,
          },
        },
      });
      session.metadata = {
        ...session.metadata,
        processStatus: ProcessStatus.FAILED,
      };

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
          processName: draft?.template?.processName || session.metadata?.currentProcessName || processContext.processCode,
          processCategory: draft?.template?.processCategory || session.metadata?.currentProcessCategory || null,
          processStatus: ProcessStatus.FAILED,
          template: draft?.template,
          formData: (draft?.formData as Record<string, any> | undefined) || processContext.parameters,
          draftId: draft?.id || draftId,
          actionState: 'readonly',
          canContinue: false,
        }),
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
        missingFields: [],
        reworkHint: null,
        reworkReason: null,
      };
      delete metadata.pendingDraftId;

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
      // Step 0: Route to the right connector
      const sessionMeta = (session.metadata || {}) as Record<string, any>;
      const routeResult = await this.connectorRouter.route(
        input.tenantId,
        input.userId,
        input.message,
        sessionMeta.routedConnectorId || null,
      );

      if (routeResult.needsSelection) {
        // Store candidates in session so user can pick by number/name
        await this.prisma.chatSession.update({
          where: { id: session.id },
          data: {
            metadata: {
              ...sessionMeta,
              pendingConnectorSelection: true,
              connectorCandidates: routeResult.candidates,
            },
          },
        });
        return {
          sessionId: session.id,
          message: routeResult.selectionQuestion || '请选择要使用的 OA 系统。',
          needsInput: true,
          suggestedActions: routeResult.candidates?.map(c => c.name),
        };
      }

      // Persist routed connector in session
      if (routeResult.connectorId && routeResult.connectorId !== sessionMeta.routedConnectorId) {
        await this.prisma.chatSession.update({
          where: { id: session.id },
          data: {
            metadata: {
              ...sessionMeta,
              routedConnectorId: routeResult.connectorId,
              routedConnectorName: routeResult.connectorName,
            },
          },
        });
        session.metadata = {
          ...sessionMeta,
          routedConnectorId: routeResult.connectorId,
          routedConnectorName: routeResult.connectorName,
        };
      }

      // Step 1: Get flows scoped to the selected connector only
      const allFlows = await this.processLibraryService.list(input.tenantId);
      const flows = routeResult.connectorId
        ? allFlows.filter(f => f.connector?.id === routeResult.connectorId)
        : allFlows;

      // Match flow (LLM only sees this connector's flows)
      const flowResult = await this.flowAgent.matchFlow(
        intentResult.intent,
        input.message,
        flows.map(f => ({
          processCode: f.processCode,
          processName: f.processName,
          processCategory: f.processCategory || '',
        })),
      );

      if (flowResult.needsClarification || !flowResult.matchedFlow) {
        return {
          sessionId: session.id,
          message: flowResult.clarificationQuestion || '请问您想办理哪个流程？',
          needsInput: true,
          suggestedActions: flows.slice(0, 5).map(f => f.processName),
        };
      }

      // Check permission
      const permResult = await this.permissionService.check({
        tenantId: input.tenantId,
        userId: input.userId,
        processCode: flowResult.matchedFlow.processCode,
        action: 'submit',
        traceId,
      });

      if (!permResult.allowed) {
        return {
          sessionId: session.id,
          message: `抱歉，您没有权限发起"${flowResult.matchedFlow.processName}"。\n原因：${permResult.reason}`,
          needsInput: false,
        };
      }

      // Get template and extract fields
      const template = await this.processLibraryService.getByCode(
        input.tenantId,
        flowResult.matchedFlow.processCode,
      );

      const schema = template.schema as any;
      const formResult = await this.formAgent.extractFields(
        flowResult.matchedFlow.processCode,
        schema,
        input.message,
        {},
      );

      // Merge form data and prefill from shared context
      const currentFormData = { ...formResult.extractedFields };
      this.prefillFromSharedContext(currentFormData, schema, sharedContext);

      // Initialize process context
      const processId = `process_${Date.now()}`;
      const newMetadata = {
        ...((session.metadata || {}) as Record<string, any>),
        processId,
        processType: ChatIntent.CREATE_SUBMISSION,
        currentTemplateId: template.id,
        currentProcessCode: flowResult.matchedFlow.processCode,
        currentProcessName: flowResult.matchedFlow.processName,
        currentProcessCategory: template.processCategory || null,
        currentFormData,
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

      // Log process initialization
      await this.auditService.createLog({
        tenantId: input.tenantId,
        traceId,
        userId: input.userId,
        action: 'process_initialized',
        result: 'success',
        details: {
          processId,
          processCode: flowResult.matchedFlow.processCode,
          extractedFields: Object.keys(currentFormData),
        },
      });

      if (!formResult.isComplete) {
        const hasFileField = formResult.missingFields.some(f => f.type === 'file');
        // 一次性列出所有缺失字段，让用户可以一次性提供
        const allQuestions = formResult.missingFields
          .map((f, i) => `${i + 1}. ${f.question}`)
          .join('\n');
        return {
          sessionId: session.id,
          message: `正在为您填写"${flowResult.matchedFlow.processName}"，还需要以下信息：\n\n${allQuestions}\n\n您可以一次性告诉我，也可以逐个回答。`,
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
      )).slice(0, 5);

      if (submissions.length === 0) {
        return {
          sessionId: session.id,
          message: '您目前没有进行中的申请。',
          needsInput: false,
          suggestedActions: ['发起新申请', '查看流程列表'],
        };
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
  ): Promise<ChatResponse> {
    const actionNames: Record<string, string> = {
      cancel: '撤回',
      urge: '催办',
      supplement: '补件',
      delegate: '转办',
    };

    try {
      // 获取连接器
      const connector = await this.prisma.connector.findUnique({
        where: { id: submission.template.connectorId },
      });

      if (!connector) {
        throw new Error('连接器不存在');
      }

      // 查找对应的MCP工具
      const tool = await this.mcpService.getToolByCategory(
        connector.id,
        submission.template.processCode,
        action,
      );

      if (!tool) {
        return {
          sessionId: session.id,
          message: `该流程暂不支持${actionNames[action]}操作。`,
          needsInput: false,
        };
      }

      // 执行MCP工具
      const externalSubmissionId = submission.oaSubmissionId || submission.id;
      const result = await this.mcpExecutor.executeTool(
        tool.toolName,
        {
          submissionId: externalSubmissionId,
          applicationId: externalSubmissionId,
          oaSubmissionId: externalSubmissionId,
          ...submission.formData,
        },
        connector.id,
      );

      this.logger.log(` ${action} action result:`, result);

      if (action === 'cancel') {
        await this.prisma.submission.update({
          where: { id: submission.id },
          data: {
            status: 'cancelled',
          },
        });
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
          actionResult: result,
        },
      });

      return {
        sessionId: session.id,
        message: `${actionNames[action]}操作已成功执行！\n\n申请：${submission.template.processName}\n编号：${submission.oaSubmissionId || submission.id}`,
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

    if (this.isAbortPendingSelectionMessage(input.message)) {
      await this.clearPendingActionSelection(session);
      return {
        sessionId: session.id,
        message: `已取消本次${this.getActionDisplayName(pendingAction)}操作。`,
        needsInput: false,
      };
    }

    if (!this.isSelectionLikeInput(input.message)) {
      await this.clearPendingActionSelection(session);
      return null;
    }

    const selected = this.resolvePendingSubmissionSelection(input.message, candidates);
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

    await this.clearPendingActionSelection(session);
    return this.executeAction(input, session, submission, pendingAction, traceId);
  }

  private async handleServiceRequest(
    input: ChatInput,
    session: any,
    traceId: string,
  ): Promise<ChatResponse> {
    try {
      const flows = await this.processLibraryService.list(input.tenantId);

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
      if (existing) return existing;
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

  async listSessions(tenantId: string, userId: string) {
    const sessions = await this.prisma.chatSession.findMany({
      where: { tenantId, userId },
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
      return {
        id: s.id,
        title: firstUserMsg.length > 30 ? firstUserMsg.substring(0, 30) + '...' : firstUserMsg || '新对话',
        lastMessage: lastMsg?.role === 'user'
          ? lastMsg.content.substring(0, 50)
          : (lastMsg?.content || '').substring(0, 50),
        messageCount: s._count.messages,
        status: s.status,
        timestamp: s.updatedAt,
        createdAt: s.createdAt,
        hasActiveProcess: sessionState.hasActiveProcess,
        processName: sessionState.processName || lastProcessCard?.processName || null,
        processStatus: sessionState.processStatus || lastMeta.processStatus || null,
        processStage: sessionState.stage || lastProcessCard?.stage || null,
        reworkHint: sessionState.reworkHint || lastProcessCard?.reworkHint || null,
      };
    });
  }

  async getMessages(sessionId: string) {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
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

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      return;
    }

    const metadata = ((session.metadata || {}) as Record<string, any>) || {};
    const processStatus = metadata.processStatus as ProcessStatus | undefined;
    if (processStatus && !isTerminalChatProcessStatus(processStatus)) {
      throw new BadRequestException('当前流程未结束，请继续办理或等待审批完成后再删除会话');
    }

    // Delete all messages first
    await this.prisma.chatMessage.deleteMany({
      where: { sessionId },
    });

    // Delete the session
    await this.prisma.chatSession.delete({
      where: { id: sessionId },
    });

    this.logger.log(` Session deleted: ${sessionId}`);
  }

  async resetSession(sessionId: string): Promise<void> {
    // Clear session metadata (process context)
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        metadata: {},
        status: 'active',
      },
    });

    this.logger.log(` Session reset: ${sessionId}`);
  }

  private parsePendingAction(action: unknown): PendingAssistantAction | null {
    if (action === 'cancel' || action === 'urge' || action === 'supplement' || action === 'delegate') {
      return action;
    }
    return null;
  }

  private getActionDisplayName(action: string) {
    const actionNames: Record<string, string> = {
      cancel: '撤回',
      urge: '催办',
      supplement: '补件',
      delegate: '转办',
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
    return /^(取消|算了|不用了|不需要了)$/i.test(trimmed);
  }

  private resolvePendingSubmissionSelection(
    message: string,
    candidates: PendingSubmissionSelection[],
  ) {
    const trimmed = message.trim();

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
          content: message.content,
          createdAt: message.createdAt,
          messageKind: processCard ? 'process_card' : (messageMeta.messageKind || 'text'),
          attachments: message.role === 'user' ? messageMeta.attachments : undefined,
          actionButtons: actionAvailable ? messageMeta.actionButtons : undefined,
          formData: messageMeta.formData,
          processStatus: processCard?.processStatus || messageMeta.processStatus,
          needsAttachment: messageMeta.needsAttachment,
          missingFields: messageMeta.missingFields,
          processCard,
        };
      });
  }

  private formatFormData(formData: Record<string, any>, schema: any): string {
    const fields = schema?.fields || [];
    return Object.entries(formData)
      .map(([key, value]) => {
        const field = fields.find((f: any) => f.key === key);
        const label = field?.label || key;
        // 文件类型字段显示文件名列表
        if (Array.isArray(value) && value.length > 0 && value[0]?.fileName) {
          const fileNames = value.map((f: any) => f.fileName).join('、');
          return `  ${label}: ${fileNames}`;
        }
        return `  ${label}: ${value}`;
      })
      .join('\n');
  }

  private buildFormDataWithLabels(
    formData: Record<string, any>,
    template: any | null | undefined,
  ): ProcessCardField[] {
    const schema = template?.schema as any;
    const fields: any[] = schema?.fields || [];

    return Object.entries(formData).map(([key, value]) => {
      const field = fields.find((item: any) => item.key === key);
      let displayValue = value;

      if (Array.isArray(value) && value.length > 0 && value[0]?.fileName) {
        displayValue = value.map((file: any) => file.fileName).join('、');
      } else if (field?.options && Array.isArray(field.options)) {
        if (Array.isArray(value)) {
          displayValue = value
            .map((item) => {
              const option = field.options.find((candidate: any) => candidate.value === item);
              return option?.label || item;
            })
            .join('、');
        } else {
          const option = field.options.find((candidate: any) => candidate.value === value);
          if (option) {
            displayValue = option.label;
          }
        }
      }

      return {
        key,
        label: field?.label || key,
        value,
        displayValue,
        type: field?.type || 'text',
        required: Boolean(field?.required),
      };
    });
  }
}
