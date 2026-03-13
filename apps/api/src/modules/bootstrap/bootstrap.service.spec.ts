import { Test, TestingModule } from '@nestjs/testing';
import { BootstrapService } from './bootstrap.service';
import { PrismaService } from '../common/prisma.service';
import { Queue } from 'bull';
import { WorkerAvailabilityService } from './worker-availability.service';
import axios from 'axios';

jest.mock('axios');

describe('BootstrapService', () => {
  let service: BootstrapService;
  let prisma: PrismaService;

  const mockQueue = {
    add: jest.fn(),
  } as unknown as Queue;

  const mockWorkerAvailabilityService = {
    assertBootstrapWorkerAvailable: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BootstrapService,
        {
          provide: PrismaService,
          useValue: {
            bootstrapJob: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
            bootstrapSource: {
              create: jest.fn(),
            },
            bootstrapReport: {
              findFirst: jest.fn(),
            },
          },
        },
        {
          provide: WorkerAvailabilityService,
          useValue: mockWorkerAvailabilityService,
        },
        {
          provide: 'BullQueue_bootstrap',
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<BootstrapService>(BootstrapService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createJob', () => {
    it('should create a bootstrap job with apiDocUrl', async () => {
      const mockJob = {
        id: 'test-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
        openApiUrl: 'http://example.com/openapi.json',
      };

      (axios.get as jest.Mock).mockResolvedValue({
        data: { openapi: '3.0.0', paths: {} },
      });
      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      const result = await service.createJob({
        apiDocUrl: 'http://example.com/openapi.json',
      });

      expect(result).toEqual({
        ...mockJob,
        queueJobId: 'queue-job-id',
      });
      expect(prisma.bootstrapJob.create).toHaveBeenCalled();
      expect(prisma.bootstrapJob.update).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({ jobId: mockJob.id, queueJobId: expect.any(String) }),
        expect.objectContaining({ jobId: expect.any(String) }),
      );
    });
  });
});
