import { Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as bodyParser from 'body-parser';
import { SyncController } from '../src/modules/sync/sync.controller';
import { SyncService } from '../src/modules/sync/sync.service';
import { WebhookController } from '../src/modules/webhook/webhook.controller';
import { WebhookService } from '../src/modules/webhook/webhook.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [SyncController, WebhookController],
  providers: [
    {
      provide: SyncService,
      useValue: {
        enqueue: jest.fn(),
        listJobs: jest.fn(),
        getJob: jest.fn(),
        getConfig: jest.fn(),
        updateConfig: jest.fn(),
        dispatchDueSchedules: jest.fn(),
        listRemoteProcesses: jest.fn(),
        getRemoteProcess: jest.fn(),
        listReferenceDatasets: jest.fn(),
        getReferenceDataset: jest.fn(),
        listReferenceItems: jest.fn(),
        listCursors: jest.fn(),
      },
    },
    {
      provide: WebhookService,
      useValue: {
        receive: jest.fn(),
        processInbox: jest.fn(),
        listInbox: jest.fn(),
        getInbox: jest.fn(),
        getConfig: jest.fn(),
        updateConfig: jest.fn(),
      },
    },
    {
      provide: RequestAuthService,
      useValue: {
        resolveUser: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          userId: 'user-1',
          roles: ['admin'],
          source: 'session',
        }),
      },
    },
  ],
})
class TestHttpModule {}

describe('Sync/Webhook HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let syncService: jest.Mocked<SyncService>;
  let webhookService: jest.Mocked<WebhookService>;
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestHttpModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });

    const captureRawBody = (req: any, _res: any, buffer: Buffer, encoding: BufferEncoding) => {
      req.rawBody = buffer.toString(encoding || 'utf8');
    };

    app.use(bodyParser.json({ verify: captureRawBody }));
    app.use(bodyParser.urlencoded({ extended: true, verify: captureRawBody }));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');

    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    syncService = moduleFixture.get(SyncService);
    webhookService = moduleFixture.get(WebhookService);
    requestAuth = moduleFixture.get(RequestAuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    requestAuth.resolveUser.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['admin'],
      source: 'session',
    });
  });

  it('routes sync config and run-due endpoints with expected parameters', async () => {
    syncService.getConfig.mockResolvedValue({
      connector: { id: 'connector-1', name: 'O2OA', status: 'active' },
      syncPolicy: {
        enabled: true,
        domains: {
          schema: { enabled: true, intervalMinutes: 360 },
        },
      },
    } as any);
    syncService.updateConfig.mockResolvedValue({
      enabled: true,
      domains: {
        status: { enabled: true, intervalMinutes: 5 },
      },
    } as any);
    syncService.dispatchDueSchedules.mockResolvedValue({
      evaluated: 1,
      enqueued: 1,
      jobs: [{ connectorId: 'connector-1', syncDomain: 'status' }],
      skipped: [],
    } as any);
    syncService.enqueue.mockResolvedValue({
      id: 'sync-job-1',
      connectorId: 'connector-1',
      syncDomain: 'schema',
      triggerType: 'manual',
    } as any);

    await request(httpApp)
      .get('/api/v1/sync/connectors/connector-1/config')
      .expect(200)
      .expect(({ body }) => {
        expect(body.connector.id).toBe('connector-1');
        expect(body.syncPolicy.enabled).toBe(true);
      });

    await request(httpApp)
      .post('/api/v1/sync/connectors/connector-1/config')
      .send({
        updatedBy: 'admin',
        domains: {
          status: { enabled: true, intervalMinutes: 5 },
        },
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.domains.status.intervalMinutes).toBe(5);
      });

    await request(httpApp)
      .post('/api/v1/sync/run-due')
      .query({ connectorId: 'connector-1' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.enqueued).toBe(1);
      });

    await request(httpApp)
      .post('/api/v1/sync/connectors/connector-1/schema')
      .send({
        triggerType: 'manual',
        requestedBy: 'tester',
        scope: { mode: 'full' },
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toBe('sync-job-1');
      });

    expect(syncService.getConfig).toHaveBeenCalledWith('connector-1', 'tenant-1');
    expect(syncService.updateConfig).toHaveBeenCalledWith('connector-1', 'tenant-1', {
      updatedBy: 'admin',
      domains: {
        status: { enabled: true, intervalMinutes: 5 },
      },
    });
    expect(syncService.dispatchDueSchedules).toHaveBeenCalledWith('connector-1', 'tenant-1');
    expect(syncService.enqueue).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      syncDomain: 'schema',
      triggerType: 'manual',
      requestedBy: 'user-1',
      scope: { mode: 'full' },
    });
  });

  it('routes webhook receive and config endpoints, including raw request body', async () => {
    webhookService.receive.mockResolvedValue({
      inboxId: 'inbox-1',
      dedupeKey: 'connector-1:evt-1',
      duplicate: false,
      processStatus: 'pending',
    } as any);
    webhookService.updateConfig.mockResolvedValue({
      signatureHeader: 'x-custom-signature',
      signaturePayloadMode: 'raw',
    } as any);
    webhookService.processInbox.mockResolvedValue({
      id: 'inbox-1',
      tenantId: 'tenant-1',
      processStatus: 'processed',
    } as any);

    const rawBody = '{"event":{"id":"evt-1","type":"approved"},"submission":{"id":"oa-100"}}';

    await request(httpApp)
      .post('/api/v1/webhooks/connectors/connector-1')
      .set('X-Custom-Signature', 'test-signature')
      .set('Content-Type', 'application/json')
      .send(rawBody)
      .expect(201)
      .expect(({ body }) => {
        expect(body.inboxId).toBe('inbox-1');
      });

    await request(httpApp)
      .post('/api/v1/webhooks/connectors/connector-1/config')
      .send({
        signatureHeader: 'x-custom-signature',
        signaturePayloadMode: 'raw',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.signaturePayloadMode).toBe('raw');
      });

    await request(httpApp)
      .post('/api/v1/webhooks/inbox/inbox-1/process')
      .expect(201)
      .expect(({ body }) => {
        expect(body.processStatus).toBe('processed');
      });

    expect(webhookService.receive).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({
        'x-custom-signature': 'test-signature',
      }),
      {
        event: {
          id: 'evt-1',
          type: 'approved',
        },
        submission: {
          id: 'oa-100',
        },
      },
      rawBody,
    );
    expect(webhookService.updateConfig).toHaveBeenCalledWith('connector-1', 'tenant-1', {
      signatureHeader: 'x-custom-signature',
      signaturePayloadMode: 'raw',
    });
    expect(webhookService.processInbox).toHaveBeenCalledWith('inbox-1', 'tenant-1');
  });
});
