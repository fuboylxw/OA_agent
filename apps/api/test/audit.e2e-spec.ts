import { ForbiddenException, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AuditController } from '../src/modules/audit/audit.controller';
import { AuditService } from '../src/modules/audit/audit.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [AuditController],
  providers: [
    {
      provide: AuditService,
      useValue: {
        queryLogs: jest.fn(),
        getTrace: jest.fn(),
        getStats: jest.fn(),
        queryRuntimeDiagnostics: jest.fn(),
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
class AuditHttpTestModule {}

describe('Audit HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let auditService: {
    queryLogs: jest.Mock;
    getTrace: jest.Mock;
    getStats: jest.Mock;
    queryRuntimeDiagnostics: jest.Mock;
  };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuditHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    auditService = moduleFixture.get(AuditService);
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

  it('routes audit queries and admin-only endpoints with parsed filters', async () => {
    auditService.queryLogs.mockResolvedValue({ logs: [], total: 0 });
    auditService.getTrace.mockResolvedValue({ traceId: 'trace-1', logs: [] });
    auditService.getStats.mockResolvedValue({ total: 3, byAction: [], byResult: [] });
    auditService.queryRuntimeDiagnostics.mockResolvedValue({ items: [], total: 0 });

    await request(httpApp)
      .get('/api/v1/audit/logs')
      .query({
        tenantId: 'tenant-1',
        userId: 'user-2',
        action: 'submit',
        result: 'success',
        traceId: 'trace-1',
        startDate: '2026-04-01T00:00:00.000Z',
        endDate: '2026-04-02T00:00:00.000Z',
        limit: '20',
        offset: '5',
      })
      .expect(200);

    await request(httpApp)
      .get('/api/v1/audit/trace/trace-1')
      .query({ tenantId: 'tenant-1' })
      .expect(200);

    await request(httpApp)
      .get('/api/v1/audit/stats')
      .query({
        tenantId: 'tenant-1',
        startDate: '2026-04-01T00:00:00.000Z',
      })
      .expect(200);

    await request(httpApp)
      .get('/api/v1/audit/runtime-events')
      .query({
        tenantId: 'tenant-1',
        category: 'system',
        eventType: 'audit_error',
        level: 'error',
        limit: '10',
      })
      .expect(200);

    expect(auditService.queryLogs).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-2',
      action: 'submit',
      result: 'success',
      traceId: 'trace-1',
      limit: 20,
      offset: 5,
    }));
    expect(auditService.getTrace).toHaveBeenCalledWith('tenant-1', 'trace-1');
    expect(auditService.getStats).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      startDate: expect.any(Date),
    }));
    expect(auditService.queryRuntimeDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      category: 'system',
      eventType: 'audit_error',
      level: 'error',
      limit: 10,
    }));
  });

  it('forbids non-admin users from reading trace details', async () => {
    requestAuth.resolveUser.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['user'],
      source: 'session',
    });

    await request(httpApp)
      .get('/api/v1/audit/trace/trace-1')
      .query({ tenantId: 'tenant-1' })
      .expect(403);
  });
});
