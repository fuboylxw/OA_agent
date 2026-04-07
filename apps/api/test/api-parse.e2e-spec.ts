import { Module, ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { ApiParseController } from '../src/modules/api-parse/api-parse.controller';
import { ApiParseService } from '../src/modules/api-parse/api-parse.service';
import { FlowDiscoveryService } from '../src/modules/api-parse/flow-discovery.service';
import { SyncService } from '../src/modules/api-parse/sync.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [ApiParseController],
  providers: [
    {
      provide: ApiParseService,
      useValue: {
        parseAndGenerate: jest.fn(),
        previewNormalize: jest.fn(),
        validateConnector: jest.fn(),
      },
    },
    {
      provide: SyncService,
      useValue: {
        handleWebhook: jest.fn(),
        syncOnDemand: jest.fn(),
        pollPendingSubmissions: jest.fn(),
      },
    },
    {
      provide: FlowDiscoveryService,
      useValue: {
        listAllFlows: jest.fn(),
        discoverFlows: jest.fn(),
        findFlow: jest.fn(),
      },
    },
    {
      provide: RequestAuthService,
      useValue: {
        resolveUser: jest.fn(),
      },
    },
  ],
})
class ApiParseHttpTestModule {}

describe('ApiParse HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let apiParseService: {
    parseAndGenerate: jest.Mock;
    previewNormalize: jest.Mock;
    validateConnector: jest.Mock;
  };
  let syncService: {
    handleWebhook: jest.Mock;
    syncOnDemand: jest.Mock;
    pollPendingSubmissions: jest.Mock;
  };
  let flowDiscovery: {
    listAllFlows: jest.Mock;
    discoverFlows: jest.Mock;
    findFlow: jest.Mock;
  };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ApiParseHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    apiParseService = moduleFixture.get(ApiParseService);
    syncService = moduleFixture.get(SyncService);
    flowDiscovery = moduleFixture.get(FlowDiscoveryService);
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
      roles: ['user'],
      source: 'session',
    });
  });

  it('routes protected endpoints with tenant-scoped arguments', async () => {
    apiParseService.parseAndGenerate.mockResolvedValue({ ok: true });
    apiParseService.previewNormalize.mockResolvedValue({
      format: 'openapi',
      endpoints: [],
      rawEndpointCount: 0,
    });
    apiParseService.validateConnector.mockResolvedValue({
      overall: 'passed',
      connectivity: true,
      authValid: true,
      endpoints: [],
      summary: { total: 0, reachable: 0, unreachable: 0, unknown: 0 },
    });
    syncService.pollPendingSubmissions.mockResolvedValue({ synced: 2, failed: 0 });
    flowDiscovery.listAllFlows.mockResolvedValue([
      {
        processCode: 'expense_apply',
        processName: 'Expense Apply',
        category: 'finance',
        isNew: false,
        templateId: 'tpl-1',
      },
    ]);
    flowDiscovery.discoverFlows.mockResolvedValue([]);
    flowDiscovery.findFlow.mockResolvedValue({
      processCode: 'expense_apply',
      processName: 'Expense Apply',
      category: 'finance',
      isNew: false,
      templateId: 'tpl-1',
    });

    await request(httpApp)
      .post('/api/v1/api-parse/parse-and-generate')
      .send({
        tenantId: 'tenant-body',
        connectorId: 'connector-1',
        docContent: 'openapi: 3.0.0',
      })
      .expect(200);

    await request(httpApp)
      .post('/api/v1/api-parse/preview-normalize')
      .send({
        content: 'raw-doc',
        formatHint: 'openapi',
      })
      .expect(200);

    await request(httpApp)
      .post('/api/v1/api-parse/validate/connector-1')
      .expect(200);

    await request(httpApp)
      .post('/api/v1/api-parse/sync-all')
      .expect(200);

    await request(httpApp)
      .get('/api/v1/api-parse/flows/connector-1')
      .expect(200);

    await request(httpApp)
      .post('/api/v1/api-parse/flows/connector-1/discover')
      .expect(200);

    await request(httpApp)
      .get('/api/v1/api-parse/flows/connector-1/search')
      .query({ keyword: 'expense' })
      .expect(200);

    expect(requestAuth.resolveUser).toHaveBeenNthCalledWith(1, expect.anything(), {
      tenantId: 'tenant-body',
      requireUser: true,
    });
    expect(requestAuth.resolveUser).toHaveBeenNthCalledWith(2, expect.anything(), {
      requireUser: true,
    });
    expect(requestAuth.resolveUser).toHaveBeenNthCalledWith(3, expect.anything(), {
      requireUser: true,
    });
    expect(requestAuth.resolveUser).toHaveBeenNthCalledWith(4, expect.anything(), {
      requireUser: true,
    });
    expect(requestAuth.resolveUser).toHaveBeenNthCalledWith(5, expect.anything(), {
      requireUser: true,
    });
    expect(requestAuth.resolveUser).toHaveBeenNthCalledWith(6, expect.anything(), {
      requireUser: true,
    });
    expect(requestAuth.resolveUser).toHaveBeenNthCalledWith(7, expect.anything(), {
      requireUser: true,
    });

    expect(apiParseService.parseAndGenerate).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      docContent: 'openapi: 3.0.0',
    });
    expect(apiParseService.previewNormalize).toHaveBeenCalledWith('raw-doc', 'openapi');
    expect(apiParseService.validateConnector).toHaveBeenCalledWith('connector-1', 'tenant-1');
    expect(syncService.pollPendingSubmissions).toHaveBeenCalledWith('tenant-1');
    expect(flowDiscovery.listAllFlows).toHaveBeenCalledWith('connector-1', 'tenant-1');
    expect(flowDiscovery.discoverFlows).toHaveBeenCalledWith('connector-1', 'tenant-1');
    expect(flowDiscovery.findFlow).toHaveBeenCalledWith('connector-1', 'tenant-1', 'expense');
  });

  it('limits on-demand sync to the current user unless the role can view all', async () => {
    syncService.syncOnDemand.mockResolvedValue({
      success: true,
      newStatus: 'approved',
    });

    requestAuth.resolveUser.mockResolvedValueOnce({
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['user'],
      source: 'session',
    });

    await request(httpApp)
      .post('/api/v1/api-parse/sync/submission-1')
      .expect(200);

    expect(syncService.syncOnDemand).toHaveBeenLastCalledWith(
      'submission-1',
      'tenant-1',
      'user-1',
    );

    requestAuth.resolveUser.mockResolvedValueOnce({
      tenantId: 'tenant-1',
      userId: 'auditor-1',
      roles: ['auditor'],
      source: 'session',
    });

    await request(httpApp)
      .post('/api/v1/api-parse/sync/submission-2')
      .expect(200);

    expect(syncService.syncOnDemand).toHaveBeenLastCalledWith(
      'submission-2',
      'tenant-1',
      undefined,
    );
  });

  it('keeps webhook sync open without request auth', async () => {
    syncService.handleWebhook.mockResolvedValue({
      processed: true,
      submissionId: 'submission-1',
    });

    await request(httpApp)
      .post('/api/v1/api-parse/webhook/connector-1')
      .send({ id: 'oa-100' })
      .expect(200);

    expect(syncService.handleWebhook).toHaveBeenCalledWith('connector-1', { id: 'oa-100' });
    expect(requestAuth.resolveUser).not.toHaveBeenCalled();
  });
});
