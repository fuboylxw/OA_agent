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
          browserProvider: 'playwright',
        },
      }),
      runtime: {
        executorMode: 'browser',
        browserProvider: 'playwright',
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
    expect(result.requestedProvider).toBe('playwright');
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'browser_provider_fallback',
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
