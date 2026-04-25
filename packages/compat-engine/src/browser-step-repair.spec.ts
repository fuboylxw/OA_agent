import type { BrowserPageSnapshot } from '@uniflow/shared-types';
import { BrowserStepRepairEngine, inferBrowserStepRepairHeuristically } from './browser-step-repair';

describe('BrowserStepRepairEngine', () => {
  it('does not semantically rebind a failed field step without llm judgement', async () => {
    const snapshot = buildSnapshot([
      {
        ref: 'e1',
        role: 'input',
        selector: '[name="start_time"]',
        fieldKey: 'start_time',
        label: '开始日期',
      },
      {
        ref: 'e2',
        role: 'button',
        selector: '#submit',
        text: '提交',
        label: '提交',
      },
    ]);

    const result = await new BrowserStepRepairEngine(null).repair({
      step: {
        type: 'input',
        selector: '#field_1',
        fieldKey: 'field_1',
        description: '输入开始日期',
      },
      reason: 'unable to resolve selector',
      processCode: 'leave_request',
      processName: '请假申请',
      fields: [
        {
          key: 'field_1',
          label: '开始日期',
          type: 'date',
        },
      ],
      formData: {
        field_1: '2026-04-21',
      },
      snapshot,
    });

    expect(result.canRepair).toBe(false);
    expect(result.source).toBe('heuristic');
    expect(result.repairedStep).toBeUndefined();
  });

  it('keeps deterministic rebinding when fieldKey evidence is exact', async () => {
    const snapshot = buildSnapshot([
      {
        ref: 'e1',
        role: 'input',
        selector: '[name="field_1"]',
        fieldKey: 'field_1',
        label: '开始日期',
      },
    ]);

    const result = await new BrowserStepRepairEngine(null).repair({
      step: {
        type: 'input',
        selector: '#old-field',
        fieldKey: 'field_1',
        description: '输入开始日期',
      },
      reason: 'unable to resolve selector',
      fields: [
        {
          key: 'field_1',
          label: '开始日期',
          type: 'date',
        },
      ],
      snapshot,
    });

    expect(result.canRepair).toBe(true);
    expect(result.source).toBe('heuristic');
    expect(result.matchedElementRef).toBe('e1');
    expect(result.repairedStep?.selector).toBe('[name="field_1"]');
  });

  it('accepts a valid LLM repair when heuristic evidence is weak', async () => {
    const snapshot = buildSnapshot([
      {
        ref: 'e10',
        role: 'button',
        selector: '.workflow-send',
        text: '发送',
        label: '发送',
      },
      {
        ref: 'e11',
        role: 'button',
        selector: '.workflow-cancel',
        text: '取消',
        label: '取消',
      },
    ]);

    const fakeClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          canRepair: true,
          confidence: 0.84,
          reason: '发送按钮最符合提交语义',
          repairedTargetRef: 'e10',
          signals: ['按钮文本为发送'],
        }),
        model: 'fake-repair-model',
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
        },
      }),
    };

    const result = await new BrowserStepRepairEngine(fakeClient as any).repair({
      step: {
        type: 'click',
        selector: '#submit',
        description: '点击提交流程',
      },
      reason: 'selector not found',
      processCode: 'generic_submit',
      processName: 'Generic Submit',
      snapshot,
    });

    expect(fakeClient.chat).toHaveBeenCalled();
    expect(result.canRepair).toBe(true);
    expect(result.source).toBe('llm');
    expect(result.matchedElementRef).toBe('e10');
    expect(result.repairedStep?.selector).toBe('.workflow-send');
    expect(result.repairedStep?.target?.kind).toBe('element_ref');
    expect(result.repairedStep?.target?.value).toBe('e10');
  });

  it('prefers the concrete option element when the user selected a specific value', async () => {
    const result = inferBrowserStepRepairHeuristically({
      step: {
        type: 'select',
        fieldKey: 'seal_type',
        description: '勾选用印类型',
        target: {
          kind: 'text',
          value: '用印类型',
          label: '用印类型',
        },
      },
      reason: 'old selector not found',
      processCode: 'seal_apply',
      processName: '用印申请',
      fields: [
        {
          key: 'seal_type',
          label: '用印类型',
          type: 'select',
        },
      ],
      formData: {
        seal_type: '学校公章',
      },
      snapshot: buildSnapshot([
        {
          ref: 'e1',
          role: 'radio',
          selector: '#seal-school',
          fieldKey: 'seal_type',
          label: '学校公章',
          text: '学校公章',
        },
        {
          ref: 'e2',
          role: 'radio',
          selector: '#seal-finance',
          fieldKey: 'seal_type',
          label: '财务专用章',
          text: '财务专用章',
        },
      ]),
    });

    expect(result.canRepair).toBe(true);
    expect(result.matchedElementRef).toBe('e1');
    expect(result.repairedStep?.selector).toBe('#seal-school');
    expect((result.repairedStep?.options as any)?.__runtime?.repairedElementRole).toBe('radio');
  });

  it('refuses repair when only a weak ambiguous candidate exists', () => {
    const result = inferBrowserStepRepairHeuristically({
      step: {
        type: 'click',
        description: '点击继续',
      },
      reason: 'element missing',
      snapshot: buildSnapshot([
        {
          ref: 'e1',
          role: 'button',
          selector: '.secondary',
          text: '更多',
          label: '更多',
        },
      ]),
    });

    expect(result.canRepair).toBe(false);
    expect(result.repairedStep).toBeUndefined();
  });

  it('prefers candidates inside the active frame scope when multiple fields are otherwise equivalent', () => {
    const childFrameUrl = 'https://example.com/frame/approval';
    const result = inferBrowserStepRepairHeuristically({
      step: {
        type: 'input',
        fieldKey: 'field_2',
        description: '填写结束日期',
      },
      reason: 'old selector missing',
      processCode: 'leave_request',
      processName: '请假申请',
      fields: [
        {
          key: 'field_2',
          label: '结束日期',
          type: 'date',
        },
      ],
      formData: {
        field_2: '2026-04-22',
      },
      preferredFrameUrl: childFrameUrl,
      snapshot: buildSnapshot([
        {
          ref: 'main-end',
          role: 'input',
          selector: '[name="end_time_main"]',
          fieldKey: 'field_2',
          label: '结束日期',
        },
        {
          ref: 'frame-end',
          role: 'input',
          selector: '[name="end_time_frame"]',
          fieldKey: 'field_2',
          label: '结束日期',
          targetHints: [
            {
              kind: 'url',
              value: childFrameUrl,
              label: 'scope:frame',
            },
          ],
        },
      ]),
    });

    expect(result.canRepair).toBe(true);
    expect(result.matchedElementRef).toBe('frame-end');
    expect(result.repairedStep?.selector).toBe('[name="end_time_frame"]');
    expect((result.repairedStep?.options as any)?.__runtime?.preferredFrameUrl).toBe(childFrameUrl);
  });
});

function buildSnapshot(elements: BrowserPageSnapshot['interactiveElements']): BrowserPageSnapshot {
  return {
    snapshotId: 'snapshot-repair',
    title: '测试页面',
    url: 'https://example.com/form',
    generatedAt: new Date().toISOString(),
    regions: [],
    forms: [],
    tables: [],
    dialogs: [],
    importantTexts: ['测试表单'],
    structuredText: '测试表单',
    interactiveElements: elements,
  };
}
