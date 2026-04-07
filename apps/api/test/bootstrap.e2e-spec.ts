import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { BootstrapController } from '../src/modules/bootstrap/bootstrap.controller';
import { BootstrapService } from '../src/modules/bootstrap/bootstrap.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [BootstrapController],
  providers: [
    {
      provide: BootstrapService,
      useValue: {
        createJob: jest.fn(),
        getJob: jest.fn(),
        listJobs: jest.fn(),
        getReport: jest.fn(),
        reactivate: jest.fn(),
        deleteJob: jest.fn(),
      },
    },
    {
      provide: RequestAuthService,
      useValue: {
        resolveTenant: jest.fn().mockReturnValue({
          tenantId: 'tenant-1',
          roles: [],
          source: 'request',
        }),
      },
    },
  ],
})
class BootstrapHttpTestModule {}

describe('Bootstrap HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let bootstrapService: jest.Mocked<BootstrapService>;
  let requestAuth: { resolveTenant: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [BootstrapHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    bootstrapService = moduleFixture.get(BootstrapService);
    requestAuth = moduleFixture.get(RequestAuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    requestAuth.resolveTenant.mockReturnValue({
      tenantId: 'tenant-1',
      roles: [],
      source: 'request',
    });
  });

  it('validates and creates bootstrap jobs', async () => {
    bootstrapService.createJob.mockResolvedValue({
      id: 'job-1',
      status: 'PENDING',
    } as any);

    await request(httpApp)
      .post('/api/v1/bootstrap/jobs')
      .send({
        tenantId: 'tenant-1',
        name: '费用报销接入',
        oaUrl: 'https://oa.example.com',
        accessMode: 'backend_api',
        apiDocType: 'openapi',
        apiDocUrl: 'https://oa.example.com/openapi.json',
        authConfig: {
          username: 'tester',
          password: 'secret',
        },
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toBe('job-1');
      });

    expect(bootstrapService.createJob).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      name: '费用报销接入',
      oaUrl: 'https://oa.example.com',
      accessMode: 'backend_api',
      apiDocType: 'openapi',
      apiDocUrl: 'https://oa.example.com/openapi.json',
      authConfig: {
        username: 'tester',
        password: 'secret',
      },
    });

    await request(httpApp)
      .post('/api/v1/bootstrap/jobs')
      .send({
        oaUrl: 'not-a-url',
        bootstrapMode: 'invalid-mode',
      })
      .expect(400);
  });

  it('accepts text-guide bootstrap payloads using the recommended template format', async () => {
    bootstrapService.createJob.mockResolvedValue({
      id: 'job-text-guide',
      status: 'PENDING',
    } as any);

    const textGuide = [
      '# 全局',
      '入口链接: https://oa.example.com/workbench',
      '执行方式: browser',
      '## 流程: 请假申请',
      '流程编码: leave_request',
      '参数:',
      '- 开始日期 | date | 必填',
      '- 结束日期 | date | 必填',
      '- 请假原因 | textarea | 必填',
      '步骤:',
      '- 点击 申请中心',
      '- 点击 请假申请',
      '- 输入 开始日期',
      '- 输入 结束日期',
      '- 输入 请假原因',
      '- 点击 提交',
      '- 看到 已提交 就结束',
      '测试样例:',
      '- 开始日期: 2026-04-01',
      '- 结束日期: 2026-04-02',
      '- 请假原因: 家中有事',
    ].join('\n');

    await request(httpApp)
      .post('/api/v1/bootstrap/jobs')
      .send({
        tenantId: 'tenant-1',
        name: '请假流程注册',
        oaUrl: 'https://oa.example.com',
        accessMode: 'text_guide',
        rpaFlowContent: textGuide,
        platformConfig: {
          entryUrl: 'https://oa.example.com/workbench',
          executorMode: 'browser',
        },
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toBe('job-text-guide');
      });

    expect(bootstrapService.createJob).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      name: '请假流程注册',
      oaUrl: 'https://oa.example.com',
      accessMode: 'text_guide',
      rpaFlowContent: textGuide,
      platformConfig: {
        entryUrl: 'https://oa.example.com/workbench',
        executorMode: 'browser',
      },
    });
  });

  it('routes query, report, reactivate, and delete endpoints correctly', async () => {
    bootstrapService.listJobs.mockResolvedValue([
      { id: 'job-1', name: '费用报销接入' },
    ] as any);
    bootstrapService.getJob.mockResolvedValue({
      id: 'job-1',
      status: 'FAILED',
    } as any);
    bootstrapService.getReport.mockResolvedValue({
      jobId: 'job-1',
      summary: '需要人工修复',
    } as any);
    bootstrapService.reactivate.mockResolvedValue({
      id: 'job-2',
      status: 'PENDING',
    } as any);
    bootstrapService.deleteJob.mockResolvedValue({
      deleted: true,
      jobId: 'job-1',
    } as any);

    await request(httpApp)
      .get('/api/v1/bootstrap/jobs')
      .query({ tenantId: 'tenant-1' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
      });

    await request(httpApp)
      .get('/api/v1/bootstrap/jobs/job-1')
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe('job-1');
      });

    await request(httpApp)
      .get('/api/v1/bootstrap/jobs/job-1/report')
      .expect(200)
      .expect(({ body }) => {
        expect(body.jobId).toBe('job-1');
      });

    await request(httpApp)
      .post('/api/v1/bootstrap/jobs/job-1/reactivate')
      .send({
        mode: 'new',
        accessMode: 'text_guide',
        oaUrl: 'https://oa.example.com',
        rpaFlowContent: [
          '点击 新建申请',
          '输入 请假原因 为 家中有事',
          '点击 提交',
        ].join('\n'),
        platformConfig: {
          entryUrl: 'https://oa.example.com/login',
          executorMode: 'browser',
        },
        authConfig: {
          username: 'tester',
        },
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toBe('job-2');
      });

    await request(httpApp)
      .delete('/api/v1/bootstrap/jobs/job-1')
      .expect(200)
      .expect(({ body }) => {
        expect(body.deleted).toBe(true);
      });

    expect(bootstrapService.listJobs).toHaveBeenCalledWith('tenant-1');
    expect(bootstrapService.getJob).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(bootstrapService.getReport).toHaveBeenCalledWith('job-1', 'tenant-1');
    expect(bootstrapService.reactivate).toHaveBeenCalledWith('job-1', 'tenant-1', 'new', {
      apiDocContent: undefined,
      apiDocUrl: undefined,
      apiDocType: undefined,
      rpaFlowContent: [
        '点击 新建申请',
        '输入 请假原因 为 家中有事',
        '点击 提交',
      ].join('\n'),
      rpaSourceType: undefined,
      platformConfig: {
        entryUrl: 'https://oa.example.com/login',
        executorMode: 'browser',
      },
      accessMode: 'text_guide',
      bootstrapMode: undefined,
      oaUrl: 'https://oa.example.com',
      authConfig: {
        username: 'tester',
      },
    });
    expect(bootstrapService.deleteJob).toHaveBeenCalledWith('job-1', 'tenant-1');
  });
});
