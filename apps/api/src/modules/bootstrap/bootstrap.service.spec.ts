import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bull';
import axios from 'axios';
import { PrismaService } from '../common/prisma.service';
import { BootstrapService } from './bootstrap.service';
import { TextGuideLlmParserService } from './text-guide-llm-parser.service';
import { WorkerAvailabilityService } from './worker-availability.service';

jest.mock('axios');

describe('BootstrapService', () => {
  let service: BootstrapService;
  let prisma: PrismaService;

  const mockQueue = {
    add: jest.fn(),
  } as unknown as Queue;

  const mockWorkerAvailabilityService = {
    assertBootstrapWorkerAvailable: jest.fn(),
  };

  const mockTextGuideLlmParserService = {
    parse: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTextGuideLlmParserService.parse.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BootstrapService,
        {
          provide: PrismaService,
          useValue: {
            connector: {
              findFirst: jest.fn(),
            },
            bootstrapJob: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
            bootstrapSource: {
              create: jest.fn(),
            },
            bootstrapReport: {
              findFirst: jest.fn(),
            },
            bootstrapRepairAttempt: {
              deleteMany: jest.fn(),
            },
          },
        },
        {
          provide: WorkerAvailabilityService,
          useValue: mockWorkerAvailabilityService,
        },
        {
          provide: TextGuideLlmParserService,
          useValue: mockTextGuideLlmParserService,
        },
        {
          provide: 'BullQueue_bootstrap',
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<BootstrapService>(BootstrapService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createJob', () => {
    it('creates a backend-api bootstrap job from apiDocUrl', async () => {
      const mockJob = {
        id: 'test-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
        openApiUrl: 'http://example.com/openapi.json',
      };

      (axios.get as jest.Mock).mockResolvedValue({
        data: { openapi: '3.0.0', paths: {} },
      });
      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      const result = await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'backend_api',
        apiDocUrl: 'http://example.com/openapi.json',
      });

      expect(result).toEqual({
        ...mockJob,
        queueJobId: 'queue-job-id',
      });
      expect(prisma.bootstrapJob.create).toHaveBeenCalled();
      expect(prisma.bootstrapJob.update).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({ jobId: mockJob.id, queueJobId: expect.any(String) }),
        expect.objectContaining({ jobId: expect.any(String) }),
      );
    });

    it('creates a direct-link bootstrap job with page flow content only', async () => {
      const mockJob = {
        id: 'rpa-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      const result = await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'direct_link',
        rpaFlowContent: '{"flows":[{"processCode":"expense_submit","processName":"Expense Submit"}]}',
        platformConfig: {
          entryUrl: 'https://portal.example.com/sso',
          targetSystem: 'expense-oa',
        },
      });

      expect(result).toEqual({
        ...mockJob,
        queueJobId: 'queue-job-id',
      });
      expect(prisma.bootstrapSource.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          bootstrapJobId: mockJob.id,
          sourceType: 'manual_rpa',
          metadata: expect.objectContaining({
            accessMode: 'direct_link',
            sourceType: 'direct_link',
          }),
        }),
      }));
    });

    it('binds the bootstrap job to an existing source system when connectorId is provided', async () => {
      const mockJob = {
        id: 'existing-connector-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      jest.spyOn((prisma as any).connector, 'findFirst').mockResolvedValue({
        id: 'connector-1',
        name: '统一办公',
        baseUrl: 'https://oa.example.com',
        authConfig: {
          authType: 'oauth2',
          accessMode: 'direct_link',
          bootstrapMode: 'rpa_only',
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
          },
          username: 'hidden-user',
        },
      } as any);
      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
        connectorId: 'connector-1',
        name: '统一办公',
        oaUrl: 'https://oa.example.com',
        authConfig: {
          authType: 'oauth2',
          accessMode: 'direct_link',
          bootstrapMode: 'rpa_only',
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
          },
          username: 'hidden-user',
        },
      } as any);

      const result = await service.createJob({
        tenantId: 'default-tenant',
        connectorId: 'connector-1',
        accessMode: 'direct_link',
        rpaFlowContent: JSON.stringify({
          flows: [{
            processCode: 'expense_submit',
            processName: 'Expense Submit',
            actions: {
              submit: {
                steps: [
                  { type: 'goto', value: 'https://oa.example.com/expense' },
                  { type: 'click', target: { kind: 'text', value: '提交' } },
                ],
              },
            },
          }],
        }),
      });

      expect((prisma as any).connector.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'connector-1',
          tenantId: 'default-tenant',
        },
        select: {
          id: true,
          name: true,
          baseUrl: true,
          authConfig: true,
        },
      });
      expect(prisma.bootstrapJob.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          connectorId: 'connector-1',
          name: '统一办公',
          oaUrl: 'https://oa.example.com',
          authConfig: expect.objectContaining({
            authType: 'oauth2',
            accessMode: 'direct_link',
            bootstrapMode: 'rpa_only',
            delegatedAuth: {
              enabled: true,
              mode: 'mock',
            },
            username: 'hidden-user',
          }),
        }),
      }));
      expect(prisma.bootstrapSource.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          bootstrapJobId: mockJob.id,
          sourceType: 'oa_url',
          sourceUrl: 'https://oa.example.com',
        }),
      }));
      expect(prisma.bootstrapSource.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          bootstrapJobId: mockJob.id,
          sourceType: 'manual_rpa',
          metadata: expect.objectContaining({
            accessMode: 'direct_link',
            sourceType: 'direct_link',
          }),
        }),
      }));
      expect(result).toEqual(expect.objectContaining({
        queueJobId: 'queue-job-id',
        connectorId: 'connector-1',
        name: '统一办公',
        oaUrl: 'https://oa.example.com',
        authConfig: expect.objectContaining({
          authType: 'oauth2',
          accessMode: 'direct_link',
          bootstrapMode: 'rpa_only',
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
          },
        }),
      }));
      expect((result as any).authConfig.username).toBeUndefined();
    });

    it('preserves delegated auth settings while sanitizing sensitive runtime secrets', async () => {
      const mockJob = {
        id: 'delegated-auth-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
        authConfig: {
          authType: 'oauth2',
          accessMode: 'direct_link',
          bootstrapMode: 'rpa_only',
          accessToken: 'secret-access-token',
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
            headerName: 'x-delegated-token',
            expiresInSeconds: 900,
          },
          platformConfig: {
            entryUrl: 'https://portal.example.com/sso',
            serviceToken: 'secret-service-token',
          },
        },
      } as any);

      const result = await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'direct_link',
        authType: 'oauth2',
        authConfig: {
          accessToken: 'secret-access-token',
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
            headerName: 'x-delegated-token',
            expiresInSeconds: 900,
          },
        },
        platformConfig: {
          entryUrl: 'https://portal.example.com/sso',
          serviceToken: 'secret-service-token',
        },
        rpaFlowContent: '{"flows":[{"processCode":"expense_submit","processName":"Expense Submit"}]}',
      });

      expect(prisma.bootstrapJob.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          authConfig: expect.objectContaining({
            authType: 'oauth2',
            accessMode: 'direct_link',
            bootstrapMode: 'rpa_only',
            delegatedAuth: {
              enabled: true,
              mode: 'mock',
              headerName: 'x-delegated-token',
              expiresInSeconds: 900,
            },
            accessToken: 'secret-access-token',
            platformConfig: {
              entryUrl: 'https://portal.example.com/sso',
              serviceToken: 'secret-service-token',
            },
          }),
        }),
      }));
      expect(result).toEqual(expect.objectContaining({
        queueJobId: 'queue-job-id',
        authConfig: {
          authType: 'oauth2',
          accessMode: 'direct_link',
          bootstrapMode: 'rpa_only',
          delegatedAuth: {
            enabled: true,
            mode: 'mock',
            headerName: 'x-delegated-token',
            expiresInSeconds: 900,
          },
          platformConfig: {
            entryUrl: 'https://portal.example.com/sso',
          },
        },
      }));
      expect((result as any).authConfig.accessToken).toBeUndefined();
      expect((result as any).authConfig.platformConfig.serviceToken).toBeUndefined();
    });

    it('rejects invalid page flow content before creating the job', async () => {
      await expect(service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'direct_link',
        rpaFlowContent: '{"flows":[{"name":"missing-process-code"}]}',
      })).rejects.toThrow('页面流程内容无效，无法识别可执行步骤');

      expect(prisma.bootstrapJob.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('accepts text-guide access and converts the description into a generated page flow', async () => {
      const mockJob = {
        id: 'guide-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'text_guide',
        name: '请假申请',
        oaUrl: 'https://portal.example.com',
        rpaFlowContent: [
          '先点击 新建申请',
          '输入 开始日期 为 2026-03-20',
          '输入 结束日期 为 2026-03-21',
          '输入 请假原因 为 家中有事',
          '点击 提交',
          '看到 提交成功 就结束',
        ].join('\n'),
        platformConfig: {
          entryUrl: 'https://portal.example.com/leave',
          executorMode: 'browser',
        },
      });

      expect(prisma.bootstrapSource.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'manual_rpa',
          metadata: expect.objectContaining({
            accessMode: 'text_guide',
            sourceType: 'text_guide',
            guideText: expect.stringContaining('先点击 新建申请'),
          }),
        }),
      }));

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);

      expect(generatedFlow.flows[0]).toMatchObject({
        processCode: 'text_guided_flow',
        runtime: expect.objectContaining({
          executorMode: 'browser',
        }),
      });
      expect(generatedFlow.flows[0].actions.submit.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'goto', value: 'https://portal.example.com/leave' }),
          expect.objectContaining({ type: 'click' }),
          expect.objectContaining({ type: 'input', fieldKey: 'field_1' }),
        ]),
      );
      expect(generatedFlow.flows[0].actions.submit.successAssert).toEqual({
        type: 'text',
        value: '提交成功',
      });
    });

    it('prefers llm parsing for text-guide content when the model returns a structured document', async () => {
      const mockJob = {
        id: 'guide-job-llm-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      mockTextGuideLlmParserService.parse.mockResolvedValue({
        platformConfig: {
          entryUrl: 'https://portal.example.com/workbench',
          executorMode: 'browser',
        },
        sharedSteps: [
          '\u8f93\u5165 Username \u4e3a alice',
          '\u70b9\u51fb Login',
        ],
        flows: [
          {
            processName: 'Leave Request',
            processCode: 'leave_request',
            steps: [
              '\u70b9\u51fb Leave Application',
              '\u8f93\u5165 Reason \u4e3a Family matters',
              '\u70b9\u51fb Submit',
              '\u770b\u5230 Submitted \u5c31\u7ed3\u675f',
            ],
          },
        ],
      });

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'text_guide',
        name: 'Leave Request',
        rpaFlowContent: 'free form guide',
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);

      expect(mockTextGuideLlmParserService.parse).toHaveBeenCalledWith(expect.objectContaining({
        guideText: 'free form guide',
        connectorName: 'Leave Request',
      }));
      expect(generatedFlow.flows[0]).toMatchObject({
        processCode: 'leave_request',
        processName: 'Leave Request',
        platform: {
          entryUrl: 'https://portal.example.com/workbench',
        },
      });
      expect(generatedFlow.flows[0].actions.submit.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'goto', value: 'https://portal.example.com/workbench' }),
          expect.objectContaining({ type: 'input', value: '{{auth.username}}' }),
          expect.objectContaining({ type: 'click', target: expect.objectContaining({ value: 'Leave Application' }) }),
        ]),
      );
    });

    it('falls back to rule parsing when llm parsing fails', async () => {
      const mockJob = {
        id: 'guide-job-fallback-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      mockTextGuideLlmParserService.parse.mockRejectedValue(new Error('llm unavailable'));

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'text_guide',
        name: 'Fallback Flow',
        rpaFlowContent: [
          '\u70b9\u51fb \u65b0\u5efa\u7533\u8bf7',
          '\u8f93\u5165 \u539f\u56e0 \u4e3a \u5bb6\u4e2d\u6709\u4e8b',
          '\u70b9\u51fb \u63d0\u4ea4',
          '\u770b\u5230 \u63d0\u4ea4\u6210\u529f \u5c31\u7ed3\u675f',
        ].join('\n'),
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);

      expect(mockTextGuideLlmParserService.parse).toHaveBeenCalled();
      expect(generatedFlow.flows[0]).toMatchObject({
        processCode: 'fallback_flow',
        processName: 'Fallback Flow',
      });
      expect(generatedFlow.flows[0].actions.submit.successAssert).toEqual({
        type: 'text',
        value: '\u63d0\u4ea4\u6210\u529f',
      });
    });

    it('accepts a multi-flow text-guide document and generates multiple flows with shared steps', async () => {
      const mockJob = {
        id: 'multi-guide-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'text_guide',
        name: '综合 OA',
        rpaFlowContent: [
          '# 全局',
          '入口链接: https://portal.example.com/workbench',
          '执行方式: 浏览器',
          '# 共享步骤',
          '输入 用户名 为 alice',
          '输入 密码 为 alice123',
          '点击 登录工作台',
          '## 流程: 请假申请',
          '流程编码: leave_request',
          '步骤:',
          '点击 申请中心',
          '点击 请假申请',
          '输入 原因 为 家中有事',
          '点击 提交',
          '看到 已提交 就结束',
          '## 流程: 报销申请',
          '流程编码: expense_submit',
          '步骤:',
          '点击 申请中心',
          '点击 报销申请',
          '输入 金额 为 1200',
          '点击 提交',
          '看到 提交成功 就结束',
        ].join('\n'),
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);

      expect(generatedFlow.flows).toHaveLength(2);
      expect(generatedFlow.flows[0]).toMatchObject({
        processCode: 'leave_request',
        processName: '请假申请',
        platform: {
          entryUrl: 'https://portal.example.com/workbench',
        },
        runtime: expect.objectContaining({
          executorMode: 'browser',
        }),
      });
      expect(generatedFlow.flows[1]).toMatchObject({
        processCode: 'expense_submit',
        processName: '报销申请',
        platform: {
          entryUrl: 'https://portal.example.com/workbench',
        },
      });
      expect(generatedFlow.flows[0].actions.submit.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'goto', value: 'https://portal.example.com/workbench' }),
          expect.objectContaining({ type: 'input', value: '{{auth.username}}' }),
          expect.objectContaining({ type: 'input', value: '{{auth.password}}' }),
          expect.objectContaining({ type: 'click', target: expect.objectContaining({ value: '登录工作台' }) }),
          expect.objectContaining({ type: 'click', target: expect.objectContaining({ value: '请假申请' }) }),
        ]),
      );
      expect(generatedFlow.flows[1].actions.submit.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'goto', value: 'https://portal.example.com/workbench' }),
          expect.objectContaining({ type: 'input', value: '{{auth.username}}' }),
          expect.objectContaining({ type: 'input', value: '{{auth.password}}' }),
          expect.objectContaining({ type: 'click', target: expect.objectContaining({ value: '报销申请' }) }),
          expect.objectContaining({ type: 'input', value: '1200' }),
        ]),
      );
    });

    it('supports separated parameter and test-sample sections without hard-coding sample values into runtime steps', async () => {
      const mockJob = {
        id: 'structured-guide-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'text_guide',
        name: '请假申请',
        rpaFlowContent: [
          '## 流程: 请假申请',
          '流程编码: leave_request',
          '参数:',
          '- 开始日期 | date | 必填',
          '- 结束日期 | date | 必填',
          '- 请假原因 | textarea | 必填',
          '步骤:',
          '- 点击 申请中心',
          '- 点击 请假申请',
          '- 输入 开始日期',
          '- 输入 结束日期',
          '- 输入 请假原因',
          '- 点击 提交',
          '- 看到 已提交 就结束',
          '测试样例:',
          '- 开始日期: 2026-04-01',
          '- 结束日期: 2026-04-02',
          '- 请假原因: 家中有事',
        ].join('\n'),
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);
      const flow = generatedFlow.flows[0];
      const startDateStep = flow.actions.submit.steps.find((step: any) => step.fieldKey === 'field_1');

      expect(flow.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: '开始日期', type: 'date', required: true }),
          expect.objectContaining({ label: '结束日期', type: 'date', required: true }),
          expect.objectContaining({ label: '请假原因', type: 'textarea', required: true }),
        ]),
      );
      expect(startDateStep).toMatchObject({
        type: 'input',
        fieldKey: 'field_1',
      });
      expect(startDateStep.value).toBeUndefined();
      expect(flow.metadata).toEqual({
        textGuide: {
          sampleData: {
            field_1: '2026-04-01',
            field_2: '2026-04-02',
            field_3: '家中有事',
          },
        },
      });
    });
  });

  describe('reactivate', () => {
    it('reactivates with new direct-link flow content', async () => {
      const existingJob = {
        id: 'job-1',
        openApiUrl: null,
        oaUrl: 'https://portal.example.com',
        status: 'FAILED',
        connectorId: null,
        authConfig: {
          authType: 'oauth2',
          accessMode: 'direct_link',
          bootstrapMode: 'rpa_only',
        },
        sources: [
          {
            sourceType: 'manual_rpa',
            sourceContent: '{"flows":[{"processCode":"old_flow","processName":"Old Flow"}]}',
            createdAt: new Date('2026-03-16T10:00:00.000Z'),
          },
        ],
      };

      jest.spyOn(prisma.bootstrapJob, 'findFirst').mockResolvedValue(existingJob as any);
      jest.spyOn(prisma.bootstrapJob, 'update').mockResolvedValue({ id: 'job-1' } as any);

      const result = await service.reactivate('job-1', 'default-tenant', 'new', {
        accessMode: 'direct_link',
        rpaFlowContent: '{"flows":[{"processCode":"expense_submit","processName":"Expense Submit"}]}',
        platformConfig: {
          entryUrl: 'https://portal.example.com/sso',
          targetSystem: 'expense-oa',
        },
      });

      expect(result).toEqual({ jobId: 'job-1', mode: 'new', status: 'CREATED' });
      expect(prisma.bootstrapRepairAttempt.deleteMany).toHaveBeenCalledWith({
        where: { bootstrapJobId: 'job-1' },
      });
      expect(prisma.bootstrapSource.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          bootstrapJobId: 'job-1',
          sourceType: 'manual_rpa',
          sourceContent: '{"flows":[{"processCode":"expense_submit","processName":"Expense Submit"}]}',
          metadata: expect.objectContaining({
            accessMode: 'direct_link',
            sourceType: 'direct_link',
          }),
        }),
      }));
      expect(prisma.bootstrapJob.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'CREATED',
          currentStage: 'CREATED',
          authConfig: expect.objectContaining({
            authType: 'oauth2',
            accessMode: 'direct_link',
            bootstrapMode: 'rpa_only',
            platformConfig: {
              entryUrl: 'https://portal.example.com/sso',
              targetSystem: 'expense-oa',
            },
          }),
        }),
      }));
      expect(mockQueue.add).toHaveBeenCalled();
    });
  });

  describe('deleteJob', () => {
    it('blocks deleting a published bootstrap job while its connector still exists', async () => {
      jest.spyOn(prisma.bootstrapJob, 'findFirst').mockResolvedValue({
        id: 'job-1',
        tenantId: 'default-tenant',
        status: 'PUBLISHED',
        connectorId: 'connector-1',
      } as any);

      await expect(service.deleteJob('job-1', 'default-tenant')).rejects.toThrow(
        '已发布并绑定连接器的初始化任务不可删除',
      );
    });

    it('allows deleting a published bootstrap job after its connector has been removed', async () => {
      (prisma.bootstrapJob as any).delete = jest.fn().mockResolvedValue({ id: 'job-1' });
      jest.spyOn(prisma.bootstrapJob, 'findFirst').mockResolvedValue({
        id: 'job-1',
        tenantId: 'default-tenant',
        status: 'PUBLISHED',
        connectorId: null,
      } as any);

      const result = await service.deleteJob('job-1', 'default-tenant');

      expect((prisma.bootstrapJob as any).delete).toHaveBeenCalledWith({
        where: { id: 'job-1' },
      });
      expect(result).toEqual({ deleted: true, jobId: 'job-1' });
    });
  });

  describe('sanitization', () => {
    it('removes sensitive auth fields from listed jobs', async () => {
      jest.spyOn(prisma.bootstrapJob, 'findMany').mockResolvedValue([
        {
          id: 'job-1',
          authConfig: {
            accessMode: 'direct_link',
            bootstrapMode: 'rpa_only',
            username: 'admin',
            password: 'secret',
            token: 'token-123',
            platformConfig: {
              entryUrl: 'https://portal.example.com',
              serviceToken: 'svc-token',
            },
          },
          reports: [],
        },
      ] as any);

      const result = await service.listJobs('default-tenant');
      expect(result).toEqual([
        expect.objectContaining({
          id: 'job-1',
          authConfig: {
            accessMode: 'direct_link',
            bootstrapMode: 'rpa_only',
            platformConfig: {
              entryUrl: 'https://portal.example.com',
            },
          },
        }),
      ]);
    });
  });
});
