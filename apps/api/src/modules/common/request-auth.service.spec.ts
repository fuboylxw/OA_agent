import { issueAuthSessionToken } from '@uniflow/shared-types';
import { TenantUserResolverService } from './tenant-user-resolver.service';
import { RequestAuthService } from './request-auth.service';

describe('RequestAuthService', () => {
  let service: RequestAuthService;
  let tenantUserResolver: {
    resolve: jest.Mock;
  };

  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET = 'request-auth-secret';

    tenantUserResolver = {
      resolve: jest.fn(),
    };

    service = new RequestAuthService(
      tenantUserResolver as unknown as TenantUserResolverService,
    );
  });

  it('prefers bearer session over request parameters', async () => {
    const { token } = issueAuthSessionToken({
      userId: 'session-user',
      username: 'admin',
      displayName: 'Admin',
      roles: ['admin'],
      tenantId: 'tenant-session',
    }, 'request-auth-secret');

    const result = await service.resolveUser({
      header: (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${token}` : '',
      body: { tenantId: 'tenant-body', userId: 'body-user' },
      query: {},
      params: {},
    } as any);

    expect(result).toEqual(expect.objectContaining({
      tenantId: 'tenant-session',
      userId: 'session-user',
      roles: ['admin'],
      source: 'session',
    }));
    expect(tenantUserResolver.resolve).not.toHaveBeenCalled();
  });

  it('falls back to request tenant and user when no session is provided', async () => {
    tenantUserResolver.resolve.mockResolvedValue({
      id: 'user-1',
      username: 'tester',
      displayName: 'Test User',
      roles: ['user'],
    });

    const result = await service.resolveUser({
      header: () => '',
      body: { tenantId: 'tenant-1' },
      query: { userId: 'user-1' },
      params: {},
    } as any);

    expect(result).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      roles: ['user'],
      source: 'request',
    }));
    expect(tenantUserResolver.resolve).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      allowFallback: false,
    });
  });

  it('throws when an invalid bearer token is supplied', async () => {
    await expect(service.resolveUser({
      header: (name: string) => name.toLowerCase() === 'authorization' ? 'Bearer invalid-token' : '',
      body: {},
      query: {},
      params: {},
    } as any)).rejects.toThrow('登录状态已失效，请重新登录');
  });
});
