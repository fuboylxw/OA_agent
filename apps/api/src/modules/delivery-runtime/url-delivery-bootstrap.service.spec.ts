import { UrlDeliveryBootstrapService } from './url-delivery-bootstrap.service';

describe('UrlDeliveryBootstrapService', () => {
  it('applies the portal SSO bridge result to execution context', async () => {
    const adapterRuntimeService = {
      getConnectorWithSecrets: jest.fn().mockResolvedValue({
        id: 'connector-1',
        authType: 'cookie',
      }),
      resolveAuthConfigForExecution: jest.fn().mockResolvedValue({
        cookie: 'PORTAL=portal-session',
      }),
      loadRpaFlowsForConnector: jest.fn().mockResolvedValue([
        {
          processCode: 'leave_request',
          processName: '科员请假',
          rpaDefinition: {
            processCode: 'leave_request',
            processName: '科员请假',
            platform: {
              entryUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
              portalSsoBridge: {
                enabled: true,
                portalUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
              },
            },
            runtime: {},
          },
        },
      ]),
    };
    const bridgeService = {
      resolve: jest.fn().mockResolvedValue({
        authConfig: {
          cookie: 'JSESSIONID=oa-session',
          platformConfig: {
            cookieOrigin: 'https://oa2023.xpu.edu.cn',
          },
        },
        ticket: {
          jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
          metadata: {
            portalSsoBridge: {
              activated: true,
            },
          },
        },
      }),
    };
    const oaBackendLoginService = {
      resolveExecutionAuthConfig: jest.fn().mockResolvedValue(null),
    };

    const service = new UrlDeliveryBootstrapService(
      adapterRuntimeService as any,
      bridgeService as any,
      oaBackendLoginService as any,
    );

    const ticketBroker = {
      issueTicket: jest.fn().mockResolvedValue({
        jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/main.do',
      }),
    };
    (service as any).ticketBroker = ticketBroker;

    const context = await service.prepare({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_request',
      processName: '科员请假',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(ticketBroker.issueTicket).toHaveBeenCalledTimes(1);
    expect(bridgeService.resolve).toHaveBeenCalledWith(expect.objectContaining({
      connectorId: 'connector-1',
      processCode: 'leave_request',
      action: 'submit',
    }));
    expect(context.authConfig).toEqual({
      cookie: 'JSESSIONID=oa-session',
      platformConfig: {
        cookieOrigin: 'https://oa2023.xpu.edu.cn',
      },
    });
    expect(context.ticket.jumpUrl).toBe('https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl');
    expect(context.navigation.portalUrl).toBe('https://sz.xpu.edu.cn/#/home?component=thirdScreen');
  });

  it('refreshes backend login for URL execution when configured', async () => {
    const adapterRuntimeService = {
      getConnectorWithSecrets: jest.fn().mockResolvedValue({
        id: 'connector-1',
        authType: 'cookie',
      }),
      resolveAuthConfigForExecution: jest.fn().mockResolvedValue({
        platformConfig: {
          entryUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
          oaBackendLogin: {
            enabled: true,
          },
          storageState: {
            cookies: [{
              name: 'OLD',
              value: 'stale-session',
              url: 'https://sz.xpu.edu.cn',
            }],
            origins: [],
          },
        },
      }),
      loadRpaFlowsForConnector: jest.fn().mockResolvedValue([
        {
          processCode: 'leave_request',
          processName: '科员请假',
          rpaDefinition: {
            processCode: 'leave_request',
            processName: '科员请假',
            platform: {
              portalSsoBridge: {
                enabled: true,
                portalUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
              },
            },
            runtime: {
              networkSubmit: {
                url: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=saveDraft',
              },
            },
          },
        },
      ]),
    };
    const bridgeService = {
      resolve: jest.fn().mockResolvedValue({
        authConfig: {
          cookie: 'JSESSIONID=oa-session',
          platformConfig: {
            cookieOrigin: 'https://oa2023.xpu.edu.cn',
          },
        },
        ticket: {
          jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
        },
      }),
    };
    const oaBackendLoginService = {
      resolveExecutionAuthConfig: jest.fn().mockResolvedValue({
        authConfig: {
          cookie: 'PORTAL=fresh-session',
          platformConfig: {
            storageState: {
              cookies: [{
                name: 'PORTAL',
                value: 'fresh-session',
                url: 'https://sz.xpu.edu.cn',
              }],
              origins: [],
            },
          },
        },
      }),
    };

    const service = new UrlDeliveryBootstrapService(
      adapterRuntimeService as any,
      bridgeService as any,
      oaBackendLoginService as any,
    );
    const ticketBroker = {
      issueTicket: jest.fn().mockResolvedValue({
        jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/main.do',
      }),
    };
    (service as any).ticketBroker = ticketBroker;

    await service.prepare({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_request',
      processName: '科员请假',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(oaBackendLoginService.resolveExecutionAuthConfig).toHaveBeenCalledWith({
      connectorId: 'connector-1',
      authType: 'cookie',
      authConfig: {
        platformConfig: {
          entryUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
          oaBackendLogin: {
            enabled: true,
          },
          storageState: {
            cookies: [{
              name: 'OLD',
              value: 'stale-session',
              url: 'https://sz.xpu.edu.cn',
            }],
            origins: [],
          },
        },
      },
      authScope: {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      flow: expect.objectContaining({
        processCode: 'leave_request',
      }),
    });
    expect(bridgeService.resolve).toHaveBeenCalledWith(expect.objectContaining({
      authConfig: expect.objectContaining({
        cookie: 'PORTAL=fresh-session',
      }),
    }));
  });

  it('infers portal SSO bridge when legacy URL flows only expose entry and target base urls', async () => {
    const adapterRuntimeService = {
      getConnectorWithSecrets: jest.fn().mockResolvedValue({
        id: 'connector-1',
        authType: 'cookie',
      }),
      resolveAuthConfigForExecution: jest.fn().mockResolvedValue({
        platformConfig: {
          entryUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
          oaBackendLogin: {
            enabled: true,
          },
        },
      }),
      loadRpaFlowsForConnector: jest.fn().mockResolvedValue([
        {
          processCode: 'seal_request',
          processName: '用印申请',
          rpaDefinition: {
            processCode: 'seal_request',
            processName: '用印申请',
            platform: {
              entryUrl: 'https://sz.xpu.edu.cn/',
              targetBaseUrl: 'https://oa2023.xpu.edu.cn/',
              businessBaseUrl: 'https://oa2023.xpu.edu.cn/',
            },
            runtime: {
              preflight: {
                steps: [{ type: 'goto', value: 'https://oa2023.xpu.edu.cn/' }],
              },
            },
          },
        },
      ]),
    };
    const bridgeService = {
      resolve: jest.fn().mockResolvedValue({
        authConfig: {
          cookie: 'JSESSIONID=oa-session',
        },
        ticket: {
          jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
        },
      }),
    };
    const oaBackendLoginService = {
      resolveExecutionAuthConfig: jest.fn().mockResolvedValue(null),
    };

    const service = new UrlDeliveryBootstrapService(
      adapterRuntimeService as any,
      bridgeService as any,
      oaBackendLoginService as any,
    );
    const ticketBroker = {
      issueTicket: jest.fn().mockResolvedValue({
        jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/main.do',
      }),
    };
    (service as any).ticketBroker = ticketBroker;

    const context = await service.prepare({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'seal_request',
      processName: '用印申请',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(bridgeService.resolve).toHaveBeenCalledWith(expect.objectContaining({
      flow: expect.objectContaining({
        platform: expect.objectContaining({
          portalSsoBridge: expect.objectContaining({
            enabled: true,
            portalUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
            oaInfoUrl: '/gate/lobby/api/oa/info',
            sourcePath: 'coordinateUrl',
          }),
        }),
      }),
    }));
    expect(context.navigation.portalUrl).toBe('https://sz.xpu.edu.cn/#/home?component=thirdScreen');
  });
});
