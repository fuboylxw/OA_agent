import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AuthService,
      useValue: {
        login: jest.fn(),
        getUserInfo: jest.fn(),
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
class AuthHttpTestModule {}

describe('Auth HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let authService: { login: jest.Mock; getUserInfo: jest.Mock };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    authService = moduleFixture.get(AuthService);
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

  it('keeps login public and forwards tenant-aware credentials', async () => {
    authService.login.mockResolvedValue({
      accessToken: 'session-token',
      user: { id: 'user-1' },
    });

    await request(httpApp)
      .post('/api/v1/auth/login')
      .send({
        username: 'alice',
        password: 'secret',
        tenantId: 'tenant-1',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.accessToken).toBe('session-token');
      });

    expect(authService.login).toHaveBeenCalledWith('alice', 'secret', 'tenant-1');
    expect(requestAuth.resolveUser).not.toHaveBeenCalled();
  });

  it('resolves the current user before returning user info', async () => {
    authService.getUserInfo.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
    });

    await request(httpApp)
      .get('/api/v1/auth/user-info')
      .query({ userId: 'user-1' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe('user-1');
      });

    expect(requestAuth.resolveUser).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1',
      requireUser: true,
    });
    expect(authService.getUserInfo).toHaveBeenCalledWith('user-1');
  });
});
