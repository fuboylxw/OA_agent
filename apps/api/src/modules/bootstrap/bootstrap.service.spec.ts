import { Test, TestingModule } from '@nestjs/testing';
import { BootstrapService } from './bootstrap.service';
import { PrismaService } from '../common/prisma.service';
import { BootstrapStateMachine } from './bootstrap.state-machine';
import { Queue } from 'bull';

describe('BootstrapService', () => {
  let service: BootstrapService;
  let prisma: PrismaService;

  const mockQueue = {
    add: jest.fn(),
  } as unknown as Queue;

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
        BootstrapStateMachine,
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

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);

      const result = await service.createJob({
        apiDocUrl: 'http://example.com/openapi.json',
      });

      expect(result).toEqual(mockJob);
      expect(prisma.bootstrapJob.create).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith('process', { jobId: mockJob.id });
    });
  });
});
