import { BrowserActionExecutor } from './browser-action-executor';

describe('BrowserActionExecutor', () => {
  it('interpolates selector templates and falls back to ad-hoc elements for extract', async () => {
    const engine = {
      extract: jest.fn().mockResolvedValue('IN_APPROVAL'),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue(undefined),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const session = { sessionId: 'session-1' } as any;
    const tab = {
      tabId: 'tab-1',
      payload: {
        submissionId: 'LV-001',
      },
      extractedValues: {},
      artifacts: {},
    } as any;

    const result = await executor.executeStep(
      session,
      tab,
      {
        type: 'extract',
        fieldKey: 'status',
        selector: 'xpath=//article[contains(., "{{submissionId}}")]//*[contains(@class, "status-chip")]',
        description: 'Read status',
      },
      0,
      'snapshot-1',
    );

    expect(engine.extract).toHaveBeenCalledWith(
      session,
      tab,
      expect.objectContaining({
        fieldKey: 'status',
        selector: 'xpath=//article[contains(., "LV-001")]//*[contains(@class, "status-chip")]',
      }),
    );
    expect(result.extractedValues).toEqual({
      status: 'IN_APPROVAL',
    });
  });

  it('prefers runtime formData over step sample values for input steps', async () => {
    const engine = {
      input: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue({
        ref: 'amount-input',
        role: 'input',
        selector: '#amount',
        fieldKey: 'amount',
      }),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const session = { sessionId: 'session-1' } as any;
    const tab = {
      tabId: 'tab-1',
      payload: {
        formData: {
          amount: '888.00',
        },
      },
      extractedValues: {},
      artifacts: {},
    } as any;

    const result = await executor.executeStep(
      session,
      tab,
      {
        type: 'input',
        selector: '#amount',
        fieldKey: 'amount',
        value: '100.00',
        description: 'Fill amount',
      },
      1,
      'snapshot-2',
    );

    expect(engine.input).toHaveBeenCalledWith(
      session,
      tab,
      expect.objectContaining({
        ref: 'amount-input',
        fieldKey: 'amount',
      }),
      '888.00',
    );
    expect(result.stepResult).toMatchObject({
      type: 'input',
      fieldKey: 'amount',
      value: '888.00',
      status: 'executed',
    });
  });

  it('falls back to delegated auth payload for login credential steps', async () => {
    const engine = {
      input: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue({
        ref: 'username-input',
        role: 'input',
        selector: '#username',
        fieldKey: 'username',
      }),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const session = { sessionId: 'session-1' } as any;
    const tab = {
      tabId: 'tab-1',
      payload: {
        auth: {
          username: 'delegated-user',
        },
      },
      extractedValues: {},
      artifacts: {},
    } as any;

    await executor.executeStep(
      session,
      tab,
      {
        type: 'input',
        selector: '#username',
        fieldKey: 'username',
        value: 'sample-user',
        description: 'Fill login username',
      },
      0,
      'snapshot-3',
    );

    expect(engine.input).toHaveBeenCalledWith(
      session,
      tab,
      expect.objectContaining({
        ref: 'username-input',
        fieldKey: 'username',
      }),
      'delegated-user',
    );
  });

  it('merges object results from evaluate steps into extracted values', async () => {
    const engine = {
      evaluate: jest.fn().mockResolvedValue({
        csrfToken: '',
        saveDraft: {
          action: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=saveDraft',
          fields: {
            _json_params: '{"colMainData":{"subject":"请假申请"}}',
          },
        },
      }),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue(undefined),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const session = { sessionId: 'session-1' } as any;
    const tab = {
      tabId: 'tab-1',
      url: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
      title: '新建页面',
      action: 'submit',
      pageVersion: 2,
      history: ['https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl'],
      ticket: {
        jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
      },
      payload: {
        formData: {
          reason: '出差开会',
        },
      },
      extractedValues: {},
      artifacts: {},
    } as any;

    const result = await executor.executeStep(
      session,
      tab,
      {
        type: 'evaluate',
        script: 'return { ok: true };',
        description: '截获保存待发表单',
      },
      0,
      'snapshot-9',
    );

    expect(engine.evaluate).toHaveBeenCalledWith(
      session,
      tab,
      'return { ok: true };',
      expect.objectContaining({
        formData: {
          reason: '出差开会',
        },
        step: expect.objectContaining({
          type: 'evaluate',
          description: '截获保存待发表单',
        }),
      }),
    );
    expect(result.extractedValues).toEqual({
      csrfToken: '',
      saveDraft: {
        action: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=saveDraft',
        fields: {
          _json_params: '{"colMainData":{"subject":"请假申请"}}',
        },
      },
    });
    expect(tab.extractedValues).toEqual(result.extractedValues);
    expect(result.stepResult).toMatchObject({
      type: 'evaluate',
      status: 'executed',
    });
  });

  it('keeps previously extracted attachment mappings when evaluate returns an empty attachmentFieldMap', async () => {
    const engine = {
      evaluate: jest.fn().mockResolvedValue({
        submitCapture: {
          action: 'https://oa.example.com/form/saveDraft',
          fields: {},
        },
        attachmentFieldMap: {},
      }),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue(undefined),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const tab = {
      tabId: 'tab-1',
      payload: {
        formData: {},
      },
      extractedValues: {
        attachmentFieldMap: {
          field_2: 'attachmentRealField',
        },
      },
      artifacts: {},
    } as any;

    const result = await executor.executeStep(
      { sessionId: 'session-1' } as any,
      tab,
      {
        type: 'evaluate',
        builtin: 'capture_form_submit',
      } as any,
      0,
      'snapshot-attach-1',
    );

    expect(result.extractedValues).toEqual(expect.objectContaining({
      attachmentFieldMap: {
        field_2: 'attachmentRealField',
      },
    }));
    expect(tab.extractedValues.attachmentFieldMap).toEqual({
      field_2: 'attachmentRealField',
    });
  });

  it('keeps previously confirmed filledFields evidence when evaluate returns false for the same field', async () => {
    const engine = {
      evaluate: jest.fn().mockResolvedValue({
        submitCapture: {
          action: 'https://oa.example.com/form/saveDraft',
          fields: {},
        },
        filledFields: {
          field_2: false,
          '用印附件': false,
        },
      }),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue(undefined),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const tab = {
      tabId: 'tab-1',
      payload: {
        formData: {},
      },
      extractedValues: {
        filledFields: {
          field_2: true,
          '用印附件': true,
        },
      },
      artifacts: {},
    } as any;

    const result = await executor.executeStep(
      { sessionId: 'session-1' } as any,
      tab,
      {
        type: 'evaluate',
        builtin: 'capture_form_submit',
      } as any,
      0,
      'snapshot-filled-1',
    );

    expect(result.extractedValues).toEqual(expect.objectContaining({
      filledFields: {
        field_2: true,
        '用印附件': true,
      },
    }));
    expect(tab.extractedValues.filledFields).toEqual({
      field_2: true,
      '用印附件': true,
    });
  });

  it('marks uploaded fields as filled so later URL validation can reuse the DOM binding evidence', async () => {
    const engine = {
      upload: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue({
        ref: 'upload-field-2',
        role: 'upload',
        fieldKey: 'field_2',
        label: '用印附件',
        text: '用印附件',
      }),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const tab = {
      tabId: 'tab-1',
      payload: {
        formData: {},
        attachments: [
          {
            fieldKey: 'field_2',
            filename: 'seal.pdf',
          },
        ],
      },
      extractedValues: {},
      artifacts: {},
    } as any;

    await executor.executeStep(
      { sessionId: 'session-1' } as any,
      tab,
      {
        type: 'upload',
        fieldKey: 'field_2',
        target: {
          kind: 'upload',
          value: '用印附件',
          label: '用印附件',
        },
      } as any,
      0,
      'snapshot-upload-1',
    );

    expect(engine.upload).toHaveBeenCalled();
    expect(tab.extractedValues.filledFields).toEqual(expect.objectContaining({
      field_2: true,
      '用印附件': true,
    }));
  });

  it('resolves builtin evaluate plugins without embedding raw per-flow scripts', async () => {
    const engine = {
      evaluate: jest.fn().mockResolvedValue({
        submitCapture: {
          action: 'https://oa.example.com/form/saveDraft',
          headers: {
            'content-type': 'application/json',
          },
          rawBody: '{"ok":true}',
          fields: {
            _json_params: '{"ok":true}',
          },
        },
        submitRequestHeaders: {
          'content-type': 'application/json',
        },
        submitRawBody: '{"ok":true}',
      }),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue(undefined),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    await executor.executeStep(
      { sessionId: 'session-1' } as any,
      {
        tabId: 'tab-1',
        url: 'https://oa.example.com/form/new',
        title: '新建页面',
        action: 'submit',
        pageVersion: 1,
        history: ['https://oa.example.com/form/new'],
        ticket: { jumpUrl: 'https://oa.example.com/form/new' },
        payload: {
          formData: {
            reason: '出差',
          },
        },
        extractedValues: {},
        artifacts: {},
      } as any,
      {
        type: 'evaluate',
        builtin: 'capture_form_submit',
        options: {
          frame: {
            name: 'zwIframe',
          },
          trigger: {
            text: '保存待发',
          },
          capture: {
            actionPattern: 'saveDraft',
          },
        },
      },
      0,
      'snapshot-10',
    );

    expect(engine.evaluate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('__uniflowSubmitCaptureStore'),
      expect.objectContaining({
        step: expect.objectContaining({
          builtin: 'capture_form_submit',
          options: expect.objectContaining({
            frame: {
              name: 'zwIframe',
            },
          }),
        }),
      }),
    );
  });

  it('adapts select steps to click when the repaired element is a checkbox-like option', async () => {
    const engine = {
      click: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue({
        ref: 'seal-school',
        role: 'radio',
        selector: '#seal-school',
        fieldKey: 'seal_type',
        label: '学校公章',
        text: '学校公章',
      }),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    await executor.executeStep(
      { sessionId: 'session-1' } as any,
      {
        tabId: 'tab-1',
        payload: {
          formData: {
            seal_type: '学校公章',
          },
        },
        extractedValues: {},
        artifacts: {},
      } as any,
      {
        type: 'select',
        fieldKey: 'seal_type',
        description: '勾选用印类型',
        options: {
          __runtime: {
            repairedElementRole: 'radio',
          },
        },
      },
      0,
      'snapshot-select-repair',
    );

    expect(engine.click).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        ref: 'seal-school',
        role: 'radio',
        selector: '#seal-school',
      }),
      undefined,
    );
    expect(engine.select).not.toHaveBeenCalled();
  });

  it('falls back to repaired element-role hints when ref cache is unavailable', async () => {
    const engine = {
      click: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue(undefined),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    await executor.executeStep(
      { sessionId: 'session-1' } as any,
      {
        tabId: 'tab-1',
        payload: {
          formData: {
            seal_type: '学校公章',
          },
        },
        extractedValues: {},
        artifacts: {},
      } as any,
      {
        type: 'select',
        fieldKey: 'seal_type',
        selector: '#seal-school',
        description: '勾选用印类型',
        options: {
          __runtime: {
            repairedElementRole: 'radio',
          },
        },
      },
      0,
      'snapshot-select-repair-fallback',
    );

    expect(engine.click).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        role: 'radio',
        selector: '#seal-school',
        fieldKey: 'seal_type',
      }),
      undefined,
    );
    expect(engine.select).not.toHaveBeenCalled();
  });

  it('preserves frame-scope runtime hints when building ad-hoc fallback elements', async () => {
    const engine = {
      click: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue(undefined),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    await executor.executeStep(
      { sessionId: 'session-iframe' } as any,
      {
        tabId: 'tab-iframe',
        payload: {
          formData: {},
        },
        extractedValues: {},
        artifacts: {},
      } as any,
      {
        type: 'click',
        selector: '.send-button',
        description: '点击发送',
        options: {
          __runtime: {
            preferredRegionId: 'frame-1',
            preferredFrameUrl: 'https://example.com/frame/send',
            repairedElementRole: 'button',
          },
        },
      },
      0,
      'snapshot-iframe-fallback',
    );

    expect(engine.click).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        role: 'button',
        selector: '.send-button',
        regionId: 'frame-1',
        targetHints: expect.arrayContaining([
          expect.objectContaining({
            kind: 'url',
            value: 'https://example.com/frame/send',
            label: 'scope:frame',
          }),
        ]),
      }),
      undefined,
    );
  });
});
