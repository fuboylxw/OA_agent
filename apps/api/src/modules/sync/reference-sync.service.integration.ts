import { Test, TestingModule } from '@nestjs/testing';
import { ReferenceSyncService } from './reference-sync.service';
import { PrismaService } from '../common/prisma.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';

describe('ReferenceSyncService Integration', () => {
  let service: ReferenceSyncService;

  const mockPrisma = {
    referenceDataset: {
      upsert: jest.fn(),
    },
    referenceItem: {
      upsert: jest.fn(),
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
        ReferenceSyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AdapterRuntimeService, useValue: mockAdapterRuntimeService },
      ],
    }).compile();

    service = module.get(ReferenceSyncService);
  });

  it('marks stale reference items inactive for full-sync datasets', async () => {
    mockAdapterRuntimeService.createAdapterForConnector.mockResolvedValue({
      listReferenceData: jest.fn().mockImplementation((datasetCode: string) => {
        if (datasetCode === 'department') {
          return Promise.resolve({
            datasetCode: 'department',
            datasetName: '部门',
            datasetType: 'department',
            syncMode: 'full',
            items: [
              {
                remoteItemId: 'dept-1',
                itemKey: 'dept-1',
                itemLabel: '研发部',
                itemValue: 'dept-1',
              },
            ],
          });
        }

        throw new Error('unsupported');
      }),
    });
    mockPrisma.referenceDataset.upsert.mockResolvedValue({
      id: 'dataset-1',
    });
    mockPrisma.referenceItem.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.run({
      id: 'sync-job-1',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
    });

    expect(mockPrisma.referenceItem.upsert).toHaveBeenCalledWith({
      where: {
        id: 'dataset-1:dept-1',
      },
      create: expect.objectContaining({
        id: 'dataset-1:dept-1',
        datasetId: 'dataset-1',
        itemLabel: '研发部',
      }),
      update: expect.objectContaining({
        status: 'active',
      }),
    });
    expect(mockPrisma.referenceItem.updateMany).toHaveBeenCalledWith({
      where: {
        datasetId: 'dataset-1',
        id: {
          notIn: ['dataset-1:dept-1'],
        },
        status: 'active',
      },
      data: {
        status: 'inactive',
      },
    });
    expect(result).toMatchObject({
      syncedDatasets: 1,
      syncedItems: 1,
      deactivatedItems: 2,
    });
  });
});
