import { ExistingAdapterProvider } from './existing-adapter-provider';

describe('ExistingAdapterProvider', () => {
  const adapterRuntimeService = {
    resolveAuthConfig: jest.fn(),
    resolveAuthConfigForExecution: jest.fn(),
  };
  const authBindingService = {
    hasUsableBinding: jest.fn(),
  };

  let provider: ExistingAdapterProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new ExistingAdapterProvider(
      adapterRuntimeService as any,
      authBindingService as any,
    );
  });

  it('uses execution-scoped auth when resolving a user artifact', async () => {
    authBindingService.hasUsableBinding.mockResolvedValue({ authorized: true });
    adapterRuntimeService.resolveAuthConfigForExecution.mockResolvedValue({
      accessToken: 'user-token',
      platformConfig: {
        entryUrl: 'https://portal.example.com',
      },
    });

    await expect(provider.resolveArtifact({
      connector: {
        id: 'connector-1',
        authType: 'oauth2',
        authConfig: {
          delegatedAuth: {
            enabled: true,
            provider: 'sso',
          },
        },
      },
      authChoice: {
        id: 'delegated',
        mode: 'user',
        artifact: 'bearer_token',
        interactive: true,
        callback: 'oauth2',
      },
      authScope: {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    })).resolves.toEqual(expect.objectContaining({
      type: 'bearer_token',
      payload: expect.objectContaining({
        accessToken: 'user-token',
      }),
    }));

    expect(adapterRuntimeService.resolveAuthConfigForExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'connector-1',
      }),
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    );
  });

  it('returns null when delegated auth has no usable binding', async () => {
    authBindingService.hasUsableBinding.mockResolvedValue({ authorized: false });

    await expect(provider.resolveArtifact({
      connector: {
        id: 'connector-1',
        authType: 'oauth2',
        authConfig: {
          delegatedAuth: {
            enabled: true,
            provider: 'sso',
          },
        },
      },
      authChoice: {
        id: 'delegated',
        mode: 'user',
        artifact: 'bearer_token',
        interactive: true,
        callback: 'oauth2',
      },
      authScope: {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    })).resolves.toBeNull();
  });
});
