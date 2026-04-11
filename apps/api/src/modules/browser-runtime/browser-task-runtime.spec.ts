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
        targetKind: 'image',
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
  it('skips a failed text navigation click when visible fields match semantically', async () => {
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

    expect(result.success).toBe(true);
    expect(result.executedSteps).toEqual([
      expect.objectContaining({ type: 'goto', status: 'executed' }),
      expect.objectContaining({ type: 'click', status: 'recovered', description: 'Click Leave Request' }),
      expect.objectContaining({ type: 'input', status: 'executed', fieldKey: 'field_1' }),
      expect.objectContaining({ type: 'click', status: 'executed', description: 'Click Submit' }),
    ]);
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
