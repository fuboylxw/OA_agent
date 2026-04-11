import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { DashboardController } from '../src/modules/dashboard/dashboard.controller';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [DashboardController],
  providers: [
    {
      provide: DashboardService,
      useValue: {
        getOverview: jest.fn(),
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
class DashboardHttpTestModule {}

describe('Dashboard HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let dashboardService: { getOverview: jest.Mock };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DashboardHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    dashboardService = moduleFixture.get(DashboardService);
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

  it('resolves the user before returning dashboard overview data', async () => {
    dashboardService.getOverview.mockResolvedValue({
      pendingCount: 2,
      recentSubmissions: [],
    });

    await request(httpApp)
      .get('/api/v1/dashboard/overview')
      .query({ tenantId: 'tenant-1', userId: 'user-1' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.pendingCount).toBe(2);
      });

    expect(requestAuth.resolveUser).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      userId: 'user-1',
      requireUser: true,
    });
    expect(dashboardService.getOverview).toHaveBeenCalledWith('tenant-1', 'user-1');
  });
});
