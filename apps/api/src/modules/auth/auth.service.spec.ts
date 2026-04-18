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
    process.env.AUTH_OAUTH2_BASE_URL = 'https://oauth.example.com';
    process.env.AUTH_OAUTH2_CLIENT_ID = 'client-id';
    delete process.env.DEFAULT_TENANT_ID;
    delete process.env.PUBLIC_WEB_BASE_URL;
    delete process.env.AUTH_OAUTH2_REDIRECT_URI;
    delete process.env.AUTH_OAUTH2_LOGOUT_REDIRECT_PARAM;
    delete process.env.AUTH_OAUTH2_LOGOUT_REDIRECT_PARAMS;

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

  it('rewrites oauth callback origin to the current request host', () => {
    process.env.AUTH_OAUTH2_REDIRECT_URI = 'http://202.200.206.250/login/callback';

    const url = service.buildOauth2AuthorizationUrl({
      header: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'x-forwarded-host') return 'uniflow.example.com';
        if (normalized === 'x-forwarded-proto') return 'https';
        if (normalized === 'host') return '127.0.0.1:3001';
        return '';
      },
    } as any, '/chat');

    expect(url).toContain(encodeURIComponent('https://uniflow.example.com/login/callback'));
  });

  it('builds oauth logout callback against the current request host', () => {
    process.env.PUBLIC_WEB_BASE_URL = 'http://202.200.206.250';

    const url = service.buildOauth2LogoutUrl({
      header: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'x-forwarded-host') return 'uniflow.example.com';
        if (normalized === 'x-forwarded-proto') return 'https';
        if (normalized === 'host') return '127.0.0.1:3001';
        return '';
      },
    } as any, '/login?loggedOut=1&returnTo=%2Fchat');

    expect(url).toContain(encodeURIComponent('https://uniflow.example.com/login?loggedOut=1&returnTo=%2Fchat'));
  });

  it('supports configurable oauth logout redirect params', () => {
    process.env.PUBLIC_WEB_BASE_URL = 'http://202.200.206.250';
    process.env.AUTH_OAUTH2_LOGOUT_REDIRECT_PARAMS = 'callback,redirect_uri';

    const url = service.buildOauth2LogoutUrl({
      header: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'x-forwarded-host') return 'uniflow.example.com';
        if (normalized === 'x-forwarded-proto') return 'https';
        if (normalized === 'host') return '127.0.0.1:3001';
        return '';
      },
    } as any, '/login?loggedOut=1&returnTo=%2Fchat');

    expect(url).toContain('callback=');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain(encodeURIComponent('https://uniflow.example.com/login?loggedOut=1&returnTo=%2Fchat'));
  });
});
