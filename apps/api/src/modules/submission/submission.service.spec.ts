import { SubmissionService } from './submission.service';

describe('SubmissionService', () => {
  const flushBackgroundRefresh = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  const createService = () => {
    const prisma = {
      submission: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      processDraft: {
        findMany: jest.fn(),
      },
      processTemplate: {
        findMany: jest.fn(),
      },
      submissionEvent: {
        create: jest.fn(),
      },
      submissionStatus: {
        create: jest.fn(),
      },
    };
    const auditService = {
      createLog: jest.fn(),
    };
    const ruleService = {
      checkRules: jest.fn(),
    };
    const permissionService = {
      check: jest.fn(),
    };
    const processLibraryService = {};
    const adapterRuntimeService = {
      createAdapterForConnector: jest.fn(),
    };
    const deliveryOrchestrator = {
      submit: jest.fn(),
      queryStatus: jest.fn(),
    };
    const chatSessionProcessService = {
      syncSubmissionStatusToSession: jest.fn(),
    };
    const attachmentService = {
      prepareSubmissionPayload: jest.fn(),
    };
    const attachmentBindingService = {
      syncSubmissionBindings: jest.fn(),
    };
    const submitQueue = {
      add: jest.fn(),
    };

    return {
      service: new SubmissionService(
        prisma as any,
        auditService as any,
        ruleService as any,
        permissionService as any,
        processLibraryService as any,
        adapterRuntimeService as any,
        deliveryOrchestrator as any,
        chatSessionProcessService as any,
        attachmentService as any,
        attachmentBindingService as any,
        submitQueue as any,
      ),
      prisma,
      adapterRuntimeService,
      chatSessionProcessService,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps submitted workbench items unchanged when status query is not configured', async () => {
    const { service, prisma, adapterRuntimeService, chatSessionProcessService } = createService();
    const queryStatus = jest.fn().mockResolvedValue({
      status: 'error',
      statusDetail: {
        error: 'No RPA status query flow configured',
      },
    });

    prisma.submission.findMany.mockResolvedValue([
      {
        id: 'submission-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        templateId: 'template-1',
        oaSubmissionId: 'oa-123',
        status: 'submitted',
        formData: { reason: 'annual leave' },
        submittedAt: new Date('2026-03-09T09:01:00.000Z'),
        createdAt: new Date('2026-03-09T09:00:00.000Z'),
        user: {
          id: 'user-1',
          username: 'testuser',
          displayName: 'Test User',
        },
      },
    ]);
    prisma.processTemplate.findMany.mockResolvedValue([
      {
        id: 'template-1',
        connectorId: 'connector-1',
        processCode: 'leave_request',
        processName: 'Leave Request',
        processCategory: 'HR',
        schema: { fields: [] },
      },
    ]);
    adapterRuntimeService.createAdapterForConnector.mockResolvedValue({
      queryStatus,
    });
    prisma.processDraft.findMany.mockResolvedValue([]);

    const result = await service.listSubmissions('tenant-1', 'user-1');
    await flushBackgroundRefresh();

    expect(queryStatus).toHaveBeenCalledWith('oa-123');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'submission-1',
        sourceType: 'submission',
        status: 'submitted',
        statusText: expect.any(String),
      }),
    ]);
    expect(prisma.submissionEvent.create).not.toHaveBeenCalled();
    expect(prisma.submissionStatus.create).not.toHaveBeenCalled();
    expect(prisma.submission.update).not.toHaveBeenCalled();
    expect(chatSessionProcessService.syncSubmissionStatusToSession).not.toHaveBeenCalled();
  });

  it('filters internal synthetic submission ids when normalizing OA submission ids', async () => {
    const { service } = createService();

    expect((service as any).normalizeOaSubmissionId('VISION-LEAVE_REQUEST-123')).toBeUndefined();
    expect((service as any).normalizeOaSubmissionId('RPA-LEAVE_REQUEST-123')).toBeUndefined();
    expect((service as any).normalizeOaSubmissionId('OA-REAL-123')).toBe('OA-REAL-123');
    expect((service as any).normalizeOaSubmissionId(10086)).toBe('10086');
  });

  it('normalizes historical pending draft-save submissions when listing records', async () => {
    const { service, prisma, adapterRuntimeService } = createService();

    prisma.submission.findMany.mockResolvedValue([
      {
        id: 'submission-draft-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        templateId: 'template-1',
        oaSubmissionId: null,
        status: 'pending',
        submitResult: {
          metadata: {
            request: {
              completionKind: 'draft',
            },
          },
        },
        formData: { reason: 'seal' },
        submittedAt: null,
        createdAt: new Date('2026-04-17T16:42:43.957Z'),
        user: {
          id: 'user-1',
          username: 'testuser',
          displayName: 'Test User',
        },
      },
    ]);
    prisma.processTemplate.findMany.mockResolvedValue([
      {
        id: 'template-1',
        connectorId: 'connector-1',
        processCode: 'seal_apply',
        processName: '用印申请',
        processCategory: '行政',
        schema: { fields: [] },
      },
    ]);
    prisma.processDraft.findMany.mockResolvedValue([]);

    const result = await service.listSubmissions('tenant-1', 'user-1');
    await flushBackgroundRefresh();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'submission-draft-1',
        sourceType: 'submission',
        status: 'draft_saved',
        statusText: '已保存待发',
      }),
    ]);
    expect(adapterRuntimeService.createAdapterForConnector).not.toHaveBeenCalled();
  });

  it('includes standalone drafts in the workbench list', async () => {
    const { service, prisma, adapterRuntimeService } = createService();

    prisma.submission.findMany.mockResolvedValue([]);
    prisma.processTemplate.findMany.mockResolvedValue([]);
    prisma.processDraft.findMany.mockResolvedValue([
      {
        id: 'draft-ready-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        templateId: 'template-1',
        sessionId: 'session-2',
        formData: { reason: '待确认' },
        status: 'ready',
        createdAt: new Date('2026-04-18T11:00:00.000Z'),
        updatedAt: new Date('2026-04-18T11:10:00.000Z'),
        template: {
          id: 'template-1',
          processCode: 'seal_apply',
          processName: '用印申请',
          processCategory: '行政',
          schema: { fields: [] },
        },
      },
      {
        id: 'draft-editing-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        templateId: 'template-1',
        sessionId: 'session-1',
        formData: { reason: '补材料' },
        status: 'editing',
        createdAt: new Date('2026-04-18T10:00:00.000Z'),
        updatedAt: new Date('2026-04-18T10:10:00.000Z'),
        template: {
          id: 'template-1',
          processCode: 'seal_apply',
          processName: '用印申请',
          processCategory: '行政',
          schema: { fields: [] },
        },
      },
    ]);

    const result = await service.listSubmissions('tenant-1', 'user-1');
    await flushBackgroundRefresh();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'draft-ready-1',
        sourceType: 'draft',
        draftId: 'draft-ready-1',
        status: 'draft_saved',
        statusText: '待确认提交',
        canRestoreConversation: true,
      }),
      expect.objectContaining({
        id: 'draft-editing-1',
        sourceType: 'draft',
        draftId: 'draft-editing-1',
        status: 'editing',
        statusText: '待补充信息',
        canRestoreConversation: true,
      }),
    ]);
    expect(adapterRuntimeService.createAdapterForConnector).not.toHaveBeenCalled();
  });
});
