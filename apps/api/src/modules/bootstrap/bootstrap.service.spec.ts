import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bull';
import axios from 'axios';
import { PrismaService } from '../common/prisma.service';
import { BootstrapService } from './bootstrap.service';
import { TextGuideLlmParserService } from './text-guide-llm-parser.service';
import { WorkerAvailabilityService } from './worker-availability.service';
import { buildPageAutomationFlowBundle } from '../process-library/process-library-authoring.util';

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
        oaUrl: 'https://oa.example.com',
        identityScope: 'both',
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
        oaUrl: 'https://oa.example.com',
        identityScope: 'both',
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
          sourceContent: expect.any(String),
          metadata: expect.objectContaining({
            accessMode: 'direct_link',
            sourceType: 'direct_link',
          }),
        }),
      }));
      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const normalizedFlow = JSON.parse(createdSource.data.sourceContent);
      expect(normalizedFlow.flows[0]).toEqual(expect.objectContaining({
        accessMode: 'direct_link',
        sourceType: 'direct_link',
        runtime: expect.objectContaining({
          networkSubmit: expect.objectContaining({
            url: '{{preflight.submitCapture.action}}',
          }),
        }),
      }));
      expect(normalizedFlow.flows[0].actions).toBeUndefined();
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
        identityScope: 'teacher',
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
        identityScope: 'teacher',
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
          identityScope: true,
          authConfig: true,
        },
      });
      expect(prisma.bootstrapJob.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          connectorId: 'connector-1',
          name: '统一办公',
          oaUrl: 'https://oa.example.com',
          identityScope: 'teacher',
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
        identityScope: 'teacher',
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
        oaUrl: 'https://oa.example.com',
        identityScope: 'both',
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
        oaUrl: 'https://oa.example.com',
        identityScope: 'both',
        rpaFlowContent: '{"flows":[{"name":"missing-process-code"}]}',
      })).rejects.toThrow('页面流程内容无效，无法识别可执行步骤');

      expect(prisma.bootstrapJob.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('accepts structured text-guide templates and converts them into generated page flows', async () => {
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
        identityScope: 'student',
        rpaFlowContent: [
          '流程: 请假申请',
          '流程编码: leave_request',
          '用户办理时需要补充的信息:',
          '- 开始日期 | 示例: 2026-03-20',
          '- 结束日期 | 示例: 2026-03-21',
          '- 请假原因 | 示例: 家中有事',
          '办理步骤:',
          '- 点击 新建申请',
          '- 输入 开始日期',
          '- 输入 结束日期',
          '- 输入 请假原因',
          '- 点击 提交',
          '- 看到 提交成功 就结束',
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
            guideText: expect.stringContaining('流程: 请假申请'),
          }),
        }),
      }));

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);

      expect(generatedFlow.flows[0]).toMatchObject({
        processCode: 'leave_request',
        processName: '请假申请',
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

    it('falls back to llm parsing for free-form text-guide content when deterministic parsing cannot understand it', async () => {
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
            fields: [
              {
                label: 'Reason',
                type: 'textarea',
                required: true,
                description: '请填写请假原因说明',
                example: '因家中有事请假',
              },
            ],
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
        oaUrl: 'https://portal.example.com',
        identityScope: 'both',
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
        fields: expect.arrayContaining([
          expect.objectContaining({
            label: 'Reason',
            description: '请填写请假原因说明',
            example: '因家中有事请假',
          }),
        ]),
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

    it('uses deterministic structured-template parsing first and keeps llm as fallback only', async () => {
      const mockJob = {
        id: 'guide-job-fallback-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      mockTextGuideLlmParserService.parse.mockResolvedValue({
        platformConfig: {
          entryUrl: 'https://wrong.example.com/should-not-win',
        },
        sharedSteps: [
          '点击 错误入口',
        ],
        flows: [
          {
            processName: 'Wrong Flow',
            processCode: 'wrong_flow',
            fields: [],
            steps: [
              '点击 错误步骤',
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
        name: 'Fallback Flow',
        oaUrl: 'https://portal.example.com',
        identityScope: 'both',
        rpaFlowContent: [
          '流程: Fallback Flow',
          '流程编码: fallback_flow',
          '办理步骤:',
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

      expect(mockTextGuideLlmParserService.parse).not.toHaveBeenCalled();
      expect(generatedFlow.flows[0]).toMatchObject({
        processCode: 'fallback_flow',
        processName: 'Fallback Flow',
      });
      expect(generatedFlow.flows[0].actions.submit.successAssert).toEqual({
        type: 'text',
        value: '\u63d0\u4ea4\u6210\u529f',
      });
    });

    it('rejects free-form text-guide input when llm parsing fails instead of rule-guessing', async () => {
      mockTextGuideLlmParserService.parse.mockRejectedValue(new Error('llm unavailable'));

      await expect(service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'text_guide',
        name: 'Fallback Flow',
        oaUrl: 'https://portal.example.com',
        identityScope: 'both',
        rpaFlowContent: [
          '\u70b9\u51fb \u65b0\u5efa\u7533\u8bf7',
          '\u8f93\u5165 \u539f\u56e0 \u4e3a \u5bb6\u4e2d\u6709\u4e8b',
          '\u70b9\u51fb \u63d0\u4ea4',
          '\u770b\u5230 \u63d0\u4ea4\u6210\u529f \u5c31\u7ed3\u675f',
        ].join('\n'),
      })).rejects.toThrow('页面流程内容无效，无法识别可执行步骤');

      expect(prisma.bootstrapJob.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
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
        oaUrl: 'https://portal.example.com',
        identityScope: 'both',
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

    it('accepts a multi-flow direct-link guide document and keeps URL mode metadata', async () => {
      const mockJob = {
        id: 'multi-direct-link-job-id',
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
        accessMode: 'direct_link',
        name: '综合 OA',
        oaUrl: 'https://oa.example.com',
        identityScope: 'both',
        rpaFlowContent: [
          '# 全局',
          '认证入口: https://sz.xpu.edu.cn/',
          '系统网址: https://oa.example.com',
          '## 流程: 请假申请',
          '描述: 网信处科员请假申请',
          '流程编码: leave_request',
          '参数:',
          '- 请假事由 | textarea | 必填',
          '- 开始日期 | date | 必填',
          '- 结束日期 | date | 必填',
          '步骤:',
          '- 访问 https://sz.xpu.edu.cn/',
          '- 访问 https://oa.example.com',
          '- 访问 https://oa.example.com/leave/new',
          '- 填写 请假事由',
          '- 填写 开始日期',
          '- 填写 结束日期',
          '- 点击 保存待发',
          '- 看到 提交成功 就结束',
          '## 流程: 西安工程大学用印申请单',
          '流程编码: expense_submit',
          '描述: 西安工程大学印章申请',
          '参数:',
          '- 文件类型、名称及份数',
          '- 用印附件',
          '步骤:',
          '- 访问 https://sz.xpu.edu.cn/',
          '- 访问 https://oa.example.com',
          '- 访问 https://oa.example.com/expense/new',
          '- 填写 文件类型、名称及份数',
          '- 上传 用印附件',
          '- 点击 保存待发',
          '- 看到 提交成功 就结束',
        ].join('\n'),
      });

      expect(prisma.bootstrapSource.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'manual_rpa',
          metadata: expect.objectContaining({
            accessMode: 'direct_link',
            sourceType: 'direct_link',
            guideText: expect.stringContaining('流程: 请假申请'),
          }),
        }),
      }));

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);

      expect(generatedFlow.flows).toHaveLength(2);
      expect(generatedFlow.flows[0]).toMatchObject({
        processCode: 'leave_request',
        processName: '请假申请',
        description: '网信处科员请假申请',
        accessMode: 'direct_link',
        sourceType: 'direct_link',
        metadata: expect.objectContaining({
          accessMode: 'direct_link',
          sourceType: 'direct_link',
        }),
        platform: expect.objectContaining({
          entryUrl: 'https://sz.xpu.edu.cn/',
          businessBaseUrl: 'https://oa.example.com',
          targetBaseUrl: 'https://oa.example.com',
          jumpUrlTemplate: 'https://oa.example.com/leave/new',
        }),
        runtime: expect.objectContaining({
          executorMode: 'http',
          networkSubmit: expect.objectContaining({
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitBodyMode}}',
            body: {
              source: 'preflight.submitFields',
            },
          }),
          preflight: expect.objectContaining({
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'goto', value: 'https://sz.xpu.edu.cn/' }),
              expect.objectContaining({ type: 'goto', value: 'https://oa.example.com/leave/new' }),
              expect.objectContaining({
                type: 'evaluate',
                builtin: 'capture_form_submit',
                options: expect.objectContaining({
                  trigger: expect.objectContaining({ text: '保存待发' }),
                  fieldMappings: expect.arrayContaining([
                    expect.objectContaining({
                      fieldKey: expect.any(String),
                    }),
                  ]),
                }),
              }),
            ]),
          }),
        }),
      });
      expect(generatedFlow.flows[1]).toMatchObject({
        processCode: 'expense_submit',
        processName: '西安工程大学用印申请单',
        description: '西安工程大学印章申请',
        accessMode: 'direct_link',
        sourceType: 'direct_link',
        fields: expect.arrayContaining([
          expect.objectContaining({
            label: '文件类型、名称及份数',
            type: 'text',
          }),
          expect.objectContaining({
            label: '用印附件',
            type: 'file',
          }),
        ]),
        platform: expect.objectContaining({
          jumpUrlTemplate: 'https://oa.example.com/expense/new',
        }),
      });
      expect(generatedFlow.flows[0].actions).toBeUndefined();
    });

    it('preserves implicit field semantics when llm parsing returns fields without explicit type', async () => {
      const mockJob = {
        id: 'llm-implicit-field-types-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };

      mockTextGuideLlmParserService.parse.mockResolvedValue({
        platformConfig: {
          entryUrl: 'https://portal.example.com/workbench',
          executorMode: 'browser',
        },
        sharedSteps: [],
        flows: [
          {
            processName: '请假申请',
            processCode: 'leave_request',
            fields: [
              {
                label: '开始日期',
                required: true,
                description: '请填写请假开始日期',
                example: '2026-04-20',
              },
              {
                label: '结束日期',
                required: true,
                description: '请填写请假结束日期',
                example: '2026-04-21',
              },
              {
                label: '请假事由',
                required: true,
                description: '填写本次请假的详细原因说明',
                example: '家中有事，需要请假半天',
              },
            ],
            steps: [
              '点击 请假申请',
              '输入 开始日期',
              '输入 结束日期',
              '输入 请假事由',
              '点击 保存待发',
              '看到 保存成功 就结束',
            ],
            testData: {
              开始日期: '2026-04-20',
              结束日期: '2026-04-21',
              请假事由: '家中有事，需要请假半天',
            },
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
        name: '请假申请',
        oaUrl: 'https://portal.example.com',
        identityScope: 'teacher',
        rpaFlowContent: 'free form guide',
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent).flows[0];

      expect(generatedFlow.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: '开始日期',
            type: 'date',
            description: '请填写请假开始日期',
            example: '2026-04-20',
          }),
          expect.objectContaining({
            label: '结束日期',
            type: 'date',
            description: '请填写请假结束日期',
            example: '2026-04-21',
          }),
          expect.objectContaining({
            label: '请假事由',
            type: 'textarea',
            description: '填写本次请假的详细原因说明',
            example: '家中有事，需要请假半天',
          }),
        ]),
      );
    });

    it('keeps bootstrap direct-link compilation aligned with the shared page-automation compiler', async () => {
      const mockJob = {
        id: 'shared-compiler-alignment-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };
      const directLinkGuide = [
        '# 全局',
        '认证入口: https://sz.xpu.edu.cn/',
        '系统网址: https://oa.example.com',
        '## 流程: 请假申请',
        '描述: 网信处科员请假申请',
        '流程编码: leave_request',
        '参数:',
        '- 请假事由 | textarea | 必填',
        '- 开始日期 | date | 必填',
        '- 结束日期 | date | 必填',
        '步骤:',
        '- 访问 https://sz.xpu.edu.cn/',
        '- 访问 https://oa.example.com',
        '- 访问 https://oa.example.com/leave/new',
        '- 填写 请假事由',
        '- 填写 开始日期',
        '- 填写 结束日期',
        '- 点击 保存待发',
        '- 看到 提交成功 就结束',
      ].join('\n');

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'direct_link',
        name: '综合 OA',
        oaUrl: 'https://oa.example.com',
        identityScope: 'both',
        rpaFlowContent: directLinkGuide,
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);
      const expectedBundle = buildPageAutomationFlowBundle({
        content: directLinkGuide,
        accessMode: 'direct_link',
        connectorBaseUrl: 'https://oa.example.com',
        processName: '综合 OA',
      });

      expect(generatedFlow).toEqual(expectedBundle);
    });

    it('keeps bootstrap text-guide compilation aligned with the shared page-automation compiler', async () => {
      const mockJob = {
        id: 'shared-text-guide-alignment-job-id',
        tenantId: 'default-tenant',
        status: 'CREATED',
      };
      const textGuide = [
        '# 系统基本信息',
        '系统名称: 示例 OA',
        '系统网址: https://portal.example.com',
        '## 流程: 用印申请',
        '描述: 用印流程示例',
        '用户办理时需要补充的信息:',
        '- 文件类型、名称及份数 | 必填 | 说明: 填写需要用印的文件类型、名称和份数 | 示例: 劳务合同 2份',
        '- 用印类型 | 必填 | 说明: 选择本次需要办理的印章类型 | 示例: 党委公章、学校公章 | 可选值: 党委公章、学校公章、书记签名章 | 可多选',
        '- 用印附件 | 必填 | 说明: 上传本次用印对应的附件材料 | 示例: 用印申请材料.pdf | 上传要求: 支持上传多份，未上传视为信息缺失 | 可多选',
        '办理步骤:',
        '- 点击 流程中心',
        '- 点击 用印申请',
        '- 输入 文件类型、名称及份数',
        '- 勾选 用印类型',
        '- 上传 用印附件',
        '- 点击 保存待发',
        '- 看到 保存待发成功 就结束',
        '测试样例:',
        '- 文件类型、名称及份数: 劳务合同 2份',
        '- 用印类型: 党委公章、学校公章',
        '- 用印附件: 用印申请材料.pdf',
      ].join('\n');

      jest.spyOn(prisma.bootstrapJob, 'create').mockResolvedValue(mockJob as any);
      jest.spyOn(prisma.bootstrapJob, 'findUnique').mockResolvedValue({
        ...mockJob,
        queueJobId: 'queue-job-id',
      } as any);

      await service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'text_guide',
        name: '用印申请',
        oaUrl: 'https://portal.example.com',
        identityScope: 'teacher',
        rpaFlowContent: textGuide,
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);
      const expectedBundle = buildPageAutomationFlowBundle({
        content: textGuide,
        accessMode: 'text_guide',
        connectorBaseUrl: 'https://portal.example.com',
        processName: '用印申请',
      });

      expect(generatedFlow).toEqual(expectedBundle);
    });

    it('does not treat unified direct-link metadata lines as executable browser steps', () => {
      const bundle = buildPageAutomationFlowBundle({
        content: [
          '# 系统基本信息',
          '系统名称: 示例 OA',
          '认证入口: https://auth.example.com/',
          '系统网址: https://oa.example.com/',
          '适用对象: 教师',
          '登录说明: 统一认证登录',
          '办理完成标志: 看到 保存待发成功 就结束',
          '',
          '## 流程: 请假申请',
          '描述: 教职工请假申请示例',
          '流程页面: https://oa.example.com/workflow/new?templateId=leave_request',
          '用户办理时需要补充的信息:',
          '- 开始日期 | 必填 | 说明: 请假开始日期 | 示例: 2026-04-20',
          '- 结束日期 | 必填 | 说明: 请假结束日期 | 示例: 2026-04-20',
          '- 请假原因 | 必填 | 说明: 填写本次请假的具体原因 | 示例: 家中有事，需要请假半天',
          '办理步骤:',
          '- 访问 https://auth.example.com/',
          '- 访问 https://oa.example.com/',
          '- 访问 https://oa.example.com/workflow/new?templateId=leave_request',
          '- 输入 开始日期',
          '- 输入 结束日期',
          '- 输入 请假原因',
          '- 点击 保存待发',
          '- 看到 保存待发成功 就结束',
        ].join('\n'),
        accessMode: 'direct_link',
        connectorBaseUrl: 'https://oa.example.com',
        processName: '请假申请',
      });

      const flow = bundle.flows[0] as any;
      const preflightSteps = Array.isArray(flow.runtime?.preflight?.steps)
        ? flow.runtime.preflight.steps
        : [];
      const clickLabels = preflightSteps
        .filter((step: any) => step?.type === 'click')
        .map((step: any) => String(step?.target?.label || step?.target?.value || '').trim())
        .filter(Boolean);

      expect(clickLabels).not.toEqual(expect.arrayContaining([
        '# 系统基本信息',
        '适用对象: 教师',
        '登录说明: 统一认证登录',
        '办理完成标志: 看到 保存待发成功 就结束',
      ]));
      expect(preflightSteps).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'goto', value: 'https://auth.example.com/' }),
        expect.objectContaining({ type: 'goto', value: 'https://oa.example.com/workflow/new?templateId=leave_request' }),
        expect.objectContaining({ builtin: 'capture_form_submit' }),
      ]));
    });

    it('auto-generates a stable process code for Chinese direct-link flow names when 流程编码 is omitted', async () => {
      const mockJob = {
        id: 'auto-process-code-job-id',
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
        accessMode: 'direct_link',
        name: '综合 OA',
        oaUrl: 'https://oa.example.com',
        identityScope: 'both',
        rpaFlowContent: [
          '# 全局',
          '系统网址: https://oa.example.com',
          '## 流程: 请假申请',
          '步骤:',
          '- 访问 https://oa.example.com/leave/new',
          '- 填写 请假事由',
          '- 点击 保存待发',
          '- 看到 提交成功 就结束',
        ].join('\n'),
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);

      expect(generatedFlow.flows[0].processCode).toMatch(/^flow_[a-f0-9]{8}$/);
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
        oaUrl: 'https://portal.example.com',
        identityScope: 'teacher',
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
      expect(flow.metadata).toEqual(expect.objectContaining({
        accessMode: 'text_guide',
        sourceType: 'text_guide',
        textGuide: {
          sampleData: {
            field_1: '2026-04-01',
            field_2: '2026-04-02',
            field_3: '家中有事',
          },
        },
      }));
    });

    it('supports beginner-friendly template sections for choice, checkbox, and upload fields', async () => {
      const mockJob = {
        id: 'friendly-guide-job-id',
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
        name: '用印申请',
        oaUrl: 'https://portal.example.com',
        identityScope: 'teacher',
        rpaFlowContent: [
          '# 系统基本信息',
          '系统名称: 示例 OA',
          '系统网址: https://portal.example.com',
          '适用对象: 教师',
          '登录说明: 统一认证登录',
          '办理完成标志: 看到 保存待发成功 就结束',
          '## 流程: 用印申请',
          '描述: 用印流程示例',
          '用户办理时需要补充的信息:',
          '- 文件类型、名称及份数 | 必填 | 说明: 填写需要用印的文件类型、名称和份数 | 示例: 劳务合同 2份',
          '- 用印类型 | 必填 | 说明: 选择本次需要办理的印章类型 | 示例: 党委公章、学校公章 | 可选值: 党委公章、学校公章、书记签名章 | 可多选',
          '- 用印附件 | 必填 | 说明: 上传本次用印对应的附件材料 | 示例: 用印申请材料.pdf | 上传要求: 支持上传多份，未上传视为信息缺失 | 可多选',
          '办理步骤:',
          '- 点击 流程中心',
          '- 点击 用印申请',
          '- 输入 文件类型、名称及份数',
          '- 勾选 用印类型',
          '- 上传 用印附件',
          '- 点击 保存待发',
          '- 看到 保存待发成功 就结束',
          '测试样例:',
          '- 文件类型、名称及份数: 劳务合同 2份',
          '- 用印类型: 党委公章、学校公章',
          '- 用印附件: 用印申请材料.pdf',
          '特殊说明:',
          '- 同一个业务字段只写一次；如果是多选，把可选值写在同一行。',
        ].join('\n'),
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);
      const flow = generatedFlow.flows[0];
      const sealTypeField = flow.fields.find((field: any) => field.label === '用印类型');
      const attachmentField = flow.fields.find((field: any) => field.label === '用印附件');
      const sealTypeStep = flow.actions.submit.steps.find((step: any) => step.fieldKey === sealTypeField?.key);

      expect(flow.platform).toEqual(expect.objectContaining({
        entryUrl: 'https://portal.example.com',
        targetSystem: '示例 OA',
      }));
      expect(sealTypeField).toEqual(expect.objectContaining({
        label: '用印类型',
        type: 'checkbox',
        required: true,
        multiple: true,
        options: [
          { label: '党委公章', value: '党委公章' },
          { label: '学校公章', value: '学校公章' },
          { label: '书记签名章', value: '书记签名章' },
        ],
      }));
      expect(attachmentField).toEqual(expect.objectContaining({
        label: '用印附件',
        type: 'file',
        required: true,
        multiple: true,
      }));
      expect(attachmentField.description).toContain('上传要求：支持上传多份');
      expect(sealTypeStep).toMatchObject({
        type: 'select',
        fieldKey: sealTypeField.key,
      });
      expect(sealTypeStep.value).toBeUndefined();
      expect(flow.actions.submit.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'upload', fieldKey: attachmentField.key }),
        ]),
      );
      expect(flow.metadata).toEqual(expect.objectContaining({
        textGuide: {
          sampleData: expect.objectContaining({
            [sealTypeField.key]: '党委公章、学校公章',
            [attachmentField.key]: '用印申请材料.pdf',
          }),
        },
      }));
    });

    it('keeps fallback fill-fields conservative and does not infer file type only from attachment-like wording', () => {
      const bundle = buildPageAutomationFlowBundle({
        content: [
          '流程: 信息登记',
          '用户办理时需要补充的信息:',
          '- 附件名称 | 说明: 这里只是填写附件名称，不是上传入口 | 示例: 申请材料.pdf',
          '办理步骤:',
          '- 输入 附件名称',
          '- 点击 保存',
        ].join('\n'),
        accessMode: 'text_guide',
        connectorBaseUrl: 'https://oa.example.com',
        processName: '信息登记',
      });

      const flow = bundle.flows[0] as any;
      const attachmentNameField = flow.fields.find((field: any) => field.label === '附件名称');
      const attachmentStep = flow.actions.submit.steps.find((step: any) => step.fieldKey === attachmentNameField?.key);

      expect(attachmentNameField).toEqual(expect.objectContaining({
        label: '附件名称',
        type: 'text',
      }));
      expect(attachmentStep).toEqual(expect.objectContaining({
        type: 'input',
        fieldKey: attachmentNameField.key,
      }));
      expect(flow.actions.submit.steps).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'upload', fieldKey: attachmentNameField.key }),
        ]),
      );
    });

    it('infers date and textarea field types conservatively from inline labels, descriptions, and examples', () => {
      const bundle = buildPageAutomationFlowBundle({
        content: [
          '流程: 请假申请',
          '步骤:',
          '- 填写 请假事由 | 说明: 填写本次请假的具体原因 | 示例: 家中有事，需要请假半天',
          '- 填写 开始日期 | 说明: 请假开始日期 | 示例: 2026-04-20',
          '- 填写 结束日期 | 说明: 请假结束日期 | 示例: 2026-04-21',
          '- 点击 保存待发',
        ].join('\n'),
        accessMode: 'direct_link',
        connectorBaseUrl: 'https://oa.example.com',
        processName: '请假申请',
      });

      const flow = bundle.flows[0] as any;
      expect(flow.fields.find((field: any) => field.label === '请假事由')).toEqual(
        expect.objectContaining({
          type: 'textarea',
        }),
      );
      expect(flow.fields.find((field: any) => field.label === '开始日期')).toEqual(
        expect.objectContaining({
          type: 'date',
        }),
      );
      expect(flow.fields.find((field: any) => field.label === '结束日期')).toEqual(
        expect.objectContaining({
          type: 'date',
        }),
      );
    });

    it('preserves clean labels and choice options when direct-link templates describe fields inline in steps', async () => {
      const mockJob = {
        id: 'direct-link-inline-fields-job-id',
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
        accessMode: 'direct_link',
        name: '用印申请',
        oaUrl: 'https://oa.example.com',
        identityScope: 'teacher',
        rpaFlowContent: [
          '# 全局',
          '认证入口: https://auth.example.com/',
          '系统网址: https://oa.example.com/',
          '',
          '## 流程: 用印申请',
          '描述: 用印流程示例',
          '步骤:',
          '- 访问 https://auth.example.com/',
          '- 访问 https://oa.example.com/',
          '- 填写 文件类型、名称及份数 | 说明: 填写需要用印的文件类型、名称和份数 | 示例: 劳务合同 2份',
          '- 上传 用印附件 | 说明: 上传本次用印对应的附件材料 | 示例: 用印申请材料.pdf | 上传要求: 支持上传多份，未上传视为信息缺失 | 可多选',
          '- 选择 用印类型 | 说明: 选择本次需要办理的印章类型 | 示例: 党委公章 | 可选值: 党委公章、学校公章、书记签名章 | 可多选',
          '- 点击 保存待发',
          '- 看到 保存成功 就结束',
        ].join('\n'),
      });

      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const generatedFlow = JSON.parse(createdSource.data.sourceContent);
      const flow = generatedFlow.flows[0];
      const attachmentField = flow.fields.find((field: any) => field.label === '用印附件');
      const sealTypeField = flow.fields.find((field: any) => field.label === '用印类型');
      const captureStep = flow.runtime.preflight.steps.find((step: any) => step.builtin === 'capture_form_submit');
      const sealTypeMapping = captureStep.options.fieldMappings.find((mapping: any) => mapping.fieldKey === sealTypeField?.key);

      expect(attachmentField).toEqual(expect.objectContaining({
        label: '用印附件',
        type: 'file',
        required: true,
        multiple: true,
      }));
      expect(attachmentField.description).toContain('上传要求：支持上传多份');
      expect(sealTypeField).toEqual(expect.objectContaining({
        label: '用印类型',
        type: 'checkbox',
        required: true,
        multiple: true,
        options: [
          { label: '党委公章', value: '党委公章' },
          { label: '学校公章', value: '学校公章' },
          { label: '书记签名章', value: '书记签名章' },
        ],
      }));
      expect(sealTypeMapping).toEqual(expect.objectContaining({
        fieldType: 'checkbox',
        target: expect.objectContaining({
          label: '用印类型',
        }),
        options: [
          { label: '党委公章', value: '党委公章' },
          { label: '学校公章', value: '学校公章' },
          { label: '书记签名章', value: '书记签名章' },
        ],
      }));
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
          sourceContent: expect.any(String),
          metadata: expect.objectContaining({
            accessMode: 'direct_link',
            sourceType: 'direct_link',
          }),
        }),
      }));
      const createdSource = (prisma.bootstrapSource.create as jest.Mock).mock.calls.find(
        ([call]) => call.data?.bootstrapJobId === 'job-1' && call.data?.sourceType === 'manual_rpa',
      )?.[0];
      const normalizedFlow = JSON.parse(createdSource.data.sourceContent);
      expect(normalizedFlow.flows[0]).toEqual(expect.objectContaining({
        processCode: 'expense_submit',
        processName: 'Expense Submit',
        accessMode: 'direct_link',
        sourceType: 'direct_link',
        runtime: expect.objectContaining({
          networkSubmit: expect.objectContaining({
            url: '{{preflight.submitCapture.action}}',
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

    it('rejects direct-link flow definitions when text-guide mode is selected', async () => {
      await expect(service.createJob({
        tenantId: 'default-tenant',
        accessMode: 'text_guide',
        oaUrl: 'https://oa.example.com',
        identityScope: 'both',
        rpaFlowContent: JSON.stringify({
          flows: [{
            processCode: 'leave_request',
            processName: '请假申请',
            accessMode: 'direct_link',
            sourceType: 'direct_link',
            runtime: {
              networkSubmit: {
                url: 'https://oa.example.com/api/submit',
              },
            },
          }],
        }),
      })).rejects.toThrow('文字示教接入不能使用链接直达流程定义，请改为链接直达模式');
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
