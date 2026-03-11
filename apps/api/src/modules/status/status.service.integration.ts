import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { StatusService } from './status.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';

describe('StatusService Integration', () => {
  let service: StatusService;

  const mockPrisma = {
    submission: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    processTemplate: {
      findUnique: jest.fn(),
    },
    submissionStatus: {
      create: jest.fn(),
    },
    submissionEvent: {
      create: jest.fn(),
    },
  };

  const mockAuditService = {
    createLog: jest.fn(),
  };

  const mockAdapterRuntimeService = {
    createAdapterForConnector: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatusService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: AdapterRuntimeService, useValue: mockAdapterRuntimeService },
      ],
    }).compile();

    service = module.get(StatusService);
  });

  it('polls OA status, persists status/event records, and returns timeline with the latest polled state', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue({
      id: 'submission-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      templateId: 'template-1',
      status: 'pending',
      oaSubmissionId: 'oa-123',
      createdAt: new Date('2026-03-09T09:00:00.000Z'),
      submittedAt: new Date('2026-03-09T09:01:00.000Z'),
      events: [],
      statusRecords: [],
    });
    mockPrisma.processTemplate.findUnique.mockResolvedValue({
      id: 'template-1',
      connectorId: 'connector-1',
    });
    mockAdapterRuntimeService.createAdapterForConnector.mockResolvedValue({
      queryStatus: jest.fn().mockResolvedValue({
        status: 'approved',
        approver: 'manager-1',
      }),
    });

    const result = await service.queryStatus('submission-1', 'trace-1');

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
      data: {
        status: 'approved',
      },
    });
    expect(mockPrisma.submissionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        submissionId: 'submission-1',
        eventType: 'status_polled',
        eventSource: 'oa_pull',
        remoteEventId: expect.stringMatching(/^oa-123:/),
        status: 'approved',
        payload: {
          status: 'approved',
          approver: 'manager-1',
        },
      }),
    });
    expect(result.status).toBe('approved');
    expect(result.oaStatus).toEqual({
      status: 'approved',
      approver: 'manager-1',
    });
    expect(result.statusRecords).toHaveLength(1);
    expect(result.statusRecords[0]).toEqual(
      expect.objectContaining({
        submissionId: 'submission-1',
        status: 'approved',
      }),
    );
    expect(result.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'created',
          description: '申请已创建',
        }),
        expect.objectContaining({
          status: 'submitted',
          description: '已提交至OA系统',
        }),
        expect.objectContaining({
          status: 'approved',
          description: '状态更新: approved',
        }),
        expect.objectContaining({
          status: 'approved',
          description: '事件: status_polled',
        }),
      ]),
    );
  });

  it('swallows duplicate polled events and skips persisting duplicate status records', async () => {
    mockPrisma.submission.findUnique.mockResolvedValue({
      id: 'submission-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      templateId: 'template-1',
      status: 'pending',
      oaSubmissionId: 'oa-123',
      createdAt: new Date('2026-03-09T09:00:00.000Z'),
      submittedAt: new Date('2026-03-09T09:01:00.000Z'),
      events: [],
      statusRecords: [],
    });
    mockPrisma.processTemplate.findUnique.mockResolvedValue({
      id: 'template-1',
      connectorId: 'connector-1',
    });
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

    const result = await service.queryStatus('submission-1', 'trace-1');

    expect(mockPrisma.submissionStatus.create).not.toHaveBeenCalled();
    expect(mockPrisma.submission.update).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      data: {
        status: 'approved',
      },
    });
    expect(result.statusRecords).toHaveLength(0);
    expect(result.timeline).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          description: '状态更新: approved',
        }),
      ]),
    );
  });
});
