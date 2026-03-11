import { Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ConnectorController } from '../src/modules/connector/connector.controller';
import { ConnectorService } from '../src/modules/connector/connector.service';

@Module({
  controllers: [ConnectorController],
  providers: [
    {
      provide: ConnectorService,
      useValue: {
        create: jest.fn(),
        list: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        healthCheck: jest.fn(),
      },
    },
  ],
})
class ConnectorHttpTestModule {}

describe('Connector HTTP E2E', () => {
  let app: INestApplication;
  let httpApp: any;
  let connectorService: jest.Mocked<ConnectorService>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConnectorHttpTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();

    httpApp = app.getHttpAdapter().getInstance();
    connectorService = moduleFixture.get(ConnectorService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('validates create payload and forwards enterprise connector config', async () => {
    connectorService.create.mockResolvedValue({
      id: 'connector-1',
      name: 'O2OA Connector',
      oaType: 'openapi',
      authType: 'apikey',
      status: 'active',
    } as any);

    await request(httpApp)
      .post('/api/v1/connectors')
      .send({
        name: 'O2OA Connector',
        oaType: 'openapi',
        oaVendor: 'o2oa',
        oaVersion: 'v8',
        baseUrl: 'https://oa.example.com',
        authType: 'apikey',
        authConfig: {
          tokenField: 'x-token',
          secretProvider: 'env',
          secretPath: 'OA_SECRET_JSON',
        },
        healthCheckUrl: 'https://oa.example.com/health',
        oclLevel: 'OCL4',
        falLevel: 'F2',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toBe('connector-1');
      });

    expect(connectorService.create).toHaveBeenCalledWith({
      name: 'O2OA Connector',
      oaType: 'openapi',
      oaVendor: 'o2oa',
      oaVersion: 'v8',
      baseUrl: 'https://oa.example.com',
      authType: 'apikey',
      authConfig: {
        tokenField: 'x-token',
        secretProvider: 'env',
        secretPath: 'OA_SECRET_JSON',
      },
      healthCheckUrl: 'https://oa.example.com/health',
      oclLevel: 'OCL4',
      falLevel: 'F2',
    });

    await request(httpApp)
      .post('/api/v1/connectors')
      .send({
        name: 'Broken Connector',
        oaType: 'invalid-type',
        baseUrl: 'not-a-url',
        authType: 'apikey',
        authConfig: {},
        oclLevel: 'OCL4',
      })
      .expect(400);
  });

  it('routes update and health-check requests correctly', async () => {
    connectorService.update.mockResolvedValue({
      id: 'connector-1',
      status: 'active',
      oaType: 'hybrid',
    } as any);
    connectorService.healthCheck.mockResolvedValue({
      healthy: true,
      latency: 123,
    } as any);

    await request(httpApp)
      .put('/api/v1/connectors/connector-1')
      .send({
        oaType: 'hybrid',
        authType: 'cookie',
        authConfig: {
          cookieName: 'SESSION',
        },
        oclLevel: 'OCL5',
        status: 'active',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.oaType).toBe('hybrid');
      });

    await request(httpApp)
      .post('/api/v1/connectors/connector-1/health-check')
      .expect(201)
      .expect(({ body }) => {
        expect(body.healthy).toBe(true);
      });

    expect(connectorService.update).toHaveBeenCalledWith('connector-1', {
      oaType: 'hybrid',
      authType: 'cookie',
      authConfig: {
        cookieName: 'SESSION',
      },
      oclLevel: 'OCL5',
      status: 'active',
    });
    expect(connectorService.healthCheck).toHaveBeenCalledWith('connector-1');
  });
});
