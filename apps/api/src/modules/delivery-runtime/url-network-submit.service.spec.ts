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

  it('resolves single-source body templates directly from preflight values', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitFields: {
            field_1: '出差',
            field_2: '2026-04-21',
          },
        },
      }),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: '请假申请',
      payload: {
        formData: {
          field_1: '出差',
          field_2: '2026-04-21',
        },
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          sessionCookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/leave',
        },
        runtime: {
          preflight: {
            steps: [
              { type: 'evaluate', builtin: 'capture_form_submit' },
            ],
          },
          networkSubmit: {
            url: 'https://oa.example.com/api/leave/submit',
            method: 'POST',
            bodyMode: 'form',
            successMode: 'http2xx',
            body: {
              source: 'preflight.submitFields',
            },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: '请假申请',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: '请假申请',
          },
        },
      } as any,
    });

    const data = String(request.mock.calls[0][0].data);
    expect(decodeURIComponent(data.replace(/\+/g, '%20'))).toContain('field_1=出差');
    expect(decodeURIComponent(data.replace(/\+/g, '%20'))).toContain('field_2=2026-04-21');
  });

  it('prefers richer preflight payload fields when submitCapture points at a shallow autosave request', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/leave/saveDraft',
            method: 'post',
            bodyMode: 'form',
            fields: {
              _json_params: JSON.stringify({
                colMainData: {
                  subject: '请假申请',
                },
              }),
            },
            rawBody: '_json_params=%7B%22colMainData%22%3A%7B%22subject%22%3A%22%E8%AF%B7%E5%81%87%E7%94%B3%E8%AF%B7%22%7D%7D',
          },
          submitFields: {
            _json_params: JSON.stringify({
              colMainData: {
                subject: '请假申请',
              },
              formmain_0187: {
                field0004: '出差',
                field0005: '2026-04-21',
                field0006: '2026-04-23',
              },
            }),
          },
        },
      }),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: '请假申请',
      payload: {
        formData: {
          reason: '出差',
          startDate: '2026-04-21',
          endDate: '2026-04-23',
        },
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          sessionCookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/leave/new',
        },
        runtime: {
          preflight: {
            steps: [
              { type: 'evaluate', builtin: 'capture_form_submit' },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            body: {
              source: 'preflight.submitFields',
            },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: '请假申请',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: '请假申请',
          },
        },
      } as any,
    });

    const data = decodeURIComponent(String(request.mock.calls[0][0].data).replace(/\+/g, '%20'));
    expect(data).toContain('"field0004":"出差"');
    expect(data).toContain('"field0005":"2026-04-21"');
    expect(data).toContain('"field0006":"2026-04-23"');
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
            method: 'post',
            bodyMode: 'form',
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
            method: '{{preflight.saveDraft.method}}',
            bodyMode: '{{preflight.saveDraft.bodyMode}}',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: { source: 'preflight.saveDraft.fields' },
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
      data: '_json_params=%7B%22demo%22%3Atrue%7D',
    }));
    expect(result.submitResult).toMatchObject({
      success: true,
    });
    expect(result.summary).toBe('请假申请 draft saved through URL network runtime');
  });

  it('does not treat non-persisting draft-style requests as successful business saves', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        success: 'true',
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa2023.xpu.edu.cn/seeyon/content/content.do?method=saveOrUpdate&onlyGenerateSn=false&notSaveDB=true',
            method: 'post',
            bodyMode: 'form',
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
              { type: 'evaluate', builtin: 'capture_form_submit' },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: { source: 'preflight.submitCapture.fields' },
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

    expect(result.submitResult).toMatchObject({
      success: false,
    });
    expect(result.submitResult?.errorMessage).toContain('URL network submit failed');
  });

  it('patches captured form payloads from field-level request mappings before URL submit', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        ok: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/seal/saveDraft',
            method: 'post',
            bodyMode: 'form',
            fields: {
              CSRFTOKEN: 'csrf-001',
              _json_params: JSON.stringify({
                colMainData: {
                  subject: '西安工程大学用印申请单',
                },
              }),
            },
          },
          filledFields: {
            '文件类型、名称及份数': false,
          },
        },
      }),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'expense_submit',
      processName: '西安工程大学用印申请单',
      payload: {
        formData: {
          field_1: '测试用印材料1份',
        },
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/seal/new',
        },
        runtime: {
          preflight: {
            steps: [
              { type: 'evaluate', builtin: 'capture_form_submit' },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: { source: 'preflight.submitCapture.fields' },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'expense_submit',
          processName: '西安工程大学用印申请单',
          rpaDefinition: {
            processCode: 'expense_submit',
            processName: '西安工程大学用印申请单',
            fields: [
              {
                key: 'field_1',
                label: '文件类型、名称及份数',
                type: 'textarea',
                required: true,
                requestPatches: [
                  {
                    scope: 'body',
                    path: '_json_params.colMainData.fileSummary',
                  },
                ],
              },
            ],
          },
        },
      } as any,
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://oa.example.com/form/seal/saveDraft',
    }));

    const data = String(request.mock.calls[0][0].data);
    expect(decodeURIComponent(data)).toContain('"fileSummary":"测试用印材料1份"');
  });

  it('inherits captured ajax request headers for URL runtime replay while dropping hop-by-hop headers', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/seal/saveDraft',
            method: 'post',
            bodyMode: 'json',
            fields: {
              formId: 'form-001',
            },
          },
          submitRequestHeaders: {
            'content-type': 'application/json;charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
            host: 'oa.example.com',
            'content-length': '123',
          },
        },
      }),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'seal_apply',
      processName: '用印申请',
      payload: {
        formData: {},
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/seal/new',
        },
        runtime: {
          preflight: {
            steps: [
              { type: 'evaluate', builtin: 'capture_form_submit' },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            body: { source: 'preflight.submitCapture.fields' },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'seal_apply',
          processName: '用印申请',
          rpaDefinition: {
            processCode: 'seal_apply',
            processName: '用印申请',
          },
        },
      } as any,
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://oa.example.com/form/seal/saveDraft',
      headers: expect.objectContaining({
        Cookie: 'SESSION=abc123',
        'content-type': 'application/json;charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      }),
      data: {
        formId: 'form-001',
      },
    }));
    expect(request.mock.calls[0][0].headers.host).toBeUndefined();
    expect(request.mock.calls[0][0].headers['content-length']).toBeUndefined();
  });

  it('infers CAP4 colMainData body patch paths from generic field ids without explicit requestPatches', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/seal/saveDraft',
            method: 'post',
            bodyMode: 'form',
            fields: {
              _json_params: JSON.stringify({
                workflow_definition: {},
                colMainData: {
                  subject: '西安工程大学用印申请单',
                  field0050: '',
                },
              }),
            },
          },
          filledFields: {
            field0050_id: false,
          },
        },
      }),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'seal_apply',
      processName: '西安工程大学用印申请单',
      payload: {
        formData: {
          fileSummary: '合同文本 2份',
        },
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/seal/new',
        },
        runtime: {
          preflight: {
            steps: [
              { type: 'evaluate', builtin: 'capture_form_submit' },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: { source: 'preflight.submitCapture.fields' },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'seal_apply',
          processName: '西安工程大学用印申请单',
          rpaDefinition: {
            processCode: 'seal_apply',
            processName: '西安工程大学用印申请单',
            fields: [
              {
                key: 'fileSummary',
                label: '文件类型、名称及份数',
                type: 'textarea',
                required: true,
                id: 'field0050_id',
              },
            ],
          },
        },
      } as any,
    });

    const data = String(request.mock.calls[0][0].data);
    expect(decodeURIComponent(data.replace(/\+/g, '%20'))).toContain('"field0050":"合同文本 2份"');
  });

  it('infers body patch paths from capture mappings when legacy field definitions do not include target ids', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/leave/saveDraft',
            method: 'post',
            bodyMode: 'form',
            fields: {
              _json_params: JSON.stringify({
                workflow_definition: {},
                formmain_0187: {
                  field0005: '',
                  field0006: '',
                },
              }),
            },
          },
          filledFields: {
            '开始日期': true,
            '结束日期': true,
          },
        },
      }),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'leave_apply',
      processName: '请假申请',
      payload: {
        formData: {
          field_2: '2026-04-21',
          field_3: '2026-04-23',
        },
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/leave/new',
        },
        runtime: {
          preflight: {
            steps: [
              {
                type: 'evaluate',
                builtin: 'capture_form_submit',
                options: {
                  fieldMappings: [
                    {
                      fieldKey: 'field_2',
                      fieldType: 'date',
                      target: { id: 'field0005', label: '开始日期' },
                    },
                    {
                      fieldKey: 'field_3',
                      fieldType: 'date',
                      target: { id: 'field0006', label: '结束日期' },
                    },
                  ],
                },
              },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: { source: 'preflight.submitCapture.fields' },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'leave_apply',
          processName: '请假申请',
          rpaDefinition: {
            processCode: 'leave_apply',
            processName: '请假申请',
            fields: [
              {
                key: 'field_2',
                label: '开始日期',
                type: 'date',
                required: true,
              },
              {
                key: 'field_3',
                label: '结束日期',
                type: 'date',
                required: true,
              },
            ],
          },
        },
      } as any,
    });

    const data = decodeURIComponent(String(request.mock.calls[0][0].data).replace(/\+/g, '%20'));
    expect(data).toContain('"field0005":"2026-04-21"');
    expect(data).toContain('"field0006":"2026-04-23"');
  });

  it('infers CAP4 checkbox request patches from capture_form_submit field mappings', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/seal/saveDraft',
            method: 'post',
            bodyMode: 'form',
            fields: {
              _json_params: JSON.stringify({
                workflow_definition: {},
                colMainData: {
                  subject: '西安工程大学用印申请单',
                  field0053: '',
                  field0054: '',
                },
              }),
            },
          },
          filledFields: {
            field0053_id: true,
            sealTypes: true,
          },
        },
      }),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'seal_apply',
      processName: '西安工程大学用印申请单',
      payload: {
        formData: {
          sealTypes: ['党委公章'],
        },
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/seal/new',
        },
        runtime: {
          preflight: {
            steps: [
              {
                type: 'evaluate',
                builtin: 'capture_form_submit',
                options: {
                  fieldMappings: [
                    {
                      fieldKey: 'sealTypes',
                      fieldType: 'checkbox',
                      target: { id: 'field0053_id', label: '党委公章' },
                      options: [{ label: '党委公章', value: '党委公章' }],
                    },
                    {
                      fieldKey: 'sealTypes',
                      fieldType: 'checkbox',
                      target: { id: 'field0054_id', label: '学校公章' },
                      options: [{ label: '学校公章', value: '学校公章' }],
                    },
                  ],
                },
              },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: { source: 'preflight.submitCapture.fields' },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'seal_apply',
          processName: '西安工程大学用印申请单',
          rpaDefinition: {
            processCode: 'seal_apply',
            processName: '西安工程大学用印申请单',
            fields: [
              {
                key: 'sealTypes',
                label: '用印类型',
                type: 'checkbox',
                required: true,
                multiple: true,
                options: [
                  { label: '党委公章', value: '党委公章' },
                  { label: '学校公章', value: '学校公章' },
                ],
              },
            ],
          },
        },
      } as any,
    });

    const data = String(request.mock.calls[0][0].data);
    const decoded = decodeURIComponent(data.replace(/\+/g, '%20'));
    expect(decoded).toContain('"field0053":"1"');
    expect(decoded).toContain('"field0054":""');
  });

  it('adds missing CAP4 checkbox sibling fields when the captured payload omits unselected options', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/seal/saveDraft',
            method: 'post',
            bodyMode: 'form',
            fields: {
              _json_params: JSON.stringify({
                workflow_definition: {},
                colMainData: {
                  subject: '西安工程大学用印申请单',
                  field0053: '',
                },
              }),
            },
          },
          filledFields: {
            field0053_id: true,
            sealTypes: true,
          },
        },
      }),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'seal_apply',
      processName: '西安工程大学用印申请单',
      payload: {
        formData: {
          sealTypes: ['党委公章'],
        },
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/seal/new',
        },
        runtime: {
          preflight: {
            steps: [
              {
                type: 'evaluate',
                builtin: 'capture_form_submit',
                options: {
                  fieldMappings: [
                    {
                      fieldKey: 'sealTypes',
                      fieldType: 'checkbox',
                      target: { id: 'field0053_id', label: '党委公章' },
                      options: [{ label: '党委公章', value: '党委公章' }],
                    },
                    {
                      fieldKey: 'sealTypes',
                      fieldType: 'checkbox',
                      target: { id: 'field0054_id', label: '学校公章' },
                      options: [{ label: '学校公章', value: '学校公章' }],
                    },
                  ],
                },
              },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: { source: 'preflight.submitCapture.fields' },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'seal_apply',
          processName: '西安工程大学用印申请单',
          rpaDefinition: {
            processCode: 'seal_apply',
            processName: '西安工程大学用印申请单',
            fields: [
              {
                key: 'sealTypes',
                label: '用印类型',
                type: 'checkbox',
                required: true,
                multiple: true,
                options: [
                  { label: '党委公章', value: '党委公章' },
                  { label: '学校公章', value: '学校公章' },
                ],
              },
            ],
          },
        },
      } as any,
    });

    const data = String(request.mock.calls[0][0].data);
    const decoded = decodeURIComponent(data.replace(/\+/g, '%20'));
    expect(decoded).toContain('"field0053":"1"');
    expect(decoded).toContain('"field0054":""');
  });

  it('fails fast when a required URL field is neither DOM-bound nor request-patched', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        ok: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/seal/saveDraft',
            method: 'post',
            bodyMode: 'form',
            fields: {
              _json_params: '{"demo":true}',
            },
          },
          filledFields: {
            '文件类型、名称及份数': false,
          },
        },
      }),
    } as any);

    await expect(service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'expense_submit',
      processName: '西安工程大学用印申请单',
      payload: {
        formData: {
          field_1: '测试用印材料1份',
        },
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/seal/new',
        },
        runtime: {
          preflight: {
            steps: [
              { type: 'evaluate', builtin: 'capture_form_submit' },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: { source: 'preflight.submitCapture.fields' },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'expense_submit',
          processName: '西安工程大学用印申请单',
          rpaDefinition: {
            processCode: 'expense_submit',
            processName: '西安工程大学用印申请单',
            fields: [
              {
                key: 'field_1',
                label: '文件类型、名称及份数',
                type: 'textarea',
                required: true,
              },
            ],
          },
        },
      } as any,
    })).rejects.toThrow('URL runtime failed to bind required fields: 文件类型、名称及份数');

    expect(request).not.toHaveBeenCalled();
  });

  it('fails fast when a required checkbox field is DOM-clicked but still missing from the request payload', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        ok: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/seal/saveDraft',
            method: 'post',
            bodyMode: 'form',
            fields: {
              _json_params: JSON.stringify({
                workflow_definition: {},
                colMainData: {
                  subject: '西安工程大学用印申请单',
                },
              }),
            },
          },
          filledFields: {
            field0053_id: true,
            sealTypes: true,
          },
        },
      }),
    } as any);

    await expect(service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'seal_apply',
      processName: '西安工程大学用印申请单',
      payload: {
        formData: {
          sealTypes: ['党委公章'],
        },
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/seal/new',
        },
        runtime: {
          preflight: {
            steps: [
              {
                type: 'evaluate',
                builtin: 'capture_form_submit',
                options: {
                  fieldMappings: [
                    {
                      fieldKey: 'sealTypes',
                      fieldType: 'checkbox',
                      target: { label: '党委公章' },
                      options: [{ label: '党委公章', value: '党委公章' }],
                    },
                  ],
                },
              },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            completionKind: 'draft',
            body: { source: 'preflight.submitCapture.fields' },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'seal_apply',
          processName: '西安工程大学用印申请单',
          rpaDefinition: {
            processCode: 'seal_apply',
            processName: '西安工程大学用印申请单',
            fields: [
              {
                key: 'sealTypes',
                label: '用印类型',
                type: 'checkbox',
                required: true,
                multiple: true,
                options: [
                  { label: '党委公章', value: '党委公章' },
                ],
              },
            ],
          },
        },
      } as any,
    })).rejects.toThrow('URL runtime failed to bind required fields: 用印类型');

    expect(request).not.toHaveBeenCalled();
  });

  it('supports multipart submit by merging captured fields with uploaded attachments', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        ok: true,
      },
    });
    mockedAxios.create.mockReturnValue({
      request,
    } as any);

    const service = new UrlNetworkSubmitService({
      run: jest.fn().mockResolvedValue({
        success: true,
        extractedValues: {
          submitCapture: {
            action: 'https://oa.example.com/form/seal/submit',
            method: 'post',
            bodyMode: 'multipart',
            fields: {
              subject: '印章申请',
            },
          },
          attachmentFieldMap: {},
        },
      }),
    } as any);

    await service.execute({
      action: 'submit',
      connectorId: 'connector-1',
      processCode: 'expense_submit',
      processName: '西安工程大学用印申请单',
      payload: {
        formData: {
          subject: '印章申请',
        },
        attachments: [
          {
            filename: 'seal.pdf',
            mimeType: 'application/pdf',
            fieldKey: 'sealAttachment',
            content: Buffer.from('seal-file-content').toString('base64'),
          },
        ],
      },
      context: {
        path: 'url',
        action: 'submit',
        authConfig: {
          cookie: 'SESSION=abc123',
        },
        ticket: {
          jumpUrl: 'https://oa.example.com/form/seal/new',
        },
        runtime: {
          preflight: {
            steps: [
              { type: 'evaluate', builtin: 'capture_form_submit' },
            ],
          },
          networkSubmit: {
            url: '{{preflight.submitCapture.action}}',
            method: '{{preflight.submitCapture.method}}',
            bodyMode: '{{preflight.submitCapture.bodyMode}}',
            successMode: 'http2xx',
            body: { source: 'preflight.submitCapture.fields' },
          },
        },
        navigation: {},
        rpaFlow: {
          processCode: 'expense_submit',
          processName: '西安工程大学用印申请单',
          rpaDefinition: {
            processCode: 'expense_submit',
            processName: '西安工程大学用印申请单',
            fields: [
              {
                key: 'sealAttachment',
                label: '用印附件',
                type: 'file',
                requestFieldName: 'attachmentRealField',
              },
            ],
          },
        },
      } as any,
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://oa.example.com/form/seal/submit',
      headers: expect.not.objectContaining({
        'Content-Type': expect.anything(),
      }),
      data: expect.anything(),
    }));

    const formData = request.mock.calls[0][0].data as any;
    expect(Array.from((formData as any).entries())).toEqual(
      expect.arrayContaining([
        ['subject', '印章申请'],
        [
          'attachmentRealField',
          expect.objectContaining({
            name: 'seal.pdf',
          }),
        ],
      ]),
    );
  });
});
