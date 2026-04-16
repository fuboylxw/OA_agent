jest.mock('../agents/api-analyzer.agent', () => ({
  ApiAnalyzerAgent: class MockApiAnalyzerAgent {},
}));

jest.mock('../agents/bootstrap-repair.agent', () => ({
  BootstrapRepairAgent: class MockBootstrapRepairAgent {},
}));

jest.mock('@uniflow/agent-kernel', () => ({
  recordRuntimeDiagnostic: jest.fn(),
}));

import { BootstrapProcessor } from './bootstrap.processor';

describe('BootstrapProcessor RPA publishing', () => {
  function createTxMocks() {
    const connectorUpsert = jest.fn().mockResolvedValue({
      id: 'connector-1',
      name: 'Expense Connector',
      oaType: 'form-page',
      authType: 'cookie',
      authConfig: {},
      oclLevel: 'OCL2',
      healthCheckUrl: null,
      oaVendor: null,
      oaVersion: null,
      falLevel: null,
      baseUrl: 'https://portal.example.com',
    });

    const processTemplateCreate = jest.fn().mockResolvedValue({ id: 'template-1', version: 1 });

    const tx = {
      connector: {
        upsert: connectorUpsert,
        update: jest.fn().mockResolvedValue({}),
      },
      connectorCapability: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      connectorSecretRef: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      mCPTool: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: processTemplateCreate,
        update: jest.fn().mockResolvedValue({ id: 'template-1', version: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      bootstrapJob: {
        update: jest.fn().mockResolvedValue({}),
      },
      adapterBuild: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };

    return { prisma, tx, connectorUpsert, processTemplateCreate };
  }

  function createRpaDefinition() {
    return {
      processCode: 'expense_submit',
      processName: 'Expense Submit',
      platform: {
        entryUrl: 'https://portal.example.com/sso',
      },
      actions: {
        submit: {
          steps: [{ type: 'goto', selector: 'body' }],
        },
        queryStatus: {
          steps: [{ type: 'extract', selector: '#status' }],
        },
      },
    };
  }

  it('extracts and merges RPA definitions from bootstrap sources', () => {
    const { prisma } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    const definitions = (processor as any).getRpaDefinitions({
      sources: [
        {
          sourceType: 'manual_rpa',
          sourceContent: JSON.stringify({
            flows: [createRpaDefinition()],
          }),
          metadata: {
            platformConfig: {
              targetSystem: 'expense-oa',
              jumpUrlTemplate: 'https://portal.example.com/jump/{processCode}',
            },
          },
        },
      ],
    });

    expect(definitions).toHaveLength(1);
    expect(definitions[0].platform).toMatchObject({
      entryUrl: 'https://portal.example.com/sso',
      targetSystem: 'expense-oa',
      jumpUrlTemplate: 'https://portal.example.com/jump/{processCode}',
    });
  });

  it('maps platform executor mode into runtime when the uploaded flow omits it', () => {
    const { prisma } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    const definitions = (processor as any).getRpaDefinitions({
      authConfig: { accessMode: 'direct_link' },
      sources: [
        {
          sourceType: 'manual_rpa',
          sourceContent: JSON.stringify({
            flows: [createRpaDefinition()],
          }),
          metadata: {
            platformConfig: {
              entryUrl: 'https://portal.example.com/sso',
              executorMode: 'browser',
            },
          },
        },
      ],
    });

    expect(definitions[0].platform).not.toHaveProperty('executorMode');
    expect(definitions[0].runtime).toMatchObject({
      executorMode: 'browser',
    });
  });

  it('builds synthetic RPA submit and status endpoints from definitions', () => {
    const { prisma } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    const processes = (processor as any).buildProcessesFromRpaDefinitions([createRpaDefinition()]);

    expect(processes).toHaveLength(1);
    expect(processes[0].endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'RPA', category: 'submit', path: 'rpa://expense_submit/submit' }),
        expect.objectContaining({ method: 'RPA', category: 'status_query', path: 'rpa://expense_submit/status' }),
      ]),
    );
  });

  it('prefers the final business jump URL over the portal entry URL when resolving connector baseUrl', () => {
    const { prisma } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    const baseUrl = (processor as any).resolveBaseUrl({
      oaUrl: 'https://sz.xpu.edu.cn',
      openApiUrl: null,
      authConfig: {
        platformConfig: {
          entryUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
        },
      },
      sources: [
        {
          sourceType: 'manual_rpa',
          sourceContent: JSON.stringify({
            flows: [{
              ...createRpaDefinition(),
              platform: {
                entryUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
                jumpUrlTemplate: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
              },
            }],
          }),
          metadata: {},
        },
      ],
    });

    expect(baseUrl).toBe('https://oa2023.xpu.edu.cn');
  });

  it('uses explicit businessBaseUrl before any portal or jump URL hints', () => {
    const { prisma } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    const baseUrl = (processor as any).resolveBaseUrl({
      oaUrl: 'https://sz.xpu.edu.cn',
      openApiUrl: null,
      authConfig: {
        platformConfig: {
          entryUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
          businessBaseUrl: 'https://oa2023.xpu.edu.cn',
        },
      },
      sources: [
        {
          sourceType: 'manual_rpa',
          sourceContent: JSON.stringify({
            flows: [{
              ...createRpaDefinition(),
              platform: {
                entryUrl: 'https://sz.xpu.edu.cn/#/home?component=thirdScreen',
                jumpUrlTemplate: 'https://other.example.com/workflow/new',
              },
            }],
          }),
          metadata: {},
        },
      ],
    });

    expect(baseUrl).toBe('https://oa2023.xpu.edu.cn');
  });

  it('publishes form-page connectors and rpa execution modes for RPA-only jobs', async () => {
    const { prisma, connectorUpsert, processTemplateCreate, tx } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    await (processor as any).runCompiling(
      {
        id: 'job-1',
        tenantId: 'tenant-1',
        name: 'Expense Connector',
        oaUrl: 'https://portal.example.com',
        openApiUrl: null,
        authConfig: { bootstrapMode: 'rpa_only' },
        sources: [
          {
            sourceType: 'manual_rpa',
            sourceContent: JSON.stringify({ flows: [createRpaDefinition()] }),
            metadata: {},
          },
        ],
      },
      [
        {
          processCode: 'expense_submit',
          processName: 'Expense Submit',
          category: 'rpa',
          description: 'Expense submit flow',
          endpoints: [
            {
              name: 'Expense Submit submit',
              method: 'RPA',
              path: 'rpa://expense_submit/submit',
              description: 'Submit',
              category: 'submit',
              parameters: [{ name: 'amount', type: 'string', required: true, description: 'Amount', in: 'body' }],
              responseMapping: { success: 'success', data: 'data' },
              bodyTemplate: { kind: 'rpa_submit' },
            },
            {
              name: 'Expense Submit status',
              method: 'RPA',
              path: 'rpa://expense_submit/status',
              description: 'Query status',
              category: 'status_query',
              parameters: [{ name: 'submissionId', type: 'string', required: true, description: 'Submission ID', in: 'body' }],
              responseMapping: { success: 'success', data: 'data' },
              bodyTemplate: { kind: 'rpa_status_query' },
            },
          ],
        },
      ],
      'PUBLISHED',
      [],
    );

    expect(connectorUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ oaType: 'form-page' }),
      update: expect.objectContaining({ oaType: 'form-page' }),
    }));

    expect(tx.mCPTool.upsert).not.toHaveBeenCalled();
    expect(processTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        uiHints: expect.objectContaining({
          executionModes: {
            submit: ['rpa'],
            queryStatus: ['rpa'],
          },
          rpaDefinition: expect.objectContaining({ processCode: 'expense_submit' }),
        }),
      }),
    }));
  });

  it('publishes hybrid connectors and mixed execution modes when both API and RPA exist', async () => {
    const { prisma, connectorUpsert, processTemplateCreate, tx } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    await (processor as any).runCompiling(
      {
        id: 'job-2',
        tenantId: 'tenant-1',
        name: 'Expense Hybrid Connector',
        oaUrl: 'https://portal.example.com',
        openApiUrl: 'https://portal.example.com/openapi.json',
        authConfig: { bootstrapMode: 'hybrid' },
        sources: [
          {
            sourceType: 'manual_rpa',
            sourceContent: JSON.stringify({ flows: [createRpaDefinition()] }),
            metadata: {},
          },
          {
            sourceType: 'openapi',
            sourceContent: '{"openapi":"3.0.0","paths":{}}',
            metadata: {},
          },
        ],
      },
      [
        {
          processCode: 'expense_submit',
          processName: 'Expense Submit',
          category: 'expense',
          description: 'Expense submit flow',
          endpoints: [
            {
              name: 'Submit expense',
              method: 'POST',
              path: '/api/expenses',
              description: 'Submit',
              category: 'submit',
              parameters: [{ name: 'amount', type: 'string', required: true, description: 'Amount', in: 'body' }],
              responseMapping: { success: 'success', data: 'data', id: 'data.id' },
              bodyTemplate: { amount: '{{amount}}' },
            },
            {
              name: 'Get expense status',
              method: 'GET',
              path: '/api/expenses/{id}',
              description: 'Status',
              category: 'status_query',
              parameters: [{ name: 'id', type: 'string', required: true, description: 'ID', in: 'path' }],
              responseMapping: { success: 'success', data: 'data', status: 'data.status' },
            },
          ],
        },
      ],
      'PUBLISHED',
      [],
    );

    expect(connectorUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ oaType: 'hybrid' }),
      update: expect.objectContaining({ oaType: 'hybrid' }),
    }));

    expect(tx.mCPTool.upsert).toHaveBeenCalled();
    expect(processTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        uiHints: expect.objectContaining({
          executionModes: {
            submit: ['api', 'rpa'],
            queryStatus: ['api', 'rpa'],
          },
        }),
      }),
    }));
  });

  it('keeps delegated auth settings on the connector while moving runtime secrets into secret storage', async () => {
    const { prisma, connectorUpsert, tx } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);
    const envKey = 'BOOTSTRAP_SECRET_CONNECTOR_1';

    delete process.env[envKey];

    await (processor as any).runCompiling(
      {
        id: 'job-3',
        tenantId: 'tenant-1',
        name: 'Delegated Connector',
        oaUrl: 'https://portal.example.com',
        openApiUrl: null,
        authConfig: {
          authType: 'oauth2',
          bootstrapMode: 'rpa_only',
          accessToken: 'bootstrap-access-token',
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
            headerName: 'x-delegated-token',
            scope: 'expense:submit',
          },
          platformConfig: {
            entryUrl: 'https://portal.example.com/sso',
            targetSystem: 'expense-oa',
            serviceToken: 'platform-service-token',
          },
        },
        sources: [
          {
            sourceType: 'manual_rpa',
            sourceContent: JSON.stringify({ flows: [createRpaDefinition()] }),
            metadata: {},
          },
        ],
      },
      [
        {
          processCode: 'expense_submit',
          processName: 'Expense Submit',
          category: 'rpa',
          description: 'Expense submit flow',
          endpoints: [
            {
              name: 'Expense Submit submit',
              method: 'RPA',
              path: 'rpa://expense_submit/submit',
              description: 'Submit',
              category: 'submit',
              parameters: [{ name: 'amount', type: 'string', required: true, description: 'Amount', in: 'body' }],
              responseMapping: { success: 'success', data: 'data' },
              bodyTemplate: { kind: 'rpa_submit' },
            },
          ],
        },
      ],
      'PUBLISHED',
      [],
    );

    expect(connectorUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        authConfig: {
          authType: 'oauth2',
          bootstrapMode: 'rpa_only',
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
            headerName: 'x-delegated-token',
            scope: 'expense:submit',
          },
          platformConfig: {
            entryUrl: 'https://portal.example.com/sso',
            targetSystem: 'expense-oa',
          },
        },
      }),
      update: expect.objectContaining({
        authConfig: {
          authType: 'oauth2',
          bootstrapMode: 'rpa_only',
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
            headerName: 'x-delegated-token',
            scope: 'expense:submit',
          },
          platformConfig: {
            entryUrl: 'https://portal.example.com/sso',
            targetSystem: 'expense-oa',
          },
        },
      }),
    }));
    expect(tx.connectorSecretRef.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectorId: 'connector-1' },
    }));
    expect(JSON.parse(process.env[envKey] || '{}')).toEqual({
      accessToken: 'bootstrap-access-token',
      platformConfig: {
        serviceToken: 'platform-service-token',
      },
    });

    delete process.env[envKey];
  });

  it('persists a clear failure reason when no business process is identified', async () => {
    const bootstrapJobUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      bootstrapJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-empty',
          tenantId: 'tenant-1',
          status: 'CREATED',
          queueJobId: null,
          oaUrl: 'http://127.0.0.1:8000/',
          openApiUrl: null,
          authConfig: {},
          sources: [{
            sourceType: 'openapi',
            sourceContent: JSON.stringify({
              openapi: '3.0.0',
              paths: {
                '/api/health': {
                  get: {
                    summary: 'Health',
                  },
                },
              },
            }),
          }],
        }),
        update: bootstrapJobUpdate,
      },
      bootstrapReport: {
        create: jest.fn().mockResolvedValue({ id: 'report-1' }),
        findUnique: jest.fn().mockResolvedValue({ evidence: [] }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const processor = new BootstrapProcessor(prisma as any);
    (processor as any).apiAnalyzer.execute = jest.fn().mockResolvedValue({
      success: true,
      data: {
        processes: [],
        totalEndpoints: 0,
      },
    });

    const result = await processor.handleBootstrap({
      data: {
        jobId: 'job-empty',
      },
    } as any);

    expect(result).toEqual({
      success: false,
      reason: 'no_business_processes',
    });
    expect(bootstrapJobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-empty' },
      data: expect.objectContaining({
        status: 'FAILED',
        lastError: 'No business processes were identified from the provided API document',
      }),
    }));
  });
});
