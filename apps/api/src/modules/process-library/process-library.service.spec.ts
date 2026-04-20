import { ProcessLibraryService } from './process-library.service';
import { PrismaService } from '../common/prisma.service';

describe('ProcessLibraryService', () => {
  let service: ProcessLibraryService;
  let prisma: any;

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
    prisma = {
      connector: {
        findFirst: jest.fn(),
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
      },
      $transaction: jest.fn(),
    };

    service = new ProcessLibraryService(prisma as unknown as PrismaService);
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
        processName: '请假申请',
        version: 2,
        sourceType: 'published',
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
            expect.objectContaining({ label: '文件类型、名称及份数', type: 'text' }),
            expect.objectContaining({ label: '用印附件', type: 'file' }),
          ]),
        }),
      }),
    }));
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
