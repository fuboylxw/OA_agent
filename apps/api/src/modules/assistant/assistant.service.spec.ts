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
        update: jest.fn().mockResolvedValue(undefined),
      },
      processTemplate: {
        findFirst: jest.fn(),
      },
      processDraft: {
        create: jest.fn(),
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
      extractModifications: jest.fn(),
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
    expect(response.message).toContain('正在为您填写“请假申请”');
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
});
