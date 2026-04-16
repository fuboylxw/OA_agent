import axios from 'axios';
import { UrlNetworkSubmitService } from './url-network-submit.service';

jest.mock('axios');

describe('UrlNetworkSubmitService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds a server-side submit request from jumpUrl session and preflight extracted values', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        ok: true,
        data: {
          requestNo: 'REQ-1001',
        },
        message: '提交成功',
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const runtime = {
      run: jest.fn().mockResolvedValue({
        success: true,
        sessionId: 'browser-1',
        provider: 'playwright',
        requestedProvider: 'playwright',
        snapshots: [{
          snapshotId: 'snapshot-1',
          title: 'Leave Form',
          url: 'https://oa.example.com/form/leave',
        }],
        extractedValues: {
          csrfToken: 'csrf-001',
          workflowId: 'wf-888',
        },
      }),
    };
    const service = new UrlNetworkSubmitService(runtime as any);

    const result = await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      payload: {
        formData: {
          days: 3,
          reason: 'annual leave',
        },
        idempotencyKey: 'idem-1',
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          sessionCookie: 'SESSION=abc123',
          platformConfig: {
            cookieOrigin: 'https://oa.example.com',
          },
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/leave',
          ticket: 'ticket-1',
          headers: {
            'x-platform-ticket': 'ticket-header',
          },
        },
        runtime: {
          browserProvider: 'playwright',
          preflight: {
            steps: [
              { type: 'extract', selector: 'input[name=\"csrf\"]', fieldKey: 'csrfToken' },
            ],
          },
          networkSubmit: {
            url: 'https://oa.example.com/api/leave/submit',
            method: 'POST',
            headers: {
              'x-csrf-token': { source: 'preflight.csrfToken' },
            },
            body: {
              workflowId: { source: 'preflight.workflowId' },
              days: { source: 'formData.days', transform: 'toNumber' },
              reason: { source: 'formData.reason' },
              jumpUrl: '{{jumpUrl}}',
              ticket: '{{ticket}}',
            },
            responseMapping: {
              successPath: 'ok',
              successValue: true,
              submissionIdPath: 'data.requestNo',
              messagePath: 'message',
            },
          },
          timeoutMs: 12000,
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: 'Leave Apply',
          },
        },
      } as any,
    });

    expect(runtime.run).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://oa.example.com/api/leave/submit',
      timeout: 12000,
      headers: expect.objectContaining({
        Cookie: 'SESSION=abc123',
        'x-csrf-token': 'csrf-001',
        'x-platform-ticket': 'ticket-header',
        'Content-Type': 'application/json',
      }),
      data: {
        workflowId: 'wf-888',
        days: 3,
        reason: 'annual leave',
        jumpUrl: 'https://oa.example.com/form/leave',
        ticket: 'ticket-1',
      },
    }));
    expect(result.submitResult).toMatchObject({
      success: true,
      submissionId: 'REQ-1001',
    });
    expect(result.summary).toBe('提交成功');
    expect(result.artifactRefs).toEqual([
      {
        id: 'snapshot-1',
        kind: 'page_snapshot',
        summary: 'Leave Form @ https://oa.example.com/form/leave',
      },
    ]);
  });

  it('supports form-mode status requests without preflight', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          status: 'APPROVED',
        },
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn(),
    } as any);

    const result = await service.execute({
      action: 'queryStatus',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      payload: {
        submissionId: 'REQ-1001',
      },
      context: {
        path: 'url',
        action: 'queryStatus',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/leave',
        },
        runtime: {
          networkStatus: {
            url: 'https://oa.example.com/api/leave/status',
            method: 'POST',
            bodyMode: 'form',
            body: {
              requestNo: { source: 'submissionId' },
            },
            responseMapping: {
              statusPath: 'data.status',
            },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: 'Leave Apply',
          },
        },
      } as any,
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://oa.example.com/api/leave/status',
      headers: expect.objectContaining({
        Cookie: 'SESSION=abc123',
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      data: 'requestNo=REQ-1001',
    }));
    expect(result.statusResult).toMatchObject({
      status: 'APPROVED',
    });
  });

  it('derives Cookie header from storageState when no sessionCookie is set', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        ok: true,
        data: {
          requestNo: 'REQ-2002',
        },
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn(),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      payload: {
        formData: {},
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          platformConfig: {
            cookieOrigin: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
            storageState: {
              cookies: [
                {
                  name: 'JSESSIONID',
                  value: 'oa-session',
                  domain: 'oa2023.xpu.edu.cn',
                  path: '/',
                },
                {
                  name: 'PORTAL',
                  value: 'portal-session',
                  domain: 'sz.xpu.edu.cn',
                  path: '/',
                },
              ],
              origins: [],
            },
          },
        },
        ticket: {
          jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
        },
        runtime: {
          networkSubmit: {
            url: 'https://oa2023.xpu.edu.cn/seeyon/rest/leave/submit',
            method: 'POST',
            responseMapping: {
              successPath: 'ok',
              successValue: true,
              submissionIdPath: 'data.requestNo',
            },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: 'Leave Apply',
          },
        },
      } as any,
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        Cookie: 'JSESSIONID=oa-session',
      }),
    }));
  });

  it('does not treat submit as success when no submission id can be derived', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        ok: true,
        message: 'draft saved',
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn(),
    } as any);

    const result = await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      payload: {
        formData: {},
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {},
        ticket: {},
        runtime: {
          networkSubmit: {
            url: 'https://oa.example.com/api/leave/submit',
            method: 'POST',
            responseMapping: {
              successPath: 'ok',
              successValue: true,
              messagePath: 'message',
            },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: 'Leave Apply',
          },
        },
      } as any,
    });

    expect(result.submitResult).toMatchObject({
      success: true,
    });

    const serviceWithoutSuccessPath = new UrlNetworkSubmitService({
      run: jest.fn(),
    } as any);
    mockedAxios.create.mockReturnValue({
      request,
    } as any);
    const strictResult = await serviceWithoutSuccessPath.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: 'Leave Apply',
      payload: {
        formData: {},
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {},
        ticket: {},
        runtime: {
          networkSubmit: {
            url: 'https://oa.example.com/api/leave/submit',
            method: 'POST',
            responseMapping: {
              messagePath: 'message',
            },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: 'Leave Apply',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: 'Leave Apply',
          },
        },
      } as any,
    });

    expect(strictResult.submitResult).toMatchObject({
      success: false,
      errorMessage: 'draft saved',
    });
  });

  it('supports HTTP 2xx draft-style submit requests without submission id mapping', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        result: 'ok',
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          csrfToken: '',
          saveDraft: {
            action: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=saveDraft',
            fields: {
              _json_params: '{"demo":true}',
            },
          },
        },
      }),
    } as any);

    const result = await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_request',
      processName: '请假申请',
      payload: {
        formData: {},
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          sessionCookie: 'JSESSIONID=oa-session',
        },
        ticket: {
          jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
        },
        runtime: {
          preflight: {
            steps: [
              {
                type: 'evaluate',
                script: 'return {};',
              },
            ],
          },
          networkSubmit: {
            url: '{{preflight.saveDraft.action}}',
            method: 'POST',
            bodyMode: 'form',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: {
              CSRFTOKEN: { source: 'preflight.csrfToken', default: '' },
              _json_params: { source: 'preflight.saveDraft.fields._json_params' },
            },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_request',
          processName: '请假申请',
          rpaDefinition: {
            processCode: 'leave_request',
            processName: '请假申请',
          },
        },
      } as any,
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=saveDraft',
      headers: expect.objectContaining({
        Cookie: 'JSESSIONID=oa-session',
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
      data: 'CSRFTOKEN=&_json_params=%7B%22demo%22%3Atrue%7D',
    }));
    expect(result.submitResult).toMatchObject({
      success: true,
    });
    expect(result.summary).toBe('请假申请 draft saved through URL network runtime');
  });
});
