import type { RpaFlowDefinition } from '@uniflow/shared-types';
import { BrowserTaskRuntime } from './browser-task-runtime';

describe('BrowserTaskRuntime', () => {
  it('generates structured snapshots and executes image-target browser steps', async () => {
    const runtime = new BrowserTaskRuntime();
    const result = await runtime.run({
      action: 'submit',
      flow: buildFlow({
        runtime: {
          executorMode: 'browser',
          browserProvider: 'stub',
          headless: true,
        },
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: {
                  kind: 'url',
                  value: 'https://portal.example.com/form/expense',
                },
                description: '打开申请页面',
              },
              {
                type: 'input',
                selector: '#amount',
                fieldKey: 'amount',
                description: '填写金额',
              },
              {
                type: 'click',
                target: {
                  kind: 'image',
                  value: 'submit-button.png',
                  imageUrl: 'submit-button.png',
                },
                description: '点击提交按钮',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
      },
      payload: {
        formData: {
          amount: 128,
        },
      },
      ticket: {
        jumpUrl: 'https://portal.example.com/jump/expense',
      },
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('stub');
    expect(result.snapshots.length).toBeGreaterThan(1);
    expect(result.finalSnapshot?.structuredText).toContain('可交互元素');
    expect(result.snapshots[0]?.interactiveElements[0]?.ref).toMatch(/^e\d+$/);
    expect(result.executedSteps).toEqual([
      expect.objectContaining({
        type: 'goto',
        status: 'executed',
        targetKind: 'url',
      }),
      expect.objectContaining({
        type: 'input',
        status: 'executed',
        elementRef: 'e1',
      }),
      expect.objectContaining({
        type: 'click',
        status: 'executed',
      }),
    ]);
  });

  it('falls back to stub runtime when unsupported provider is requested', async () => {
    const runtime = new BrowserTaskRuntime();
    const result = await runtime.run({
      action: 'queryStatus',
      flow: buildFlow({
        runtime: {
          executorMode: 'browser',
          browserProvider: 'unsupported-provider' as any,
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'unsupported-provider' as any,
      },
      payload: {
        submissionId: 'approve-001',
      },
      ticket: {
        jumpUrl: 'https://portal.example.com/jump/expense',
      },
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('stub');
    expect(result.requestedProvider).toBe('unsupported-provider');
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'browser_provider_fallback',
      }),
    ]);
  });

  it('skips a failed text navigation click when the target form is already visible', async () => {
    const runtime = new BrowserTaskRuntime();
    const captureSnapshot = jest.spyOn(runtime as any, 'captureSnapshot');
    const targetFormSnapshot = {
      snapshotId: 'snapshot-form',
      title: '请假申请',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['请假申请', '当前任务为提交流程'],
      structuredText: '请假申请表单',
      forms: [
        {
          id: 'form-main',
          name: '请假申请表单',
          fieldRefs: ['e1', 'e2', 'e3', 'e4'],
          fields: [
            { ref: 'e1', fieldKey: 'field_1', label: '开始日期', required: true },
            { ref: 'e2', fieldKey: 'field_2', label: '结束日期', required: true },
            { ref: 'e3', fieldKey: 'field_3', label: '请假类型', required: true },
            { ref: 'e4', fieldKey: 'field_4', label: '请假原因', required: true },
          ],
        },
      ],
      interactiveElements: [
        { ref: 'e1', role: 'input', selector: '#field_1', fieldKey: 'field_1', label: '开始日期' },
        { ref: 'e2', role: 'input', selector: '#field_2', fieldKey: 'field_2', label: '结束日期' },
        { ref: 'e3', role: 'select', selector: '#field_3', fieldKey: 'field_3', label: '请假类型' },
        { ref: 'e4', role: 'textarea', selector: '#field_4', fieldKey: 'field_4', label: '请假原因' },
        { ref: 'e5', role: 'button', selector: '#submit', text: '提交', label: '提交' },
      ],
    };
    captureSnapshot
      .mockResolvedValueOnce({
        ...targetFormSnapshot,
        snapshotId: 'snapshot-start',
        title: '申请中心',
        importantTexts: ['申请中心'],
        structuredText: '申请中心',
        forms: [],
        interactiveElements: [],
      })
      .mockResolvedValueOnce(targetFormSnapshot)
      .mockResolvedValue(targetFormSnapshot);

    const tab = {
      tabId: 'tab-1',
      action: 'submit',
      url: 'about:blank',
      title: 'start',
      history: [],
      pageVersion: 0,
      payload: {
        formData: {
          field_1: '2026-04-09',
          field_2: '2026-04-15',
          field_3: '事假',
          field_4: '外出旅游',
        },
      },
      extractedValues: {},
      artifacts: {},
      uploads: [],
      flow: buildFlow({
        processCode: 'leave_request',
        processName: '请假申请',
        fields: [
          { key: 'field_1', label: '开始日期', type: 'date', required: true },
          { key: 'field_2', label: '结束日期', type: 'date', required: true },
          { key: 'field_3', label: '请假类型', type: 'text', required: true },
          { key: 'field_4', label: '请假原因', type: 'textarea', required: true },
        ],
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: { kind: 'url', value: 'http://127.0.0.1:8000/' },
                description: '打开入口页面',
              },
              {
                type: 'click',
                description: '点击 请假申请',
                target: { kind: 'text', value: '请假申请' },
              },
              {
                type: 'input',
                selector: '#field_1',
                fieldKey: 'field_1',
                description: '输入 开始日期',
              },
              {
                type: 'click',
                selector: '#submit',
                description: '点击 提交',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
      },
      ticket: {
        jumpUrl: 'http://127.0.0.1:8000/',
      },
    } as any;
    const session = {
      sessionId: 'session-1',
      provider: 'stub',
      requestedProvider: 'stub',
      warnings: [],
      headless: true,
    } as any;
    const adapter = {
      provider: 'stub',
      initialize: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
      input: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      extract: jest.fn().mockResolvedValue(''),
      download: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.text === '请假申请') {
          throw new Error('text navigation is already satisfied');
        }
        return Promise.resolve();
      }),
    };

    (runtime as any).sessionManager.createSession = jest.fn().mockReturnValue(session);
    (runtime as any).sessionManager.getActiveTab = jest.fn().mockReturnValue(tab);
    (runtime as any).engineFactory.create = jest.fn().mockReturnValue({
      adapter,
      warnings: [],
    });
    (runtime as any).recoveryManager.attemptRecovery = jest.fn().mockImplementation(() => ({
      attempt: {
        stepIndex: 1,
        reason: 'text navigation is already satisfied',
        recovered: false,
        snapshotId: targetFormSnapshot.snapshotId,
      },
      snapshot: targetFormSnapshot,
    }));

    const result = await runtime.run({
      action: 'submit',
      flow: tab.flow,
      runtime: tab.runtime,
      payload: tab.payload,
      ticket: tab.ticket,
    });

    expect(result.success).toBe(true);
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({ type: 'click', status: 'recovered', description: '点击 请假申请' }),
      expect.objectContaining({ type: 'input', status: 'executed', fieldKey: 'field_1' }),
      expect.objectContaining({ type: 'click', status: 'executed', description: '点击 提交' }),
    ]);
  });
  it('does not skip a failed text navigation click when visible fields only match by semantic guess', async () => {
    const runtime = new BrowserTaskRuntime();
    const captureSnapshot = jest.spyOn(runtime as any, 'captureSnapshot');
    const targetFormSnapshot = {
      snapshotId: 'snapshot-form-semantic',
      title: 'Apply Center',
      url: 'http://127.0.0.1:8000/apply',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Leave Request', 'Apply Center'],
      structuredText: 'Leave Request form',
      forms: [
        {
          id: 'leave-form',
          name: 'Leave Request form',
          fieldRefs: ['e1', 'e2', 'e3', 'e4'],
          fields: [
            { ref: 'e1', fieldKey: 'start_time', label: 'Start Time', required: true },
            { ref: 'e2', fieldKey: 'end_time', label: 'End Time', required: true },
            { ref: 'e3', fieldKey: 'leave_type', label: 'Leave Type', required: true },
            { ref: 'e4', fieldKey: 'reason', label: 'Reason', required: true },
          ],
        },
      ],
      interactiveElements: [
        { ref: 'e1', role: 'input', selector: '[name=\"start_time\"]', fieldKey: 'start_time', label: 'Start Time' },
        { ref: 'e2', role: 'input', selector: '[name=\"end_time\"]', fieldKey: 'end_time', label: 'End Time' },
        { ref: 'e3', role: 'select', selector: '[name=\"leave_type\"]', fieldKey: 'leave_type', label: 'Leave Type' },
        { ref: 'e4', role: 'textarea', selector: '[name=\"reason\"]', fieldKey: 'reason', label: 'Reason' },
        { ref: 'e5', role: 'button', selector: 'button[type=\"submit\"]', text: 'Submit', label: 'Submit' },
      ],
    };
    captureSnapshot
      .mockResolvedValueOnce({
        ...targetFormSnapshot,
        snapshotId: 'snapshot-start-semantic',
        title: 'Dashboard',
        importantTexts: ['Dashboard'],
        structuredText: 'Dashboard',
        forms: [],
        interactiveElements: [],
      })
      .mockResolvedValueOnce(targetFormSnapshot)
      .mockResolvedValue(targetFormSnapshot);

    const tab = {
      tabId: 'tab-semantic',
      action: 'submit',
      url: 'about:blank',
      title: 'start',
      history: [],
      pageVersion: 0,
      payload: {
        formData: {
          field_1: '2026-04-09',
          field_2: '2026-04-15',
          field_3: 'Personal',
          field_4: 'Travel',
        },
      },
      extractedValues: {},
      artifacts: {},
      uploads: [],
      flow: buildFlow({
        processCode: 'leave_request',
        processName: 'Leave Request',
        fields: [
          { key: 'field_1', label: 'Start Date', type: 'date', required: true },
          { key: 'field_2', label: 'End Date', type: 'date', required: true },
          { key: 'field_3', label: 'Leave Type', type: 'select', required: true },
          { key: 'field_4', label: 'Reason', type: 'textarea', required: true },
        ],
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: { kind: 'url', value: 'http://127.0.0.1:8000/' },
                description: 'Open entry page',
              },
              {
                type: 'click',
                description: 'Click Leave Request',
                target: { kind: 'text', value: 'Leave Request' },
              },
              {
                type: 'input',
                selector: '[name=\"start_time\"]',
                fieldKey: 'field_1',
                description: 'Input Start Date',
              },
              {
                type: 'click',
                selector: 'button[type=\"submit\"]',
                description: 'Click Submit',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
      },
      ticket: {
        jumpUrl: 'http://127.0.0.1:8000/',
      },
    } as any;
    const session = {
      sessionId: 'session-semantic',
      provider: 'stub',
      requestedProvider: 'stub',
      warnings: [],
      headless: true,
    } as any;
    const adapter = {
      provider: 'stub',
      initialize: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
      input: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      extract: jest.fn().mockResolvedValue(''),
      download: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.text === 'Leave Request') {
          throw new Error('text navigation is already satisfied');
        }
        return Promise.resolve();
      }),
    };

    (runtime as any).sessionManager.createSession = jest.fn().mockReturnValue(session);
    (runtime as any).sessionManager.getActiveTab = jest.fn().mockReturnValue(tab);
    (runtime as any).engineFactory.create = jest.fn().mockReturnValue({
      adapter,
      warnings: [],
    });
    (runtime as any).recoveryManager.attemptRecovery = jest.fn().mockImplementation(() => ({
      attempt: {
        stepIndex: 1,
        reason: 'text navigation is already satisfied',
        recovered: false,
        snapshotId: targetFormSnapshot.snapshotId,
      },
      snapshot: targetFormSnapshot,
    }));

    const result = await runtime.run({
      action: 'submit',
      flow: tab.flow,
      runtime: tab.runtime,
      payload: tab.payload,
      ticket: tab.ticket,
    });

    expect(result.success).toBe(false);
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({
        type: 'click',
        status: 'failed',
        description: 'Click Leave Request',
        errorMessage: 'text navigation is already satisfied',
      }),
    ]);
  });

  it('repairs a failed field step by rebinding it to the observed page element', async () => {
    const runtime = new BrowserTaskRuntime();
    const captureSnapshot = jest.spyOn(runtime as any, 'captureSnapshot');
    const startSnapshot = {
      snapshotId: 'snapshot-start-repair',
      title: 'Dashboard',
      url: 'http://127.0.0.1:8000/',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Dashboard'],
      structuredText: 'Dashboard',
      forms: [],
      interactiveElements: [],
    };
    const formSnapshot = {
      snapshotId: 'snapshot-form-repair',
      title: '请假申请',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['请假申请', '填写申请单'],
      structuredText: '请假申请表单',
      forms: [
        {
          id: 'form-main',
          name: '请假申请表单',
          fieldRefs: ['e1'],
          fields: [
            { ref: 'e1', fieldKey: 'start_time', label: '开始日期', required: true },
          ],
        },
      ],
      interactiveElements: [
        { ref: 'e1', role: 'input', selector: '[name=\"start_time\"]', fieldKey: 'start_time', label: '开始日期' },
        { ref: 'e2', role: 'button', selector: '#submit', text: '提交', label: '提交' },
      ],
    };
    captureSnapshot
      .mockResolvedValueOnce(startSnapshot)
      .mockResolvedValueOnce(formSnapshot)
      .mockResolvedValueOnce(formSnapshot)
      .mockResolvedValue(formSnapshot);

    const tab = {
      tabId: 'tab-repair',
      action: 'submit',
      url: 'about:blank',
      title: 'start',
      history: [],
      pageVersion: 0,
      payload: {
        formData: {
          field_1: '2026-04-09',
        },
      },
      extractedValues: {},
      artifacts: {},
      uploads: [],
      flow: buildFlow({
        processCode: 'leave_request',
        processName: '请假申请',
        fields: [
          { key: 'field_1', label: '开始日期', type: 'date', required: true },
        ],
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: { kind: 'url', value: 'http://127.0.0.1:8000/form' },
                description: '打开申请页面',
              },
              {
                type: 'input',
                selector: '#field_1',
                fieldKey: 'field_1',
                description: '输入开始日期',
              },
              {
                type: 'click',
                selector: '#submit',
                description: '点击提交',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
      },
      ticket: {
        jumpUrl: 'http://127.0.0.1:8000/form',
      },
    } as any;
    const session = {
      sessionId: 'session-repair',
      provider: 'stub',
      requestedProvider: 'stub',
      warnings: [],
      headless: true,
    } as any;
    const adapter = {
      provider: 'stub',
      initialize: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
      input: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.selector === '#field_1') {
          throw new Error('stale selector');
        }
        return Promise.resolve();
      }),
      select: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      extract: jest.fn().mockResolvedValue(''),
      download: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    };

    (runtime as any).sessionManager.createSession = jest.fn().mockReturnValue(session);
    (runtime as any).sessionManager.getActiveTab = jest.fn().mockReturnValue(tab);
    (runtime as any).engineFactory.create = jest.fn().mockReturnValue({
      adapter,
      warnings: [],
    });
    (runtime as any).recoveryManager.attemptRecovery = jest.fn().mockImplementation(() => ({
      attempt: {
        stepIndex: 1,
        reason: 'stale selector',
        recovered: false,
        snapshotId: 'snapshot-synthetic-repair',
      },
      snapshot: {
        ...formSnapshot,
        snapshotId: 'snapshot-synthetic-repair',
      },
    }));

    const result = await runtime.run({
      action: 'submit',
      flow: tab.flow,
      runtime: tab.runtime,
      payload: tab.payload,
      ticket: tab.ticket,
    });

    expect(result.success).toBe(true);
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({
        type: 'input',
        status: 'recovered',
        fieldKey: 'field_1',
        selector: '[name=\"start_time\"]',
      }),
      expect.objectContaining({ type: 'click', status: 'executed', description: '点击提交' }),
    ]);
    expect(adapter.input).toHaveBeenCalledTimes(2);
    expect(adapter.input).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        fieldKey: 'field_1',
        selector: '[name=\"start_time\"]',
      }),
      '2026-04-09',
    );
  });

  it('does not skip a failed text navigation click based on a synthetic recovery snapshot', async () => {
    const runtime = new BrowserTaskRuntime();
    const captureSnapshot = jest.spyOn(runtime as any, 'captureSnapshot');
    const dashboardSnapshot = {
      snapshotId: 'snapshot-dashboard',
      title: 'Dashboard',
      url: 'http://127.0.0.1:8000/',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Dashboard'],
      structuredText: 'Dashboard',
      forms: [],
      interactiveElements: [],
    };
    const syntheticFormSnapshot = {
      snapshotId: 'snapshot-form',
      title: 'Leave Request',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Leave Request', 'Submit flow'],
      structuredText: 'Leave Request form',
      forms: [
        {
          id: 'form-main',
          name: 'Leave Request form',
          fieldRefs: ['e1'],
          fields: [
            { ref: 'e1', fieldKey: 'field_1', label: 'Start Date', required: true },
          ],
        },
      ],
      interactiveElements: [
        { ref: 'e1', role: 'input', fieldKey: 'field_1', label: 'Start Date' },
      ],
    };
    captureSnapshot
      .mockResolvedValueOnce(dashboardSnapshot)
      .mockResolvedValueOnce(dashboardSnapshot)
      .mockResolvedValueOnce(dashboardSnapshot);

    const tab = {
      tabId: 'tab-2',
      action: 'submit',
      url: 'about:blank',
      title: 'start',
      history: [],
      pageVersion: 0,
      payload: {
        formData: {
          field_1: '2026-04-09',
        },
      },
      extractedValues: {},
      artifacts: {},
      uploads: [],
      flow: buildFlow({
        processCode: 'leave_request',
        processName: 'Leave Request',
        fields: [
          { key: 'field_1', label: 'Start Date', type: 'date', required: true },
        ],
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: { kind: 'url', value: 'http://127.0.0.1:8000/' },
                description: 'Open entry page',
              },
              {
                type: 'click',
                description: 'Click Leave Request',
                target: { kind: 'text', value: 'Leave Request' },
              },
              {
                type: 'input',
                selector: '#field_1',
                fieldKey: 'field_1',
                description: 'Input Start Date',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
      },
      ticket: {
        jumpUrl: 'http://127.0.0.1:8000/',
      },
    } as any;
    const session = {
      sessionId: 'session-2',
      provider: 'stub',
      requestedProvider: 'stub',
      warnings: [],
      headless: true,
    } as any;
    const adapter = {
      provider: 'stub',
      initialize: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
      input: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      extract: jest.fn().mockResolvedValue(''),
      download: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.text === 'Leave Request') {
          throw new Error('navigation target not clickable');
        }
        return Promise.resolve();
      }),
    };

    (runtime as any).sessionManager.createSession = jest.fn().mockReturnValue(session);
    (runtime as any).sessionManager.getActiveTab = jest.fn().mockReturnValue(tab);
    (runtime as any).engineFactory.create = jest.fn().mockReturnValue({
      adapter,
      warnings: [],
    });
    (runtime as any).recoveryManager.attemptRecovery = jest.fn().mockImplementation(() => ({
      attempt: {
        stepIndex: 1,
        reason: 'navigation target not clickable',
        recovered: false,
        snapshotId: syntheticFormSnapshot.snapshotId,
      },
      snapshot: syntheticFormSnapshot,
    }));

    const result = await runtime.run({
      action: 'submit',
      flow: tab.flow,
      runtime: tab.runtime,
      payload: tab.payload,
      ticket: tab.ticket,
    });

    expect(result.success).toBe(false);
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({ type: 'click', status: 'failed', description: 'Click Leave Request' }),
    ]);
    expect(adapter.input).not.toHaveBeenCalled();
  });

  it('re-runs repair judgement with newer page evidence when the first repaired step still fails', async () => {
    const runtime = new BrowserTaskRuntime();
    const captureSnapshot = jest.spyOn(runtime as any, 'captureSnapshot');
    const initialSnapshot = {
      snapshotId: 'snapshot-loop-start',
      title: 'Apply Center',
      url: 'http://127.0.0.1:8000/apply',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Apply Center'],
      structuredText: 'Apply Center',
      forms: [],
      interactiveElements: [],
    };
    const recoverySnapshot = {
      snapshotId: 'snapshot-loop-recovery',
      title: 'Apply Form',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Apply Form', 'Submit'],
      structuredText: 'Apply Form',
      forms: [],
      interactiveElements: [
        { ref: 'e1', role: 'button', selector: '#candidate-1', text: 'First Candidate', label: 'First Candidate' },
      ],
    };
    const repairRoundTwoSnapshot = {
      snapshotId: 'snapshot-loop-round2',
      title: 'Apply Form',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Apply Form', 'Confirm Submit'],
      structuredText: 'Apply Form',
      forms: [],
      interactiveElements: [
        { ref: 'e2', role: 'button', selector: '#candidate-2', text: 'Second Candidate', label: 'Second Candidate' },
      ],
    };
    const finalSnapshot = {
      ...repairRoundTwoSnapshot,
      snapshotId: 'snapshot-loop-final',
      importantTexts: ['Apply Form', 'Submitted'],
      structuredText: 'Submitted',
    };
    captureSnapshot
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(recoverySnapshot)
      .mockResolvedValueOnce(repairRoundTwoSnapshot)
      .mockResolvedValueOnce(finalSnapshot)
      .mockResolvedValue(finalSnapshot);

    const tab = {
      tabId: 'tab-loop',
      action: 'submit',
      url: 'about:blank',
      title: 'start',
      history: [],
      pageVersion: 0,
      payload: {
        formData: {},
      },
      extractedValues: {},
      artifacts: {},
      uploads: [],
      flow: buildFlow({
        processCode: 'generic_submit',
        processName: 'Generic Submit',
        fields: [],
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: { kind: 'url', value: 'http://127.0.0.1:8000/form' },
                description: 'Open form',
              },
              {
                type: 'click',
                selector: '#submit',
                description: 'Click submit',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
        maxRetries: 2,
      },
      ticket: {
        jumpUrl: 'http://127.0.0.1:8000/form',
      },
    } as any;
    const session = {
      sessionId: 'session-loop',
      provider: 'stub',
      requestedProvider: 'stub',
      warnings: [],
      headless: true,
    } as any;
    const adapter = {
      provider: 'stub',
      initialize: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
      input: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      extract: jest.fn().mockResolvedValue(''),
      download: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.selector === '#submit') {
          throw new Error('original submit missing');
        }
        if (element?.selector === '#candidate-1') {
          throw new Error('candidate one failed');
        }
        return Promise.resolve();
      }),
    };

    (runtime as any).sessionManager.createSession = jest.fn().mockReturnValue(session);
    (runtime as any).sessionManager.getActiveTab = jest.fn().mockReturnValue(tab);
    (runtime as any).engineFactory.create = jest.fn().mockReturnValue({
      adapter,
      warnings: [],
    });
    (runtime as any).recoveryManager.attemptRecovery = jest.fn().mockImplementation(() => ({
      attempt: {
        stepIndex: 1,
        reason: 'original submit missing',
        recovered: false,
        snapshotId: 'snapshot-loop-synthetic',
      },
      snapshot: {
        ...recoverySnapshot,
        snapshotId: 'snapshot-loop-synthetic',
      },
    }));
    (runtime as any).stepRepairEngine.repair = jest.fn()
      .mockResolvedValueOnce({
        canRepair: true,
        repairedStep: {
          type: 'click',
          selector: '#candidate-1',
          description: 'Click submit repaired candidate 1',
        },
        reasoning: ['first candidate'],
        confidence: 0.78,
      })
      .mockResolvedValueOnce({
        canRepair: true,
        repairedStep: {
          type: 'click',
          selector: '#candidate-2',
          description: 'Click submit repaired candidate 2',
        },
        reasoning: ['second candidate'],
        confidence: 0.81,
      });

    const result = await runtime.run({
      action: 'submit',
      flow: tab.flow,
      runtime: tab.runtime,
      payload: tab.payload,
      ticket: tab.ticket,
    });

    expect(result.success).toBe(true);
    expect((runtime as any).stepRepairEngine.repair).toHaveBeenCalledTimes(2);
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({
        type: 'click',
        status: 'recovered',
        selector: '#candidate-2',
      }),
    ]);
    expect(result.recoveryAttempts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepIndex: 1,
        reason: expect.stringContaining('step_repair_round_1'),
        recovered: false,
      }),
      expect.objectContaining({
        stepIndex: 1,
        reason: expect.stringContaining('step_repair_round_2'),
        recovered: true,
      }),
    ]));
  });

  it('reuses a successful repaired selector for later steps with the same stable field identity', async () => {
    const runtime = new BrowserTaskRuntime();
    const captureSnapshot = jest.spyOn(runtime as any, 'captureSnapshot');
    const startSnapshot = {
      snapshotId: 'snapshot-plan-start',
      title: 'Start',
      url: 'http://127.0.0.1:8000/start',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Start'],
      structuredText: 'Start',
      forms: [],
      interactiveElements: [],
    };
    const formSnapshot = {
      snapshotId: 'snapshot-plan-form',
      title: 'Leave Form',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Leave Form'],
      structuredText: 'Leave Form',
      forms: [
        {
          id: 'form-main',
          name: 'Leave Form',
          fieldRefs: ['e1'],
          fields: [
            { ref: 'e1', fieldKey: 'start_time', label: '开始日期', required: true },
          ],
        },
      ],
      interactiveElements: [
        { ref: 'e1', role: 'input', selector: '[name=\"start_time\"]', fieldKey: 'start_time', label: '开始日期' },
      ],
    };
    const afterInputSnapshot = {
      ...formSnapshot,
      snapshotId: 'snapshot-plan-after-input',
      importantTexts: ['Leave Form', 'Value entered'],
    };
    const afterExtractSnapshot = {
      ...formSnapshot,
      snapshotId: 'snapshot-plan-after-extract',
      importantTexts: ['Leave Form', 'Value confirmed'],
    };
    captureSnapshot
      .mockResolvedValueOnce(startSnapshot)
      .mockResolvedValueOnce(formSnapshot)
      .mockResolvedValueOnce(afterInputSnapshot)
      .mockResolvedValueOnce(afterExtractSnapshot)
      .mockResolvedValue(afterExtractSnapshot);

    const tab = {
      tabId: 'tab-plan',
      action: 'submit',
      url: 'about:blank',
      title: 'start',
      history: [],
      pageVersion: 0,
      payload: {
        formData: {
          field_1: '2026-04-21',
        },
      },
      extractedValues: {},
      artifacts: {},
      uploads: [],
      flow: buildFlow({
        processCode: 'leave_request',
        processName: '请假申请',
        fields: [
          { key: 'field_1', label: '开始日期', type: 'date', required: true },
        ],
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: { kind: 'url', value: 'http://127.0.0.1:8000/form' },
                description: '打开表单',
              },
              {
                type: 'input',
                selector: '#legacy_start_time',
                fieldKey: 'field_1',
                stabilityKey: 'leave_start_time',
                description: '填写开始日期',
              },
              {
                type: 'extract',
                selector: '#legacy_start_time',
                fieldKey: 'field_1',
                stabilityKey: 'leave_start_time',
                description: '读取开始日期',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
      },
      ticket: {
        jumpUrl: 'http://127.0.0.1:8000/form',
      },
    } as any;
    const session = {
      sessionId: 'session-plan',
      provider: 'stub',
      requestedProvider: 'stub',
      warnings: [],
      headless: true,
    } as any;
    const adapter = {
      provider: 'stub',
      initialize: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
      input: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.selector === '#legacy_start_time') {
          throw new Error('legacy selector missing');
        }
        return Promise.resolve();
      }),
      select: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      extract: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.selector !== '[name=\"start_time\"]') {
          throw new Error(`unexpected extract selector:${element?.selector}`);
        }
        return Promise.resolve('2026-04-21');
      }),
      download: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    };

    (runtime as any).sessionManager.createSession = jest.fn().mockReturnValue(session);
    (runtime as any).sessionManager.getActiveTab = jest.fn().mockReturnValue(tab);
    (runtime as any).engineFactory.create = jest.fn().mockReturnValue({
      adapter,
      warnings: [],
    });
    (runtime as any).recoveryManager.attemptRecovery = jest.fn().mockImplementation(() => ({
      attempt: {
        stepIndex: 1,
        reason: 'legacy selector missing',
        recovered: false,
        snapshotId: 'snapshot-plan-synthetic',
      },
      snapshot: {
        ...formSnapshot,
        snapshotId: 'snapshot-plan-synthetic',
      },
    }));
    (runtime as any).stepRepairEngine.repair = jest.fn().mockResolvedValue({
      canRepair: true,
      repairedStep: {
        type: 'input',
        selector: '[name=\"start_time\"]',
        fieldKey: 'field_1',
        stabilityKey: 'leave_start_time',
        target: {
          kind: 'element_ref',
          value: 'e1',
          label: '开始日期',
        },
        options: {
          __runtime: {
            repairedElementRole: 'input',
          },
        },
        description: '填写开始日期',
      },
      reasoning: ['repair start date field'],
      confidence: 0.85,
    });

    const result = await runtime.run({
      action: 'submit',
      flow: tab.flow,
      runtime: tab.runtime,
      payload: tab.payload,
      ticket: tab.ticket,
    });

    expect(result.success).toBe(true);
    expect((runtime as any).stepRepairEngine.repair).toHaveBeenCalledTimes(1);
    expect(adapter.input).toHaveBeenCalledTimes(2);
    expect(adapter.extract).toHaveBeenCalledTimes(1);
    expect(adapter.extract).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        fieldKey: 'field_1',
        selector: '[name=\"start_time\"]',
      }),
    );
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({
        type: 'input',
        status: 'recovered',
        selector: '[name=\"start_time\"]',
      }),
      expect.objectContaining({
        type: 'extract',
        status: 'executed',
        selector: '[name=\"start_time\"]',
        fieldKey: 'field_1',
      }),
    ]);
  });

  it('propagates the active form scope so later sibling steps can align before failing', async () => {
    const runtime = new BrowserTaskRuntime();
    const captureSnapshot = jest.spyOn(runtime as any, 'captureSnapshot');
    const startSnapshot = {
      snapshotId: 'snapshot-scope-start',
      title: 'Start',
      url: 'http://127.0.0.1:8000/start',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Start'],
      structuredText: 'Start',
      forms: [],
      interactiveElements: [],
    };
    const formSnapshot = {
      snapshotId: 'snapshot-scope-form',
      title: 'Leave Form',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [
        {
          id: 'main-form',
          role: 'form',
          name: 'Main Form',
          summary: 'Leave form',
          elementRefs: ['e1', 'e2'],
        },
      ],
      tables: [],
      dialogs: [],
      importantTexts: ['Leave Form'],
      structuredText: 'Leave Form',
      forms: [
        {
          id: 'leave-form',
          name: 'Leave Form',
          fieldRefs: ['e1', 'e2'],
          fields: [
            { ref: 'e1', fieldKey: 'start_time', label: '开始日期', required: true },
            { ref: 'e2', fieldKey: 'end_time', label: '结束日期', required: true },
          ],
        },
      ],
      interactiveElements: [
        { ref: 'e1', role: 'input', selector: '[name=\"start_time\"]', fieldKey: 'start_time', label: '开始日期', regionId: 'main-form' },
        { ref: 'e2', role: 'input', selector: '[name=\"end_time\"]', fieldKey: 'end_time', label: '结束日期', regionId: 'main-form' },
      ],
    };
    const afterStartSnapshot = {
      ...formSnapshot,
      snapshotId: 'snapshot-scope-after-start',
      importantTexts: ['Leave Form', 'Start date filled'],
    };
    const afterEndSnapshot = {
      ...formSnapshot,
      snapshotId: 'snapshot-scope-after-end',
      importantTexts: ['Leave Form', 'End date filled'],
    };
    captureSnapshot
      .mockResolvedValueOnce(startSnapshot)
      .mockResolvedValueOnce(formSnapshot)
      .mockResolvedValueOnce(afterStartSnapshot)
      .mockResolvedValueOnce(afterEndSnapshot)
      .mockResolvedValue(afterEndSnapshot);

    const tab = {
      tabId: 'tab-scope',
      action: 'submit',
      url: 'about:blank',
      title: 'start',
      history: [],
      pageVersion: 0,
      payload: {
        formData: {
          field_1: '2026-04-21',
          field_2: '2026-04-22',
        },
      },
      extractedValues: {},
      artifacts: {},
      uploads: [],
      flow: buildFlow({
        processCode: 'leave_request',
        processName: '请假申请',
        fields: [
          { key: 'field_1', label: '开始日期', type: 'date', required: true },
          { key: 'field_2', label: '结束日期', type: 'date', required: true },
        ],
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: { kind: 'url', value: 'http://127.0.0.1:8000/form' },
                description: '打开表单',
              },
              {
                type: 'input',
                selector: '#legacy_start_time',
                fieldKey: 'field_1',
                stabilityKey: 'leave_start_time',
                description: '填写开始日期',
              },
              {
                type: 'input',
                selector: '#legacy_end_time',
                fieldKey: 'field_2',
                stabilityKey: 'leave_end_time',
                description: '填写结束日期',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
      },
      ticket: {
        jumpUrl: 'http://127.0.0.1:8000/form',
      },
    } as any;
    const session = {
      sessionId: 'session-scope',
      provider: 'stub',
      requestedProvider: 'stub',
      warnings: [],
      headless: true,
    } as any;
    const adapter = {
      provider: 'stub',
      initialize: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
      input: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.selector === '#legacy_start_time') {
          throw new Error('legacy start selector missing');
        }
        if (element?.selector === '#legacy_end_time') {
          throw new Error('legacy end selector should have been pre-aligned');
        }
        return Promise.resolve();
      }),
      select: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      extract: jest.fn().mockResolvedValue(''),
      download: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    };

    (runtime as any).sessionManager.createSession = jest.fn().mockReturnValue(session);
    (runtime as any).sessionManager.getActiveTab = jest.fn().mockReturnValue(tab);
    (runtime as any).engineFactory.create = jest.fn().mockReturnValue({
      adapter,
      warnings: [],
    });
    (runtime as any).recoveryManager.attemptRecovery = jest.fn().mockImplementation(() => ({
      attempt: {
        stepIndex: 1,
        reason: 'legacy start selector missing',
        recovered: false,
        snapshotId: 'snapshot-scope-synthetic',
      },
      snapshot: {
        ...formSnapshot,
        snapshotId: 'snapshot-scope-synthetic',
      },
    }));
    (runtime as any).stepRepairEngine.repair = jest.fn().mockResolvedValue({
      canRepair: true,
      repairedStep: {
        type: 'input',
        selector: '[name=\"start_time\"]',
        fieldKey: 'field_1',
        stabilityKey: 'leave_start_time',
        target: {
          kind: 'element_ref',
          value: 'e1',
          label: '开始日期',
        },
        options: {
          __runtime: {
            repairedElementRole: 'input',
          },
        },
        description: '填写开始日期',
      },
      reasoning: ['repair start date field'],
      confidence: 0.85,
    });

    const result = await runtime.run({
      action: 'submit',
      flow: tab.flow,
      runtime: tab.runtime,
      payload: tab.payload,
      ticket: tab.ticket,
    });

    expect(result.success).toBe(true);
    expect((runtime as any).stepRepairEngine.repair).toHaveBeenCalledTimes(1);
    expect(adapter.input).toHaveBeenCalledTimes(3);
    expect(adapter.input).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        fieldKey: 'field_2',
        selector: '[name=\"end_time\"]',
      }),
      '2026-04-22',
    );
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({
        type: 'input',
        status: 'recovered',
        selector: '[name=\"start_time\"]',
      }),
      expect.objectContaining({
        type: 'input',
        status: 'executed',
        selector: '[name=\"end_time\"]',
        fieldKey: 'field_2',
      }),
    ]);
  });

  it('propagates active frame scope so later sibling steps stay inside the repaired iframe', async () => {
    const runtime = new BrowserTaskRuntime();
    const childFrameUrl = 'https://example.com/frame/leave-form';
    const captureSnapshot = jest.spyOn(runtime as any, 'captureSnapshot');
    const startSnapshot = {
      snapshotId: 'snapshot-frame-start',
      title: 'Start',
      url: 'http://127.0.0.1:8000/start',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Start'],
      structuredText: 'Start',
      forms: [],
      interactiveElements: [],
    };
    const frameFormSnapshot = {
      snapshotId: 'snapshot-frame-form',
      title: 'Leave Form',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [
        {
          id: 'main-form',
          role: 'form',
          name: 'Main Form',
          summary: 'Leave form in main page',
          elementRefs: ['e1', 'e3'],
        },
        {
          id: 'frame-1',
          role: 'main',
          name: 'Frame 1',
          summary: childFrameUrl,
          elementRefs: ['e2', 'e4'],
        },
      ],
      tables: [],
      dialogs: [],
      importantTexts: ['Leave Form'],
      structuredText: 'Leave Form',
      forms: [],
      interactiveElements: [
        { ref: 'e1', role: 'input', selector: '[name=\"start_time_main\"]', fieldKey: 'field_1', label: '开始日期', regionId: 'main-form' },
        {
          ref: 'e2',
          role: 'input',
          selector: '[name=\"start_time_frame\"]',
          fieldKey: 'field_1',
          label: '开始日期',
          regionId: 'frame-1',
          targetHints: [
            {
              kind: 'url',
              value: childFrameUrl,
              label: 'scope:frame',
            },
          ],
        },
        { ref: 'e3', role: 'input', selector: '[name=\"end_time_main\"]', fieldKey: 'field_2', label: '结束日期', regionId: 'main-form' },
        {
          ref: 'e4',
          role: 'input',
          selector: '[name=\"end_time_frame\"]',
          fieldKey: 'field_2',
          label: '结束日期',
          regionId: 'frame-1',
          targetHints: [
            {
              kind: 'url',
              value: childFrameUrl,
              label: 'scope:frame',
            },
          ],
        },
      ],
    };
    const afterStartSnapshot = {
      ...frameFormSnapshot,
      snapshotId: 'snapshot-frame-after-start',
      importantTexts: ['Leave Form', 'Frame start date filled'],
    };
    const afterEndSnapshot = {
      ...frameFormSnapshot,
      snapshotId: 'snapshot-frame-after-end',
      importantTexts: ['Leave Form', 'Frame end date filled'],
    };
    captureSnapshot
      .mockResolvedValueOnce(startSnapshot)
      .mockResolvedValueOnce(frameFormSnapshot)
      .mockResolvedValueOnce(afterStartSnapshot)
      .mockResolvedValueOnce(afterEndSnapshot)
      .mockResolvedValue(afterEndSnapshot);

    const tab = {
      tabId: 'tab-frame-scope',
      action: 'submit',
      url: 'about:blank',
      title: 'start',
      history: [],
      pageVersion: 0,
      payload: {
        formData: {
          field_1: '2026-04-21',
          field_2: '2026-04-22',
        },
      },
      extractedValues: {},
      artifacts: {},
      uploads: [],
      flow: buildFlow({
        processCode: 'leave_request',
        processName: '请假申请',
        fields: [
          { key: 'field_1', label: '开始日期', type: 'date', required: true },
          { key: 'field_2', label: '结束日期', type: 'date', required: true },
        ],
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: { kind: 'url', value: 'http://127.0.0.1:8000/form' },
                description: '打开表单',
              },
              {
                type: 'input',
                selector: '#legacy_start_time',
                fieldKey: 'field_1',
                stabilityKey: 'leave_start_time',
                description: '填写开始日期',
              },
              {
                type: 'input',
                selector: '#legacy_end_time',
                fieldKey: 'field_2',
                stabilityKey: 'leave_end_time',
                description: '填写结束日期',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
      },
      ticket: {
        jumpUrl: 'http://127.0.0.1:8000/form',
      },
    } as any;
    const session = {
      sessionId: 'session-frame-scope',
      provider: 'stub',
      requestedProvider: 'stub',
      warnings: [],
      headless: true,
    } as any;
    const adapter = {
      provider: 'stub',
      initialize: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
      input: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.selector === '#legacy_start_time') {
          throw new Error('legacy start selector missing');
        }
        if (element?.selector === '#legacy_end_time') {
          throw new Error('legacy end selector should have been pre-aligned');
        }
        if (element?.selector === '[name=\"end_time_main\"]') {
          throw new Error('main-page end selector should not win over frame-scoped candidate');
        }
        return Promise.resolve();
      }),
      select: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      extract: jest.fn().mockResolvedValue(''),
      download: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    };

    (runtime as any).sessionManager.createSession = jest.fn().mockReturnValue(session);
    (runtime as any).sessionManager.getActiveTab = jest.fn().mockReturnValue(tab);
    (runtime as any).engineFactory.create = jest.fn().mockReturnValue({
      adapter,
      warnings: [],
    });
    (runtime as any).recoveryManager.attemptRecovery = jest.fn().mockImplementation(() => ({
      attempt: {
        stepIndex: 1,
        reason: 'legacy start selector missing',
        recovered: false,
        snapshotId: 'snapshot-frame-synthetic',
      },
      snapshot: {
        ...frameFormSnapshot,
        snapshotId: 'snapshot-frame-synthetic',
      },
    }));
    (runtime as any).stepRepairEngine.repair = jest.fn().mockResolvedValue({
      canRepair: true,
      repairedStep: {
        type: 'input',
        selector: '[name=\"start_time_frame\"]',
        fieldKey: 'field_1',
        stabilityKey: 'leave_start_time',
        target: {
          kind: 'element_ref',
          value: 'e2',
          label: '开始日期',
        },
        options: {
          __runtime: {
            repairedElementRole: 'input',
            preferredFrameUrl: childFrameUrl,
          },
        },
        description: '填写开始日期',
      },
      reasoning: ['repair start date field inside frame'],
      confidence: 0.9,
    });

    const result = await runtime.run({
      action: 'submit',
      flow: tab.flow,
      payload: tab.payload,
      runtime: tab.runtime,
      ticket: tab.ticket,
    } as any);

    expect(adapter.input).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        fieldKey: 'field_1',
        selector: '[name=\"start_time_frame\"]',
      }),
      '2026-04-21',
    );
    expect(adapter.input).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        fieldKey: 'field_2',
        selector: '[name=\"end_time_frame\"]',
        targetHints: expect.arrayContaining([
          expect.objectContaining({
            kind: 'element_ref',
            value: 'e4',
          }),
          expect.objectContaining({
            kind: 'url',
            value: childFrameUrl,
            label: 'scope:frame',
          }),
        ]),
      }),
      '2026-04-22',
    );
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({
        type: 'input',
        status: 'recovered',
        selector: '[name=\"start_time_frame\"]',
      }),
      expect.objectContaining({
        type: 'input',
        status: 'executed',
        selector: '[name=\"end_time_frame\"]',
        fieldKey: 'field_2',
      }),
    ]);
  });

  it('switches active scope to a newly opened dialog region after the page refreshes', async () => {
    const runtime = new BrowserTaskRuntime();
    const captureSnapshot = jest.spyOn(runtime as any, 'captureSnapshot');
    const startSnapshot = {
      snapshotId: 'snapshot-dialog-start',
      title: 'Start',
      url: 'http://127.0.0.1:8000/start',
      generatedAt: new Date().toISOString(),
      regions: [],
      tables: [],
      dialogs: [],
      importantTexts: ['Start'],
      structuredText: 'Start',
      forms: [],
      interactiveElements: [],
    };
    const formSnapshot = {
      snapshotId: 'snapshot-dialog-form',
      title: 'Leave Form',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [
        {
          id: 'main-form',
          role: 'main',
          name: 'Main Form',
          summary: 'Primary work area',
          elementRefs: ['open-dialog'],
        },
      ],
      tables: [],
      dialogs: [],
      importantTexts: ['Leave Form'],
      structuredText: 'Leave Form',
      forms: [],
      interactiveElements: [
        {
          ref: 'open-dialog',
          role: 'button',
          selector: '#open-comment-dialog',
          label: '填写审批意见',
          text: '填写审批意见',
          regionId: 'main-form',
        },
      ],
    };
    const dialogSnapshot = {
      snapshotId: 'snapshot-dialog-open',
      title: 'Leave Form',
      url: 'http://127.0.0.1:8000/form',
      generatedAt: new Date().toISOString(),
      regions: [
        {
          id: 'main-form',
          role: 'main',
          name: 'Main Form',
          summary: 'Primary work area',
          elementRefs: ['open-dialog', 'main-comment'],
        },
        {
          id: 'dialog-comment',
          role: 'dialog',
          name: '审批意见',
          summary: '请填写审批意见',
          elementRefs: ['dialog-comment-input'],
        },
      ],
      tables: [],
      dialogs: [
        {
          id: 'dialog-1',
          title: '审批意见',
          summary: '请填写审批意见',
        },
      ],
      importantTexts: ['审批意见'],
      structuredText: '审批意见',
      forms: [],
      interactiveElements: [
        {
          ref: 'open-dialog',
          role: 'button',
          selector: '#open-comment-dialog',
          label: '填写审批意见',
          text: '填写审批意见',
          regionId: 'main-form',
        },
        {
          ref: 'main-comment',
          role: 'input',
          selector: '[name=\"comment_main\"]',
          fieldKey: 'comment',
          label: '审批意见',
          regionId: 'main-form',
        },
        {
          ref: 'dialog-comment-input',
          role: 'input',
          selector: '[name=\"comment_dialog\"]',
          fieldKey: 'comment',
          label: '审批意见',
          regionId: 'dialog-comment',
        },
      ],
    };
    const afterCommentSnapshot = {
      ...dialogSnapshot,
      snapshotId: 'snapshot-dialog-after-input',
      importantTexts: ['审批意见', '已填写'],
    };
    captureSnapshot
      .mockResolvedValueOnce(startSnapshot)
      .mockResolvedValueOnce(formSnapshot)
      .mockResolvedValueOnce(dialogSnapshot)
      .mockResolvedValueOnce(afterCommentSnapshot)
      .mockResolvedValue(afterCommentSnapshot);

    const tab = {
      tabId: 'tab-dialog-scope',
      action: 'submit',
      url: 'about:blank',
      title: 'start',
      history: [],
      pageVersion: 0,
      payload: {
        formData: {
          comment: '请尽快处理',
        },
      },
      extractedValues: {},
      artifacts: {},
      uploads: [],
      flow: buildFlow({
        processCode: 'leave_request',
        processName: '请假申请',
        fields: [
          { key: 'comment', label: '审批意见', type: 'text', required: false },
        ],
        actions: {
          submit: {
            steps: [
              {
                type: 'goto',
                target: { kind: 'url', value: 'http://127.0.0.1:8000/form' },
                description: '打开表单',
              },
              {
                type: 'click',
                selector: '#open-comment-dialog',
                description: '打开审批意见弹窗',
              },
              {
                type: 'input',
                selector: '#legacy_comment',
                fieldKey: 'comment',
                description: '填写审批意见',
              },
            ],
          },
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'stub',
        headless: true,
      },
      ticket: {
        jumpUrl: 'http://127.0.0.1:8000/form',
      },
    } as any;
    const session = {
      sessionId: 'session-dialog-scope',
      provider: 'stub',
      requestedProvider: 'stub',
      warnings: [],
      headless: true,
    } as any;
    const adapter = {
      provider: 'stub',
      initialize: jest.fn().mockResolvedValue(undefined),
      dispose: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
      input: jest.fn().mockImplementation((_session, _tab, element) => {
        if (element?.selector === '#legacy_comment') {
          throw new Error('legacy comment selector missing');
        }
        if (element?.selector === '[name=\"comment_main\"]') {
          throw new Error('background page field should not beat dialog field');
        }
        return Promise.resolve();
      }),
      select: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      extract: jest.fn().mockResolvedValue(''),
      download: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
    };

    (runtime as any).sessionManager.createSession = jest.fn().mockReturnValue(session);
    (runtime as any).sessionManager.getActiveTab = jest.fn().mockReturnValue(tab);
    (runtime as any).engineFactory.create = jest.fn().mockReturnValue({
      adapter,
      warnings: [],
    });

    const result = await runtime.run({
      action: 'submit',
      flow: tab.flow,
      payload: tab.payload,
      runtime: tab.runtime,
      ticket: tab.ticket,
    } as any);

    expect(adapter.input).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        fieldKey: 'comment',
        selector: '[name=\"comment_dialog\"]',
        regionId: 'dialog-comment',
      }),
      '请尽快处理',
    );
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({ type: 'click', status: 'executed' }),
      expect.objectContaining({
        type: 'input',
        status: 'executed',
        selector: '[name=\"comment_dialog\"]',
        fieldKey: 'comment',
      }),
    ]);
  });
});

function buildFlow(overrides?: Partial<RpaFlowDefinition>): RpaFlowDefinition {
  return {
    processCode: 'expense_submit',
    processName: 'Expense Submit',
    fields: [
      {
        key: 'amount',
        label: '金额',
        type: 'text',
        required: true,
        selector: '#amount',
      },
    ],
    platform: {
      entryUrl: 'https://portal.example.com',
      targetSystem: 'expense-oa',
    },
    runtime: {
      executorMode: 'browser',
      browserProvider: 'stub',
      headless: true,
    },
    actions: {
      submit: {
        steps: [
          {
            type: 'goto',
            selector: 'body',
            description: 'Open page',
          },
          {
            type: 'input',
            selector: '#amount',
            fieldKey: 'amount',
            description: 'Fill amount',
          },
        ],
      },
      queryStatus: {
        steps: [
          {
            type: 'goto',
            selector: 'body',
            description: 'Open detail',
          },
          {
            type: 'extract',
            selector: '#status',
            fieldKey: 'status',
            description: 'Read status',
          },
        ],
      },
    },
    ...overrides,
  };
}
