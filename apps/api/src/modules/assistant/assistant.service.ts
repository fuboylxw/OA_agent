import { Injectable, Logger } from '@nestjs/common';
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
import { ChatIntent } from '@uniflow/shared-types';
import {
  ACTIVE_SUBMISSION_STATUSES,
  getSubmissionStatusText,
} from '../common/submission-status.util';

interface ChatInput {
  tenantId: string;
  userId: string;
  sessionId?: string;
  message: string;
  attachments?: ChatAttachment[];
}

interface ChatAttachment {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  filePath: string;
}

interface ActionButton {
  label: string;
  action: string; // confirm | cancel | modify
  type: 'primary' | 'default' | 'danger';
}

interface ChatResponse {
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
}

// 流程状态枚举
enum ProcessStatus {
  INITIALIZED = 'initialized',
  PARAMETER_COLLECTION = 'parameter_collection',
  PENDING_CONFIRMATION = 'pending_confirmation',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
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

      // Save user message
      await this.prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'user',
          content: input.message,
          metadata: input.attachments?.length
            ? { attachments: input.attachments as any }
            : undefined,
        },
      });

      // If user sent attachments during parameter collection, store them in form data
      if (input.attachments?.length) {
        const processContext = this.extractProcessContext(session);
        if (processContext && processContext.status === ProcessStatus.PARAMETER_COLLECTION) {
          const currentFormData = { ...processContext.parameters };
          // Find file-type fields that are still missing
          const template = await this.processLibraryService.getByCode(
            input.tenantId,
            processContext.processCode,
          );
          const schema = template.schema as any;
          const fileFields = (schema?.fields || []).filter(
            (f: any) => f.type === 'file' && !currentFormData[f.key],
          );
          if (fileFields.length > 0) {
            currentFormData[fileFields[0].key] = input.attachments;
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
          }
        }
      }

      // Check if we're in the middle of a process
      const processContext = this.extractProcessContext(session);

      let response: ChatResponse;

      // If in parameter collection, check if user wants to switch to a different flow
      if (processContext && processContext.status === ProcessStatus.PARAMETER_COLLECTION) {
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
            // 保存助手回复并返回
            await this.prisma.chatMessage.create({
              data: {
                sessionId: session.id,
                role: 'assistant',
                content: response.message,
                metadata: {
                  processStatus: response.processStatus,
                  draftId: response.draftId,
                  actionButtons: response.actionButtons as any,
                },
              },
            });
            return response;
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
      await this.prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'assistant',
          content: response.message,
          metadata: {
            processStatus: response.processStatus,
            draftId: response.draftId,
            actionButtons: response.actionButtons as any,
          },
        },
      });

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
      await this.rollbackProcess(session, traceId);
      return {
        sessionId: session.id,
        message: '已取消申请。如需重新发起，请告诉我。',
        needsInput: false,
        processStatus: ProcessStatus.CANCELLED,
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
        await this.rollbackProcess(session, traceId);
        return {
          sessionId: session.id,
          message: '已取消申请。如需重新发起，请告诉我。',
          needsInput: false,
          processStatus: ProcessStatus.CANCELLED,
        };

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

      const response = await llmClient.chat(messages);
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

    // 更新会话状态
    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        metadata: {
          ...session.metadata,
          pendingDraftId: draft.id,
          processStatus: ProcessStatus.PENDING_CONFIRMATION,
        },
      },
    });

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

      // 获取草稿
      const draft = await this.prisma.processDraft.findUnique({
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
        draft.formData as Record<string, any>,
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

      // 更新草稿状态
      await this.prisma.processDraft.update({
        where: { id: draft.id },
        data: { status: 'submitted' },
      });

      // 清理会话元数据
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: { metadata: {} },
      });

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
        processStatus: ProcessStatus.COMPLETED,
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

      return {
        sessionId: session.id,
        message: `提交失败：${error.message}\n\n请稍后重试或联系管理员。`,
        needsInput: false,
        suggestedActions: ['重试', '取消'],
        processStatus: ProcessStatus.FAILED,
      };
    }
  }

  // 回滚流程
  private async rollbackProcess(session: any, traceId: string): Promise<void> {
    try {
      // 清理会话元数据中的流程上下文
      await this.prisma.chatSession.update({
        where: { id: session.id },
        data: {
          metadata: {
            processStatus: ProcessStatus.CANCELLED,
          },
        },
      });

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
        processId,
        processType: ChatIntent.CREATE_SUBMISSION,
        currentProcessCode: flowResult.matchedFlow.processCode,
        currentFormData,
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
      const submissionIdMatch = input.message.match(/[A-Z0-9]{10,}/);

      if (submissionIdMatch) {
        const submissionId = submissionIdMatch[0];

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

      return {
        sessionId: session.id,
        message: `请选择要${actionNames[action]}的申请：\n${submissionList}\n\n请回复申请编号。`,
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
      const result = await this.mcpExecutor.executeTool(
        tool.toolName,
        {
          submissionId: submission.oaSubmissionId || submission.id,
          ...submission.formData,
        },
        connector.id,
      );

      this.logger.log(` ${action} action result:`, result);

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

    // Check if user exists, fallback to first available user
    let userId = input.userId;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      const fallbackUser = await this.prisma.user.findFirst({
        where: { tenantId: input.tenantId },
      });
      if (!fallbackUser) {
        throw new Error(`No users found for tenant: ${input.tenantId}`);
      }
      userId = fallbackUser.id;
    }

    return this.prisma.chatSession.create({
      data: {
        tenantId: input.tenantId,
        userId,
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
          select: { content: true, role: true, createdAt: true },
        }),
      ),
    );

    return sessions.map((s, i) => {
      const firstUserMsg = s.messages[0]?.content || '';
      const lastMsg = lastMessages[i];
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
      };
    });
  }

  async getMessages(sessionId: string) {
    return this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
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
}
