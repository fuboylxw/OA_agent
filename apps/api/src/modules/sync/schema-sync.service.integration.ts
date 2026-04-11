import { Test, TestingModule } from '@nestjs/testing';
import { SchemaSyncService } from './schema-sync.service';
import { PrismaService } from '../common/prisma.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { createDeterministicHash } from '@uniflow/shared-types';

describe('SchemaSyncService Integration', () => {
  let service: SchemaSyncService;

  const mockPrisma = {
    processTemplate: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    remoteProcess: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockAdapterRuntimeService = {
    createAdapterForConnector: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchemaSyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AdapterRuntimeService, useValue: mockAdapterRuntimeService },
      ],
    }).compile();

    service = module.get(SchemaSyncService);
  });

  it('creates a review template version when discovered flow metadata drifts and deprecates missing remote processes', async () => {
    mockAdapterRuntimeService.createAdapterForConnector.mockResolvedValue({
      discover: jest.fn().mockResolvedValue({
        oaVendor: 'O2OA',
        oaVersion: '8.0',
        discoveredFlows: [
          {
            flowCode: 'expense',
            flowName: '费用报销（新版）',
            entryUrl: '/work/expense',
            submitUrl: '/work/expense/v2',
            queryUrl: '/work/expense/status',
          },
        ],
      }),
    });
    mockPrisma.processTemplate.findMany.mockResolvedValue([
      {
        id: 'template-2',
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        remoteProcessId: 'remote-1',
        processCode: 'expense',
        processName: '费用报销',
        processCategory: 'finance',
        description: '旧版流程',
        version: 2,
        status: 'published',
        falLevel: 'F3',
        sourceHash: 'old-hash',
        sourceVersion: '7.9',
        reviewStatus: 'approved',
        schema: { fields: [{ key: 'amount' }] },
        rules: [{ type: 'required' }],
        permissions: [{ type: 'department' }],
        uiHints: {
          discovery: {
            flow: {
              flowCode: 'expense',
              flowName: '费用报销',
              entryUrl: '/work/expense',
              submitUrl: '/work/expense',
              queryUrl: '/work/expense/status',
            },
          },
        },
      },
      {
        id: 'template-1',
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        remoteProcessId: 'remote-1',
        processCode: 'expense',
        processName: '费用报销',
        processCategory: 'finance',
        description: '更旧版本',
        version: 1,
        status: 'published',
        falLevel: 'F3',
        sourceHash: 'older-hash',
        sourceVersion: '7.8',
        reviewStatus: 'approved',
        schema: { fields: [{ key: 'amount' }] },
        rules: [{ type: 'required' }],
        permissions: [{ type: 'department' }],
        uiHints: {},
      },
    ]);
    mockPrisma.remoteProcess.findMany.mockResolvedValue([
      {
        id: 'remote-1',
        remoteProcessId: 'expense',
        remoteProcessName: '费用报销',
        processCategory: 'finance',
        sourceHash: 'old-hash',
        metadata: {
          flow: {
            flowCode: 'expense',
            flowName: '费用报销',
            entryUrl: '/work/expense',
            submitUrl: '/work/expense',
            queryUrl: '/work/expense/status',
          },
        },
      },
      {
        id: 'remote-2',
        remoteProcessId: 'travel',
        remoteProcessName: '差旅申请',
        processCategory: 'travel',
        sourceHash: 'travel-hash',
        status: 'active',
        metadata: {},
      },
    ]);
    mockPrisma.remoteProcess.upsert.mockResolvedValue({
      id: 'remote-1',
      sourceVersion: '8.0',
    });
    mockPrisma.processTemplate.create.mockResolvedValue({
      id: 'template-3',
      processCode: 'expense',
      version: 3,
    });
    mockPrisma.remoteProcess.update.mockResolvedValue({});
    mockPrisma.remoteProcess.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.run({
      id: 'sync-job-1',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
    });

    expect(mockPrisma.processTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        processCode: 'expense',
        processName: '费用报销（新版）',
        version: 3,
        status: 'draft',
        reviewStatus: 'review',
        supersedesId: 'template-2',
        changeSummary: expect.objectContaining({
          changeType: 'updated',
          changedFields: expect.arrayContaining([
            expect.objectContaining({
              field: 'flowName',
              previousValue: '费用报销',
              currentValue: '费用报销（新版）',
            }),
            expect.objectContaining({
              field: 'submitUrl',
              previousValue: '/work/expense',
              currentValue: '/work/expense/v2',
            }),
          ]),
        }),
      }),
    });
    expect(mockPrisma.remoteProcess.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        remoteProcessId: {
          notIn: ['expense'],
        },
        status: {
          not: 'deprecated',
        },
      },
      data: expect.objectContaining({
        status: 'deprecated',
      }),
    });
    expect(result).toMatchObject({
      discoveredFlows: 1,
      driftedTemplates: 1,
      reviewRequiredTemplates: 1,
      deprecatedRemoteProcesses: 1,
    });
  });

  it('updates the latest template version instead of an older version when there is no drift', async () => {
    const flow = {
      flowCode: 'expense',
      flowName: '费用报销',
      entryUrl: '/work/expense',
      submitUrl: '/work/expense',
      queryUrl: '/work/expense/status',
    };

    mockAdapterRuntimeService.createAdapterForConnector.mockResolvedValue({
      discover: jest.fn().mockResolvedValue({
        oaVendor: 'O2OA',
        oaVersion: '8.0',
        discoveredFlows: [flow],
      }),
    });
    mockPrisma.processTemplate.findMany.mockResolvedValue([
      {
        id: 'template-2',
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        processCode: 'expense',
        processName: '费用报销',
        version: 2,
        processCategory: 'finance',
        sourceHash: createDeterministicHash(flow),
        sourceVersion: '8.0',
        falLevel: 'F3',
        schema: { fields: [] },
        rules: [],
        permissions: [],
        uiHints: {},
      },
      {
        id: 'template-1',
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        processCode: 'expense',
        processName: '费用报销',
        version: 1,
        processCategory: 'finance',
        sourceHash: 'older-hash',
        sourceVersion: '7.0',
        falLevel: 'F3',
        schema: { fields: [] },
        rules: [],
        permissions: [],
        uiHints: {},
      },
    ]);
    mockPrisma.remoteProcess.findMany.mockResolvedValue([]);
    mockPrisma.remoteProcess.upsert.mockResolvedValue({
      id: 'remote-1',
      sourceVersion: '8.0',
    });
    mockPrisma.remoteProcess.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.run({
      id: 'sync-job-2',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
    });

    expect(mockPrisma.processTemplate.update).toHaveBeenCalledWith({
      where: { id: 'template-2' },
      data: expect.objectContaining({
        remoteProcessId: 'remote-1',
        processName: '费用报销',
      }),
    });
    expect(mockPrisma.processTemplate.create).not.toHaveBeenCalled();
    expect(result.driftedTemplates).toBe(0);
  });
});
