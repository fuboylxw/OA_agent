import axios from 'axios';
import { GenericHttpAdapter } from './generic-http-adapter';

jest.mock('axios');

describe('GenericHttpAdapter', () => {
  const request = jest.fn();
  const post = jest.fn();
  const client = {
    request,
    get: jest.fn(),
    post,
  };
  const endpointLoader = {
    loadEndpoints: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (axios.create as unknown as jest.Mock).mockReturnValue(client);
    endpointLoader.loadEndpoints.mockResolvedValue([{
      toolName: 'leave_post_leave_applications',
      category: 'submit',
      apiEndpoint: 'http://127.0.0.1:8000/api/leave/applications',
      httpMethod: 'POST',
      paramMapping: {
        reason: 'reason',
      },
      responseMapping: {},
      flowCode: 'leave',
    }]);
    request.mockResolvedValue({
      data: {
        success: true,
        submissionId: 'LEAVE-001',
      },
    });
  });

  it('sends bearer auth headers for configured token-based connectors', async () => {
    const adapter = new GenericHttpAdapter({
      connectorId: 'connector-1',
      baseUrl: 'http://127.0.0.1:8000',
      authType: 'bearer',
      authConfig: {
        token: 'token-123',
        headerName: 'Authorization',
        headerPrefix: 'Bearer ',
      },
      flows: [{
        flowCode: 'leave',
        flowName: 'Leave Application',
      }],
      oaType: 'openapi',
    }, endpointLoader as any);

    await adapter.init();
    await adapter.submit({
      flowCode: 'leave',
      formData: { reason: 'trip' },
      idempotencyKey: 'idem-1',
      attachments: [],
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer token-123',
      }),
    }));
  });

  it('refreshes bearer tokens on 401 and retries the request', async () => {
    request
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({
        data: {
          success: true,
          submissionId: 'LEAVE-002',
        },
      });
    post.mockResolvedValue({
      status: 200,
      data: {
        access_token: 'fresh-token',
      },
    });

    const adapter = new GenericHttpAdapter({
      connectorId: 'connector-1',
      baseUrl: 'http://127.0.0.1:8000',
      authType: 'bearer',
      authConfig: {
        token: 'stale-token',
        username: 'alice',
        password: 'alice123',
        loginPath: '/api/auth/login',
        headerName: 'Authorization',
        headerPrefix: 'Bearer ',
      },
      flows: [{
        flowCode: 'leave',
        flowName: 'Leave Application',
      }],
      oaType: 'openapi',
    }, endpointLoader as any);

    await adapter.init();
    const result = await adapter.submit({
      flowCode: 'leave',
      formData: { reason: 'trip' },
      idempotencyKey: 'idem-2',
      attachments: [],
    });

    expect(post).toHaveBeenCalledWith(
      '/api/auth/login',
      { username: 'alice', password: 'alice123' },
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer fresh-token',
      }),
    }));
    expect(result.success).toBe(true);
    expect(result.submissionId).toBe('LEAVE-002');
  });

  it('refreshes bearer tokens on 403 and retries the request', async () => {
    request
      .mockRejectedValueOnce({ response: { status: 403 } })
      .mockResolvedValueOnce({
        data: {
          success: true,
          submissionId: 'LEAVE-003',
        },
      });
    post.mockResolvedValue({
      status: 200,
      data: {
        access_token: 'fresh-token-403',
      },
    });

    const adapter = new GenericHttpAdapter({
      connectorId: 'connector-1',
      baseUrl: 'http://127.0.0.1:8000',
      authType: 'bearer',
      authConfig: {
        token: 'stale-token',
        username: 'alice',
        password: 'alice123',
        loginPath: '/api/auth/login',
        headerName: 'Authorization',
        headerPrefix: 'Bearer ',
      },
      flows: [{
        flowCode: 'leave',
        flowName: 'Leave Application',
      }],
      oaType: 'openapi',
    }, endpointLoader as any);

    await adapter.init();
    const result = await adapter.submit({
      flowCode: 'leave',
      formData: { reason: 'trip' },
      idempotencyKey: 'idem-403',
      attachments: [],
    });

    expect(post).toHaveBeenCalledWith(
      '/api/auth/login',
      { username: 'alice', password: 'alice123' },
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer fresh-token-403',
      }),
    }));
    expect(result.success).toBe(true);
    expect(result.submissionId).toBe('LEAVE-003');
  });

  it('preserves explicit field values and omits empty attachments for submit payloads', async () => {
    endpointLoader.loadEndpoints.mockResolvedValueOnce([{
      toolName: 'leave_post_leave_applications',
      category: 'submit',
      apiEndpoint: 'http://127.0.0.1:8000/api/leave/applications',
      httpMethod: 'POST',
      paramMapping: {
        leave_type: 'leave_type',
        start_time: 'start_time',
        end_time: 'end_time',
        reason: 'reason',
        attachments: 'attachments',
      },
      bodyTemplate: {
        leave_type: '{{leave_type}}',
        start_time: '{{start_time}}',
        end_time: '{{end_time}}',
        reason: '{{reason}}',
        attachments: '{{attachments}}',
      },
      responseMapping: {},
      flowCode: 'leave',
    }]);

    const adapter = new GenericHttpAdapter({
      connectorId: 'connector-1',
      baseUrl: 'http://127.0.0.1:8000',
      authType: 'bearer',
      authConfig: {
        token: 'token-123',
        headerName: 'Authorization',
        headerPrefix: 'Bearer ',
      },
      flows: [{
        flowCode: 'leave',
        flowName: 'Leave Application',
      }],
      oaType: 'openapi',
    }, endpointLoader as any);

    await adapter.init();
    await adapter.submit({
      flowCode: 'leave',
      formData: {
        leave_type: '事假',
        start_time: '2026-03-25',
        end_time: '2026-03-27',
        reason: '出去旅游',
      },
      idempotencyKey: 'idem-3',
      attachments: [],
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        leave_type: '事假',
        start_time: '2026-03-25',
        end_time: '2026-03-27',
        reason: '出去旅游',
      }),
    }));
    expect(request.mock.calls[0][0].data.attachments).toBeUndefined();
  });
});
