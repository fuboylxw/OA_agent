import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { SyncService } from './sync.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SyncCursorService } from './sync-cursor.service';
import { SchemaSyncService } from './schema-sync.service';
import { ReferenceSyncService } from './reference-sync.service';
import { StatusSyncService } from './status-sync.service';

describe('SyncService Integration', () => {
  let service: SyncService;

  const mockQueue = {
    add: jest.fn(),
  };

  const mockPrisma = {
    connector: {
      findUnique: jest.fn(),
    },
    connectorCapability: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    syncJob: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockAuditService = {
    createLog: jest.fn(),
  };

  const mockSyncCursorService = {
    getOrCreate: jest.fn(),
    markSuccess: jest.fn(),
    markFailure: jest.fn(),
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-09T10:00:00.000Z'));
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: SyncCursorService, useValue: mockSyncCursorService },
        { provide: SchemaSyncService, useValue: {} },
        { provide: ReferenceSyncService, useValue: {} },
        { provide: StatusSyncService, useValue: {} },
        { provide: getQueueToken('sync'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get(SyncService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dispatches only due scheduled domains and includes deterministic schedule metadata', async () => {
    mockPrisma.connectorCapability.findMany.mockResolvedValue([
      {
        connectorId: 'connector-1',
        supportsSchemaSync: true,
        supportsReferenceSync: true,
        supportsStatusPull: true,
        metadata: {
          syncPolicy: {
            enabled: true,
            domains: {
              schema: { enabled: true, intervalMinutes: 60, scope: { mode: 'incremental' } },
              reference: { enabled: false, intervalMinutes: 120 },
              status: { enabled: true, intervalMinutes: 10 },
            },
          },
        },
        connector: {
          id: 'connector-1',
          tenantId: 'tenant-1',
          name: 'O2OA',
          status: 'active',
        },
      },
    ]);

    mockPrisma.syncJob.findFirst.mockImplementation(({ where }: any) => {
      if (where.syncDomain === 'schema') {
        return Promise.resolve({
          id: 'old-schema-job',
          status: 'succeeded',
          createdAt: new Date('2026-03-09T07:00:00.000Z'),
          startedAt: new Date('2026-03-09T07:00:00.000Z'),
          finishedAt: new Date('2026-03-09T07:05:00.000Z'),
        });
      }

      if (where.syncDomain === 'status') {
        return Promise.resolve({
          id: 'recent-status-job',
          status: 'succeeded',
          createdAt: new Date('2026-03-09T09:54:00.000Z'),
          startedAt: new Date('2026-03-09T09:54:00.000Z'),
          finishedAt: new Date('2026-03-09T09:55:00.000Z'),
        });
      }

      return Promise.resolve(null);
    });

    mockPrisma.connector.findUnique.mockResolvedValue({
      id: 'connector-1',
      tenantId: 'tenant-1',
    });

    mockSyncCursorService.getOrCreate.mockResolvedValue({
      cursorType: 'watermark',
      cursorValue: 'cursor-1',
      lastVersion: 'v1',
      metadata: { checkpoint: 1 },
    });

    mockPrisma.syncJob.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: data.id,
        connectorId: data.connectorId,
        tenantId: data.tenantId,
        syncDomain: data.syncDomain,
        triggerType: data.triggerType,
        status: data.status,
        scope: data.scope,
      }),
    );

    const result = await service.dispatchDueSchedules();

    expect(result.enqueued).toBe(1);
    expect(result.evaluated).toBe(2);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      connectorId: 'connector-1',
      syncDomain: 'schema',
      intervalMinutes: 60,
      scheduleSlot: '2026-03-09T10:00:00.000Z',
    });
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectorId: 'connector-1',
          syncDomain: 'status',
          reason: 'not_due',
          nextRunAt: '2026-03-09T10:05:00.000Z',
        }),
      ]),
    );

    expect(mockPrisma.syncJob.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.syncJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.stringMatching(/^sync_sched_[a-f0-9]{32}$/),
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        syncDomain: 'schema',
        triggerType: 'schedule',
        status: 'pending',
        scope: expect.objectContaining({
          mode: 'incremental',
          intervalMinutes: 60,
          scheduleSlot: '2026-03-09T10:00:00.000Z',
        }),
      }),
    });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'run',
      { syncJobId: expect.stringMatching(/^sync_sched_[a-f0-9]{32}$/) },
      expect.objectContaining({
        jobId: expect.stringMatching(/^sync:sync_sched_[a-f0-9]{32}$/),
      }),
    );
  });

  it('updates sync policy without losing existing connector metadata', async () => {
    mockPrisma.connector.findUnique.mockResolvedValue({
      id: 'connector-1',
      tenantId: 'tenant-1',
      oaType: 'openapi',
      oclLevel: 'OCL4',
      capability: {
        supportsSchemaSync: true,
        supportsReferenceSync: true,
        supportsStatusPull: true,
        supportsWebhook: true,
        supportsCancel: true,
        supportsUrge: true,
        supportsDelegate: true,
        supportsSupplement: true,
        supportsRealtimePerm: true,
        supportsIdempotency: true,
        syncModes: ['full', 'incremental'],
        metadata: {
          webhookConfig: {
            signatureHeader: 'x-webhook-signature',
          },
          customTag: 'keep-me',
        },
      },
    });

    mockPrisma.connectorCapability.upsert.mockResolvedValue({});

    const result = await service.updateConfig('connector-1', {
      updatedBy: 'admin',
      domains: {
        status: {
          enabled: true,
          intervalMinutes: 5,
          scope: { window: 'recent' },
        },
      },
    });

    expect(result).toMatchObject({
      enabled: true,
      updatedBy: 'admin',
      domains: {
        schema: { enabled: true, intervalMinutes: 360 },
        reference: { enabled: true, intervalMinutes: 120 },
        status: {
          enabled: true,
          intervalMinutes: 5,
          scope: { window: 'recent' },
        },
      },
    });

    expect(mockPrisma.connectorCapability.upsert).toHaveBeenCalledWith({
      where: { connectorId: 'connector-1' },
      create: expect.objectContaining({
        metadata: expect.objectContaining({
          webhookConfig: {
            signatureHeader: 'x-webhook-signature',
          },
          customTag: 'keep-me',
          syncPolicy: expect.objectContaining({
            updatedBy: 'admin',
            domains: expect.objectContaining({
              status: expect.objectContaining({
                intervalMinutes: 5,
              }),
            }),
          }),
        }),
      }),
      update: expect.objectContaining({
        metadata: expect.objectContaining({
          webhookConfig: {
            signatureHeader: 'x-webhook-signature',
          },
          customTag: 'keep-me',
          syncPolicy: expect.objectContaining({
            updatedBy: 'admin',
          }),
        }),
      }),
    });
  });
});
