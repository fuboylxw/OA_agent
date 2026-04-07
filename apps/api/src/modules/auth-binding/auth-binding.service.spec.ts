import { PrismaService } from '../common/prisma.service';
import { encryptAuthBindingPayload } from './auth-binding-crypto';
import { AuthBindingService } from './auth-binding.service';

describe('AuthBindingService', () => {
  let service: AuthBindingService;
  let prisma: {
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    connector: {
      findFirst: jest.Mock;
    };
    authBinding: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    authSessionAsset: {
      count: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_BINDING_SECRET = 'test-auth-binding-secret';
    process.env.AUTH_SESSION_SECRET = 'test-auth-session-secret';

    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { table_name: 'auth_bindings' },
        { table_name: 'auth_session_assets' },
      ]),
      $transaction: jest.fn(),
      connector: {
        findFirst: jest.fn(),
      },
      authBinding: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      authSessionAsset: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    service = new AuthBindingService(prisma as unknown as PrismaService);
  });

  it('stores session payloads encrypted and does not expose encrypted content in the response', async () => {
    const actor = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['user'],
    };
    const existingBinding = {
      id: 'binding-1',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      userId: 'user-1',
      bindingName: 'OA login',
      ownerType: 'user',
      authType: 'oauth2',
      authMode: 'api_token',
      status: 'active',
      isDefault: true,
      lastBoundAt: null,
      lastUsedAt: null,
      expiresAt: null,
      metadata: null,
      createdAt: new Date('2026-03-30T08:00:00.000Z'),
      updatedAt: new Date('2026-03-30T08:00:00.000Z'),
      sessionAssets: [],
    };
    const tx = {
      authSessionAsset: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'asset-1' }),
      },
      authBinding: {
        update: jest.fn().mockResolvedValue({
          ...existingBinding,
          lastBoundAt: new Date('2026-03-30T09:00:00.000Z'),
          updatedAt: new Date('2026-03-30T09:00:00.000Z'),
          sessionAssets: [
            {
              id: 'asset-1',
              assetType: 'api_token',
              status: 'active',
              issuedAt: new Date('2026-03-30T09:00:00.000Z'),
              expiresAt: null,
              lastValidatedAt: null,
              metadata: {
                source: 'manual-login',
              },
              createdAt: new Date('2026-03-30T09:00:00.000Z'),
              updatedAt: new Date('2026-03-30T09:00:00.000Z'),
            },
          ],
        }),
      },
    };

    prisma.authBinding.findFirst.mockResolvedValue(existingBinding);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await service.upsertSessionAsset(actor, 'binding-1', {
      assetType: 'api_token',
      payload: {
        accessToken: 'secret-token-value',
        refreshToken: 'refresh-token-value',
      },
      metadata: {
        source: 'manual-login',
      },
    });

    const createdPayload = tx.authSessionAsset.create.mock.calls[0][0].data.encryptedPayload;
    expect(createdPayload).toEqual(expect.any(String));
    expect(createdPayload).not.toContain('secret-token-value');
    expect(createdPayload).not.toContain('refresh-token-value');
    expect(result).toEqual(expect.objectContaining({
      id: 'binding-1',
      sessionAssets: [
        expect.objectContaining({
          id: 'asset-1',
          assetType: 'api_token',
          status: 'active',
          metadata: {
            source: 'manual-login',
          },
        }),
      ],
    }));
    expect(result.sessionAssets[0]).not.toHaveProperty('encryptedPayload');
  });

  it('merges multiple active asset fragments into one runtime auth config', async () => {
    prisma.authBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      userId: 'user-1',
      ownerType: 'user',
      authType: 'oauth2',
      authMode: 'browser_session',
      status: 'active',
      isDefault: true,
      updatedAt: new Date('2026-03-30T09:00:00.000Z'),
    });
    prisma.authSessionAsset.findMany.mockResolvedValue([
      {
        id: 'asset-browser',
        assetType: 'browser_session',
        encryptedPayload: encryptAuthBindingPayload({
          storageState: '{"cookies":[{"name":"sid","value":"abc"}]}',
        }),
        createdAt: new Date('2026-03-30T09:03:00.000Z'),
      },
      {
        id: 'asset-auth',
        assetType: 'auth_payload',
        encryptedPayload: encryptAuthBindingPayload({
          username: 'alice',
          password: 'secret',
          platformConfig: {
            ticketHeaderValue: 'header-ticket',
          },
        }),
        createdAt: new Date('2026-03-30T09:02:00.000Z'),
      },
      {
        id: 'asset-jump',
        assetType: 'jump_ticket',
        encryptedPayload: encryptAuthBindingPayload('https://portal.example.com/jump/123'),
        createdAt: new Date('2026-03-30T09:01:00.000Z'),
      },
      {
        id: 'asset-token',
        assetType: 'api_token',
        encryptedPayload: encryptAuthBindingPayload('token-abc'),
        createdAt: new Date('2026-03-30T09:00:00.000Z'),
      },
    ]);
    prisma.authBinding.update.mockResolvedValue({
      id: 'binding-1',
    });

    const result = await service.resolveExecutionAuthConfig({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      userId: 'user-1',
      authBindingId: 'binding-1',
    });

    expect(result).toEqual({
      authBindingId: 'binding-1',
      authType: 'oauth2',
      authMode: 'browser_session',
      authConfig: {
        username: 'alice',
        password: 'secret',
        accessToken: 'token-abc',
        token: 'token-abc',
        platformConfig: {
          storageState: '{"cookies":[{"name":"sid","value":"abc"}]}',
          ticketHeaderValue: 'header-ticket',
          jumpUrl: 'https://portal.example.com/jump/123',
        },
      },
    });
    expect(prisma.authBinding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'binding-1' },
      data: expect.objectContaining({
        lastUsedAt: expect.any(Date),
      }),
    }));
  });

  it('prefers a user default binding before a service binding when resolving execution auth', async () => {
    prisma.authBinding.findFirst.mockResolvedValueOnce({
      id: 'binding-user-default',
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      userId: 'user-1',
      ownerType: 'user',
      authType: 'cookie',
      authMode: 'cookie_session',
      status: 'active',
      isDefault: true,
      updatedAt: new Date('2026-03-30T09:00:00.000Z'),
    });
    prisma.authSessionAsset.findMany.mockResolvedValue([
      {
        id: 'asset-cookie',
        assetType: 'cookie_session',
        encryptedPayload: encryptAuthBindingPayload('sid=abc; Path=/; HttpOnly'),
        createdAt: new Date('2026-03-30T09:00:00.000Z'),
      },
    ]);
    prisma.authBinding.update.mockResolvedValue({
      id: 'binding-user-default',
    });

    const result = await service.resolveExecutionAuthConfig({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      userId: 'user-1',
    });

    expect(prisma.authBinding.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        userId: 'user-1',
        status: 'active',
        isDefault: true,
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      authBindingId: 'binding-user-default',
      authConfig: {
        cookie: 'sid=abc; Path=/; HttpOnly',
        sessionCookie: 'sid=abc; Path=/; HttpOnly',
      },
    }));
  });

  it('returns null when auth binding tables are missing during execution auth resolution', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.resolveExecutionAuthConfig({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      userId: 'user-1',
    })).resolves.toBeNull();
  });

  it('treats missing auth binding tables as no usable binding', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.hasUsableBinding({
      tenantId: 'tenant-1',
      connectorId: 'connector-1',
      userId: 'user-1',
    })).resolves.toEqual({ authorized: false });
  });
});
