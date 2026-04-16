import { AdapterRuntimeService } from './adapter-runtime.service';

describe('AdapterRuntimeService', () => {
  const prisma = {
    bootstrapJob: {
      findFirst: jest.fn(),
    },
  };
  const delegatedCredentialService = {
    resolveExecutionAuthConfig: jest.fn(),
  };
  const authBindingService = {
    resolveExecutionAuthConfig: jest.fn(),
  };
  const oaBackendLoginService = {
    resolveExecutionAuthConfig: jest.fn(),
  };

  let service: AdapterRuntimeService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TEST_RUNTIME_SECRET;
    authBindingService.resolveExecutionAuthConfig.mockResolvedValue(null);
    service = new AdapterRuntimeService(
      prisma as any,
      delegatedCredentialService as any,
      authBindingService as any,
      oaBackendLoginService as any,
    );
  });

  it('merges nested platform secrets from env into runtime auth config', async () => {
    process.env.TEST_RUNTIME_SECRET = JSON.stringify({
      accessToken: 'top-level-token',
      platformConfig: {
        serviceToken: 'platform-service-token',
      },
    });

    const result = await service.resolveAuthConfig({
      id: 'connector-1',
      authType: 'oauth2',
      authConfig: {
        authType: 'oauth2',
        platformConfig: {
          entryUrl: 'https://portal.example.com',
          targetSystem: 'expense-oa',
        },
      },
      secretRef: {
        secretProvider: 'env',
        secretPath: 'TEST_RUNTIME_SECRET',
      },
    });

    expect(result).toEqual({
      authType: 'oauth2',
      accessToken: 'top-level-token',
      platformConfig: {
        entryUrl: 'https://portal.example.com',
        targetSystem: 'expense-oa',
        serviceToken: 'platform-service-token',
      },
    });
  });

  it('falls back to bootstrap auth and restores nested platform secrets', async () => {
    prisma.bootstrapJob.findFirst.mockResolvedValue({
      authConfig: {
        accessToken: 'fallback-token',
        platformConfig: {
          entryUrl: 'https://portal.example.com',
          targetSystem: 'expense-oa',
          serviceToken: 'fallback-service-token',
          ticketHeaderValue: 'fallback-header-value',
        },
      },
    });

    const result = await service.resolveAuthConfig({
      id: 'connector-1',
      authType: 'oauth2',
      authConfig: {
        platformConfig: {
          entryUrl: 'https://portal.example.com',
          targetSystem: 'expense-oa',
        },
      },
      secretRef: {
        secretProvider: 'env',
        secretPath: 'MISSING_SECRET',
      },
    });

    expect(result).toEqual({
      accessToken: 'fallback-token',
      platformConfig: {
        entryUrl: 'https://portal.example.com',
        targetSystem: 'expense-oa',
        serviceToken: 'fallback-service-token',
        ticketHeaderValue: 'fallback-header-value',
      },
    });
  });

  it('overrides runtime auth with resolved delegated credential during execution', async () => {
    delegatedCredentialService.resolveExecutionAuthConfig.mockResolvedValue({
      providerType: 'mock',
      authConfig: {
        accessToken: 'delegated-token',
        platformConfig: {
          serviceToken: 'delegated-service-token',
        },
      },
    });

    const result = await service.resolveAuthConfigForExecution({
      id: 'connector-1',
      authType: 'oauth2',
      authConfig: {
        username: 'alice',
        platformConfig: {
          entryUrl: 'https://portal.example.com',
        },
      },
    }, {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(delegatedCredentialService.resolveExecutionAuthConfig).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      userId: 'user-1',
      authType: 'oauth2',
      baseAuthConfig: {
        username: 'alice',
        platformConfig: {
          entryUrl: 'https://portal.example.com',
        },
      },
    });
    expect(result).toEqual({
      username: 'alice',
      accessToken: 'delegated-token',
      platformConfig: {
        entryUrl: 'https://portal.example.com',
        serviceToken: 'delegated-service-token',
      },
    });
  });

  it('falls back to OA backend login when no binding or delegated credential is available', async () => {
    delegatedCredentialService.resolveExecutionAuthConfig.mockResolvedValue(null);
    oaBackendLoginService.resolveExecutionAuthConfig.mockResolvedValue({
      authConfig: {
        cookie: 'XPU-SESSION=backend-login',
        platformConfig: {
          storageState: {
            cookies: [{
              name: 'XPU-SESSION',
              value: 'backend-login',
              url: 'https://sz.xpu.edu.cn',
            }],
            origins: [],
          },
        },
      },
    });

    const result = await service.resolveAuthConfigForExecution({
      id: 'connector-1',
      authType: 'cookie',
      authConfig: {
        platformConfig: {
          entryUrl: 'https://sz.xpu.edu.cn/',
          oaBackendLogin: {
            enabled: true,
          },
        },
      },
    }, {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(oaBackendLoginService.resolveExecutionAuthConfig).toHaveBeenCalledWith({
      connectorId: 'connector-1',
      authType: 'cookie',
      authConfig: {
        platformConfig: {
          entryUrl: 'https://sz.xpu.edu.cn/',
          oaBackendLogin: {
            enabled: true,
          },
        },
      },
      authScope: {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    });
    expect(result).toEqual({
      cookie: 'XPU-SESSION=backend-login',
      platformConfig: {
        entryUrl: 'https://sz.xpu.edu.cn/',
        oaBackendLogin: {
          enabled: true,
        },
        storageState: {
          cookies: [{
            name: 'XPU-SESSION',
            value: 'backend-login',
            url: 'https://sz.xpu.edu.cn',
          }],
          origins: [],
        },
      },
    });
  });
});
