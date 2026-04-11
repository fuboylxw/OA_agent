import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PermissionController } from '../src/modules/permission/permission.controller';
import { PermissionService } from '../src/modules/permission/permission.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [PermissionController],
  providers: [
    {
      provide: PermissionService,
      useValue: {
        check: jest.fn(),
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
class PermissionHttpTestModule {}

describe('Permission HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let permissionService: { check: jest.Mock };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PermissionHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    permissionService = moduleFixture.get(PermissionService);
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

  it('routes permission checks through request auth with trace metadata', async () => {
    permissionService.check.mockResolvedValue({
      allowed: true,
      reason: 'allowed',
    });

    await request(httpApp)
      .post('/api/v1/permission/check')
      .send({
        tenantId: 'tenant-1',
        userId: 'user-1',
        processCode: 'expense_apply',
        action: 'submit',
        context: { amount: 128 },
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.allowed).toBe(true);
      });

    expect(requestAuth.resolveUser).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      userId: 'user-1',
      requireUser: true,
    });
    expect(permissionService.check).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      processCode: 'expense_apply',
      action: 'submit',
      context: { amount: 128 },
      traceId: expect.any(String),
    }));
  });

  it('rejects invalid permission actions at the DTO layer', async () => {
    await request(httpApp)
      .post('/api/v1/permission/check')
      .send({
        tenantId: 'tenant-1',
        userId: 'user-1',
        processCode: 'expense_apply',
        action: 'approve',
      })
      .expect(400);
  });
});
