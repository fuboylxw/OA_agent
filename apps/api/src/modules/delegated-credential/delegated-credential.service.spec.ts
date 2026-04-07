import { PrismaService } from '../common/prisma.service';
import {
  decryptDelegatedCredentialPayload,
  encryptDelegatedCredentialPayload,
} from './delegated-credential-crypto';
import { DelegatedCredentialService } from './delegated-credential.service';

describe('DelegatedCredentialService', () => {
  let service: DelegatedCredentialService;
  let prisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    connector: { findMany: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SESSION_SECRET = 'test-session-secret';
    delete process.env.DELEGATED_CREDENTIAL_SECRET;

    prisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      connector: {
        findMany: jest.fn(),
      },
    };

    service = new DelegatedCredentialService(prisma as unknown as PrismaService);
  });

  it('seeds mock credentials only for delegated connectors', async () => {
    prisma.connector.findMany.mockResolvedValue([
      {
        id: 'connector-enabled',
        authType: 'bearer',
        authConfig: {
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
          },
        },
      },
      {
        id: 'connector-disabled',
        authType: 'bearer',
        authConfig: {},
      },
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { table_name: 'user_delegated_credentials' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'credential-1',
          providerType: 'mock',
          status: 'active',
          encryptedAccessToken: 'encrypted',
          accessTokenExpiresAt: new Date('2099-04-01T00:00:00.000Z'),
        },
      ]);

    const seeded = await service.seedMockCredentialsForUser({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(seeded).toBe(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    const encryptedToken = prisma.$queryRaw.mock.calls[1][8] as string;
    expect(decryptDelegatedCredentialPayload<string>(encryptedToken)).toContain('mock.tenant-1.user-1.connector-enabled');
  });

  it('creates a mock credential lazily and resolves runtime auth config', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { table_name: 'user_delegated_credentials' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'credential-1',
          providerType: 'mock',
          status: 'active',
          encryptedAccessToken: encryptDelegatedCredentialPayload('mock.tenant-1.user-1.connector-1'),
          accessTokenExpiresAt: new Date('2099-04-01T00:00:00.000Z'),
        },
      ]);
    prisma.$executeRaw.mockResolvedValue(1);

    const result = await service.resolveExecutionAuthConfig({
      tenantId: 'tenant-1',
      userId: 'user-1',
      connectorId: 'connector-1',
      authType: 'bearer',
      baseAuthConfig: {
        delegatedAuth: {
          enabled: true,
          mode: 'mock',
        },
      },
    });

    expect(result).toEqual({
      providerType: 'mock',
      authConfig: expect.objectContaining({
        accessToken: expect.stringContaining('mock.tenant-1.user-1.connector-1'),
        token: expect.stringContaining('mock.tenant-1.user-1.connector-1'),
      }),
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('falls back to an ephemeral mock credential when the delegated credential table is missing', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(0);

    const result = await service.resolveExecutionAuthConfig({
      tenantId: 'tenant-1',
      userId: 'user-1',
      connectorId: 'connector-1',
      authType: 'bearer',
      baseAuthConfig: {
        delegatedAuth: {
          enabled: true,
          mode: 'mock',
        },
      },
    });

    expect(result).toEqual({
      providerType: 'mock',
      authConfig: expect.objectContaining({
        accessToken: expect.stringContaining('mock.tenant-1.user-1.connector-1'),
        token: expect.stringContaining('mock.tenant-1.user-1.connector-1'),
      }),
    });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
