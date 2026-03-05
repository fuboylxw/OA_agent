import { Test, TestingModule } from '@nestjs/testing';
import { ApiDocumentParserAgent } from './api-document-parser.agent';

describe('ApiDocumentParserAgent - 非业务接口过滤', () => {
  let agent: ApiDocumentParserAgent;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiDocumentParserAgent],
    }).compile();

    agent = module.get<ApiDocumentParserAgent>(ApiDocumentParserAgent);
  });

  it('应该过滤系统管理接口', async () => {
    const document = {
      openapi: '3.0.0',
      paths: {
        '/api/v1/user/create': {
          post: { summary: '创建用户' },
        },
        '/api/v1/leave/submit': {
          post: { summary: '提交请假申请' },
        },
        '/api/v1/role/list': {
          get: { summary: '角色列表' },
        },
        '/api/v1/expense/create': {
          post: { summary: '创建报销申请' },
        },
      },
    };

    const result = await agent.parseDocument(
      JSON.stringify(document),
      'openapi',
      { filterNonBusinessEndpoints: true },
    );

    expect(result.metadata.totalEndpoints).toBe(4);
    expect(result.metadata.businessEndpoints).toBe(2);
    expect(result.metadata.filteredEndpoints).toBe(2);
    expect(result.filteredEndpoints).toContain('/api/v1/user/create');
    expect(result.filteredEndpoints).toContain('/api/v1/role/list');
  });

  it('应该过滤认证和监控接口', async () => {
    const document = {
      openapi: '3.0.0',
      paths: {
        '/api/v1/login': {
          post: { summary: '用户登录' },
        },
        '/api/v1/health': {
          get: { summary: '健康检查' },
        },
        '/api/v1/metrics': {
          get: { summary: '系统指标' },
        },
        '/api/v1/leave/submit': {
          post: { summary: '提交请假' },
        },
      },
    };

    const result = await agent.parseDocument(
      JSON.stringify(document),
      'openapi',
      { filterNonBusinessEndpoints: true },
    );

    expect(result.metadata.businessEndpoints).toBe(1);
    expect(result.filteredEndpoints).toHaveLength(3);
  });

  it('应该保留所有业务流程接口', async () => {
    const document = {
      openapi: '3.0.0',
      paths: {
        '/api/v1/leave/submit': {
          post: { summary: '提交请假' },
        },
        '/api/v1/leave/{id}': {
          get: { summary: '查询请假状态' },
        },
        '/api/v1/leave/{id}/cancel': {
          post: { summary: '撤回请假' },
        },
        '/api/v1/expense/submit': {
          post: { summary: '提交报销' },
        },
        '/api/v1/purchase/apply': {
          post: { summary: '采购申请' },
        },
      },
    };

    const result = await agent.parseDocument(
      JSON.stringify(document),
      'openapi',
      { filterNonBusinessEndpoints: true },
    );

    expect(result.metadata.businessEndpoints).toBe(5);
    expect(result.metadata.filteredEndpoints).toBe(0);
  });
});

describe('ApiDocumentParserAgent - 用户接口链接解析', () => {
  let agent: ApiDocumentParserAgent;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiDocumentParserAgent],
    }).compile();

    agent = module.get<ApiDocumentParserAgent>(ApiDocumentParserAgent);
  });

  it('应该解析x-options-url并提取选项列表', async () => {
    // Mock fetch
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { value: '1', label: '事假' },
          { value: '2', label: '病假' },
          { value: '3', label: '年假' },
        ],
      }),
    });

    const document = {
      openapi: '3.0.0',
      paths: {
        '/api/v1/leave/submit': {
          post: {
            summary: '提交请假',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    properties: {
                      leave_type: {
                        type: 'string',
                        description: '请假类型',
                        'x-options-url': 'https://oa.example.com/api/v1/dict/leave-types',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = await agent.parseDocument(
      JSON.stringify(document),
      'openapi',
      { includeUserLinks: true },
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://oa.example.com/api/v1/dict/leave-types',
      expect.any(Object),
    );

    const leaveProcess = result.processes.find((p) =>
      p.endpoints.some((e) => e.path === '/api/v1/leave/submit'),
    );
    const leaveTypeField = leaveProcess?.fields.find(
      (f) => f.fieldCode === 'leave_type',
    );

    expect(leaveTypeField?.options).toEqual(['事假', '病假', '年假']);
    expect(leaveTypeField?.fieldType).toBe('select');
  });

  it('应该处理链接获取失败的情况', async () => {
    // Mock fetch failure
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const document = {
      openapi: '3.0.0',
      paths: {
        '/api/v1/leave/submit': {
          post: {
            summary: '提交请假',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    properties: {
                      leave_type: {
                        type: 'string',
                        'x-options-url': 'https://oa.example.com/api/v1/dict/leave-types',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    // 应该不抛出异常，继续解析
    const result = await agent.parseDocument(
      JSON.stringify(document),
      'openapi',
      { includeUserLinks: true },
    );

    expect(result.processes).toBeDefined();
    expect(result.warnings).toBeDefined();
  });

  it('应该支持多个字段的链接解析', async () => {
    global.fetch = jest
      .fn()
      .mockImplementation((url: string) => {
        if (url.includes('leave-types')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [{ label: '事假' }, { label: '病假' }] }),
          });
        }
        if (url.includes('departments')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [{ name: '人事部' }, { name: '财务部' }] }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

    const document = {
      openapi: '3.0.0',
      paths: {
        '/api/v1/leave/submit': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    properties: {
                      leave_type: {
                        type: 'string',
                        'x-options-url': 'https://oa.example.com/api/v1/dict/leave-types',
                      },
                      department: {
                        type: 'string',
                        'x-data-source': 'https://oa.example.com/api/v1/departments',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = await agent.parseDocument(
      JSON.stringify(document),
      'openapi',
      { includeUserLinks: true },
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('ApiDocumentParserAgent - 完整流程测试', () => {
  let agent: ApiDocumentParserAgent;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApiDocumentParserAgent],
    }).compile();

    agent = module.get<ApiDocumentParserAgent>(ApiDocumentParserAgent);
  });

  it('应该完成过滤+链接解析+业务提取的完整流程', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ value: '1', label: '事假' }],
      }),
    });

    const document = {
      openapi: '3.0.0',
      info: { title: 'OA API', version: '1.0.0' },
      paths: {
        '/api/v1/login': {
          post: { summary: '登录' },
        },
        '/api/v1/health': {
          get: { summary: '健康检查' },
        },
        '/api/v1/leave/submit': {
          post: {
            summary: '提交请假申请',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    properties: {
                      leave_type: {
                        type: 'string',
                        description: '请假类型',
                        'x-options-url': 'https://oa.example.com/api/v1/dict/leave-types',
                      },
                      start_date: {
                        type: 'string',
                        format: 'date',
                        description: '开始日期',
                      },
                      reason: {
                        type: 'string',
                        description: '请假事由',
                      },
                    },
                    required: ['leave_type', 'start_date', 'reason'],
                  },
                },
              },
            },
          },
        },
        '/api/v1/leave/{id}': {
          get: { summary: '查询请假状态' },
        },
      },
    };

    const result = await agent.parseDocument(
      JSON.stringify(document),
      'openapi',
      {
        filterNonBusinessEndpoints: true,
        includeUserLinks: true,
        confidenceThreshold: 0.8,
      },
    );

    // 验证过滤结果
    expect(result.metadata.totalEndpoints).toBe(4);
    expect(result.metadata.businessEndpoints).toBe(2);
    expect(result.metadata.filteredEndpoints).toBe(2);

    // 验证业务流程提取
    expect(result.processes).toHaveLength(1);
    const leaveProcess = result.processes[0];
    expect(leaveProcess.processCode).toBe('LEAVE_REQUEST');
    expect(leaveProcess.endpoints).toHaveLength(2);

    // 验证字段提取
    expect(leaveProcess.fields).toHaveLength(3);
    const leaveTypeField = leaveProcess.fields.find(
      (f) => f.fieldCode === 'leave_type',
    );
    expect(leaveTypeField?.fieldType).toBe('select');
    expect(leaveTypeField?.options).toContain('事假');

    const startDateField = leaveProcess.fields.find(
      (f) => f.fieldCode === 'start_date',
    );
    expect(startDateField?.fieldType).toBe('date');
    expect(startDateField?.required).toBe(true);
  });
});
