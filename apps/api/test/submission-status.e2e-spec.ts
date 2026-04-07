import { Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { SubmissionController } from '../src/modules/submission/submission.controller';
import { SubmissionService } from '../src/modules/submission/submission.service';
import { StatusController } from '../src/modules/status/status.controller';
import { StatusService } from '../src/modules/status/status.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [SubmissionController, StatusController],
  providers: [
    {
      provide: SubmissionService,
      useValue: {
        submit: jest.fn(),
        listSubmissions: jest.fn(),
        getSubmission: jest.fn(),
        cancel: jest.fn(),
        urge: jest.fn(),
        supplement: jest.fn(),
        delegate: jest.fn(),
      },
    },
    {
      provide: StatusService,
      useValue: {
        queryStatus: jest.fn(),
        listMySubmissions: jest.fn(),
        getTimeline: jest.fn(),
      },
    },
    {
      provide: RequestAuthService,
      useValue: {
        resolveUser: jest.fn().mockResolvedValue({
          tenantId: 'tenant-default',
          userId: 'user-1',
          roles: ['user'],
          source: 'request',
        }),
      },
    },
  ],
})
class SubmissionStatusHttpTestModule {}

describe('Submission/Status HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let submissionService: jest.Mocked<SubmissionService>;
  let statusService: jest.Mocked<StatusService>;
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    process.env.DEFAULT_TENANT_ID = 'tenant-default';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [SubmissionStatusHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    submissionService = moduleFixture.get(SubmissionService);
    statusService = moduleFixture.get(StatusService);
    requestAuth = moduleFixture.get(RequestAuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    requestAuth.resolveUser.mockResolvedValue({
      tenantId: 'tenant-default',
      userId: 'user-1',
      roles: ['user'],
      source: 'request',
    });
  });

  it('validates submit payload and routes submission actions with expected arguments', async () => {
    submissionService.submit.mockResolvedValue({
      submissionId: 'submission-1',
      status: 'pending',
      message: '申请已提交，正在处理中',
    } as any);
    submissionService.supplement.mockResolvedValue({
      success: true,
      message: '补件成功',
    } as any);
    submissionService.delegate.mockResolvedValue({
      success: true,
      message: '转办成功',
    } as any);
    submissionService.cancel.mockResolvedValue({
      success: true,
      message: '申请已撤回',
    } as any);
    submissionService.urge.mockResolvedValue({
      success: true,
      message: '催办成功',
    } as any);

    await request(httpApp)
      .post('/api/v1/submissions')
      .send({
        draftId: 'draft-1',
        idempotencyKey: 'idem-1',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.submissionId).toBe('submission-1');
      });

    expect(submissionService.submit).toHaveBeenCalledWith({
      tenantId: 'tenant-default',
      userId: 'user-1',
      draftId: 'draft-1',
      idempotencyKey: 'idem-1',
      traceId: expect.stringMatching(/^submit-/),
    });

    await request(httpApp)
      .post('/api/v1/submissions')
      .send({
        draftId: 'draft-1',
      })
      .expect(400);

    await request(httpApp)
      .post('/api/v1/submissions/submission-1/supplement')
      .query({ userId: 'user-1' })
      .send({
        supplementData: {
          invoiceNo: 'INV-001',
        },
      })
      .expect(201);

    await request(httpApp)
      .post('/api/v1/submissions/submission-1/delegate')
      .query({ userId: 'user-1' })
      .send({
        targetUserId: 'user-2',
        reason: 'backup approver',
      })
      .expect(201);

    await request(httpApp)
      .post('/api/v1/submissions/submission-1/cancel')
      .query({ userId: 'user-1' })
      .expect(201);

    await request(httpApp)
      .post('/api/v1/submissions/submission-1/urge')
      .query({ userId: 'user-1' })
      .expect(201);

    expect(submissionService.supplement).toHaveBeenCalledWith(
      'submission-1',
      'tenant-default',
      'user-1',
      { invoiceNo: 'INV-001' },
      expect.stringMatching(/^supplement-/),
    );
    expect(submissionService.delegate).toHaveBeenCalledWith(
      'submission-1',
      'tenant-default',
      'user-1',
      'user-2',
      'backup approver',
      expect.stringMatching(/^delegate-/),
    );
    expect(submissionService.cancel).toHaveBeenCalledWith(
      'submission-1',
      'tenant-default',
      'user-1',
      expect.stringMatching(/^cancel-/),
    );
    expect(submissionService.urge).toHaveBeenCalledWith(
      'submission-1',
      'tenant-default',
      'user-1',
      expect.stringMatching(/^urge-/),
    );
  });

  it('routes status query, list, and timeline endpoints correctly', async () => {
    statusService.queryStatus.mockResolvedValue({
      submissionId: 'submission-1',
      status: 'submitted',
      timeline: [],
      statusRecords: [],
    } as any);
    statusService.listMySubmissions.mockResolvedValue([
      {
        id: 'submission-1',
        status: 'submitted',
      },
    ] as any);
    statusService.getTimeline.mockResolvedValue([
      {
        status: 'created',
        description: '申请已创建',
      },
    ] as any);

    await request(httpApp)
      .get('/api/v1/status/submissions/submission-1')
      .expect(200)
      .expect(({ body }) => {
        expect(body.submissionId).toBe('submission-1');
      });

    await request(httpApp)
      .get('/api/v1/status/my')
      .query({
        tenantId: 'tenant-default',
        userId: 'user-1',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
      });

    await request(httpApp)
      .get('/api/v1/status/submissions/submission-1/timeline')
      .expect(200)
      .expect(({ body }) => {
        expect(body[0].status).toBe('created');
      });

    expect(statusService.queryStatus).toHaveBeenCalledWith(
      'submission-1',
      'tenant-default',
      expect.stringMatching(/^status-/),
      'user-1',
    );
    expect(statusService.listMySubmissions).toHaveBeenCalledWith('tenant-default', 'user-1');
    expect(statusService.getTimeline).toHaveBeenCalledWith('submission-1', 'tenant-default', 'user-1');
  });
});
