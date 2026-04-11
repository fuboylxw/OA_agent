import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { MCPController } from '../src/modules/mcp/mcp.controller';
import { MCPService } from '../src/modules/mcp/mcp.service';
import { MCPExecutorService } from '../src/modules/mcp/mcp-executor.service';
import { ApiUploadService } from '../src/modules/mcp/api-upload.service';
import { ApiUploadJobService } from '../src/modules/mcp/api-upload-job.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [MCPController],
  providers: [
    {
      provide: MCPService,
      useValue: {
        listTools: jest.fn(),
        getTool: jest.fn(),
      },
    },
    {
      provide: MCPExecutorService,
      useValue: {
        executeTool: jest.fn(),
      },
    },
    {
      provide: ApiUploadService,
      useValue: {
        getUploadHistory: jest.fn(),
      },
    },
    {
      provide: ApiUploadJobService,
      useValue: {
        uploadAndProcessWithRepair: jest.fn(),
        startJob: jest.fn(),
        getJob: jest.fn(),
        getAttempts: jest.fn(),
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
class MCPHttpTestModule {}

describe('MCP HTTP E2E', () => {
  let app: INestApplication;
  let mcpService: { listTools: jest.Mock; getTool: jest.Mock };
  let mcpExecutor: { executeTool: jest.Mock };
  let apiUploadService: { getUploadHistory: jest.Mock };
  let apiUploadJobService: {
    uploadAndProcessWithRepair: jest.Mock;
    startJob: jest.Mock;
    getJob: jest.Mock;
    getAttempts: jest.Mock;
  };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MCPHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    mcpService = moduleFixture.get(MCPService);
    mcpExecutor = moduleFixture.get(MCPExecutorService);
    apiUploadService = moduleFixture.get(ApiUploadService);
    apiUploadJobService = moduleFixture.get(ApiUploadJobService);
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

  it('routes tool and upload endpoints with tenant-scoped auth', async () => {
    mcpService.listTools.mockResolvedValue([{ name: 'submitExpense' }]);
    mcpService.getTool.mockResolvedValue({
      name: 'submitExpense',
      testInput: { amount: 128 },
    });
    mcpExecutor.executeTool.mockResolvedValue({ ok: true });
    apiUploadJobService.uploadAndProcessWithRepair.mockResolvedValue({ jobId: 'job-1' });
    apiUploadJobService.startJob.mockResolvedValue({ jobId: 'job-2' });
    apiUploadJobService.getJob.mockResolvedValue({ id: 'job-2' });
    apiUploadJobService.getAttempts.mockResolvedValue([{ attempt: 1 }]);
    apiUploadService.getUploadHistory.mockResolvedValue([{ id: 'upload-1' }]);

    await request(app.getHttpServer())
      .get('/api/v1/mcp/tools')
      .query({ connectorId: 'connector-1', category: 'finance' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/mcp/tools/submitExpense')
      .query({ connectorId: 'connector-1' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/mcp/tools/submitExpense/execute')
      .send({
        connectorId: 'connector-1',
        params: { amount: 128 },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/mcp/tools/submitExpense/test')
      .query({ connectorId: 'connector-1' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/mcp/upload-api-json')
      .send({
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        docType: 'openapi',
        docContent: '{"openapi":"3.0.0"}',
        oaUrl: 'https://oa.example.com',
        authConfig: { token: 'secret' },
        autoValidate: true,
        autoGenerateMcp: true,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/mcp/upload-api-job')
      .send({
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        docType: 'openapi',
        docContent: '{"openapi":"3.0.0"}',
        oaUrl: 'https://oa.example.com',
        authConfig: { token: 'secret' },
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/v1/mcp/upload-api-job/job-2')
      .query({ tenantId: 'tenant-1', includeContent: 'true' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/mcp/upload-api-job/job-2/attempts')
      .query({ tenantId: 'tenant-1', includeContent: 'true' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/mcp/upload-history')
      .query({ tenantId: 'tenant-1', connectorId: 'connector-1' })
      .expect(200);

    expect(mcpService.listTools).toHaveBeenCalledWith('tenant-1', 'connector-1', 'finance');
    expect(mcpService.getTool).toHaveBeenCalledWith('tenant-1', 'connector-1', 'submitExpense');
    expect(mcpExecutor.executeTool).toHaveBeenCalledWith('submitExpense', { amount: 128 }, 'connector-1', 'tenant-1');
    expect(apiUploadJobService.uploadAndProcessWithRepair).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
    }));
    expect(apiUploadJobService.startJob).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
    }));
    expect(apiUploadJobService.getJob).toHaveBeenCalledWith('job-2', 'tenant-1', {
      includeContent: true,
    });
    expect(apiUploadJobService.getAttempts).toHaveBeenCalledWith('job-2', 'tenant-1', {
      includeContent: true,
    });
    expect(apiUploadService.getUploadHistory).toHaveBeenCalledWith('tenant-1', 'connector-1');
  });
});
