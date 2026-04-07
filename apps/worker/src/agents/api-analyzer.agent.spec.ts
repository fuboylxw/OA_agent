jest.mock('@uniflow/agent-kernel', () => ({
  BaseAgent: class MockBaseAgent {
    constructor(_config: any) {}
  },
  LLMClientFactory: {
    createFromEnv: jest.fn(() => ({
      chat: jest.fn(),
    })),
  },
}));

import { ApiAnalyzerAgent } from './api-analyzer.agent';

describe('ApiAnalyzerAgent heuristic fallback', () => {
  it('infers business processes from OpenAPI when LLM analysis fails', async () => {
    const agent = new ApiAnalyzerAgent();
    (agent as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('timeout')),
    };

    const document = {
      openapi: '3.0.0',
      paths: {
        '/api/health': {
          get: {
            summary: 'Health',
            responses: { 200: { description: 'ok' } },
          },
        },
        '/api/auth/login': {
          post: {
            summary: 'Login',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      username: { type: 'string' },
                      password: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: { 200: { description: 'ok' } },
          },
        },
        '/api/leave/applications': {
          post: {
            summary: 'Create Leave Application',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['leave_type', 'reason'],
                    properties: {
                      leave_type: { type: 'string' },
                      start_time: { type: 'string' },
                      end_time: { type: 'string' },
                      reason: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        data: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          get: {
            summary: 'List Leave Applications',
            responses: { 200: { description: 'ok' } },
          },
        },
        '/api/leave/applications/{application_id}': {
          get: {
            summary: 'Get Leave Application',
            parameters: [
              {
                name: 'application_id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: { 200: { description: 'ok' } },
          },
        },
        '/api/expense/applications': {
          post: {
            summary: 'Create Expense Application',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['expense_type', 'items'],
                    properties: {
                      expense_type: { type: 'string' },
                      payee_name: { type: 'string' },
                      items: { type: 'array' },
                    },
                  },
                },
              },
            },
            responses: { 200: { description: 'ok' } },
          },
          get: {
            summary: 'List Expense Applications',
            responses: { 200: { description: 'ok' } },
          },
        },
        '/api/expense/applications/{application_id}': {
          get: {
            summary: 'Get Expense Application',
            parameters: [
              {
                name: 'application_id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: { 200: { description: 'ok' } },
          },
        },
      },
    };

    const processes = await (agent as any).analyzeOpenAPI(document, 'http://127.0.0.1:8000');

    expect(processes).toHaveLength(2);
    expect(processes.map((process: any) => process.processCode).sort()).toEqual(['expense', 'leave']);

    const leaveProcess = processes.find((process: any) => process.processCode === 'leave');
    expect(leaveProcess).toEqual(expect.objectContaining({
      processName: '请假申请',
      category: 'hr',
    }));
    expect(leaveProcess.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'submit',
        method: 'POST',
        path: '/api/leave/applications',
        bodyTemplate: expect.objectContaining({
          leave_type: '{{leave_type}}',
          reason: '{{reason}}',
        }),
      }),
      expect.objectContaining({
        category: 'list',
        method: 'GET',
        path: '/api/leave/applications',
      }),
      expect.objectContaining({
        category: 'query',
        method: 'GET',
        path: '/api/leave/applications/{application_id}',
      }),
    ]));
  });
});
