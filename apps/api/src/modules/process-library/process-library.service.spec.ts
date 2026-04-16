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
            connector: null,
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
        oaType: true,
        baseUrl: true,
      },
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
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
          },
        },
      },
      orderBy: {
        version: 'desc',
      },
    });
  });
});
