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

    const result = await service.listSubmissions('tenant-1', 'user-1');
    await flushBackgroundRefresh();

    expect(queryStatus).toHaveBeenCalledWith('oa-123');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'submission-1',
        status: 'submitted',
        statusText: expect.any(String),
      }),
    ]);
    expect(prisma.submissionEvent.create).not.toHaveBeenCalled();
    expect(prisma.submissionStatus.create).not.toHaveBeenCalled();
    expect(prisma.submission.update).not.toHaveBeenCalled();
    expect(chatSessionProcessService.syncSubmissionStatusToSession).not.toHaveBeenCalled();
  });
});
