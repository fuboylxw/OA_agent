import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../common/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let delegatedCredentialService: {
    seedMockCredentialsForUser: jest.Mock;
  };
  let prisma: {
    user: {
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SESSION_SECRET = 'test-session-secret';
    delete process.env.DEFAULT_TENANT_ID;

    prisma = {
      user: {
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

  it('rejects local username/password login in oauth-only mode', async () => {
    await expect(service.login('admin', 'admin')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.login('admin', 'admin')).rejects.toThrow('系统已切换为第三方认证登录');
  });
});
