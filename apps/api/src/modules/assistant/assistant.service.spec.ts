import { ChatIntent } from '@uniflow/shared-types';
import { AssistantService } from './assistant.service';
import { ChatProcessStatus } from '../common/chat-process-state';

describe('AssistantService', () => {
  let service: AssistantService;
  let prisma: any;
  let intentAgent: any;
  let flowAgent: any;
  let formAgent: any;
  let connectorRouter: any;
  let permissionService: any;
  let auditService: any;
  let processLibraryService: any;
  let submissionService: any;
  let taskPlanAgent: any;
  let attachmentService: any;
  let attachmentBindingService: any;
  let tenantUserResolver: any;
  let authBindingService: any;

  const sharedContext = {
    userId: 'user-1',
    profile: {
      employeeId: 'user-1',
      name: '测试用户',
    },
    preferences: {
      defaultApprover: undefined,
      defaultCC: [],
      language: 'zh-CN',
    },
    history: {
      recentRequests: [],
      frequentTypes: [],
    },
  };

  beforeEach(() => {
    prisma = {
      chatSession: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      processTemplate: {
        findFirst: jest.fn(),
      },
      processDraft: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      connector: {
        findFirst: jest.fn(),
      },
      submission: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    intentAgent = {
      detectIntent: jest.fn(),
    };
    flowAgent = {
      matchFlow: jest.fn(),
    };
    formAgent = {
      extractFields: jest.fn(),
      extractModifications: jest.fn().mockResolvedValue({
        modifiedFields: {},
        fieldOrigins: {},
      }),
      normalizeDirectFieldValue: jest.fn(),
    };
    connectorRouter = {
      route: jest.fn(),
    };
    permissionService = {
      check: jest.fn(),
    };
    auditService = {
      createLog: jest.fn().mockResolvedValue(undefined),
      generateTraceId: jest.fn().mockReturnValue('trace-1'),
    };
    processLibraryService = {
      list: jest.fn(),
      getByCode: jest.fn(),
      getById: jest.fn(),
    };
    submissionService = {
      submit: jest.fn(),
      listSubmissions: jest.fn(),
      getSubmission: jest.fn(),
    };
    taskPlanAgent = {
      buildSubmitTaskPacketFromDraft: jest.fn(),
    };
    attachmentService = {
      normalizeAttachmentRefs: jest.fn(),
      prepareSubmissionPayload: jest.fn(),
    };
    attachmentBindingService = {
      syncDraftBindings: jest.fn(),
      syncSubmissionBindings: jest.fn(),
      bindSessionAttachments: jest.fn(),
    };
    tenantUserResolver = {
      resolve: jest.fn(),
    };
    authBindingService = {
      getBindingStatus: jest.fn(),
    };

    service = new AssistantService(
      prisma,
      intentAgent,
      flowAgent,
      formAgent,
      connectorRouter,
      permissionService,
      auditService,
      processLibraryService,
      submissionService,
      taskPlanAgent,
      attachmentService,
      attachmentBindingService,
      tenantUserResolver,
      authBindingService,
    );
  });

  it('resolves the matched flow before asking for connector selection when only one connector publishes that flow', async () => {
    processLibraryService.list.mockResolvedValue([
      {
        id: 'flow-leave',
        processCode: 'leave_request',
        processName: '请假申请',
        processCategory: '人事',
        connector: {
          id: 'connector-leave',
          name: '网信处',
          oaType: 'hybrid',
          oclLevel: 'OCL2',
        },
      },
      {
        id: 'flow-purchase',
        processCode: 'purchase_request',
        processName: '采购申请',
        processCategory: '采购',
        connector: {
          id: 'connector-purchase',
          name: '教务处',
          oaType: 'hybrid',
          oclLevel: 'OCL2',
        },
      },
    ]);
    flowAgent.matchFlow.mockResolvedValue({
      matchedFlow: {
        processCode: 'leave_request',
        processName: '请假申请',
        confidence: 0.96,
      },
      needsClarification: false,
    });

    const resolution = await (service as any).resolveSubmissionTarget(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '我要请假，明天开始',
      },
      {
        id: 'session-1',
        metadata: {},
      },
      {
        intent: ChatIntent.CREATE_SUBMISSION,
        extractedEntities: {},
      },
    );

    expect(resolution.matchedFlow).toEqual({
      processCode: 'leave_request',
      processName: '请假申请',
      confidence: 0.96,
    });
    expect(resolution.connectorId).toBe('connector-leave');
    expect(resolution.connectorName).toBe('网信处');
    expect(resolution.needsConnectorSelection).toBe(false);
    expect(resolution.needsFlowClarification).toBe(false);
    expect(connectorRouter.route).not.toHaveBeenCalled();
  });

  it('prefers the explicitly requested template when duplicate process codes exist across connectors', async () => {
    processLibraryService.list.mockResolvedValue([
      {
        id: 'template-old',
        processCode: 'flow_dup',
        processName: '请假申请',
        processCategory: '人事',
        connector: {
          id: 'connector-old',
          name: '旧OA',
          oaType: 'form-page',
          oclLevel: 'OCL0',
        },
      },
      {
        id: 'template-new',
        processCode: 'flow_dup',
        processName: '请假申请',
        processCategory: 'direct_link',
        connector: {
          id: 'connector-new',
          name: '新OA',
          oaType: 'form-page',
          oclLevel: 'OCL0',
        },
      },
    ]);

    const resolution = await (service as any).resolveSubmissionTarget(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '我要办理请假申请',
      },
      {
        id: 'session-1',
        metadata: {
          requestedTemplateId: 'template-new',
          routedConnectorId: 'connector-new',
        },
      },
      {
        intent: ChatIntent.CREATE_SUBMISSION,
        extractedEntities: {},
      },
    );

    expect(resolution.matchedFlow).toEqual({
      processCode: 'flow_dup',
      processName: '请假申请',
      confidence: 1,
    });
    expect(resolution.connectorId).toBe('connector-new');
    expect(resolution.connectorName).toBe('新OA');
    expect(resolution.flows).toHaveLength(1);
    expect(resolution.flows[0].id).toBe('template-new');
    expect(flowAgent.matchFlow).not.toHaveBeenCalled();
    expect(connectorRouter.route).not.toHaveBeenCalled();
  });

  it('turns a natural leave request into missing-field collection instead of asking for flow or connector clarification', async () => {
    processLibraryService.list.mockResolvedValue([
      {
        id: 'flow-leave',
        processCode: 'leave_request',
        processName: '请假申请',
        processCategory: '人事',
        connector: {
          id: 'connector-leave',
          name: '网信处',
          oaType: 'hybrid',
          oclLevel: 'OCL2',
        },
      },
      {
        id: 'flow-purchase',
        processCode: 'purchase_request',
        processName: '采购申请',
        processCategory: '采购',
        connector: {
          id: 'connector-purchase',
          name: '教务处',
          oaType: 'hybrid',
          oclLevel: 'OCL2',
        },
      },
    ]);
    flowAgent.matchFlow.mockResolvedValue({
      matchedFlow: {
        processCode: 'leave_request',
        processName: '请假申请',
        confidence: 0.95,
      },
      needsClarification: false,
    });
    permissionService.check.mockResolvedValue({
      allowed: true,
    });
    prisma.processTemplate.findFirst.mockResolvedValue({
      id: 'template-leave-1',
      tenantId: 'tenant-1',
      connectorId: 'connector-leave',
      processCode: 'leave_request',
      processName: '请假申请',
      processCategory: '人事',
      status: 'published',
      version: 1,
      schema: {
        fields: [
          { key: 'field_1', label: '开始日期', type: 'date', required: true },
          { key: 'field_2', label: '结束日期', type: 'date', required: true },
          { key: 'field_3', label: '请假类型', type: 'text', required: true },
          { key: 'field_4', label: '请假原因', type: 'textarea', required: true },
          { key: 'field_5', label: '请假事由', type: 'textarea', required: true },
          { key: 'field_6', label: '外出地点', type: 'text', required: true },
          { key: 'field_7', label: '外出通讯方式', type: 'text', required: true },
          { key: 'field_8', label: '请假时间', type: 'text', required: true },
        ],
      },
      connector: {
        id: 'connector-leave',
        name: '网信处',
        authConfig: {},
      },
    });
    formAgent.extractFields.mockResolvedValue({
      extractedFields: {
        field_1: '2026-04-16',
        field_2: '2026-04-18',
        field_3: '事假',
        field_4: '去北京出差',
        field_6: '北京',
        field_7: '13800138000',
      },
      fieldOrigins: {
        field_1: 'user',
        field_2: 'derived',
        field_3: 'user',
        field_4: 'user',
        field_6: 'user',
        field_7: 'user',
      },
      missingFields: [
        {
          key: 'field_5',
          label: '请假事由',
          question: '请简要说明一下请假的具体事由。',
          type: 'textarea',
        },
        {
          key: 'field_8',
          label: '请假时间',
          question: '请说明一下具体的请假时间（例如：全天、上午、下午等）。',
          type: 'text',
        },
      ],
      isComplete: false,
    });

    const response = await (service as any).handleCreateSubmission(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '我要请假，明天开始，请假三天，事假，去北京出差，联系电话13800138000',
      },
      {
        id: 'session-1',
        metadata: {},
      },
      {
        intent: ChatIntent.CREATE_SUBMISSION,
        extractedEntities: {},
      },
      sharedContext,
      'trace-1',
    );

    expect(response.needsInput).toBe(true);
    expect(response.processStatus).toBe(ChatProcessStatus.PARAMETER_COLLECTION);
    expect(response.message).toContain('还差 2 项信息');
    expect(response.message).not.toContain('请问您想办理哪个流程');
    expect(response.message).not.toContain('请选择要使用的系统');
    expect(response.missingFields).toEqual([
      expect.objectContaining({ key: 'field_5', label: '请假事由' }),
      expect.objectContaining({ key: 'field_8', label: '请假时间' }),
    ]);
    expect(prisma.chatSession.update).toHaveBeenCalled();
    expect(formAgent.extractFields).toHaveBeenCalledWith(
      'leave_request',
      expect.any(Object),
      '我要请假，明天开始，请假三天，事假，去北京出差，联系电话13800138000',
      {},
    );
  });

  it('asks the user to choose when multiple similar flows exist instead of guessing one', async () => {
    processLibraryService.list.mockResolvedValue([
      {
        id: 'flow-staff-leave',
        processCode: 'staff_leave_request',
        processName: '网信处科员请假',
        processCategory: '人事',
        connector: {
          id: 'connector-leave',
          name: '网信处',
          oaType: 'hybrid',
          oclLevel: 'OCL2',
        },
      },
      {
        id: 'flow-director-leave',
        processCode: 'director_leave_request',
        processName: '网信处处长请假',
        processCategory: '人事',
        connector: {
          id: 'connector-leave',
          name: '网信处',
          oaType: 'hybrid',
          oclLevel: 'OCL2',
        },
      },
    ]);
    flowAgent.matchFlow.mockResolvedValue({
      matchedFlow: undefined,
      candidateFlows: [
        { processCode: 'staff_leave_request', processName: '网信处科员请假' },
        { processCode: 'director_leave_request', processName: '网信处处长请假' },
      ],
      needsClarification: true,
      clarificationQuestion: '您是要办理“网信处科员请假”还是“网信处处长请假”？',
    });

    const session = {
      id: 'session-ambiguity-1',
      metadata: {},
    };

    const response = await (service as any).handleCreateSubmission(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '我要请假',
      },
      session,
      {
        intent: ChatIntent.CREATE_SUBMISSION,
        extractedEntities: {},
      },
      sharedContext,
      'trace-1',
    );

    expect(response.needsInput).toBe(true);
    expect(response.message).toContain('网信处科员请假');
    expect(response.message).toContain('网信处处长请假');
    expect(prisma.chatSession.update).toHaveBeenCalledWith({
      where: { id: 'session-ambiguity-1' },
      data: {
        metadata: expect.objectContaining({
          pendingFlowSelection: true,
          flowCandidates: [
            { processCode: 'staff_leave_request', processName: '网信处科员请假' },
            { processCode: 'director_leave_request', processName: '网信处处长请假' },
          ],
        }),
      },
    });
    expect(permissionService.check).not.toHaveBeenCalled();
  });

  it('continues the original request after the user selects a connector from a pending connector prompt', async () => {
    const continuation = {
      sessionId: 'session-1',
      message: '继续办理',
      needsInput: true,
    };
    const handleCreateSubmissionSpy = jest
      .spyOn(service as any, 'handleCreateSubmission')
      .mockResolvedValue(continuation);

    const session = {
      id: 'session-1',
      metadata: {
        pendingConnectorSelection: true,
        connectorCandidates: [
          { id: 'connector-a', name: '统一门户' },
          { id: 'connector-b', name: '网信处' },
        ],
        pendingConnectorSelectionContext: {
          originalMessage: '我要请假，明天开始，请假三天',
          processCode: 'leave_request',
          processName: '请假申请',
        },
      },
    };

    const response = await (service as any).tryHandlePendingConnectorSelection(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '2',
      },
      session,
      sharedContext,
      'trace-1',
    );

    expect(response).toBe(continuation);
    expect(prisma.chatSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: {
        metadata: {
          routedConnectorId: 'connector-b',
          routedConnectorName: '网信处',
        },
      },
    });
    expect(handleCreateSubmissionSpy).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '我要请假，明天开始，请假三天',
      },
      session,
      {
        intent: ChatIntent.CREATE_SUBMISSION,
        confidence: 0.9,
        extractedEntities: {
          flowCode: 'leave_request',
        },
      },
      sharedContext,
      'trace-1',
    );
  });

  it('resolves natural-language connector selection through llm understanding', async () => {
    const continuation = {
      sessionId: 'session-1',
      message: '继续办理',
      needsInput: true,
    };
    jest.spyOn(service as any, 'handleCreateSubmission').mockResolvedValue(continuation);
    jest.spyOn(service as any, 'resolvePendingSelectionWithLlm').mockResolvedValue({
      action: 'select',
      candidateId: 'connector-b',
    });

    const session = {
      id: 'session-1',
      metadata: {
        pendingConnectorSelection: true,
        connectorCandidates: [
          { id: 'connector-a', name: '统一门户' },
          { id: 'connector-b', name: '网信处' },
        ],
        pendingConnectorSelectionContext: {
          originalMessage: '我要请假，明天开始，请假三天',
          processCode: 'leave_request',
          processName: '请假申请',
        },
      },
    };

    const response = await (service as any).tryHandlePendingConnectorSelection(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '网信处那个',
      },
      session,
      sharedContext,
      'trace-1',
    );

    expect(response).toBe(continuation);
    expect(prisma.chatSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: {
        metadata: {
          routedConnectorId: 'connector-b',
          routedConnectorName: '网信处',
        },
      },
    });
  });

  it('treats natural-language cancel as pending connector abort through llm understanding', async () => {
    jest.spyOn(service as any, 'resolvePendingSelectionWithLlm').mockResolvedValue({
      action: 'cancel',
    });

    const session = {
      id: 'session-cancel-1',
      metadata: {
        pendingConnectorSelection: true,
        connectorCandidates: [
          { id: 'connector-a', name: '统一门户' },
          { id: 'connector-b', name: '网信处' },
        ],
      },
    };

    const response = await (service as any).tryHandlePendingConnectorSelection(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '算了，不选了',
      },
      session,
      sharedContext,
      'trace-1',
    );

    expect(response).toEqual({
      sessionId: 'session-cancel-1',
      message: '已取消本次系统选择。如需继续办理，请重新告诉我您要办什么。',
      needsInput: false,
    });
  });

  it('auto-binds a general uploaded attachment to the required attachment field during parameter collection', async () => {
    const session = {
      id: 'session-attachment-1',
      userId: 'user-1',
      metadata: {
        currentProcessCode: 'expense_submit',
        currentProcessName: '西安工程大学用印申请单',
        currentConnectorId: 'connector-expense',
        processStatus: ChatProcessStatus.PARAMETER_COLLECTION,
        currentFormData: {},
        missingFields: [
          {
            key: 'field_1',
            label: '文件类型、名称及份数',
            type: 'text',
            question: '请填写文件类型、名称及份数。',
          },
          {
            key: 'field_2',
            label: '用印附件',
            type: 'file',
            question: '请上传用印附件。',
          },
        ],
      },
    };

    const normalizedAttachment = {
      attachmentId: 'attachment-1',
      fileId: 'file-1',
      fileName: 'seal.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      bindScope: 'general' as const,
      fieldKey: null,
    };

    jest.spyOn(service as any, 'getOrCreateSession').mockResolvedValue(session);
    jest.spyOn(service as any, 'loadSharedContext').mockResolvedValue(sharedContext);
    jest.spyOn(service as any, 'tryHandlePendingActionSelection').mockResolvedValue(null);
    jest.spyOn(service as any, 'tryHandlePendingConnectorSelection').mockResolvedValue(null);
    jest.spyOn(service as any, 'tryHandlePendingActionExecution').mockResolvedValue(null);
    jest.spyOn(service as any, 'enrichChatResponse').mockImplementation(async (response: any) => response);
    jest.spyOn(service as any, 'saveAssistantMessage').mockResolvedValue(undefined);
    intentAgent.detectIntent.mockResolvedValue({
      intent: ChatIntent.SERVICE_REQUEST,
      confidence: 0.2,
      extractedEntities: {},
    });

    attachmentService.normalizeAttachmentRefs.mockResolvedValue([normalizedAttachment]);
    prisma.chatMessage = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    prisma.processTemplate.findFirst.mockResolvedValue({
      id: 'template-expense-1',
      tenantId: 'tenant-1',
      processCode: 'expense_submit',
      processName: '西安工程大学用印申请单',
      status: 'published',
      version: 1,
      schema: {
        fields: [
          { key: 'field_1', label: '文件类型、名称及份数', type: 'text', required: true },
          { key: 'field_2', label: '用印附件', type: 'file', required: true },
        ],
      },
      connector: {
        id: 'connector-expense',
        name: 'OA系统',
        authConfig: {},
      },
    });
    formAgent.extractFields.mockResolvedValue({
      extractedFields: {},
      fieldOrigins: {},
      missingFields: [
        {
          key: 'field_1',
          label: '文件类型、名称及份数',
          question: '请填写文件类型、名称及份数。',
          type: 'text',
        },
      ],
      isComplete: false,
    });

    const response = await service.chat({
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'session-attachment-1',
      message: '已上传附件',
      attachments: [normalizedAttachment],
    });

    expect(formAgent.extractFields).toHaveBeenCalledWith(
      'expense_submit',
      expect.any(Object),
      '已上传附件',
      expect.objectContaining({
        field_2: [
          expect.objectContaining({
            fileId: 'file-1',
            fileName: 'seal.pdf',
            fieldKey: 'field_2',
          }),
        ],
      }),
    );
    expect(prisma.chatSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-attachment-1' },
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          currentFormData: expect.objectContaining({
            field_2: [
              expect.objectContaining({
                fileId: 'file-1',
                fileName: 'seal.pdf',
                fieldKey: 'field_2',
              }),
            ],
          }),
        }),
      }),
    }));
    expect(response.processStatus).toBe(ChatProcessStatus.PARAMETER_COLLECTION);
  });

  it('binds attachments when the user message explicitly points to one missing file field', async () => {
    const session = {
      id: 'session-attachment-2',
      userId: 'user-1',
      metadata: {
        currentProcessCode: 'reimburse_submit',
        currentProcessName: '报销申请',
        currentConnectorId: 'connector-reimburse',
        processStatus: ChatProcessStatus.PARAMETER_COLLECTION,
        currentFormData: {},
        missingFields: [
          {
            key: 'field_project',
            label: '立项材料',
            type: 'file',
            question: '请上传立项材料。',
          },
          {
            key: 'field_invoice',
            label: '发票附件',
            type: 'file',
            question: '请上传发票附件。',
          },
        ],
      },
    };

    const normalizedAttachment = {
      attachmentId: 'attachment-2',
      fileId: 'file-2',
      fileName: '差旅发票.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      bindScope: 'general' as const,
      fieldKey: null,
    };

    jest.spyOn(service as any, 'getOrCreateSession').mockResolvedValue(session);
    jest.spyOn(service as any, 'loadSharedContext').mockResolvedValue(sharedContext);
    jest.spyOn(service as any, 'tryHandlePendingActionSelection').mockResolvedValue(null);
    jest.spyOn(service as any, 'tryHandlePendingConnectorSelection').mockResolvedValue(null);
    jest.spyOn(service as any, 'tryHandlePendingActionExecution').mockResolvedValue(null);
    jest.spyOn(service as any, 'enrichChatResponse').mockImplementation(async (response: any) => response);
    jest.spyOn(service as any, 'saveAssistantMessage').mockResolvedValue(undefined);
    intentAgent.detectIntent.mockResolvedValue({
      intent: ChatIntent.SERVICE_REQUEST,
      confidence: 0.2,
      extractedEntities: {},
    });

    attachmentService.normalizeAttachmentRefs.mockResolvedValue([normalizedAttachment]);
    prisma.chatMessage = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    prisma.processTemplate.findFirst.mockResolvedValue({
      id: 'template-reimburse-1',
      tenantId: 'tenant-1',
      processCode: 'reimburse_submit',
      processName: '报销申请',
      status: 'published',
      version: 1,
      schema: {
        fields: [
          {
            key: 'field_project',
            label: '立项材料',
            type: 'file',
            required: true,
            description: '上传立项申请书扫描件',
            example: '立项申请书.pdf',
          },
          {
            key: 'field_invoice',
            label: '发票附件',
            type: 'file',
            required: true,
            description: '上传报销发票扫描件',
            example: '发票.pdf',
          },
        ],
      },
      connector: {
        id: 'connector-reimburse',
        name: 'OA系统',
        authConfig: {},
      },
    });
    formAgent.extractFields.mockResolvedValue({
      extractedFields: {},
      fieldOrigins: {},
      missingFields: [
        {
          key: 'field_project',
          label: '立项材料',
          question: '请上传立项材料。',
          type: 'file',
        },
      ],
      isComplete: false,
    });

    await service.chat({
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'session-attachment-2',
      message: '我已上传发票附件',
      attachments: [normalizedAttachment],
    });

    expect(formAgent.extractFields).toHaveBeenCalledWith(
      'reimburse_submit',
      expect.any(Object),
      '我已上传发票附件',
      expect.objectContaining({
        field_invoice: [
          expect.objectContaining({
            fileId: 'file-2',
            fileName: '差旅发票.pdf',
            fieldKey: 'field_invoice',
          }),
        ],
      }),
    );
    expect(prisma.chatSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-attachment-2' },
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          currentFormData: expect.objectContaining({
            field_invoice: [
              expect.objectContaining({
                fileId: 'file-2',
                fileName: '差旅发票.pdf',
                fieldKey: 'field_invoice',
              }),
            ],
          }),
        }),
      }),
    }));
  });

  it('treats conflicting user input during parameter collection as direct field modification before continuing to ask missing fields', async () => {
    const session = {
      id: 'session-modify-1',
      metadata: {
        currentConnectorId: 'connector-leave',
        currentFieldOrigins: {
          field_1: 'user',
        },
      },
    };
    const processContext = {
      processId: 'process-1',
      processType: 'submission',
      processCode: 'leave_request',
      status: ChatProcessStatus.PARAMETER_COLLECTION,
      parameters: {
        field_1: '2026-04-16',
      },
      collectedParams: new Set<string>(['field_1']),
      validationErrors: [],
      createdAt: new Date('2026-04-16T10:00:00.000Z'),
      updatedAt: new Date('2026-04-16T10:00:00.000Z'),
    };
    const template = {
      id: 'template-leave-1',
      tenantId: 'tenant-1',
      connectorId: 'connector-leave',
      processCode: 'leave_request',
      processName: '请假申请',
      processCategory: '人事',
      status: 'published',
      version: 1,
      schema: {
        fields: [
          { key: 'field_1', label: '开始日期', type: 'date', required: true },
          { key: 'field_2', label: '请假原因', type: 'textarea', required: true },
        ],
      },
      connector: {
        id: 'connector-leave',
        name: '网信处',
        authConfig: {},
      },
    };

    jest.spyOn(service as any, 'findTemplateForResolvedFlow').mockResolvedValue(template);
    formAgent.extractModifications.mockResolvedValue({
      modifiedFields: {
        field_1: '2026-04-18',
      },
      fieldOrigins: {
        field_1: 'user',
      },
    });
    formAgent.extractFields.mockResolvedValue({
      extractedFields: {},
      fieldOrigins: {},
      missingFields: [
        {
          key: 'field_2',
          label: '请假原因',
          question: '请告诉我请假原因。',
          type: 'textarea',
        },
      ],
      isComplete: false,
    });

    const response = await (service as any).continueParameterCollection(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '开始日期改成4月18日',
        identityType: 'teacher',
        roles: ['user'],
      },
      session,
      processContext,
      sharedContext,
      'trace-1',
    );

    expect(formAgent.extractModifications).toHaveBeenCalledWith(
      'leave_request',
      template.schema,
      '开始日期改成4月18日',
      processContext.parameters,
    );
    expect(formAgent.extractFields).toHaveBeenCalledWith(
      'leave_request',
      template.schema,
      '开始日期改成4月18日',
      {
        field_1: '2026-04-18',
      },
    );
    expect(response.processStatus).toBe(ChatProcessStatus.PARAMETER_COLLECTION);
    expect(response.message).toContain('已按您的意思更新已填写内容');
    expect(response.formData).toEqual({
      field_1: '2026-04-18',
    });
    expect(prisma.chatSession.update).toHaveBeenCalledWith({
      where: { id: 'session-modify-1' },
      data: {
        metadata: expect.objectContaining({
          currentFormData: {
            field_1: '2026-04-18',
          },
          currentFieldOrigins: {
            field_1: 'user',
          },
        }),
      },
    });
  });

  it('updates the pending confirmation form field in place for inline confirm-card editing', async () => {
    prisma.chatSession.findFirst.mockResolvedValue({
      id: 'session-confirm-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      metadata: {
        currentProcessCode: 'leave_request',
        currentProcessName: '请假申请',
        currentConnectorId: 'connector-leave',
        currentFieldOrigins: {
          field_1: 'user',
        },
        currentFormData: {
          field_1: '2026-04-16',
          field_2: '事假',
        },
        pendingDraftId: 'draft-1',
        processStatus: ChatProcessStatus.PENDING_CONFIRMATION,
      },
    });
    jest.spyOn(service as any, 'findTemplateForResolvedFlow').mockResolvedValue({
      id: 'template-leave-1',
      processCode: 'leave_request',
      processName: '请假申请',
      schema: {
        fields: [
          { key: 'field_1', label: '开始日期', type: 'date', required: true },
          { key: 'field_2', label: '请假类型', type: 'select', required: true, options: ['事假', '病假'] },
        ],
      },
    });
    formAgent.normalizeDirectFieldValue.mockReturnValue('2026-04-18');
    jest.spyOn(service, 'getMessages').mockResolvedValue({
      session: {
        id: 'session-confirm-1',
        status: 'active',
        updatedAt: new Date().toISOString(),
        sessionState: null,
      },
      messages: [],
    } as any);

    const response = await service.updatePendingFormField({
      sessionId: 'session-confirm-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      fieldKey: 'field_1',
      value: '4月18日',
      identityType: 'teacher',
      roles: ['user'],
    });

    expect(formAgent.normalizeDirectFieldValue).toHaveBeenCalledWith(
      'leave_request',
      expect.any(Object),
      'field_1',
      '4月18日',
    );
    expect(prisma.chatSession.update).toHaveBeenCalledWith({
      where: { id: 'session-confirm-1' },
      data: {
        metadata: expect.objectContaining({
          currentFormData: {
            field_1: '2026-04-18',
            field_2: '事假',
          },
          currentFieldOrigins: {
            field_1: 'user',
          },
          processStatus: ChatProcessStatus.PENDING_CONFIRMATION,
        }),
      },
    });
    expect(prisma.processDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: {
        formData: {
          field_1: '2026-04-18',
          field_2: '事假',
        },
        status: 'ready',
      },
    });
    expect(response).toEqual({
      session: expect.objectContaining({ id: 'session-confirm-1' }),
      messages: [],
    });
  });

  it('waits for the settled submission status instead of returning the initial pending state', async () => {
    prisma.submission.findUnique
      .mockResolvedValueOnce({
        id: 'submission-1',
        status: 'pending',
        submitResult: null,
        oaSubmissionId: null,
      })
      .mockResolvedValueOnce({
        id: 'submission-1',
        status: 'draft_saved',
        submitResult: {
          metadata: {
            request: {
              completionKind: 'draft',
            },
          },
        },
        oaSubmissionId: null,
      });

    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    const submission = await (service as any).waitForSubmissionSettlement('submission-1', {
      timeoutMs: 1000,
      pollIntervalMs: 10,
    });

    expect(prisma.submission.findUnique).toHaveBeenCalledTimes(2);
    expect(submission).toEqual({
      id: 'submission-1',
      status: 'draft_saved',
      submitResult: {
        metadata: {
          request: {
            completionKind: 'draft',
          },
        },
      },
      oaSubmissionId: null,
    });
  });

  it('returns draft-saved status immediately after URL submission settles to OA draft box', async () => {
    const session = {
      id: 'session-submit-1',
      metadata: {
        pendingDraftId: 'draft-1',
        processId: 'process-1',
        currentProcessSummary: '请确认后提交',
        currentFieldOrigins: {
          field_reason: 'user',
        },
      },
    };
    const processContext = {
      processId: 'process-1',
      processType: 'submission',
      processCode: 'flow_url_1',
      status: ChatProcessStatus.PENDING_CONFIRMATION,
      parameters: {
        field_reason: '测试请假',
      },
      collectedParams: new Set<string>(['field_reason']),
      validationErrors: [],
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
      updatedAt: new Date('2026-04-18T10:00:00.000Z'),
    };
    const draft = {
      id: 'draft-1',
      templateId: 'template-1',
      formData: {
        field_reason: '测试请假',
      },
      template: {
        id: 'template-1',
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        processCode: 'flow_url_1',
        processName: '请假申请',
        processCategory: '人事',
        uiHints: {
          rpaDefinition: {
            runtime: {
              networkSubmit: {
                completionKind: 'draft',
              },
            },
          },
        },
        schema: {
          fields: [
            { key: 'field_reason', label: '请假事由', type: 'textarea', required: true },
          ],
        },
        connector: {
          id: 'connector-1',
          name: '西安工程大学OA系统',
        },
      },
    };

    prisma.processDraft.findUnique = jest.fn().mockResolvedValue(draft);
    prisma.submission.findUnique.mockResolvedValue({
      id: 'submission-1',
      status: 'draft_saved',
      submitResult: {
        metadata: {
          request: {
            completionKind: 'draft',
          },
        },
      },
      oaSubmissionId: null,
    });

    taskPlanAgent.buildSubmitTaskPacketFromDraft.mockResolvedValue({
      needsClarification: false,
      taskPacket: {
        selectedPath: 'url',
        fallbackPolicy: ['url'],
        runtime: {
          idempotencyKey: 'idem-1',
        },
      },
    });
    submissionService.submit.mockResolvedValue({
      submissionId: 'submission-1',
      status: 'pending',
      message: '申请已提交，正在处理中',
    });

    const response = await (service as any).executeSubmission(
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        message: '确认提交',
      },
      session,
      processContext,
      'trace-1',
    );

    expect(response.processStatus).toBe(ChatProcessStatus.DRAFT_SAVED);
    expect(response.message).toContain('写入 OA 待发箱');
    expect(response.processCard).toEqual(expect.objectContaining({
      processStatus: ChatProcessStatus.DRAFT_SAVED,
      statusText: '已保存待发',
      submissionId: 'submission-1',
      draftId: 'draft-1',
    }));
    expect(prisma.chatSession.update).toHaveBeenCalledWith({
      where: { id: 'session-submit-1' },
      data: {
        metadata: expect.objectContaining({
          currentSubmissionId: 'submission-1',
          lastSubmissionStatus: 'draft_saved',
          processStatus: ChatProcessStatus.DRAFT_SAVED,
          selectedDeliveryPath: 'url',
          deliveryFallbackPolicy: ['url'],
        }),
      },
    });
    expect(auditService.createLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'submit_application',
      result: 'success',
      details: expect.objectContaining({
        submissionId: 'submission-1',
        submitStatus: 'draft_saved',
        initialSubmitStatus: 'pending',
      }),
    }));
  });

  it('refreshes the latest tracked process message content when polling reaches a newer terminal status', () => {
    const decorated = (service as any).decorateMessagesForSession(
      {
        id: 'session-1',
        metadata: {
          currentProcessCode: 'flow_url_1',
          processId: 'process-1',
          processStatus: ChatProcessStatus.DRAFT_SAVED,
        },
      },
      [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '申请已受理，正在通过URL通道提交。',
          createdAt: '2026-04-24T10:35:14.000Z',
          metadata: {
            processCard: {
              processInstanceId: 'process-1',
              processCode: 'flow_url_1',
              processName: '科员请假申请',
              processStatus: ChatProcessStatus.EXECUTING,
              statusText: '提交执行中',
              stage: 'executing',
            },
          },
        },
      ],
      {
        hasActiveProcess: false,
        processInstanceId: 'process-1',
        processCode: 'flow_url_1',
        processName: '科员请假申请',
        processStatus: ChatProcessStatus.DRAFT_SAVED,
        stage: 'draft',
        isTerminal: true,
        activeProcessCard: {
          processInstanceId: 'process-1',
          processCode: 'flow_url_1',
          processName: '科员请假申请',
          processStatus: ChatProcessStatus.DRAFT_SAVED,
          stage: 'draft',
          actionState: 'readonly',
          canContinue: false,
          statusText: '已保存待发',
          fields: [],
          submissionId: 'submission-1',
          oaSubmissionId: 'oa-1',
          updatedAt: '2026-04-24T10:36:39.000Z',
        },
      },
    );

    expect(decorated).toEqual([
      expect.objectContaining({
        content: '科员请假申请已保存到 OA 待发箱，尚未正式送审。\n申请编号：oa-1',
        processStatus: ChatProcessStatus.DRAFT_SAVED,
        processCard: expect.objectContaining({
          processStatus: ChatProcessStatus.DRAFT_SAVED,
          statusText: '已保存待发',
          stage: 'draft',
          oaSubmissionId: 'oa-1',
        }),
      }),
    ]);
  });

  it('does not use regex fallback for natural-language confirmation intent when llm is unavailable', async () => {
    const originalFactory = jest.requireActual('@uniflow/agent-kernel').LLMClientFactory;
    const createFromEnvSpy = jest.spyOn(originalFactory, 'createFromEnv').mockReturnValue({
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    } as any);

    const result = await (service as any).detectConfirmIntent(
      '好的，提交吧',
      {
        processCode: 'leave_request',
        parameters: {
          reason: '出差',
        },
      },
    );

    expect(result).toEqual({ action: 'unknown' });
    createFromEnvSpy.mockRestore();
  });

  it('treats only action-token cancel as pending-selection abort', () => {
    expect((service as any).isAbortPendingSelectionMessage('__ACTION_CANCEL__')).toBe(true);
    expect((service as any).isAbortPendingSelectionMessage('__ACTION_CONFIRM__')).toBe(false);
    expect((service as any).isAbortPendingSelectionMessage('__ACTION_CANCEL_EXTRA__')).toBe(false);
  });
});
