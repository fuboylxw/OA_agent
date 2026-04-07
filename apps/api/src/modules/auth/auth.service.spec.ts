import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma.service';
import { Prisma } from '@prisma/client';
import { verifyAuthSessionToken } from '@uniflow/shared-types';

describe('AuthService', () => {
  let service: AuthService;
  let delegatedCredentialService: {
    seedMockCredentialsForUser: jest.Mock;
  };
  let prisma: {
    user: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SESSION_SECRET = 'test-session-secret';
    delete process.env.AUTH_USER_PASSWORD_HASHES;
    process.env.AUTH_ALLOW_LEGACY_PASSWORDS = 'true';
    delete process.env.DEFAULT_TENANT_ID;

    prisma = {
      user: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    delegatedCredentialService = {
      seedMockCredentialsForUser: jest.fn().mockResolvedValue(0),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      delegatedCredentialService as any,
    );
  });

  it('issues a signed session token on successful legacy login', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      username: 'admin',
      displayName: 'Administrator',
      roles: ['admin'],
      status: 'active',
    });

    const result = await service.login('admin', 'admin', 'tenant-1');

    expect(result.sessionToken).toBeDefined();
    const claims = verifyAuthSessionToken(result.sessionToken, 'test-session-secret');
    expect(claims).toEqual(expect.objectContaining({
      userId: 'user-1',
      username: 'admin',
      tenantId: 'tenant-1',
      roles: ['admin'],
    }));
    expect(delegatedCredentialService.seedMockCredentialsForUser).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });

  it('supports configured credentials when legacy passwords are disabled', async () => {
    process.env.AUTH_ALLOW_LEGACY_PASSWORDS = 'false';
    process.env.AUTH_USER_PASSWORD_HASHES = JSON.stringify({
      'tenant-1:admin': 'plain:secure123',
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      username: 'admin',
      displayName: 'Administrator',
      roles: ['admin'],
      status: 'active',
    });

    await expect(service.login('admin', 'admin', 'tenant-1')).rejects.toThrow('用户名或密码错误');

    const result = await service.login('admin', 'secure123', 'tenant-1');
    expect(result.userId).toBe('user-1');
  });

  it('falls back to the only active tenant match when tenantId is omitted', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        tenantId: 'tenant-seeded',
        username: 'admin',
        displayName: 'Administrator',
        roles: ['admin'],
        status: 'active',
      },
    ]);

    const result = await service.login('admin', 'admin');
    expect(result.userId).toBe('user-1');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        username: 'admin',
        status: 'active',
      }),
    }));
  });

  it('surfaces database availability errors during login', async () => {
    prisma.user.findMany.mockRejectedValue(
      new Prisma.PrismaClientInitializationError("Can't reach database server", 'test'),
    );

    await expect(service.login('admin', 'admin')).rejects.toThrow('数据库未启动，当前无法登录');
  });
});
