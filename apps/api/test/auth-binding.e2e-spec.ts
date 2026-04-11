import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthBindingController } from '../src/modules/auth-binding/auth-binding.controller';
import { AuthBindingService } from '../src/modules/auth-binding/auth-binding.service';
import { RequestAuthService } from '../src/modules/common/request-auth.service';

@Module({
  controllers: [AuthBindingController],
  providers: [
    {
      provide: AuthBindingService,
      useValue: {
        createBinding: jest.fn(),
        listBindings: jest.fn(),
        getBinding: jest.fn(),
        markDefault: jest.fn(),
        upsertSessionAsset: jest.fn(),
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
class AuthBindingHttpTestModule {}

describe('AuthBinding HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let authBindingService: {
    createBinding: jest.Mock;
    listBindings: jest.Mock;
    getBinding: jest.Mock;
    markDefault: jest.Mock;
    upsertSessionAsset: jest.Mock;
  };
  let requestAuth: { resolveUser: jest.Mock };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthBindingHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    authBindingService = moduleFixture.get(AuthBindingService);
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

  it('routes binding CRUD-style endpoints with the current auth scope', async () => {
    authBindingService.createBinding.mockResolvedValue({ id: 'binding-1' });
    authBindingService.listBindings.mockResolvedValue([{ id: 'binding-1' }]);
    authBindingService.getBinding.mockResolvedValue({ id: 'binding-1', connectorId: 'connector-1' });
    authBindingService.markDefault.mockResolvedValue({ id: 'binding-1', isDefault: true });
    authBindingService.upsertSessionAsset.mockResolvedValue({ id: 'asset-1' });

    const createPayload = {
      connectorId: 'connector-1',
      bindingName: 'Primary delegated auth',
      ownerType: 'user',
      authType: 'oauth2',
      authMode: 'api_token',
      metadata: {
        provider: 'sso',
      },
    };

    await request(httpApp)
      .post('/api/v1/auth-bindings')
      .send(createPayload)
      .expect(201);

    await request(httpApp)
      .get('/api/v1/auth-bindings')
      .query({ connectorId: 'connector-1', includeAllUsers: 'true' })
      .expect(200);

    await request(httpApp)
      .get('/api/v1/auth-bindings/binding-1')
      .expect(200);

    await request(httpApp)
      .post('/api/v1/auth-bindings/binding-1/default')
      .expect(201);

    await request(httpApp)
      .post('/api/v1/auth-bindings/binding-1/assets')
      .send({
        assetType: 'cookie_session',
        payload: {
          cookies: ['SESSION=1'],
        },
      })
      .expect(201);

    expect(authBindingService.createBinding).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['user'],
    }), createPayload);
    expect(authBindingService.listBindings).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
    }), {
      connectorId: 'connector-1',
      includeAllUsers: true,
    });
    expect(authBindingService.getBinding).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
    }), 'binding-1');
    expect(authBindingService.markDefault).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
    }), 'binding-1');
    expect(authBindingService.upsertSessionAsset).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
    }), 'binding-1', expect.objectContaining({
      assetType: 'cookie_session',
    }));
  });
});
