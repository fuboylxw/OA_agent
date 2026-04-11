import { Test, TestingModule } from '@nestjs/testing';

import { Prisma } from '@prisma/client';

import { StatusSyncService } from './status-sync.service';
import { PrismaService } from '../common/prisma.service';
import { ChatSessionProcessService } from '../common/chat-session-process.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';


describe('StatusSyncService Integration', () => {

  let service: StatusSyncService;



  const mockPrisma = {

    processTemplate: {

      findMany: jest.fn(),

    },

    submission: {

      findMany: jest.fn(),

      update: jest.fn(),

    },

    submissionStatus: {

      create: jest.fn(),

    },

    submissionEvent: {

      create: jest.fn(),

    },

  };



  const mockAdapterRuntimeService = {
    createAdapterForConnector: jest.fn(),
  };
  const mockChatSessionProcessService = {
    syncSubmissionStatusToSession: jest.fn(),
  };


  beforeEach(async () => {

    jest.clearAllMocks();



    const module: TestingModule = await Test.createTestingModule({

      providers: [
        StatusSyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatSessionProcessService, useValue: mockChatSessionProcessService },
        { provide: AdapterRuntimeService, useValue: mockAdapterRuntimeService },
      ],
    }).compile();


    service = module.get(StatusSyncService);

  });



  it('persists status events with a fingerprinted remote event id', async () => {

    mockPrisma.processTemplate.findMany.mockResolvedValue([{ id: 'template-1' }]);

    mockPrisma.submission.findMany.mockResolvedValue([

      {

        id: 'submission-1',

        status: 'pending',

        oaSubmissionId: 'oa-123',

        templateId: 'template-1',

        updatedAt: new Date('2026-03-09T09:00:00.000Z'),

      },

    ]);

    mockAdapterRuntimeService.createAdapterForConnector.mockResolvedValue({

      queryStatus: jest.fn().mockResolvedValue({

        status: 'approved',

        approver: 'manager-1',

      }),

    });



    const result = await service.run({

      id: 'sync-job-1',

      tenantId: 'tenant-1',

      connectorId: 'connector-1',

    });



    expect(mockPrisma.submissionEvent.create).toHaveBeenCalledWith({

      data: expect.objectContaining({

        submissionId: 'submission-1',

        eventSource: 'oa_pull',

        remoteEventId: expect.stringMatching(/^oa-123:/),

        status: 'approved',

      }),

    });

    expect(mockPrisma.submissionStatus.create).toHaveBeenCalledTimes(1);

    expect(result).toMatchObject({

      syncedStatuses: 1,

      failedStatuses: 0,

      deduplicatedStatuses: 0,

    });

  });



  it('treats duplicate polled events as deduplicated instead of failed', async () => {

    mockPrisma.processTemplate.findMany.mockResolvedValue([{ id: 'template-1' }]);

    mockPrisma.submission.findMany.mockResolvedValue([

      {

        id: 'submission-1',

        status: 'pending',

        oaSubmissionId: 'oa-123',

        templateId: 'template-1',

        updatedAt: new Date('2026-03-09T09:00:00.000Z'),

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



    const result = await service.run({

      id: 'sync-job-2',

      tenantId: 'tenant-1',

      connectorId: 'connector-1',

    });



    expect(mockPrisma.submissionStatus.create).not.toHaveBeenCalled();

    expect(mockPrisma.submission.update).toHaveBeenCalledWith({

      where: { id: 'submission-1' },

      data: {

        status: 'approved',

      },

    });

    expect(result).toMatchObject({

      syncedStatuses: 0,

      failedStatuses: 0,

      deduplicatedStatuses: 1,

    });

  });

});

