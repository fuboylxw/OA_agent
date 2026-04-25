import { ProcessLibraryService } from './process-library.service';
import { PrismaService } from '../common/prisma.service';
import { TextGuideLlmParserService } from '../bootstrap/text-guide-llm-parser.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { DeliveryOrchestratorService } from '../delivery-runtime/delivery-orchestrator.service';

describe('ProcessLibraryService', () => {
  let service: ProcessLibraryService;
  let prisma: any;
  let textGuideLlmParserService: Pick<TextGuideLlmParserService, 'parse'>;
  let adapterRuntimeService: Pick<AdapterRuntimeService, 'createApiAdapterForConnector' | 'createRpaAdapterForConnector' | 'destroyAdapter' | 'resolveAuthConfigForExecution'>;
  let deliveryOrchestrator: Pick<DeliveryOrchestratorService, 'submit'>;

  const validFlowContent = JSON.stringify({
    flows: [{
      processCode: 'leave_request',
      processName: '请假申请',
      fields: [
        { key: 'reason', label: '请假原因', type: 'textarea', required: true },
      ],
      actions: {
        submit: {
          steps: [
            { type: 'goto', value: 'https://oa.example.com/leave' },
            { type: 'input', fieldKey: 'reason', target: { kind: 'text', value: '请假原因' } },
            { type: 'click', target: { kind: 'text', value: '提交' } },
          ],
        },
      },
    }],
  });


  const validUrlTextTemplate = [
    '流程: 请假申请',
    '流程编码: leave_request',
    '描述: 教职工请假申请示例',
    '系统网址: https://oa.example.com',
    '流程页面: https://oa.example.com/workflow/new?templateId=leave_request',
    '',
    '需要填写的信息:',
    '- 请假事由 | 说明: 填写本次请假的具体原因 | 示例: 家中有事，需要请假半天',
    '- 开始日期 | 示例: 2026-04-20',
    '',
    '需要上传的材料:',
    '- 病假证明 | 示例: 诊断证明.pdf',
    '',
    '步骤:',
    '- 访问 https://oa.example.com/workflow/new?templateId=leave_request',
    '- 点击 保存待发',
    '- 看到 提交成功 就结束',
  ].join('\n');

  const validRpaTextTemplate = [
    '流程: 用印申请',
    '流程编码: seal_apply',
    '描述: 用印申请示例',
    '入口链接: https://oa.example.com/workflow',
    '',
    '需要填写的信息:',
    '- 文件类型、名称及份数 | 说明: 填写文件名称和份数 | 示例: 劳务合同 2份',
    '',
    '需要上传的材料:',
    '- 用印附件 | 示例: 劳务合同.pdf',
    '',
    '步骤:',
    '- 访问 https://oa.example.com/workflow',
    '- 点击 用印申请',
    '- 填写 文件类型、名称及份数',
    '- 上传 用印附件',
    '- 点击 保存待发',
  ].join('\n');

  const validApiTextTemplate = [
    '流程: 合同审批',
    '流程编码: contract_apply',
    '描述: 通过接口提交合同审批示例',
    '系统网址: https://oa.example.com',
    '提交接口: POST /api/workflow/contract/submit',
    '查询接口: GET /api/workflow/contract/status/{submissionId}',
    '提交成功字段: success',
    '状态字段: data.status',
    '',
    '需要填写的信息:',
    '- 合同名称 | 说明: 合同标题 | 示例: 校企合作协议',
    '- 合同金额 | 示例: 12000',
    '',
    '需要上传的材料:',
    '- 合同附件 | 示例: 合同正文.pdf | 多份',
  ].join('\n');

  beforeEach(() => {
    jest.useFakeTimers();

    textGuideLlmParserService = {
      parse: jest.fn().mockResolvedValue(null),
    };
    adapterRuntimeService = {
      createApiAdapterForConnector: jest.fn(),
      createRpaAdapterForConnector: jest.fn(),
      destroyAdapter: jest.fn().mockResolvedValue(undefined),
      resolveAuthConfigForExecution: jest.fn().mockResolvedValue({
        sessionCookie: 'SESSION=ready',
      }),
    };
    deliveryOrchestrator = {
      submit: jest.fn(),
    };

    prisma = {
      connector: {
        findFirst: jest.fn(),
      },
      bootstrapJob: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      processTemplate: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'template-1',
            processCode: 'leave_request',
            processName: 'Leave Application',
            processCategory: 'hr',
            version: 2,
            status: 'published',
            falLevel: 'F2',
            uiHints: null,
            createdAt: new Date('2026-03-24T00:00:00.000Z'),
            updatedAt: new Date('2026-03-24T00:00:00.000Z'),
            connector: {
              id: 'connector-1',
              name: '统一办公',
              identityScope: 'both',
              oaType: 'form-page',
              oclLevel: 'OCL3',
            },
          },
        ]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    service = new ProcessLibraryService(
      prisma as unknown as PrismaService,
      textGuideLlmParserService as TextGuideLlmParserService,
      adapterRuntimeService as AdapterRuntimeService,
      deliveryOrchestrator as DeliveryOrchestratorService,
    );
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('returns published process templates with normalized process names', async () => {
    const items = await service.list('tenant-1');

    expect(prisma.processTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        status: 'published',
        connector: {
          is: {
            tenantId: 'tenant-1',
            bootstrapJobs: {
              some: {},
            },
            identityScope: {
              in: ['both'],
            },
          },
        },
      }),
    }));

    expect(items).toEqual([
      expect.objectContaining({
        processCode: 'leave_request',
        processName: 'Leave Application Request',
        version: 2,
        sourceType: 'published',
      }),
    ]);
  });

  it('hydrates missing validationResult from bootstrap flow validation metadata', async () => {
    prisma.processTemplate.findMany.mockResolvedValue([
      {
        id: 'template-legacy-1',
        connectorId: 'connector-legacy-1',
        processCode: 'leave_request',
        processName: '请假申请',
        processCategory: 'hr',
        version: 1,
        status: 'published',
        falLevel: 'F2',
        uiHints: {
          runtimeManifest: {
            version: 1,
          },
        },
        createdAt: new Date('2026-04-24T00:00:00.000Z'),
        updatedAt: new Date('2026-04-24T00:00:00.000Z'),
        connector: {
          id: 'connector-legacy-1',
          name: '历史连接器',
          identityScope: 'both',
          oaType: 'form-page',
          oclLevel: 'OCL2',
        },
      },
    ]);
    prisma.bootstrapJob.findMany.mockResolvedValue([
      {
        connectorId: 'connector-legacy-1',
        completedAt: new Date('2026-04-24T01:00:00.000Z'),
        updatedAt: new Date('2026-04-24T01:00:00.000Z'),
        flowIRs: [
          {
            flowCode: 'leave_request',
            metadata: {
              validation: {
                status: 'passed',
                reason: 'Direct-link flow validated with submit-only capability',
                endpointCheckedCount: 1,
                endpointPassedCount: 1,
                endpointFailedCount: 0,
                failedEndpoints: [],
                error: null,
              },
            },
          },
        ],
      },
    ]);

    const items = await service.list('tenant-1');

    expect(prisma.bootstrapJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        connectorId: {
          in: ['connector-legacy-1'],
        },
      }),
    }));
    expect(items).toEqual([
      expect.objectContaining({
        processCode: 'leave_request',
        uiHints: expect.objectContaining({
          validationResult: expect.objectContaining({
            status: 'passed',
            checkedMode: 'bootstrap_validation',
            reason: 'Direct-link flow validated with submit-only capability',
            endpointCheckedCount: 1,
            endpointPassedCount: 1,
          }),
        }),
      }),
    ]);
  });

  it('requires the source system to exist before manually creating a process', async () => {
    prisma.connector.findFirst.mockResolvedValue(null);

    await expect(service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      processCode: 'leave_request',
      processName: '请假申请',
      falLevel: 'F2',
      rpaFlowContent: validFlowContent,
    })).rejects.toThrow('所属连接器不存在');

    expect(prisma.connector.findFirst).toHaveBeenCalledWith({
      where: {
        id: '11111111-1111-1111-1111-111111111111',
        tenantId: 'tenant-1',
        bootstrapJobs: {
          some: {},
        },
      },
      select: {
        id: true,
        name: true,
        identityScope: true,
        oaType: true,
        baseUrl: true,
      },
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('previews process metadata from template content for auto-fill', async () => {
    const result = await service.previewManualProcessTemplate('tenant-1', {
      accessMode: 'url',
      authoringMode: 'text',
      rpaFlowContent: validUrlTextTemplate,
    });

    expect(result).toEqual({
      processCode: 'leave_request',
      processName: '请假申请',
      description: '教职工请假申请示例',
      accessMode: 'url',
    });
  });

  it('filters process library by identityScope for end users', async () => {
    prisma.processTemplate.findMany.mockResolvedValue([]);

    await service.list('tenant-1', undefined, undefined, {
      identityType: 'teacher',
      roles: ['user'],
    });

    expect(prisma.processTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        connector: {
          is: {
            tenantId: 'tenant-1',
            bootstrapJobs: {
              some: {},
            },
            identityScope: {
              in: ['both', 'teacher'],
            },
          },
        },
      }),
    }));
  });

  it('rejects manual creation when the payload contains multiple flow definitions', async () => {
    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });

    await expect(service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      processCode: 'leave_request',
      processName: '请假申请',
      falLevel: 'F2',
      rpaFlowContent: JSON.stringify({
        flows: [
          {
            processCode: 'leave_request',
            processName: '请假申请',
            actions: { submit: { steps: [{ type: 'click', target: { kind: 'text', value: '提交' } }] } },
          },
          {
            processCode: 'expense_submit',
            processName: '费用报销',
            actions: { submit: { steps: [{ type: 'click', target: { kind: 'text', value: '提交' } }] } },
          },
        ],
      }),
    })).rejects.toThrow('单个添加流程只能提交一个流程定义');
  });

  it('rejects manual creation when the flow has no executable submit steps', async () => {
    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });

    await expect(service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      processCode: 'leave_request',
      processName: '请假申请',
      falLevel: 'F2',
      rpaFlowContent: JSON.stringify({
        flows: [{
          processCode: 'leave_request',
          processName: '请假申请',
          actions: {
            submit: {
              steps: [],
            },
          },
        }],
      }),
    })).rejects.toThrow('流程定义必须包含可执行的提交步骤');
  });

  it('accepts url text templates and stores authoring metadata for edit playback', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-1', latestTemplateId: 'template-text-url' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-text-url',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-19T10:00:00.000Z'),
          updatedAt: new Date('2026-04-19T10:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      processCode: 'leave_request',
      processName: '请假申请',
      falLevel: 'F3',
      accessMode: 'url',
      authoringMode: 'text',
      rpaFlowContent: validUrlTextTemplate,
    });

    expect(tx.processTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        uiHints: expect.objectContaining({
          runtimeManifest: expect.objectContaining({
            version: 1,
            capabilities: {
              submit: ['url'],
              queryStatus: [],
            },
            definition: expect.objectContaining({
              processCode: 'leave_request',
            }),
          }),
          executionModes: {
            submit: ['url'],
            queryStatus: [],
          },
          authoring: expect.objectContaining({
            mode: 'text',
            accessMode: 'url',
            textTemplate: validUrlTextTemplate,
          }),
        }),
      }),
    }));
  });

  it('auto-runs a safe draft validation probe after publishing when sample data is available', async () => {
    let storedUiHints: any = null;
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-probe-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-probe-1', latestTemplateId: 'template-probe-1' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          storedUiHints = data.uiHints;
          return {
            id: 'template-probe-1',
            ...data,
            connector: {
              id: 'connector-1',
              name: '统一办公',
              oaType: 'form-page',
              oclLevel: 'OCL3',
            },
            createdAt: new Date('2026-04-24T12:00:00.000Z'),
            updatedAt: new Date('2026-04-24T12:00:00.000Z'),
          };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst
      .mockResolvedValueOnce({
        id: 'connector-1',
        name: '统一办公',
        oaType: 'form-page',
        baseUrl: 'https://oa.example.com',
      })
      .mockResolvedValueOnce({
        id: 'connector-1',
        authType: 'cookie',
        authConfig: {},
        secretRef: null,
      });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    prisma.processTemplate.findUnique.mockImplementation(async () => ({
      id: 'template-probe-1',
      uiHints: storedUiHints,
    }));
    prisma.processTemplate.update.mockImplementation(async ({ data }: any) => {
      storedUiHints = data.uiHints;
      return {
        id: 'template-probe-1',
        uiHints: storedUiHints,
      };
    });

    (adapterRuntimeService.createRpaAdapterForConnector as jest.Mock).mockResolvedValue({
      healthCheck: jest.fn().mockResolvedValue({
        healthy: true,
        latencyMs: 12,
        message: 'Loaded 1 RPA flow definitions',
      }),
    });
    (deliveryOrchestrator.submit as jest.Mock).mockResolvedValue({
      submitResult: {
        success: true,
        submissionId: 'OA-DRAFT-1001',
        metadata: {
          completionKind: 'draft',
        },
      },
      packet: {
        success: true,
      },
    });

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      falLevel: 'F2',
      accessMode: 'url',
      authoringMode: 'text',
      rpaFlowContent: validUrlTextTemplate,
    }, {
      userId: 'user-1',
    });

    await jest.runOnlyPendingTimersAsync();

    expect(deliveryOrchestrator.submit).toHaveBeenCalledWith(expect.objectContaining({
      connectorId: 'connector-1',
      processCode: 'leave_request',
      processName: '请假申请',
      tenantId: 'tenant-1',
      userId: 'user-1',
      formData: expect.objectContaining({
        field_1: '家中有事，需要请假半天',
        field_2: '2026-04-20',
      }),
    }));
    expect(prisma.processTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'template-probe-1' },
      data: expect.objectContaining({
        uiHints: expect.objectContaining({
          validationResult: expect.objectContaining({
            status: 'passed',
            checkedMode: 'system_submit_probe',
            reason: expect.stringContaining('保存待发/草稿态'),
          }),
        }),
      }),
    }));
  });

  it('blocks auto validation with an explicit auth-readiness reason when no reusable auth is available', async () => {
    let storedUiHints: any = null;
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-probe-2' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-probe-2', latestTemplateId: 'template-probe-2' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          storedUiHints = data.uiHints;
          return {
            id: 'template-probe-2',
            ...data,
            connector: {
              id: 'connector-1',
              name: '统一办公',
              oaType: 'form-page',
              oclLevel: 'OCL3',
            },
            createdAt: new Date('2026-04-24T12:10:00.000Z'),
            updatedAt: new Date('2026-04-24T12:10:00.000Z'),
          };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst
      .mockResolvedValueOnce({
        id: 'connector-1',
        name: '统一办公',
        oaType: 'form-page',
        baseUrl: 'https://oa.example.com',
      })
      .mockResolvedValueOnce({
        id: 'connector-1',
        authType: 'cookie',
        authConfig: {},
        secretRef: null,
      });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    prisma.processTemplate.findUnique.mockImplementation(async () => ({
      id: 'template-probe-2',
      uiHints: storedUiHints,
    }));
    prisma.processTemplate.update.mockImplementation(async ({ data }: any) => {
      storedUiHints = data.uiHints;
      return {
        id: 'template-probe-2',
        uiHints: storedUiHints,
      };
    });

    (adapterRuntimeService.resolveAuthConfigForExecution as jest.Mock).mockResolvedValue({});

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      falLevel: 'F2',
      accessMode: 'url',
      authoringMode: 'text',
      rpaFlowContent: validUrlTextTemplate,
    }, {
      userId: 'user-1',
    });

    await jest.runOnlyPendingTimersAsync();

    expect(adapterRuntimeService.createRpaAdapterForConnector).not.toHaveBeenCalled();
    expect(deliveryOrchestrator.submit).not.toHaveBeenCalled();
    expect(prisma.processTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'template-probe-2' },
      data: expect.objectContaining({
        uiHints: expect.objectContaining({
          validationResult: expect.objectContaining({
            status: 'blocked',
            checkedMode: 'system_preflight',
            reason: expect.stringContaining('缺少可复用登录态或后端登录配置'),
          }),
        }),
      }),
    }));
  });

  it('derives process metadata from template body when manual creation omits top-level process fields', async () => {
    const templateWithoutProcessCode = [
      '流程: 请假申请',
      '描述: 教职工请假申请示例',
      '系统网址: https://oa.example.com',
      '流程页面: https://oa.example.com/workflow/new?templateId=leave_request',
      '',
      '需要填写的信息:',
      '- 请假事由 | 说明: 填写本次请假的具体原因 | 示例: 家中有事，需要请假半天',
      '',
      '步骤:',
      '- 访问 https://oa.example.com/workflow/new?templateId=leave_request',
      '- 点击 保存待发',
      '- 看到 提交成功 就结束',
    ].join('\n');

    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-derived-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-derived-1', latestTemplateId: 'template-derived-1' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-derived-1',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-24T10:00:00.000Z'),
          updatedAt: new Date('2026-04-24T10:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      falLevel: 'F3',
      accessMode: 'url',
      authoringMode: 'text',
      rpaFlowContent: templateWithoutProcessCode,
    });

    const createCall = (tx.processTemplate.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.processName).toBe('请假申请');
    expect(createCall.data.processCode).toMatch(/^flow_[a-f0-9]{8}$/);
    expect(createCall.data.description).toBe('教职工请假申请示例');
    expect(createCall.data.uiHints.authoring.textTemplate).toBe(templateWithoutProcessCode);
    expect(createCall.data.uiHints.runtimeManifest.definition.processCode).toBe(createCall.data.processCode);
  });

  it('keeps inline url-step choice metadata as clean schema fields for manual process creation', async () => {
    const inlineUrlTemplate = [
      '流程: 用印申请',
      '流程编码: seal_apply',
      '描述: 用印申请示例',
      '认证入口: https://auth.example.com/',
      '系统网址: https://oa.example.com/',
      '',
      '步骤:',
      '- 访问 https://auth.example.com/',
      '- 访问 https://oa.example.com/',
      '- 填写 文件类型、名称及份数 | 说明: 填写文件名称和份数 | 示例: 劳务合同 2份',
      '- 上传 用印附件 | 说明: 上传需要盖章的文件 | 示例: 劳务合同.pdf | 上传要求: 支持上传多份，未上传视为信息缺失 | 可多选',
      '- 选择 用印类型 | 说明: 选择本次需要办理的印章类型 | 示例: 党委公章 | 可选值: 党委公章、学校公章 | 可多选',
      '- 点击 保存待发',
      '- 看到 提交成功 就结束',
    ].join('\n');

    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-inline-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-inline-1', latestTemplateId: 'template-inline-url' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-inline-url',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-20T10:00:00.000Z'),
          updatedAt: new Date('2026-04-20T10:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      processCode: 'seal_apply',
      processName: '用印申请',
      falLevel: 'F3',
      accessMode: 'url',
      authoringMode: 'text',
      rpaFlowContent: inlineUrlTemplate,
    });

    const createCall = (tx.processTemplate.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.schema.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: '用印附件',
        type: 'file',
        multiple: true,
      }),
      expect.objectContaining({
        label: '用印类型',
        type: 'checkbox',
        multiple: true,
        options: [
          { label: '党委公章', value: '党委公章' },
          { label: '学校公章', value: '学校公章' },
        ],
      }),
    ]));
    expect(createCall.data.uiHints.runtimeManifest).toEqual(expect.objectContaining({
      version: 1,
      capabilities: {
        submit: ['url'],
        queryStatus: [],
      },
    }));
    expect(createCall.data.uiHints.rpaDefinition.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: '用印类型',
        type: 'checkbox',
        multiple: true,
      }),
    ]));
  });

  it('accepts rpa text templates and keeps rpa submit execution mode', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-1', latestTemplateId: 'template-text-rpa' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-text-rpa',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-19T11:00:00.000Z'),
          updatedAt: new Date('2026-04-19T11:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      processCode: 'seal_apply',
      processName: '用印申请',
      falLevel: 'F2',
      accessMode: 'rpa',
      authoringMode: 'text',
      rpaFlowContent: validRpaTextTemplate,
    });

    expect(tx.processTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        uiHints: expect.objectContaining({
          runtimeManifest: expect.objectContaining({
            capabilities: {
              submit: ['vision'],
              queryStatus: [],
            },
          }),
          executionModes: {
            submit: ['rpa'],
            queryStatus: [],
          },
          authoring: expect.objectContaining({
            mode: 'text',
            accessMode: 'rpa',
          }),
        }),
        schema: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ label: '文件类型、名称及份数' }),
            expect.objectContaining({ label: '用印附件', type: 'file' }),
          ]),
        }),
      }),
    }));
  });

  it('keeps fallback text parsing conservative and does not infer file type only from attachment-like wording', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-fallback-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-fallback-1', latestTemplateId: 'template-fallback-1' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-fallback-1',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-23T11:00:00.000Z'),
          updatedAt: new Date('2026-04-23T11:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    (textGuideLlmParserService.parse as jest.Mock).mockResolvedValue(null);

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: 'connector-1',
      processCode: 'info_register',
      processName: '信息登记',
      description: '保守 fallback 回归',
      falLevel: 'F2',
      accessMode: 'rpa',
      authoringMode: 'text',
      rpaFlowContent: [
        '流程: 信息登记',
        '流程编码: info_register',
        '用户办理时需要补充的信息:',
        '- 附件名称 | 说明: 这里只是填写附件名称，不是上传入口 | 示例: 申请材料.pdf',
        '办理步骤:',
        '- 输入 附件名称',
        '- 点击 保存',
      ].join('\n'),
    });

    const createdDefinition = tx.processTemplate.create.mock.calls[0][0].data.uiHints.rpaDefinition;
    expect(createdDefinition.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: '附件名称',
        type: 'text',
      }),
    ]));
    expect(createdDefinition.actions.submit.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input',
        }),
      ]),
    );
    expect(createdDefinition.actions.submit.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upload',
        }),
      ]),
    );
  });

  it('rejects free-form text authoring when llm parsing is unavailable instead of rule-guessing', async () => {
    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    (textGuideLlmParserService.parse as jest.Mock).mockRejectedValue(new Error('llm unavailable'));

    await expect(service.createManualProcessTemplate('tenant-1', {
      connectorId: 'connector-1',
      processCode: 'info_register',
      processName: '信息登记',
      description: '自由表述不应由规则层猜测',
      falLevel: 'F2',
      accessMode: 'rpa',
      authoringMode: 'text',
      rpaFlowContent: [
        '点击 新建',
        '输入 附件名称 为 申请材料.pdf',
        '点击 保存',
      ].join('\n'),
    })).rejects.toThrow('未识别出统一文字模板结构，请按模板填写');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts api text templates, publishes api execution modes, and upserts manual api tools', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-api-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-api-1', latestTemplateId: 'template-text-api' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-text-api',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'openapi',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-19T11:30:00.000Z'),
          updatedAt: new Date('2026-04-19T11:30:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      mCPTool: {
        upsert: jest.fn().mockResolvedValue({ id: 'tool-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'openapi',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      processCode: 'contract_apply',
      processName: '合同审批',
      falLevel: 'F2',
      accessMode: 'api',
      inputMethod: 'file',
      authoringMode: 'text',
      rpaFlowContent: validApiTextTemplate,
    });

    expect(tx.mCPTool.upsert).toHaveBeenCalledTimes(2);
    expect(tx.processTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        uiHints: expect.objectContaining({
          runtimeManifest: expect.objectContaining({
            capabilities: {
              submit: ['api'],
              queryStatus: ['api'],
            },
            endpoints: expect.arrayContaining([
              expect.objectContaining({
                method: 'POST',
                category: 'submit',
              }),
            ]),
          }),
          apiMethod: 'POST',
          apiPath: 'https://oa.example.com/api/workflow/contract/submit',
          executionModes: {
            submit: ['api'],
            queryStatus: ['api'],
          },
          authoring: expect.objectContaining({
            accessMode: 'api',
            inputMethod: 'file',
          }),
        }),
      }),
    }));
  });

  it('accepts direct-link definitions with network submit and publishes url execution modes', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-1', latestTemplateId: 'template-3' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-3',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-16T10:00:00.000Z'),
          updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      processCode: 'leave_request_url',
      processName: '请假申请-URL',
      falLevel: 'F3',
      rpaFlowContent: JSON.stringify({
        flows: [{
          processCode: 'leave_request_url',
          processName: '请假申请-URL',
          accessMode: 'direct_link',
          sourceType: 'direct_link',
          runtime: {
            networkSubmit: {
              url: 'https://oa.example.com/api/submit',
            },
          },
        }],
      }),
    });

    expect(tx.processTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
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
        }),
      }),
    }));
  });

  it('creates a published process under the selected source system and archives older versions', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-1', latestTemplateId: 'template-3' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue({ id: 'template-2', version: 2 }),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-3',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-16T10:00:00.000Z'),
          updatedAt: new Date('2026-04-16T10:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await service.createManualProcessTemplate('tenant-1', {
      connectorId: '11111111-1111-1111-1111-111111111111',
      processCode: ' Leave Request ',
      processName: ' 请假申请 ',
      processCategory: ' 人事 ',
      description: ' 员工请假流程 ',
      falLevel: 'F3',
      rpaFlowContent: validFlowContent,
    });

    expect(tx.remoteProcess.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        connectorId_remoteProcessId: {
          connectorId: 'connector-1',
          remoteProcessId: 'leave_request',
        },
      },
      create: expect.objectContaining({
        connectorId: 'connector-1',
        remoteProcessCode: 'leave_request',
        remoteProcessName: '请假申请',
        processCategory: '人事',
      }),
    }));
    expect(tx.processTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        remoteProcessId: 'remote-1',
        processCode: 'leave_request',
        processName: '请假申请',
        processCategory: '人事',
        description: '员工请假流程',
        version: 3,
        status: 'published',
        falLevel: 'F3',
        supersedesId: 'template-2',
      }),
    }));
    expect(tx.processTemplate.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        processCode: 'leave_request',
        status: 'published',
        NOT: { id: 'template-3' },
      },
      data: {
        status: 'archived',
      },
    });
    expect(tx.remoteProcess.update).toHaveBeenCalledWith({
      where: { id: 'remote-1' },
      data: {
        latestTemplateId: 'template-3',
        sourceVersion: '3',
      },
    });
    expect(result).toEqual(expect.objectContaining({
      id: 'template-3',
      processCode: 'leave_request',
      processName: '请假申请',
      version: 3,
      connector: expect.objectContaining({
        id: 'connector-1',
        name: '统一办公',
      }),
    }));
  });

  it('syncs saved text templates with updated basic fields when editing text-authored flows', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-1', latestTemplateId: 'template-sync-text' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue({ id: 'template-old-text', version: 1 }),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-sync-text',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-19T12:00:00.000Z'),
          updatedAt: new Date('2026-04-19T12:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prisma.processTemplate.findFirst = jest.fn().mockResolvedValue({
      id: 'template-old-text',
      connectorId: 'connector-1',
    });
    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.updateManualProcessTemplate('tenant-1', 'template-old-text', {
      connectorId: 'connector-1',
      processCode: 'seal_apply_new',
      processName: '用印申请（新版）',
      description: '新的描述',
      falLevel: 'F2',
      accessMode: 'rpa',
      authoringMode: 'text',
      rpaFlowContent: validRpaTextTemplate,
    });

    expect(tx.processTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        uiHints: expect.objectContaining({
          authoring: expect.objectContaining({
            mode: 'text',
            accessMode: 'rpa',
            textTemplate: expect.stringContaining('流程: 用印申请（新版）'),
          }),
        }),
      }),
    }));
    const uiHints = tx.processTemplate.create.mock.calls[0][0].data.uiHints;
    expect(uiHints.authoring.textTemplate).toContain('流程编码: seal_apply_new');
    expect(uiHints.authoring.textTemplate).toContain('描述: 新的描述');
  });

  it('falls back to llm parsing for free-form text when deterministic template parsing cannot understand it', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-llm-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-llm-1', latestTemplateId: 'template-llm-1' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-llm-1',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-23T10:00:00.000Z'),
          updatedAt: new Date('2026-04-23T10:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const freeFormGuide = [
      '请帮我配置一个统一办公里的用印申请流程。',
      '进入工作台后点击用印申请，填写文件类型和份数，上传用印附件，再点保存待发。',
      '字段包括：文件类型、名称及份数；用印附件。',
    ].join('\n');

    (textGuideLlmParserService.parse as jest.Mock).mockResolvedValue({
      platformConfig: {
        entryUrl: 'https://oa.example.com/workbench',
      },
      sharedSteps: [
        '点击 用印申请',
      ],
      flows: [
        {
          processName: '用印申请',
          processCode: 'seal_apply',
          fields: [
            {
              label: '文件类型、名称及份数',
              type: 'text',
              required: true,
              description: '填写文件名称和份数',
              example: '劳务合同 2份',
            },
            {
              label: '用印附件',
              type: 'file',
              required: true,
              example: '劳务合同.pdf',
            },
          ],
          steps: [
            '填写 文件类型、名称及份数 为 劳务合同 2份',
            '上传 用印附件',
            '点击 保存待发',
          ],
        },
      ],
    });

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: 'connector-1',
      processCode: 'seal_apply',
      processName: '用印申请',
      description: '用印申请示例',
      falLevel: 'F2',
      accessMode: 'rpa',
      authoringMode: 'text',
      rpaFlowContent: freeFormGuide,
    });

    expect(textGuideLlmParserService.parse).toHaveBeenCalledWith(expect.objectContaining({
      guideText: freeFormGuide,
      connectorName: '统一办公',
      oaUrl: 'https://oa.example.com',
    }));

    const createdDefinition = tx.processTemplate.create.mock.calls[0][0].data.uiHints.rpaDefinition;
    expect(createdDefinition.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: '文件类型、名称及份数',
        type: 'text',
      }),
      expect.objectContaining({
        label: '用印附件',
        type: 'file',
      }),
    ]));
  });

  it('uses deterministic structured-template parsing first for well-formed text templates', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-structured-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-structured-1', latestTemplateId: 'template-structured-1' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-structured-1',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-24T10:30:00.000Z'),
          updatedAt: new Date('2026-04-24T10:30:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    (textGuideLlmParserService.parse as jest.Mock).mockResolvedValue({
      flows: [],
      sharedSteps: [],
      platformConfig: {},
    });

    await service.createManualProcessTemplate('tenant-1', {
      connectorId: 'connector-1',
      falLevel: 'F2',
      accessMode: 'url',
      authoringMode: 'text',
      rpaFlowContent: validUrlTextTemplate,
    });

    expect(textGuideLlmParserService.parse).not.toHaveBeenCalled();

    const createdDefinition = tx.processTemplate.create.mock.calls[0][0].data.uiHints.rpaDefinition;
    expect(createdDefinition.description).toBe('教职工请假申请示例');
    expect(createdDefinition.platform?.jumpUrlTemplate).toBe('https://oa.example.com/workflow/new?templateId=leave_request');
  });

  it('updates a process by publishing a new version and archiving the previous published version', async () => {
    const tx = {
      remoteProcess: {
        upsert: jest.fn().mockResolvedValue({ id: 'remote-1' }),
        update: jest.fn().mockResolvedValue({ id: 'remote-1', latestTemplateId: 'template-4' }),
      },
      processTemplate: {
        findFirst: jest.fn().mockResolvedValue({ id: 'template-3', version: 3 }),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'template-4',
          ...data,
          connector: {
            id: 'connector-1',
            name: '统一办公',
            oaType: 'form-page',
            oclLevel: 'OCL3',
          },
          createdAt: new Date('2026-04-17T10:00:00.000Z'),
          updatedAt: new Date('2026-04-17T10:00:00.000Z'),
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prisma.processTemplate.findFirst = jest.fn().mockResolvedValue({
      id: 'template-3',
      connectorId: 'connector-1',
    });
    prisma.connector.findFirst.mockResolvedValue({
      id: 'connector-1',
      name: '统一办公',
      oaType: 'form-page',
      baseUrl: 'https://oa.example.com',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await service.updateManualProcessTemplate('tenant-1', 'template-3', {
      connectorId: 'connector-1',
      processCode: 'leave_request',
      processName: '请假申请（新版）',
      processCategory: '人事',
      description: '更新后的员工请假流程',
      falLevel: 'F4',
      rpaFlowContent: JSON.stringify({
        flows: [{
          processCode: 'leave_request',
          processName: '请假申请',
          fields: [
            { key: 'reason', label: '请假原因', type: 'textarea', required: true },
          ],
          actions: {
            submit: {
              steps: [
                { type: 'goto', value: 'https://oa.example.com/leave' },
                { type: 'input', fieldKey: 'reason', target: { kind: 'text', value: '请假原因' } },
                { type: 'click', target: { kind: 'text', value: '提交' } },
              ],
            },
          },
        }],
      }),
    });

    expect(prisma.processTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'template-3',
        tenantId: 'tenant-1',
      },
      select: {
        id: true,
        connectorId: true,
      },
    });
    expect(tx.processTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        processCode: 'leave_request',
        processName: '请假申请（新版）',
        description: '更新后的员工请假流程',
        version: 4,
        falLevel: 'F4',
        supersedesId: 'template-3',
      }),
    }));
    expect(tx.processTemplate.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        processCode: 'leave_request',
        status: 'published',
        NOT: { id: 'template-4' },
      },
      data: {
        status: 'archived',
      },
    });
    expect(result).toEqual(expect.objectContaining({
      id: 'template-4',
      processName: '请假申请（新版）',
      version: 4,
    }));
  });

  it('archives all versions of a process and disables the remote process when deleting from the library', async () => {
    const tx = {
      remoteProcess: {
        update: jest.fn().mockResolvedValue({ id: 'remote-1', status: 'disabled' }),
      },
      processTemplate: {
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };

    prisma.processTemplate.findFirst = jest.fn().mockResolvedValue({
      id: 'template-4',
      connectorId: 'connector-1',
      processCode: 'leave_request',
      remoteProcessId: 'remote-1',
      status: 'published',
    });
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await service.archiveManualProcessTemplate('tenant-1', 'template-4');

    expect(prisma.processTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'template-4',
        tenantId: 'tenant-1',
      },
      select: {
        id: true,
        connectorId: true,
        processCode: true,
        remoteProcessId: true,
        status: true,
      },
    });
    expect(tx.processTemplate.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        connectorId: 'connector-1',
        processCode: 'leave_request',
        NOT: {
          status: 'archived',
        },
      },
      data: {
        status: 'archived',
      },
    });
    expect(tx.remoteProcess.update).toHaveBeenCalledWith({
      where: {
        id: 'remote-1',
      },
      data: {
        latestTemplateId: null,
        status: 'disabled',
      },
    });
    expect(result).toEqual({
      success: true,
      archivedCount: 3,
      processCode: 'leave_request',
    });
  });

  it('requires process lookup by code to belong to an initialized connector', async () => {
    prisma.processTemplate.findFirst = jest.fn().mockResolvedValue({
      id: 'template-1',
      processCode: 'leave_request',
      status: 'published',
      connector: { id: 'connector-1' },
    });

    await service.getByCode('tenant-1', 'leave_request');

    expect(prisma.processTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        processCode: 'leave_request',
        status: 'published',
        connector: {
          is: {
            tenantId: 'tenant-1',
            bootstrapJobs: {
              some: {},
            },
            identityScope: {
              in: ['both'],
            },
          },
        },
      }),
    }));
  });

  it('requires process lookup by id to belong to an initialized connector', async () => {
    prisma.processTemplate.findFirst = jest.fn().mockResolvedValue({
      id: 'template-1',
      processCode: 'leave_request',
      status: 'published',
      connector: { id: 'connector-1' },
    });

    await service.getById('template-1', 'tenant-1');

    expect(prisma.processTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'template-1',
        tenantId: 'tenant-1',
        connector: {
          is: {
            tenantId: 'tenant-1',
            bootstrapJobs: {
              some: {},
            },
            identityScope: {
              in: ['both'],
            },
          },
        },
      },
      include: {
        connector: true,
      },
    }));
  });

  it('only lists versions for processes under initialized connectors', async () => {
    prisma.processTemplate.findMany.mockResolvedValue([]);

    await service.listVersions('tenant-1', 'leave_request');

    expect(prisma.processTemplate.findMany).toHaveBeenLastCalledWith({
      where: {
        tenantId: 'tenant-1',
        processCode: 'leave_request',
        connector: {
          is: {
            tenantId: 'tenant-1',
            bootstrapJobs: {
              some: {},
            },
            identityScope: {
              in: ['both'],
            },
          },
        },
      },
      orderBy: {
        version: 'desc',
      },
    });
  });
});
