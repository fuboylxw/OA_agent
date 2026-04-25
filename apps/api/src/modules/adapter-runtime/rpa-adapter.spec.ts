import type { OAAdapter } from '@uniflow/oa-adapters';
import type { RpaFlowDefinition } from '@uniflow/shared-types';
import { BrowserRpaExecutor } from './browser-rpa-executor';
import { CapabilityRoutedAdapter } from './capability-routed-adapter';
import { LocalRpaExecutor } from './local-rpa-executor';
import type { LoadedRpaFlow } from './prisma-rpa-flow-loader';
import { RpaAdapter, type RpaAdapterConfig } from './rpa-adapter';

describe('RpaAdapter', () => {
  const config: RpaAdapterConfig = {
    connectorId: 'connector-1',
    baseUrl: 'https://oa.example.com',
    authType: 'oauth2',
    authConfig: {},
    oaVendor: 'demo',
    oaVersion: 'v1',
    oaType: 'form-page',
  };

  const ticketBroker = {
    issueTicket: jest.fn(),
  };
  const oaBackendLoginService = {
    resolveExecutionAuthConfig: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    oaBackendLoginService.resolveExecutionAuthConfig.mockResolvedValue(null);
  });

  it('falls back to the local executor for submit when no HTTP executor is configured', async () => {
    ticketBroker.issueTicket.mockResolvedValue({
      ticket: 'portal-ticket',
      jumpUrl: 'https://portal.example.com/jump/expense',
      metadata: {
        source: 'template',
        token: 'temporary-ticket-token',
        platformConfig: {
          serviceToken: 'service-token',
        },
      },
    });

    const adapter = new RpaAdapter(
      config,
      [buildLoadedFlow()],
      ticketBroker as any,
      new LocalRpaExecutor(),
      new BrowserRpaExecutor(),
      oaBackendLoginService as any,
    );
    await adapter.init();

    const result = await adapter.submit({
      flowCode: 'expense_submit',
      formData: { amount: 128, reason: 'team lunch' },
      idempotencyKey: 'req-local-001',
    });

    expect(result.success).toBe(true);
    expect(result.submissionId).toBe('RPA-EXPENSE_SUBMIT-eqlocal001');
    expect(result.metadata).toMatchObject({
      mode: 'local',
      action: 'submit',
      jumpUrl: 'https://portal.example.com/jump/expense',
      ticketIssued: true,
      ticketMetadata: {
        source: 'template',
        token: '[redacted]',
        platformConfig: {
          serviceToken: '[redacted]',
        },
      },
    });
    expect(Array.isArray(result.metadata?.executedSteps)).toBe(true);
    expect(ticketBroker.issueTicket).toHaveBeenCalledWith(expect.objectContaining({
      connectorId: 'connector-1',
      processCode: 'expense_submit',
      action: 'submit',
    }));
  });

  it('falls back to the local executor for status query when no HTTP executor is configured', async () => {
    ticketBroker.issueTicket.mockResolvedValue({
      jumpUrl: 'https://portal.example.com/jump/expense',
      metadata: { source: 'template' },
    });

    const adapter = new RpaAdapter(
      config,
      [buildLoadedFlow()],
      ticketBroker as any,
      new LocalRpaExecutor(),
      new BrowserRpaExecutor(),
      oaBackendLoginService as any,
    );
    await adapter.init();

    const result = await adapter.queryStatus('approve-001');

    expect(result.status).toBe('approved');
    expect(result.statusDetail).toMatchObject({
      mode: 'local',
      action: 'queryStatus',
      status: 'approved',
      ticketIssued: false,
      jumpUrl: 'https://portal.example.com/jump/expense',
    });
    expect(result.timeline).toEqual([
      expect.objectContaining({
        status: 'approved',
        operator: 'local_rpa_executor',
      }),
    ]);
  });

  it('keeps stub mode behavior when executorMode is stub', async () => {
    ticketBroker.issueTicket.mockResolvedValue({
      ticket: 'stub-ticket',
      jumpUrl: 'https://portal.example.com/jump/stub',
    });

    const adapter = new RpaAdapter(
      config,
      [buildLoadedFlow({ runtime: { executorMode: 'stub' } })],
      ticketBroker as any,
      new LocalRpaExecutor(),
      new BrowserRpaExecutor(),
      oaBackendLoginService as any,
    );
    await adapter.init();

    const result = await adapter.submit({
      flowCode: 'expense_submit',
      formData: { amount: 12 },
      idempotencyKey: 'req-stub-001',
    });

    expect(result.success).toBe(true);
    expect(result.metadata).toMatchObject({
      mode: 'stub',
      action: 'submit',
      jumpUrl: 'https://portal.example.com/jump/stub',
      ticketIssued: true,
    });
  });

  it('routes to the browser executor when executorMode is browser', async () => {
    ticketBroker.issueTicket.mockResolvedValue({
      ticket: 'browser-ticket',
      jumpUrl: 'https://portal.example.com/jump/browser',
      metadata: {
        source: 'broker',
        token: 'browser-token',
      },
    });

    const adapter = new RpaAdapter(
      config,
      [buildLoadedFlow({
        runtime: {
          executorMode: 'browser',
          browserProvider: 'stub',
          headless: true,
        },
      })],
      ticketBroker as any,
      new LocalRpaExecutor(),
      new BrowserRpaExecutor(),
      oaBackendLoginService as any,
    );
    await adapter.init();

    const result = await adapter.submit({
      flowCode: 'expense_submit',
      formData: { amount: 300 },
      idempotencyKey: 'req-browser-001',
    });

    expect(result.success).toBe(true);
    expect(result.submissionId).toBe('RPA-BROWSER-EXPENSE_SUBMIT-browser001');
    expect(result.metadata).toMatchObject({
      mode: 'browser',
      action: 'submit',
      session: {
        executor: 'browser',
        provider: 'stub',
        requestedProvider: 'stub',
        jumpUrl: 'https://portal.example.com/jump/browser',
        headless: true,
      },
      ticketMetadata: {
        source: 'broker',
        token: '[redacted]',
      },
    });
    expect(result.metadata?.snapshots?.length).toBeGreaterThan(0);
    expect(result.metadata?.finalSnapshot).toMatchObject({
      title: 'Expense Submit - Submit',
    });
    expect(result.metadata?.executedSteps).toEqual([
      expect.objectContaining({
        type: 'goto',
        status: 'executed',
        targetKind: 'selector',
      }),
      expect.objectContaining({
        type: 'input',
        status: 'executed',
        elementRef: 'e1',
      }),
    ]);
  });

  it('resolves OA backend login auth before browser execution when configured', async () => {
    ticketBroker.issueTicket.mockResolvedValue({
      jumpUrl: 'https://portal.example.com/jump/browser',
      metadata: { source: 'template' },
    });
    oaBackendLoginService.resolveExecutionAuthConfig.mockResolvedValue({
      authConfig: {
        cookie: 'XPU-SESSION=session-value',
        platformConfig: {
          storageState: {
            cookies: [{
              name: 'XPU-SESSION',
              value: 'session-value',
              url: 'https://sz.xpu.edu.cn',
            }],
            origins: [],
          },
        },
      },
    });

    const browserExecutor = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        submissionId: 'RPA-BROWSER-EXPENSE_SUBMIT-browser001',
        status: 'submitted',
        message: 'ok',
        executedSteps: [],
        snapshots: [],
        recoveryAttempts: [],
        finalSnapshot: undefined,
        session: {
          executor: 'browser',
          provider: 'playwright',
          requestedProvider: 'playwright',
          jumpUrl: 'https://portal.example.com/jump/browser',
          headless: true,
        },
      }),
    };

    const adapter = new RpaAdapter(
      {
        ...config,
        authScope: {
          tenantId: 'tenant-1',
          userId: 'user-1',
        },
        authConfig: {
          platformConfig: {
            oaBackendLogin: {
              enabled: true,
            },
          },
        },
      },
      [buildLoadedFlow({
        runtime: {
          executorMode: 'browser',
          browserProvider: 'playwright',
          headless: true,
        },
      })],
      ticketBroker as any,
      new LocalRpaExecutor(),
      browserExecutor as any,
      oaBackendLoginService as any,
    );
    await adapter.init();

    await adapter.submit({
      flowCode: 'expense_submit',
      formData: { amount: 88 },
      idempotencyKey: 'req-browser-auth-001',
    });

    expect(oaBackendLoginService.resolveExecutionAuthConfig).toHaveBeenCalledWith(expect.objectContaining({
      connectorId: 'connector-1',
      authType: 'oauth2',
      authScope: {
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
    }));
    expect(browserExecutor.execute).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        auth: expect.objectContaining({
          cookie: 'XPU-SESSION=session-value',
          platformConfig: expect.objectContaining({
            storageState: expect.objectContaining({
              cookies: [expect.objectContaining({
                name: 'XPU-SESSION',
              })],
            }),
          }),
        }),
      }),
    }));
  });

  it('reuses existing browser session bootstrap without refreshing backend login again', async () => {
    ticketBroker.issueTicket.mockResolvedValue({
      jumpUrl: 'https://portal.example.com/jump/browser',
      metadata: { source: 'template' },
    });

    const browserExecutor = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        submissionId: 'RPA-BROWSER-EXPENSE_SUBMIT-existing001',
        status: 'submitted',
        message: 'ok',
        executedSteps: [],
        snapshots: [],
        recoveryAttempts: [],
        finalSnapshot: undefined,
        session: {
          executor: 'browser',
          provider: 'playwright',
          requestedProvider: 'playwright',
          jumpUrl: 'https://portal.example.com/jump/browser',
          headless: true,
        },
      }),
    };

    const adapter = new RpaAdapter(
      {
        ...config,
        authScope: {
          tenantId: 'tenant-1',
          userId: 'user-1',
        },
        authConfig: {
          cookie: 'XPU-SESSION=existing-session',
          platformConfig: {
            storageState: {
              cookies: [{
                name: 'XPU-SESSION',
                value: 'existing-session',
                url: 'https://sz.xpu.edu.cn',
              }],
              origins: [],
            },
            oaBackendLogin: {
              enabled: true,
            },
          },
        },
      },
      [buildLoadedFlow({
        runtime: {
          executorMode: 'browser',
          browserProvider: 'playwright',
          headless: true,
        },
      })],
      ticketBroker as any,
      new LocalRpaExecutor(),
      browserExecutor as any,
      oaBackendLoginService as any,
    );
    await adapter.init();

    await adapter.submit({
      flowCode: 'expense_submit',
      formData: { amount: 99 },
      idempotencyKey: 'req-browser-existing-001',
    });

    expect(oaBackendLoginService.resolveExecutionAuthConfig).not.toHaveBeenCalled();
    expect(browserExecutor.execute).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        auth: expect.objectContaining({
          cookie: 'XPU-SESSION=existing-session',
          platformConfig: expect.objectContaining({
            storageState: expect.objectContaining({
              cookies: [expect.objectContaining({
                name: 'XPU-SESSION',
                value: 'existing-session',
              })],
            }),
          }),
        }),
      }),
    }));
  });
});

describe('CapabilityRoutedAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefers the API adapter for submit when the flow supports API execution', async () => {
    const apiAdapter = buildAdapterMock();
    const rpaAdapter = buildAdapterMock();
    const adapter = new CapabilityRoutedAdapter(
      apiAdapter,
      rpaAdapter,
      [buildLoadedFlow({ executionModes: { submit: ['api', 'vision'], queryStatus: ['vision'] } })],
    );

    await adapter.submit({
      flowCode: 'expense_submit',
      formData: { amount: 200 },
      idempotencyKey: 'req-api-first',
    });

    expect(apiAdapter.submit).toHaveBeenCalledTimes(1);
    expect(rpaAdapter.submit).not.toHaveBeenCalled();
  });

  it('uses the RPA adapter for submit when the flow has no API capability', async () => {
    const apiAdapter = buildAdapterMock();
    const rpaAdapter = buildAdapterMock();
    const adapter = new CapabilityRoutedAdapter(
      apiAdapter,
      rpaAdapter,
      [buildLoadedFlow({ executionModes: { submit: ['vision'], queryStatus: ['vision'] } })],
    );

    await adapter.submit({
      flowCode: 'expense_submit',
      formData: { amount: 200 },
      idempotencyKey: 'req-rpa-only',
    });

    expect(apiAdapter.submit).not.toHaveBeenCalled();
    expect(rpaAdapter.submit).toHaveBeenCalledTimes(1);
  });
});

function buildLoadedFlow(options?: {
  runtime?: RpaFlowDefinition['runtime'];
  executionModes?: LoadedRpaFlow['executionModes'];
}): LoadedRpaFlow {
  return {
    processCode: 'expense_submit',
    processName: 'Expense Submit',
    executionModes: options?.executionModes || {
      submit: ['vision'],
      queryStatus: ['vision'],
    },
    rpaDefinition: {
      processCode: 'expense_submit',
      processName: 'Expense Submit',
      platform: {
        entryUrl: 'https://portal.example.com',
        targetSystem: 'expense-oa',
      },
      runtime: options?.runtime,
      actions: {
        submit: {
          steps: [
            { type: 'goto', selector: 'body', description: 'Open the expense page' },
            { type: 'input', selector: '#amount', fieldKey: 'amount', description: 'Fill amount' },
          ],
        },
        queryStatus: {
          steps: [
            { type: 'goto', selector: 'body', description: 'Open the detail page' },
            { type: 'extract', selector: '#status', description: 'Read the status' },
          ],
        },
      },
    },
  };
}

function buildAdapterMock(): jest.Mocked<OAAdapter> {
  return {
    discover: jest.fn().mockResolvedValue({
      oaVendor: 'mock',
      oaType: 'hybrid',
      authType: 'oauth2',
      discoveredFlows: [],
    }),
    healthCheck: jest.fn().mockResolvedValue({ healthy: true, latencyMs: 1 }),
    submit: jest.fn().mockResolvedValue({ success: true, submissionId: 'SUB-1' }),
    queryStatus: jest.fn().mockResolvedValue({ status: 'submitted', timeline: [] }),
    listReferenceData: jest.fn(),
    cancel: jest.fn().mockResolvedValue({ success: true }),
    urge: jest.fn().mockResolvedValue({ success: true }),
    delegate: jest.fn().mockResolvedValue({ success: true }),
    supplement: jest.fn().mockResolvedValue({ success: true }),
  };
}
