import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { Prisma } from '@prisma/client';
import { SubmissionService } from './submission.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RuleService } from '../rule/rule.service';
import { PermissionService } from '../permission/permission.service';
import { ProcessLibraryService } from '../process-library/process-library.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';

describe('SubmissionService Integration', () => {
  let service: SubmissionService;

  const mockQueue = {
    add: jest.fn(),
  };

  const mockPrisma = {
    submission: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    processDraft: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    processTemplate: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    submissionEvent: {
      create: jest.fn(),
    },
    submissionStatus: {
      create: jest.fn(),
    },
  };

  const mockAuditService = {
    createLog: jest.fn(),
  };

  const mockRuleService = {
    checkRules: jest.fn(),
  };

  const mockPermissionService = {
    check: jest.fn(),
  };

  const mockProcessLibraryService = {};
  const mockAdapterRuntimeService = {
    createAdapterForConnector: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: RuleService, useValue: mockRuleService },
        { provide: PermissionService, useValue: mockPermissionService },
        { provide: ProcessLibraryService, useValue: mockProcessLibraryService },
        { provide: AdapterRuntimeService, useValue: mockAdapterRuntimeService },
        { provide: getQueueToken('submit'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get(SubmissionService);
  });

  it('creates a submission, persists creation event, updates draft, and enqueues async execution', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue(null);
    mockPrisma.processDraft.findUnique.mockResolvedValue({
      id: 'draft-1',
      templateId: 'template-1',
      formData: {
        amount: 1000,
        reason: 'travel',
      },
      status: 'ready',
      template: {
        id: 'template-1',
        connectorId: 'connector-1',
        processCode: 'travel_expense',
        rules: [],
        connector: {
          id: 'connector-1',
        },
      },
    });
    mockPermissionService.check.mockResolvedValue({
      allowed: true,
    });
    mockRuleService.checkRules.mockResolvedValue({
      valid: true,
      errors: [],
    });
    mockPrisma.submission.create.mockResolvedValue({
      id: 'submission-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      templateId: 'template-1',
      draftId: 'draft-1',
      idempotencyKey: 'idem-1',
      status: 'pending',
    });

    const result = await service.submit({
      tenantId: 'tenant-1',
      userId: 'user-1',
      draftId: 'draft-1',
      idempotencyKey: 'idem-1',
      traceId: 'trace-1',
    });

    expect(result).toEqual({
      submissionId: 'submission-1',
      status: 'pending',
      message: '申请已提交，正在处理中',
    });
    expect(mockPrisma.submission.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        templateId: 'template-1',
        draftId: 'draft-1',
        idempotencyKey: 'idem-1',
        formData: {
          amount: 1000,
          reason: 'travel',
        },
        status: 'pending',
      },
    });
    expect(mockPrisma.submissionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        submissionId: 'submission-1',
        eventType: 'created',
        eventSource: 'internal',
        status: 'pending',
        payload: {
          draftId: 'draft-1',
          processCode: 'travel_expense',
        },
      }),
    });
    expect(mockPrisma.processDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { status: 'submitted' },
    });
    expect(mockQueue.add).toHaveBeenCalledWith('execute', {
      submissionId: 'submission-1',
      connectorId: 'connector-1',
      processCode: 'travel_expense',
      formData: {
        amount: 1000,
        reason: 'travel',
      },
      idempotencyKey: 'idem-1',
    });
  });

  it('returns the existing submission for idempotent requests and skips queueing', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue({
      id: 'submission-1',
      status: 'submitted',
      oaSubmissionId: 'oa-123',
    });

    const result = await service.submit({
      tenantId: 'tenant-1',
      userId: 'user-1',
      draftId: 'draft-1',
      idempotencyKey: 'idem-1',
      traceId: 'trace-2',
    });

    expect(result).toEqual({
      submissionId: 'submission-1',
      status: 'submitted',
      oaSubmissionId: 'oa-123',
      message: '该申请已提交（幂等性检查）',
    });
    expect(mockPrisma.processDraft.findUnique).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockAuditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'submit_idempotent',
        resource: 'submission-1',
      }),
    );
  });

  it('refreshes active submission statuses from OA when listing submissions', async () => {
    mockPrisma.submission.findMany.mockResolvedValue([
      {
        id: 'submission-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        templateId: 'template-1',
        oaSubmissionId: 'oa-123',
        status: 'pending',
        formData: { amount: 1000 },
        submittedAt: new Date('2026-03-09T09:01:00.000Z'),
        createdAt: new Date('2026-03-09T09:00:00.000Z'),
        user: {
          id: 'user-1',
          username: 'testuser',
          displayName: '测试用户',
        },
      },
    ]);
    mockPrisma.processTemplate.findMany.mockResolvedValue([
      {
        id: 'template-1',
        connectorId: 'connector-1',
        processCode: 'expense_claim',
        processName: '报销申请',
        processCategory: '报销',
        schema: {
          fields: [
            {
              key: 'amount',
              label: '金额',
              type: 'number',
            },
          ],
        },
      },
    ]);
    mockAdapterRuntimeService.createAdapterForConnector.mockResolvedValue({
      queryStatus: jest.fn().mockResolvedValue({
        status: 'approved',
        approver: 'manager-1',
      }),
    });

    const result = await service.listSubmissions('tenant-1', 'user-1');

    expect(mockPrisma.submissionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        submissionId: 'submission-1',
        eventType: 'status_list_refreshed',
        eventSource: 'oa_pull',
        status: 'approved',
      }),
    });
    expect(mockPrisma.submissionStatus.create).toHaveBeenCalledWith({
      data: {
        submissionId: 'submission-1',
        status: 'approved',
        statusDetail: {
          status: 'approved',
          approver: 'manager-1',
        },
      },
    });
    expect(mockPrisma.submission.update).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      data: { status: 'approved' },
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: 'submission-1',
        status: 'approved',
        statusText: '已通过',
        processName: '报销申请',
      }),
    ]);
  });

  it('swallows duplicate status refresh events when listing submissions', async () => {
    mockPrisma.submission.findMany.mockResolvedValue([
      {
        id: 'submission-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        templateId: 'template-1',
        oaSubmissionId: 'oa-123',
        status: 'submitted',
        formData: {},
        submittedAt: new Date('2026-03-09T09:01:00.000Z'),
        createdAt: new Date('2026-03-09T09:00:00.000Z'),
        user: {
          id: 'user-1',
          username: 'testuser',
          displayName: '测试用户',
        },
      },
    ]);
    mockPrisma.processTemplate.findMany.mockResolvedValue([
      {
        id: 'template-1',
        connectorId: 'connector-1',
        processCode: 'expense_claim',
        processName: '报销申请',
        processCategory: '报销',
        schema: { fields: [] },
      },
    ]);
    mockAdapterRuntimeService.createAdapterForConnector.mockResolvedValue({
      queryStatus: jest.fn().mockResolvedValue({
        status: 'approved',
        approver: 'manager-1',
      }),
    });
    mockPrisma.submissionEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate submission event', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const result = await service.listSubmissions('tenant-1', 'user-1');

    expect(mockPrisma.submissionStatus.create).not.toHaveBeenCalled();
    expect(mockPrisma.submission.update).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      data: { status: 'approved' },
    });
    expect(result[0]).toEqual(
      expect.objectContaining({
        status: 'approved',
        statusText: '已通过',
      }),
    );
  });
});
