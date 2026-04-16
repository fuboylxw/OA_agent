import { UrlPortalSsoBridgeService } from './url-portal-sso-bridge.service';

describe('UrlPortalSsoBridgeService', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('resolves the OA SSO bridge URL and merges OA cookies into auth config', async () => {
    jest.doMock('playwright', () => ({
      chromium: {
        launch: jest.fn().mockResolvedValue({
          newContext: jest.fn().mockResolvedValue({
            addCookies: jest.fn().mockResolvedValue(undefined),
            newPage: jest.fn().mockImplementation(async () => {
              const listeners = new Map<string, Function[]>();
              let currentUrl = 'about:blank';
              return {
                on: jest.fn((event: string, handler: Function) => {
                  listeners.set(event, [...(listeners.get(event) || []), handler]);
                }),
                goto: jest.fn(async (url: string) => {
                  currentUrl = url.includes('/login/sso')
                    ? 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true'
                    : url;
                  if (url === 'https://sz.xpu.edu.cn/#/home?component=thirdScreen') {
                    for (const handler of listeners.get('response') || []) {
                      await handler({
                        url: () => 'https://sz.xpu.edu.cn/gate/lobby/api/oa/info',
                        json: async () => ({
                          status: 'success',
                          data: {
                            coordinateUrl: 'https://oa2023.xpu.edu.cn/seeyon/login/sso?from=dddlserver&ticket=ticket-1&tourl=%2Fseeyon%2Fmain.do',
                          },
                        }),
                      });
                    }
                  }
                }),
                waitForLoadState: jest.fn().mockResolvedValue(undefined),
                url: jest.fn(() => currentUrl),
              };
            }),
            storageState: jest.fn().mockResolvedValue({
              cookies: [
                {
                  name: 'JSESSIONID',
                  value: 'oa-session',
                  domain: 'oa2023.xpu.edu.cn',
                  path: '/',
                },
              ],
              origins: [],
            }),
          }),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      },
    }), { virtual: true });

    const service = new UrlPortalSsoBridgeService();
    const result = await service.resolve({
      connectorId: 'connector-1',
      processCode: 'leave_request',
      processName: '科员请假',
      action: 'submit',
      authConfig: {
        sessionCookie: 'PORTAL=portal-session',
        platformConfig: {
          cookieOrigin: 'https://sz.xpu.edu.cn',
        },
      },
      flow: {
        processCode: 'leave_request',
        processName: '科员请假',
        platform: {
          portalSsoBridge: {
            enabled: true,
            mode: 'oa_info',
            portalUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
            oaInfoUrl: '/gate/lobby/api/oa/info',
            sourcePath: 'coordinateUrl',
            targetPathTemplate: '/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true',
            required: true,
          },
        },
      },
      ticket: {
        jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true',
      },
    });

    expect(result.ticket.jumpUrl).toBe('https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true');
    expect(result.ticket.metadata).toMatchObject({
      portalSsoBridge: expect.objectContaining({
        activated: true,
        mode: 'oa_info',
        oaInfoSource: 'portal_response',
      }),
    });
    expect(result.authConfig.sessionCookie).toBe('JSESSIONID=oa-session');
    expect(result.authConfig.platformConfig.cookieOrigin).toBe('https://oa2023.xpu.edu.cn');
    expect(result.authConfig.platformConfig.storageState).toEqual({
      cookies: [
        {
          name: 'JSESSIONID',
          value: 'oa-session',
          domain: 'oa2023.xpu.edu.cn',
          path: '/',
        },
      ],
      origins: [],
    });
  });

  it('falls back to direct oaInfo request when portal page does not emit the oa info response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: 'success',
        data: {
          coordinateUrl: 'https://oa2023.xpu.edu.cn/seeyon/login/sso?from=dddlserver&ticket=ticket-2&tourl=%2Fseeyon%2Fmain.do',
        },
      }),
    });
    const originalFetch = global.fetch;
    Object.defineProperty(global, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    jest.doMock('playwright', () => ({
      chromium: {
        launch: jest.fn().mockResolvedValue({
          newContext: jest.fn().mockResolvedValue({
            addCookies: jest.fn().mockResolvedValue(undefined),
            newPage: jest.fn().mockImplementation(async () => {
              let currentUrl = 'about:blank';
              return {
                on: jest.fn(),
                off: jest.fn(),
                goto: jest.fn(async (url: string) => {
                  currentUrl = url.includes('/login/sso')
                    ? 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true'
                    : url;
                }),
                waitForLoadState: jest.fn().mockResolvedValue(undefined),
                url: jest.fn(() => currentUrl),
              };
            }),
            storageState: jest.fn().mockResolvedValue({
              cookies: [
                {
                  name: 'PORTAL',
                  value: 'portal-session',
                  domain: 'sz.xpu.edu.cn',
                  path: '/',
                },
                {
                  name: 'JSESSIONID',
                  value: 'oa-session',
                  domain: 'oa2023.xpu.edu.cn',
                  path: '/',
                },
              ],
              origins: [],
            }),
          }),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      },
    }), { virtual: true });

    try {
      const service = new UrlPortalSsoBridgeService();
      const result = await service.resolve({
        connectorId: 'connector-1',
        processCode: 'leave_request',
        processName: '科员请假',
        action: 'submit',
        authConfig: {
          sessionCookie: 'PORTAL=portal-session',
          platformConfig: {
            cookieOrigin: 'https://sz.xpu.edu.cn',
          },
        },
        flow: {
          processCode: 'leave_request',
          processName: '科员请假',
          runtime: {
            timeoutMs: 2000,
          },
          platform: {
            portalSsoBridge: {
              enabled: true,
              mode: 'oa_info',
              portalUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
              oaInfoUrl: 'https://sz.xpu.edu.cn/gate/lobby/api/oa/info',
              sourcePath: 'coordinateUrl',
              targetPathTemplate: '/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true',
              required: true,
            },
          },
        },
        ticket: {
          jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true',
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://sz.xpu.edu.cn/gate/lobby/api/oa/info',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Cookie: 'PORTAL=portal-session',
            Referer: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
          }),
        }),
      );
      expect(result.ticket.metadata).toMatchObject({
        portalSsoBridge: expect.objectContaining({
          activated: true,
          oaInfoSource: 'http_fallback',
        }),
      });
      expect(result.authConfig.sessionCookie).toBe('JSESSIONID=oa-session');
    } finally {
      Object.defineProperty(global, 'fetch', {
        value: originalFetch,
        configurable: true,
        writable: true,
      });
    }
  });

  it('reuses portal authorization header captured from browser requests for oaInfo fallback', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: 'success',
        data: {
          coordinateUrl: 'https://oa2023.xpu.edu.cn/seeyon/login/sso?from=dddlserver&ticket=ticket-3&tourl=%2Fseeyon%2Fmain.do',
        },
      }),
    });
    const originalFetch = global.fetch;
    Object.defineProperty(global, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    jest.doMock('playwright', () => ({
      chromium: {
        launch: jest.fn().mockResolvedValue({
          newContext: jest.fn().mockResolvedValue({
            addCookies: jest.fn().mockResolvedValue(undefined),
            newPage: jest.fn().mockImplementation(async () => {
              const listeners = new Map<string, Function[]>();
              let currentUrl = 'about:blank';
              return {
                on: jest.fn((event: string, handler: Function) => {
                  listeners.set(event, [...(listeners.get(event) || []), handler]);
                }),
                off: jest.fn((event: string, handler: Function) => {
                  listeners.set(event, (listeners.get(event) || []).filter((item) => item !== handler));
                }),
                goto: jest.fn(async (url: string) => {
                  currentUrl = url.includes('/login/sso')
                    ? 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true'
                    : url;
                  if (url === 'https://sz.xpu.edu.cn/#/home?component=thirdScreen') {
                    for (const handler of listeners.get('request') || []) {
                      await handler({
                        url: () => 'https://sz.xpu.edu.cn/gate/lobby/api/v1/hotApps?typeId=3',
                        headers: () => ({
                          authorization: 'Bearer portal-token-123',
                        }),
                      });
                    }
                  }
                }),
                waitForLoadState: jest.fn().mockResolvedValue(undefined),
                url: jest.fn(() => currentUrl),
              };
            }),
            storageState: jest.fn().mockResolvedValue({
              cookies: [
                {
                  name: 'PORTAL',
                  value: 'portal-session',
                  domain: 'sz.xpu.edu.cn',
                  path: '/',
                },
                {
                  name: 'JSESSIONID',
                  value: 'oa-session',
                  domain: 'oa2023.xpu.edu.cn',
                  path: '/',
                },
              ],
              origins: [],
            }),
          }),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      },
    }), { virtual: true });

    try {
      const service = new UrlPortalSsoBridgeService();
      const result = await service.resolve({
        connectorId: 'connector-1',
        processCode: 'leave_request',
        processName: '科员请假',
        action: 'submit',
        authConfig: {
          sessionCookie: 'PORTAL=portal-session',
          platformConfig: {
            cookieOrigin: 'https://sz.xpu.edu.cn',
          },
        },
        flow: {
          processCode: 'leave_request',
          processName: '科员请假',
          runtime: {
            timeoutMs: 2000,
          },
          platform: {
            portalSsoBridge: {
              enabled: true,
              mode: 'oa_info',
              portalUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
              oaInfoUrl: 'https://sz.xpu.edu.cn/gate/lobby/api/oa/info',
              sourcePath: 'coordinateUrl',
              targetPathTemplate: '/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true',
              required: true,
            },
          },
        },
        ticket: {
          jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true',
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://sz.xpu.edu.cn/gate/lobby/api/oa/info',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Cookie: 'PORTAL=portal-session',
            Authorization: 'Bearer portal-token-123',
          }),
        }),
      );
      expect(result.authConfig.platformConfig.portalAuth).toEqual({
        authorizationHeader: 'Bearer portal-token-123',
        accessToken: 'portal-token-123',
      });
      expect(result.ticket.metadata).toMatchObject({
        portalSsoBridge: expect.objectContaining({
          activated: true,
          portalAuthMode: 'authorization_header',
        }),
      });
    } finally {
      Object.defineProperty(global, 'fetch', {
        value: originalFetch,
        configurable: true,
        writable: true,
      });
    }
  });

  it('falls back to the original ticket when the bridge is optional and fails', async () => {
    jest.doMock('playwright', () => ({
      chromium: {
        launch: jest.fn().mockRejectedValue(new Error('playwright unavailable')),
      },
    }), { virtual: true });

    const service = new UrlPortalSsoBridgeService();
    const result = await service.resolve({
      connectorId: 'connector-1',
      processCode: 'leave_request',
      processName: '科员请假',
      action: 'submit',
      authConfig: {},
      flow: {
        processCode: 'leave_request',
        processName: '科员请假',
        platform: {
          portalSsoBridge: {
            enabled: true,
            mode: 'oa_info',
            required: false,
            portalUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
          },
        },
      },
      ticket: {
        jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/main.do',
      },
    });

    expect(result.ticket.jumpUrl).toBe('https://oa2023.xpu.edu.cn/seeyon/main.do');
    expect(result.ticket.metadata).toMatchObject({
      portalSsoBridge: expect.objectContaining({
        activated: false,
        error: 'playwright unavailable',
      }),
    });
  });
});
