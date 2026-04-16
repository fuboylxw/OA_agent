import { OaBackendLoginService } from './oa-backend-login.service';

describe('OaBackendLoginService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
    },
    authBinding: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    authSessionAsset: {
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => callback({
      authSessionAsset: prisma.authSessionAsset,
      authBinding: prisma.authBinding,
    })),
  };

  let service: OaBackendLoginService;
  const originalClientId = process.env.AUTH_OAUTH2_CLIENT_ID;
  const originalPrivateKey = process.env.AUTH_OAUTH2_PRIVATE_KEY;

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.AUTH_OAUTH2_CLIENT_ID;
    } else {
      process.env.AUTH_OAUTH2_CLIENT_ID = originalClientId;
    }

    if (originalPrivateKey === undefined) {
      delete process.env.AUTH_OAUTH2_PRIVATE_KEY;
    } else {
      process.env.AUTH_OAUTH2_PRIVATE_KEY = originalPrivateKey;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      username: 'alice',
      email: 'alice@example.com',
      oaUserId: '2023002',
    });
    service = new OaBackendLoginService(prisma as any);
  });

  it('builds browser auth config from Set-Cookie headers', async () => {
    jest.spyOn(service as any, 'signPayload').mockReturnValue('signed-value');
    (service as any).client.request = jest.fn().mockResolvedValue({
      status: 200,
      headers: {
        'set-cookie': [
          'XPU-SESSION=session-token; Path=/; HttpOnly; SameSite=Lax',
        ],
      },
      data: {
        status: 'success',
      },
    });

    const result = await service.resolveExecutionAuthConfig({
      connectorId: 'connector-1',
      authType: 'oauth2',
      authScope: {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      authConfig: {
        platformConfig: {
          oaBackendLogin: {
            enabled: true,
            loginUrl: 'https://sz.xpu.edu.cn/auth2/api/v1/login',
            method: 'GET',
            requestMode: 'query',
            clientId: 'client-1',
            privateKey: '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----',
            accountField: 'oaUserId',
            cookieOrigin: 'https://sz.xpu.edu.cn',
            persistBinding: false,
          },
        },
      },
      flow: {
        processCode: 'leave_request',
        processName: '请假申请',
      } as any,
    });

    expect((service as any).client.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      url: 'https://sz.xpu.edu.cn/auth2/api/v1/login',
      params: expect.objectContaining({
        clientId: 'client-1',
        account: '2023002',
        sign: 'signed-value',
      }),
    }));
    expect(result).toEqual({
      authConfig: expect.objectContaining({
        cookie: 'XPU-SESSION=session-token',
        sessionCookie: 'XPU-SESSION=session-token',
        platformConfig: expect.objectContaining({
          cookieOrigin: 'https://sz.xpu.edu.cn',
          storageState: {
            cookies: [expect.objectContaining({
              name: 'XPU-SESSION',
              value: 'session-token',
              path: '/',
              url: 'https://sz.xpu.edu.cn',
            })],
            origins: [],
          },
        }),
      }),
    });
  });

  it('uses response cookie path when no Set-Cookie header is returned', async () => {
    jest.spyOn(service as any, 'signPayload').mockReturnValue('signed-value');
    (service as any).client.request = jest.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: {
        data: {
          sessionCookie: 'XPU-SESSION=session-token; route=portal',
        },
      },
    });

    const result = await service.resolveExecutionAuthConfig({
      connectorId: 'connector-1',
      authType: 'oauth2',
      authScope: {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      authConfig: {
        platformConfig: {
          oaBackendLogin: {
            enabled: true,
            loginUrl: 'https://sz.xpu.edu.cn/auth2/api/v1/login',
            clientId: 'client-1',
            privateKey: '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----',
            responseCookiePath: 'data.sessionCookie',
            cookieOrigin: 'https://sz.xpu.edu.cn',
            persistBinding: false,
          },
        },
      },
    });

    expect(result?.authConfig.platformConfig.storageState).toEqual({
      cookies: [
        expect.objectContaining({
          name: 'XPU-SESSION',
          value: 'session-token',
        }),
        expect.objectContaining({
          name: 'route',
          value: 'portal',
        }),
      ],
      origins: [],
    });
  });

  it('falls back to shared oauth env settings for client id and private key', async () => {
    process.env.AUTH_OAUTH2_CLIENT_ID = 'shared-client-id';
    process.env.AUTH_OAUTH2_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nshared\n-----END PRIVATE KEY-----';

    jest.spyOn(service as any, 'signPayload').mockReturnValue('signed-value');
    (service as any).client.request = jest.fn().mockResolvedValue({
      status: 200,
      headers: {
        'set-cookie': ['XPU-SESSION=session-token; Path=/'],
      },
      data: {
        status: 'success',
      },
    });

    await service.resolveExecutionAuthConfig({
      connectorId: 'connector-1',
      authType: 'oauth2',
      authScope: {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      authConfig: {
        platformConfig: {
          oaBackendLogin: {
            enabled: true,
            loginUrl: 'https://sz.xpu.edu.cn/auth2/api/v1/login',
            method: 'GET',
            requestMode: 'query',
            accountField: 'oaUserId',
            cookieOrigin: 'https://sz.xpu.edu.cn',
            persistBinding: false,
          },
        },
      },
    });

    expect((service as any).client.request).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        clientId: 'shared-client-id',
        account: '2023002',
        sign: 'signed-value',
      }),
    }));
  });

  it('parses base64 der private keys from env fallback', () => {
    const parse = (service as any).createSigningKey.bind(service);
    const keyObject = parse('MIGTAgEAMBMGByqGSM49AgEGCCqBHM9VAYItBHkwdwIBAQQgWZS+03uIucq6wA9KnKnwMjS4tOjLD7WlHclMSQ0zvlCgCgYIKoEcz1UBgi2hRANCAARrxZJCspvnZS5TcDi5JR14t2R/xNiRXQujC+rfUvoCorkQEaMXCItagcAb1qCyVUCr72NZhP+J+wD+Db5E3uWN');

    expect(keyObject).toBeDefined();
    expect(keyObject.type).toBe('private');
  });

  it('extracts sm2 private scalar from base64 der private keys', () => {
    const extract = (service as any).extractSm2PrivateKeyHex.bind(service);
    const privateKeyHex = extract('MIGTAgEAMBMGByqGSM49AgEGCCqBHM9VAYItBHkwdwIBAQQgWZS+03uIucq6wA9KnKnwMjS4tOjLD7WlHclMSQ0zvlCgCgYIKoEcz1UBgi2hRANCAARrxZJCspvnZS5TcDi5JR14t2R/xNiRXQujC+rfUvoCorkQEaMXCItagcAb1qCyVUCr72NZhP+J+wD+Db5E3uWN');

    expect(privateKeyHex).toHaveLength(64);
    expect(privateKeyHex).toBe('5994bed37b88b9cabac00f4a9ca9f03234b8b4e8cb0fb5a51dc94c490d33be50');
  });
});
