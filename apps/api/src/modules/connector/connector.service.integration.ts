import { Test, TestingModule } from '@nestjs/testing';
import { ConnectorService } from './connector.service';
import { PrismaService } from '../common/prisma.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';

describe('ConnectorService Integration', () => {
  let service: ConnectorService;

  const tx = {
    connector: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    connectorCapability: {
      create: jest.fn(),
      upsert: jest.fn(),
    },
    connectorSecretRef: {
      create: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    mCPTool: {
      deleteMany: jest.fn(),
    },
    submission: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    submissionStatus: {
      deleteMany: jest.fn(),
    },
    processDraft: {
      deleteMany: jest.fn(),
    },
    processTemplate: {
      deleteMany: jest.fn(),
    },
  };

  const mockPrisma = {
    $transaction: jest.fn(),
    connector: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockAdapterRuntimeService = {
    createAdapterForConnector: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.DEFAULT_TENANT_ID = 'tenant-default';

    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AdapterRuntimeService, useValue: mockAdapterRuntimeService },
      ],
    }).compile();

    service = module.get(ConnectorService);
  });

  it('creates connector with public auth config, secret ref, and default enterprise sync policy', async () => {
    tx.connector.create.mockResolvedValue({
      id: 'connector-1',
      tenantId: 'tenant-default',
      name: 'O2OA Connector',
    });

    await service.create({
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
        secretVersion: '1',
      },
      healthCheckUrl: 'https://oa.example.com/health',
      oclLevel: 'OCL4',
      falLevel: 'F2',
    }, 'tenant-default');

    expect(tx.connector.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-default',
        name: 'O2OA Connector',
        oaType: 'openapi',
        authConfig: {
          tokenField: 'x-token',
        },
      }),
    });
    expect(tx.connectorSecretRef.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-default',
        connectorId: 'connector-1',
        secretProvider: 'env',
        secretPath: 'OA_SECRET_JSON',
        secretVersion: '1',
      },
    });
    expect(tx.connectorCapability.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-default',
        connectorId: 'connector-1',
        supportsSchemaSync: true,
        supportsReferenceSync: true,
        supportsStatusPull: true,
        supportsWebhook: true,
        syncModes: ['full', 'incremental'],
        metadata: expect.objectContaining({
          inferredFrom: 'connector_create',
          oclLevel: 'OCL4',
          syncPolicy: expect.objectContaining({
            enabled: true,
            domains: expect.objectContaining({
              schema: expect.objectContaining({
                enabled: true,
                intervalMinutes: 360,
              }),
              status: expect.objectContaining({
                enabled: true,
                intervalMinutes: 10,
              }),
            }),
          }),
        }),
      }),
    });
  });

  it('updates oaType, removes inline secret refs when needed, and preserves enterprise metadata', async () => {
    mockPrisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      tenantId: 'tenant-default',
      oaType: 'openapi',
      oaVendor: 'o2oa',
      oaVersion: 'v8',
      baseUrl: 'https://oa.example.com',
      authType: 'apikey',
      authConfig: {
        tokenField: 'x-token',
      },
      healthCheckUrl: 'https://oa.example.com/health',
      oclLevel: 'OCL3',
      falLevel: 'F1',
      capability: {
        metadata: {
          webhookConfig: {
            signatureHeader: 'x-webhook-signature',
          },
          syncPolicy: {
            enabled: true,
            domains: {
              status: {
                enabled: true,
                intervalMinutes: 5,
              },
            },
          },
          customTag: 'keep-me',
        },
      },
    });

    tx.connector.update.mockResolvedValue({
      id: 'connector-1',
      tenantId: 'tenant-default',
      name: 'Connector Updated',
      oaType: 'hybrid',
      oaVendor: 'o2oa',
      oaVersion: 'v9',
      baseUrl: 'https://oa2.example.com',
      authType: 'cookie',
      authConfig: {
        cookieName: 'SESSION',
      },
      healthCheckUrl: 'https://oa2.example.com/health',
      oclLevel: 'OCL5',
      falLevel: 'F4',
      status: 'active',
    });

    await service.update('connector-1', 'tenant-default', {
      name: 'Connector Updated',
      oaType: 'hybrid',
      oaVersion: 'v9',
      baseUrl: 'https://oa2.example.com',
      authType: 'cookie',
      authConfig: {
        cookieName: 'SESSION',
      },
      healthCheckUrl: 'https://oa2.example.com/health',
      oclLevel: 'OCL5',
      falLevel: 'F4',
      status: 'active',
    });

    expect(tx.connector.update).toHaveBeenCalledWith({
      where: { id: 'connector-1' },
      data: expect.objectContaining({
        name: 'Connector Updated',
        oaType: 'hybrid',
        authType: 'cookie',
        authConfig: {
          cookieName: 'SESSION',
        },
        oclLevel: 'OCL5',
      }),
    });
    expect(tx.connectorSecretRef.deleteMany).toHaveBeenCalledWith({
      where: { connectorId: 'connector-1' },
    });
    expect(tx.connectorCapability.upsert).toHaveBeenCalledWith({
      where: { connectorId: 'connector-1' },
      create: expect.objectContaining({
        tenantId: 'tenant-default',
        connectorId: 'connector-1',
        supportsWebhook: true,
        metadata: expect.objectContaining({
          inferredFrom: 'connector_update',
          oclLevel: 'OCL5',
          webhookConfig: {
            signatureHeader: 'x-webhook-signature',
          },
          customTag: 'keep-me',
          syncPolicy: {
            enabled: true,
            domains: {
              status: {
                enabled: true,
                intervalMinutes: 5,
              },
            },
          },
        }),
      }),
      update: expect.objectContaining({
        metadata: expect.objectContaining({
          inferredFrom: 'connector_update',
          webhookConfig: {
            signatureHeader: 'x-webhook-signature',
          },
          customTag: 'keep-me',
        }),
      }),
    });
  });
});
