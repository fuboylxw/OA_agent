import { SystemInferenceEngine } from './system-inference';

describe('SystemInferenceEngine', () => {
  it('falls back heuristically and only trusts explicit structural auth evidence', async () => {
    const engine = new SystemInferenceEngine({
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    } as any);

    const result = await engine.infer({
      baseUrl: 'https://oa.example.edu.cn',
      openApiUrl: 'https://oa.example.edu.cn/openapi.json',
      apiDoc: JSON.stringify({
        openapi: '3.0.0',
        servers: [{ url: 'https://oa.example.edu.cn/api' }],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
            },
          },
        },
        paths: {
          '/api/session/create': {
            post: {
              category: 'auth',
            },
          },
          '/api/process/list': {
            get: {
              summary: 'List process',
            },
          },
        },
      }),
      processes: [
        {
          processCode: 'leave_request',
          processName: '请假申请',
          endpoints: [
            { method: 'GET', path: '/api/process/list', category: 'list' },
          ],
        },
      ],
      userAuth: {
        token: 'masked-token',
        authType: 'bearer',
      },
    });

    expect(result.source).toBe('heuristic');
    expect(result.preferredAuthType).toBe('bearer');
    expect(result.oaType).toBe('openapi');
    expect(result.authHint?.type).toBe('bearer');
    expect(result.authHint?.headerName).toBe('Authorization');
    expect(result.authHint?.headerPrefix).toBe('Bearer ');
    expect(result.loginEndpoints.some((endpoint) => endpoint.method === 'POST' && endpoint.path === '/api/session/create')).toBe(true);
    expect(result.noAuthProbeTargets).toContain('https://oa.example.edu.cn/api/process/list');
  });

  it('uses llm inference to revise heuristic judgement when available', async () => {
    const engine = new SystemInferenceEngine({
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          preferredAuthType: 'cookie',
          oaType: 'hybrid',
          interactionModel: 'hybrid',
          portalBridgeSuspected: true,
          confidence: 0.88,
          authCandidates: [
            {
              type: 'cookie',
              confidence: 0.88,
              reason: 'Observed login form plus page bridge',
            },
          ],
          authHint: {
            type: 'cookie',
          },
          loginEndpoints: [
            {
              method: 'POST',
              path: '/gateway/session/create',
              confidence: 0.82,
              reason: 'Explicit login endpoint in evidence',
            },
          ],
          signals: ['bridge detected from cross-origin evidence'],
        }),
        model: 'test-model',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      }),
    } as any);

    const result = await engine.infer({
      baseUrl: 'https://auth.example.edu.cn',
      oaUrl: 'https://auth.example.edu.cn',
      openApiUrl: 'https://oa.example.edu.cn/openapi.json',
      apiDoc: JSON.stringify({
        openapi: '3.0.0',
        servers: [{ url: 'https://oa.example.edu.cn/api' }],
        paths: {
          '/api/process/list': {
            get: {
              summary: 'List process',
            },
          },
        },
      }),
      processes: [
        {
          processCode: 'seal_apply',
          processName: '用印申请',
          endpoints: [
            { method: 'RPA', path: 'url://seal_apply/submit', category: 'submit' },
          ],
        },
      ],
      userAuth: {
        username: 'user1',
        password: 'masked',
      },
    });

    expect(result.source).toBe('mixed');
    expect(result.llmSucceeded).toBe(true);
    expect(result.preferredAuthType).toBe('cookie');
    expect(result.oaType).toBe('hybrid');
    expect(result.systemShape.portalBridgeSuspected).toBe(true);
    expect(result.loginEndpoints.some((endpoint) => endpoint.method === 'POST' && endpoint.path === '/gateway/session/create')).toBe(true);
    expect(result.model).toBe('test-model');
  });
});
