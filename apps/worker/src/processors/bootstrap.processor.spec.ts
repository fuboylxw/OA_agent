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

  function createDirectLinkDefinition() {
    return {
      processCode: 'leave_request',
      processName: '请假申请',
      accessMode: 'direct_link',
      sourceType: 'direct_link',
      metadata: {
        accessMode: 'direct_link',
        sourceType: 'direct_link',
      },
      platform: {
        entryUrl: 'https://sz.xpu.edu.cn/',
        businessBaseUrl: 'https://oa2023.xpu.edu.cn',
        jumpUrlTemplate: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
      },
      fields: [
        {
          key: 'reason',
          label: '请假事由',
          type: 'textarea',
          required: true,
        },
      ],
      runtime: {
        executorMode: 'http',
        preflight: {
          steps: [
            { type: 'goto', value: 'https://sz.xpu.edu.cn/' },
            { type: 'evaluate', builtin: 'capture_form_submit' },
          ],
        },
        networkSubmit: {
          url: '{{preflight.submitCapture.action}}',
          method: '{{preflight.submitCapture.method}}',
          bodyMode: '{{preflight.submitBodyMode}}',
          body: {
            source: 'preflight.submitFields',
          },
        },
      },
    };
  }

  function createDirectLinkChoiceDefinition() {
    return {
      processCode: 'seal_apply',
      processName: '用印申请',
      accessMode: 'direct_link',
      sourceType: 'direct_link',
      metadata: {
        accessMode: 'direct_link',
        sourceType: 'direct_link',
      },
      platform: {
        entryUrl: 'https://auth.example.com/',
        businessBaseUrl: 'https://oa.example.com',
        jumpUrlTemplate: 'https://oa.example.com/workflow/new?templateId=seal_apply',
      },
      fields: [
        {
          key: 'fileSummary',
          label: '文件类型、名称及份数',
          type: 'textarea',
          required: true,
        },
        {
          key: 'sealType',
          label: '用印类型',
          type: 'checkbox',
          required: true,
          multiple: true,
          options: [
            { label: '党委公章', value: '党委公章' },
            { label: '学校公章', value: '学校公章' },
          ],
        },
      ],
      runtime: {
        executorMode: 'http',
        preflight: {
          steps: [
            { type: 'goto', value: 'https://auth.example.com/' },
            {
              type: 'evaluate',
              builtin: 'capture_form_submit',
              options: {
                fieldMappings: [
                  {
                    fieldKey: 'fileSummary',
                    fieldType: 'textarea',
                    target: { label: '文件类型、名称及份数' },
                  },
                  {
                    fieldKey: 'sealType',
                    fieldType: 'checkbox',
                    options: [
                      { label: '党委公章', value: '党委公章' },
                      { label: '学校公章', value: '学校公章' },
                    ],
                    target: { label: '用印类型' },
                  },
                ],
              },
            },
          ],
        },
        networkSubmit: {
          url: '{{preflight.submitCapture.action}}',
          method: '{{preflight.submitCapture.method}}',
          bodyMode: '{{preflight.submitBodyMode}}',
          body: {
            source: 'preflight.submitFields',
          },
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

  it('builds synthetic URL endpoints from direct-link network runtime definitions', () => {
    const { prisma } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    const processes = (processor as any).buildProcessesFromRpaDefinitions([createDirectLinkDefinition()]);

    expect(processes).toHaveLength(1);
    expect(processes[0].endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'RPA', category: 'submit', path: 'url://leave_request/submit' }),
      ]),
    );
  });

  it('synthesizes direct-link network submit from capture_form_submit when runtime omits explicit networkSubmit', () => {
    const { prisma } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    const definitions = (processor as any).getRpaDefinitions({
      authConfig: { accessMode: 'direct_link' },
      sources: [
        {
          sourceType: 'manual_rpa',
          sourceContent: JSON.stringify({
            flows: [{
              processCode: 'leave_request_capture_only',
              processName: '请假申请',
              accessMode: 'direct_link',
              sourceType: 'direct_link',
              metadata: {
                accessMode: 'direct_link',
                sourceType: 'direct_link',
              },
              fields: [{
                key: 'reason',
                label: '请假事由',
                type: 'textarea',
                required: true,
              }],
              runtime: {
                preflight: {
                  steps: [
                    {
                      type: 'evaluate',
                      builtin: 'capture_form_submit',
                      options: {
                        output: {
                          captureKey: 'submitCapture',
                          fieldsKey: 'submitFields',
                          bodyModeKey: 'submitBodyMode',
                          originKey: 'submitOrigin',
                        },
                      },
                    },
                  ],
                },
              },
            }],
          }),
          metadata: {},
        },
      ],
    });

    expect(definitions[0].runtime).toMatchObject({
      networkSubmit: {
        url: '{{preflight.submitCapture.action}}',
        method: '{{preflight.submitCapture.method}}',
        bodyMode: '{{preflight.submitBodyMode}}',
        body: {
          source: 'preflight.submitFields',
        },
      },
    });

    const processes = (processor as any).buildProcessesFromRpaDefinitions(definitions);
    expect(processes).toHaveLength(1);
    expect(processes[0].endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'RPA', category: 'submit', path: 'url://leave_request_capture_only/submit' }),
      ]),
    );
  });

  it('does not treat direct-link browser submit steps as rpa endpoints without network submit runtime', () => {
    const { prisma } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    const processes = (processor as any).buildProcessesFromRpaDefinitions([{
      processCode: 'leave_request_browser_only',
      processName: '请假申请',
      accessMode: 'direct_link',
      sourceType: 'direct_link',
      metadata: {
        accessMode: 'direct_link',
        sourceType: 'direct_link',
      },
      actions: {
        submit: {
          steps: [{ type: 'click', target: { kind: 'text', value: '提交' } }],
        },
      },
    }]);

    expect(processes).toHaveLength(1);
    expect(processes[0].endpoints).toEqual([]);
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


  it('uses shared system inference to rank auth probing before fallback guesses', async () => {
    const prisma = {
      bootstrapJob: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const processor = new BootstrapProcessor(prisma as any);

    (processor as any).systemInferenceEngine = {
      infer: jest.fn().mockResolvedValue({
        preferredAuthType: 'apikey',
        oaType: 'openapi',
        authCandidates: [
          {
            type: 'apikey',
            confidence: 0.91,
            reason: 'security scheme suggests Authorization header token',
            headerName: 'Authorization',
            headerPrefix: 'Bearer ',
          },
        ],
        authHint: {
          type: 'apikey',
          headerName: 'Authorization',
          headerPrefix: 'Bearer ',
        },
        loginEndpoints: [
          {
            method: 'POST',
            path: '/gateway/session/create',
            confidence: 0.84,
            reason: 'observed in api doc',
          },
        ],
        noAuthProbeTargets: ['https://oa.example.edu.cn/api/process/list'],
        systemShape: {
          oaType: 'openapi',
          interactionModel: 'api',
          portalBridgeSuspected: false,
          confidence: 0.8,
          reason: 'structured api evidence present',
        },
        signals: ['structured API evidence'],
        source: 'mixed',
        llmSucceeded: true,
      }),
    };

    const probeNoAuth = jest.spyOn(processor as any, 'probeNoAuth').mockResolvedValue(null);
    const buildNoAuthProbeTargets = jest.spyOn(processor as any, 'buildNoAuthProbeTargets');
    const probeTokenHeaders = jest.spyOn(processor as any, 'probeTokenHeaders').mockResolvedValue({
      authType: 'apikey',
      headerName: 'Authorization',
      headerPrefix: 'Bearer ',
    });
    const probeLogin = jest.spyOn(processor as any, 'probeLogin').mockResolvedValue(null);
    const updateAuthConfig = jest.spyOn(processor as any, 'updateAuthConfig').mockResolvedValue(undefined);

    await (processor as any).runAuthProbing(
      {
        id: 'job-auth-1',
        tenantId: 'tenant-1',
        oaUrl: 'https://oa.example.edu.cn',
        openApiUrl: 'https://oa.example.edu.cn/openapi.json',
        authConfig: {
          token: 'masked-token',
        },
      },
      [],
      JSON.stringify({
        openapi: '3.0.0',
        paths: {
          '/gateway/session/create': { post: { summary: 'Create session' } },
        },
      }),
    );

    expect((processor as any).systemInferenceEngine.infer).toHaveBeenCalled();
    expect(probeNoAuth).toHaveBeenCalledWith(['https://oa.example.edu.cn/api/process/list']);
    expect(buildNoAuthProbeTargets).not.toHaveBeenCalled();
    expect(probeTokenHeaders).toHaveBeenCalledWith(
      'https://oa.example.edu.cn',
      'masked-token',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'apikey',
          headerName: 'Authorization',
          headerPrefix: 'Bearer ',
        }),
      ]),
    );
    expect(probeLogin).not.toHaveBeenCalled();
    expect(updateAuthConfig).toHaveBeenCalledWith(
      'job-auth-1',
      expect.objectContaining({
        authType: 'apikey',
        headerName: 'Authorization',
      }),
      expect.any(Array),
    );
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
      [
        {
          processCode: 'expense_submit',
          overall: 'passed',
          reason: 'Validation passed',
          endpointChecks: [],
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
          runtimeManifest: expect.objectContaining({
            version: 1,
            capabilities: {
              submit: ['vision'],
              queryStatus: ['vision'],
            },
            definition: expect.objectContaining({ processCode: 'expense_submit' }),
          }),
          executionModes: {
            submit: ['rpa'],
            queryStatus: ['rpa'],
          },
          rpaDefinition: expect.objectContaining({ processCode: 'expense_submit' }),
          validationResult: expect.objectContaining({
            status: 'passed',
            checkedMode: 'bootstrap_validation',
          }),
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
      [
        {
          processCode: 'expense_submit',
          overall: 'passed',
          reason: 'Validation passed',
          endpointChecks: [],
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
          runtimeManifest: expect.objectContaining({
            capabilities: {
              submit: ['api', 'vision'],
              queryStatus: ['api', 'vision'],
            },
          }),
          executionModes: {
            submit: ['api', 'rpa'],
            queryStatus: ['api', 'rpa'],
          },
        }),
      }),
    }));
  });

  it('publishes direct-link bootstrap flows with url execution modes instead of rpa', async () => {
    const { prisma, processTemplateCreate } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    await (processor as any).runCompiling(
      {
        id: 'job-4',
        tenantId: 'tenant-1',
        name: 'XPU OA',
        oaUrl: 'https://oa2023.xpu.edu.cn',
        openApiUrl: null,
        authConfig: { accessMode: 'direct_link', bootstrapMode: 'rpa_only' },
        sources: [
          {
            sourceType: 'manual_rpa',
            sourceContent: JSON.stringify({ flows: [createDirectLinkDefinition()] }),
            metadata: {},
          },
        ],
      },
      [
        {
          processCode: 'leave_request',
          processName: '请假申请',
          category: 'rpa',
          description: 'XPU leave request',
          endpoints: [
            {
              name: '请假申请 submit',
              method: 'RPA',
              path: 'url://leave_request/submit',
              description: 'Submit through URL runtime',
              category: 'submit',
              parameters: [
                {
                  name: 'reason',
                  type: 'string',
                  required: true,
                  description: '请假事由',
                  in: 'body',
                },
              ],
              responseMapping: { success: 'success', data: 'data' },
              bodyTemplate: { kind: 'url_submit' },
            },
          ],
        },
      ],
      [
        {
          processCode: 'leave_request',
          overall: 'passed',
          reason: 'Direct-link flow validated with submit-only capability',
          endpointChecks: [],
        },
      ],
      'PUBLISHED',
      [],
    );

    expect(processTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        uiHints: expect.objectContaining({
          runtimeManifest: expect.objectContaining({
            capabilities: {
              submit: ['url'],
              queryStatus: [],
            },
          }),
          executionModes: {
            submit: ['url'],
            queryStatus: [],
          },
          validationResult: expect.objectContaining({
            status: 'passed',
            checkedMode: 'bootstrap_validation',
          }),
          rpaDefinition: expect.objectContaining({
            processCode: 'leave_request',
            runtime: expect.objectContaining({
              networkSubmit: expect.objectContaining({
                url: '{{preflight.submitCapture.action}}',
              }),
            }),
          }),
        }),
      }),
    }));
  });

  it('preserves direct-link source field type and options when publishing schema fields', async () => {
    const { prisma, processTemplateCreate } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);

    await (processor as any).runCompiling(
      {
        id: 'job-4b',
        tenantId: 'tenant-1',
        name: 'Seal OA',
        oaUrl: 'https://oa.example.com',
        openApiUrl: null,
        authConfig: { accessMode: 'direct_link', bootstrapMode: 'rpa_only' },
        sources: [
          {
            sourceType: 'manual_rpa',
            sourceContent: JSON.stringify({ flows: [createDirectLinkChoiceDefinition()] }),
            metadata: {},
          },
        ],
      },
      [
        {
          processCode: 'seal_apply',
          processName: '用印申请',
          category: 'rpa',
          description: 'Seal submit',
          endpoints: [
            {
              name: '用印申请 submit',
              method: 'RPA',
              path: 'url://seal_apply/submit',
              description: 'Submit through URL runtime',
              category: 'submit',
              parameters: [
                {
                  name: 'fileSummary',
                  type: 'string',
                  required: true,
                  description: '文件类型、名称及份数',
                  in: 'body',
                },
                {
                  name: 'sealType',
                  type: 'checkbox',
                  required: true,
                  description: '用印类型 | 说明: 选择本次需要办理的印章类型',
                  in: 'body',
                },
              ],
              responseMapping: { success: 'success', data: 'data' },
              bodyTemplate: { kind: 'url_submit' },
            },
          ],
        },
      ],
      [
        {
          processCode: 'seal_apply',
          overall: 'passed',
          reason: 'Direct-link flow validated with submit-only capability',
          endpointChecks: [],
        },
      ],
      'PUBLISHED',
      [],
    );

    expect(processTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        schema: {
          fields: expect.arrayContaining([
            expect.objectContaining({
              key: 'sealType',
              label: '用印类型',
              type: 'checkbox',
              required: true,
              multiple: true,
              options: [
                { label: '党委公章', value: '党委公章' },
                { label: '学校公章', value: '学校公章' },
              ],
            }),
          ]),
        },
      }),
    }));
  });

  it('infers shared oauth backend login and portal discovery metadata for cross-origin direct-link connectors', async () => {
    const { prisma, connectorUpsert, tx } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);
    const originalClientId = process.env.AUTH_OAUTH2_CLIENT_ID;
    const originalPrivateKey = process.env.AUTH_OAUTH2_PRIVATE_KEY;
    const originalBaseUrl = process.env.AUTH_OAUTH2_BASE_URL;
    const originalLoginUrl = process.env.AUTH_OAUTH2_LOGIN_URL;
    const originalAccountField = process.env.AUTH_OAUTH2_ACCOUNT_FIELD;

    process.env.AUTH_OAUTH2_CLIENT_ID = 'shared-client-id';
    process.env.AUTH_OAUTH2_PRIVATE_KEY = 'shared-private-key';
    process.env.AUTH_OAUTH2_BASE_URL = 'https://sz.xpu.edu.cn';
    delete process.env.AUTH_OAUTH2_LOGIN_URL;
    delete process.env.AUTH_OAUTH2_ACCOUNT_FIELD;

    try {
      await (processor as any).runCompiling(
        {
          id: 'job-5',
          tenantId: 'tenant-1',
          name: 'XPU OA',
          oaUrl: 'https://oa2023.xpu.edu.cn',
          openApiUrl: null,
          authConfig: { accessMode: 'direct_link', bootstrapMode: 'rpa_only' },
          sources: [
            {
              sourceType: 'manual_rpa',
              sourceContent: JSON.stringify({ flows: [createDirectLinkDefinition()] }),
              metadata: {},
            },
          ],
        },
        [
          {
            processCode: 'leave_request',
            processName: '请假申请',
            category: 'rpa',
            description: 'XPU leave request',
            endpoints: [
              {
                name: '请假申请 submit',
                method: 'RPA',
                path: 'url://leave_request/submit',
                description: 'Submit through URL runtime',
                category: 'submit',
                parameters: [
                  {
                    name: 'reason',
                    type: 'string',
                    required: true,
                    description: '请假事由',
                    in: 'body',
                  },
                ],
                responseMapping: { success: 'success', data: 'data' },
                bodyTemplate: { kind: 'url_submit' },
              },
            ],
          },
        ],
        [
          {
            processCode: 'leave_request',
            overall: 'passed',
            reason: 'Validation passed',
            endpointChecks: [],
          },
        ],
        'PUBLISHED',
        [],
      );
    } finally {
      if (originalClientId === undefined) delete process.env.AUTH_OAUTH2_CLIENT_ID;
      else process.env.AUTH_OAUTH2_CLIENT_ID = originalClientId;
      if (originalPrivateKey === undefined) delete process.env.AUTH_OAUTH2_PRIVATE_KEY;
      else process.env.AUTH_OAUTH2_PRIVATE_KEY = originalPrivateKey;
      if (originalBaseUrl === undefined) delete process.env.AUTH_OAUTH2_BASE_URL;
      else process.env.AUTH_OAUTH2_BASE_URL = originalBaseUrl;
      if (originalLoginUrl === undefined) delete process.env.AUTH_OAUTH2_LOGIN_URL;
      else process.env.AUTH_OAUTH2_LOGIN_URL = originalLoginUrl;
      if (originalAccountField === undefined) delete process.env.AUTH_OAUTH2_ACCOUNT_FIELD;
      else process.env.AUTH_OAUTH2_ACCOUNT_FIELD = originalAccountField;
    }

    expect(connectorUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        authConfig: expect.objectContaining({
          accessMode: 'direct_link',
          bootstrapMode: 'rpa_only',
          authType: 'cookie',
          platformConfig: expect.objectContaining({
            entryUrl: 'https://sz.xpu.edu.cn/',
            businessBaseUrl: 'https://oa2023.xpu.edu.cn',
            targetBaseUrl: 'https://oa2023.xpu.edu.cn',
            oaBackendLogin: expect.objectContaining({
              enabled: true,
              loginUrl: 'https://sz.xpu.edu.cn/auth2/api/v1/login',
              clientIdEnv: 'AUTH_OAUTH2_CLIENT_ID',
              privateKeyEnv: 'AUTH_OAUTH2_PRIVATE_KEY',
              accountField: 'username',
            }),
            authDiscovery: expect.objectContaining({
              mode: 'portal_token_bridge',
              portalUrl: 'https://sz.xpu.edu.cn/',
              businessBaseUrl: 'https://oa2023.xpu.edu.cn',
            }),
          }),
        }),
      }),
    }));
    expect(tx.bootstrapJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        authConfig: expect.objectContaining({
          platformConfig: expect.objectContaining({
            oaBackendLogin: expect.objectContaining({
              loginUrl: 'https://sz.xpu.edu.cn/auth2/api/v1/login',
            }),
          }),
        }),
      }),
    }));
  });

  it('keeps explicit backend login settings when direct-link connector auth has already been configured', async () => {
    const { prisma, connectorUpsert } = createTxMocks();
    const processor = new BootstrapProcessor(prisma as any);
    const originalClientId = process.env.AUTH_OAUTH2_CLIENT_ID;
    const originalPrivateKey = process.env.AUTH_OAUTH2_PRIVATE_KEY;
    const originalBaseUrl = process.env.AUTH_OAUTH2_BASE_URL;

    process.env.AUTH_OAUTH2_CLIENT_ID = 'shared-client-id';
    process.env.AUTH_OAUTH2_PRIVATE_KEY = 'shared-private-key';
    process.env.AUTH_OAUTH2_BASE_URL = 'https://sz.xpu.edu.cn';

    try {
      await (processor as any).runCompiling(
        {
          id: 'job-6',
          tenantId: 'tenant-1',
          name: 'XPU OA',
          oaUrl: 'https://oa2023.xpu.edu.cn',
          openApiUrl: null,
          authConfig: {
            accessMode: 'direct_link',
            bootstrapMode: 'rpa_only',
            platformConfig: {
              oaBackendLogin: {
                enabled: true,
                loginUrl: 'https://custom.example.com/whitelist/login',
                accountField: 'email',
              },
            },
          },
          sources: [
            {
              sourceType: 'manual_rpa',
              sourceContent: JSON.stringify({ flows: [createDirectLinkDefinition()] }),
              metadata: {},
            },
          ],
        },
        [
          {
            processCode: 'leave_request',
            processName: '请假申请',
            category: 'rpa',
            description: 'XPU leave request',
            endpoints: [
              {
                name: '请假申请 submit',
                method: 'RPA',
                path: 'url://leave_request/submit',
                description: 'Submit through URL runtime',
                category: 'submit',
                parameters: [],
                responseMapping: { success: 'success', data: 'data' },
                bodyTemplate: { kind: 'url_submit' },
              },
            ],
          },
        ],
        [
          {
            processCode: 'leave_request',
            overall: 'passed',
            reason: 'Validation passed',
            endpointChecks: [],
          },
        ],
        'PUBLISHED',
        [],
      );
    } finally {
      if (originalClientId === undefined) delete process.env.AUTH_OAUTH2_CLIENT_ID;
      else process.env.AUTH_OAUTH2_CLIENT_ID = originalClientId;
      if (originalPrivateKey === undefined) delete process.env.AUTH_OAUTH2_PRIVATE_KEY;
      else process.env.AUTH_OAUTH2_PRIVATE_KEY = originalPrivateKey;
      if (originalBaseUrl === undefined) delete process.env.AUTH_OAUTH2_BASE_URL;
      else process.env.AUTH_OAUTH2_BASE_URL = originalBaseUrl;
    }

    expect(connectorUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        authConfig: expect.objectContaining({
          platformConfig: expect.objectContaining({
            oaBackendLogin: expect.objectContaining({
              loginUrl: 'https://custom.example.com/whitelist/login',
              accountField: 'email',
            }),
          }),
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
      [
        {
          processCode: 'expense_submit',
          overall: 'passed',
          reason: 'Validation passed',
          endpointChecks: [],
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
