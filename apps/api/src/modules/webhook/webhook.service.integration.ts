import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { ChatSessionProcessService } from '../common/chat-session-process.service';

describe('WebhookService Integration', () => {
  let service: WebhookService;

  const mockQueue = {
    add: jest.fn(),
  };

  const mockPrisma = {
    webhookInbox: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    submission: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    submissionEvent: {
      create: jest.fn(),
    },
    submissionStatus: {
      create: jest.fn(),
    },
    connectorCapability: {
      upsert: jest.fn(),
    },
  };

  const mockAuditService = {
    createLog: jest.fn(),
  };

  const mockAdapterRuntimeService = {
    getConnectorWithSecrets: jest.fn(),
    resolveAuthConfig: jest.fn(),
  };

  const mockChatSessionProcessService = {
    syncSubmissionStatusToSession: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatSessionProcessService, useValue: mockChatSessionProcessService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: AdapterRuntimeService, useValue: mockAdapterRuntimeService },
        { provide: getQueueToken('webhook'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get(WebhookService);
  });

  it('accepts raw-body signatures with configurable encoding and case-insensitive headers', async () => {
    const rawBody = '{"event":{"type":"approved","id":"evt-1"},"submission":{"id":"oa-100"}}';
    const payload = JSON.parse(rawBody);
    const secret = 'webhook-secret';
    const signature = createHmac('sha256', secret).update(rawBody).digest('base64');

    mockAdapterRuntimeService.getConnectorWithSecrets.mockResolvedValue({
      id: 'connector-1',
      tenantId: 'tenant-1',
      capability: {
        metadata: {
          webhookConfig: {
            signatureHeader: 'X-Custom-Signature',
            signaturePrefix: '',
            signatureAlgorithm: 'sha256',
            signatureEncoding: 'base64',
            signaturePayloadMode: 'raw',
            requireSignature: true,
            eventTypePath: 'event.type',
            dedupeKeyPath: 'event.id',
          },
        },
      },
    });
    mockAdapterRuntimeService.resolveAuthConfig.mockReturnValue({
      webhookSecret: secret,
    });
    mockPrisma.webhookInbox.findUnique.mockResolvedValue(null);
    mockPrisma.webhookInbox.create.mockResolvedValue({
      id: 'inbox-1',
    });

    const result = await service.receive(
      'connector-1',
      { 'X-Custom-Signature': signature },
      payload,
      rawBody,
    );

    expect(result).toEqual({
      inboxId: 'inbox-1',
      dedupeKey: 'connector-1:evt-1',
      duplicate: false,
      processStatus: 'pending',
    });
    expect(mockPrisma.webhookInbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        eventType: 'approved',
        dedupeKey: 'connector-1:evt-1',
        payload,
      }),
    });
    expect(mockQueue.add).toHaveBeenCalledWith(
      'process',
      { inboxId: 'inbox-1' },
      expect.objectContaining({
        jobId: 'webhook:inbox-1',
      }),
    );
  });

  it('marks webhook inbox as processed when submission event already exists', async () => {
    mockPrisma.webhookInbox.findUnique.mockResolvedValue({
      id: 'inbox-1',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      eventType: 'approved',
      dedupeKey: 'connector-1:evt-1',
      payload: {
        event: {
          id: 'evt-1',
          type: 'approved',
          status: 'approved',
        },
        submission: {
          id: 'oa-100',
        },
      },
      processStatus: 'pending',
      connector: {
        capability: {
          metadata: {
            webhookConfig: {
              submissionIdPath: 'submission.id',
              remoteEventIdPath: 'event.id',
              eventTypePath: 'event.type',
              statusPath: 'event.status',
            },
          },
        },
      },
    });
    mockPrisma.submission.findFirst.mockResolvedValue({
      id: 'submission-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      status: 'pending',
    });
    mockPrisma.submissionEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate submission event', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    mockPrisma.webhookInbox.update.mockResolvedValue({
      id: 'inbox-1',
      processStatus: 'processed',
    });

    const result = await service.processInbox('inbox-1');

    expect(mockPrisma.submissionStatus.create).not.toHaveBeenCalled();
    expect(mockPrisma.submission.update).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      data: {
        status: 'approved',
      },
    });
    expect(mockPrisma.webhookInbox.update).toHaveBeenCalledWith({
      where: { id: 'inbox-1' },
      data: expect.objectContaining({
        processStatus: 'processed',
        errorMessage: null,
      }),
    });
    expect(mockAuditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webhook_processed',
        details: expect.objectContaining({
          externalSubmissionId: 'oa-100',
          remoteEventId: 'evt-1',
          duplicateEvent: true,
        }),
      }),
    );
    expect(result).toEqual({
      id: 'inbox-1',
      processStatus: 'processed',
    });
  });
});
