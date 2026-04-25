import {
  inferOptionValueBindingHeuristically,
  OptionValueBindingInferenceEngine,
} from './option-value-binding';

describe('OptionValueBindingInferenceEngine', () => {
  it('resolves an exact single-select option value', () => {
    const result = inferOptionValueBindingHeuristically({
      submittedValue: '线上办理',
      field: {
        key: 'apply_mode',
        label: '办理方式',
        type: 'select',
      },
      options: [
        { label: '线下办理', value: 'offline' },
        { label: '线上办理', value: 'online' },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.resolvedValue).toBe('online');
  });

  it('refuses to resolve generic fragments that do not uniquely identify one option', () => {
    const result = inferOptionValueBindingHeuristically({
      submittedValue: '办理',
      field: {
        key: 'apply_mode',
        label: '办理方式',
        type: 'select',
      },
      options: [
        { label: '线下办理', value: 'offline' },
        { label: '线上办理', value: 'online' },
      ],
    });

    expect(result.canResolve).toBe(false);
  });

  it('resolves exact multi-select values conservatively', () => {
    const result = inferOptionValueBindingHeuristically({
      submittedValue: '党委公章、学校公章',
      field: {
        key: 'seal_types',
        label: '用印类型',
        type: 'checkbox',
        multiple: true,
      },
      options: [
        { label: '党委公章', value: '党委公章' },
        { label: '学校公章', value: '学校公章' },
        { label: '书记签名章', value: '书记签名章' },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.resolvedValue).toEqual(['党委公章', '学校公章']);
  });

  it('accepts a high-confidence llm override for natural aliases', async () => {
    const fakeClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          canResolve: true,
          confidence: 0.93,
          reason: '学校章 clearly refers to 学校公章 in this option set',
          resolvedValue: '学校公章',
          signals: ['candidate phrase is a natural alias of 学校公章'],
        }),
        model: 'fake-model',
        usage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
        },
      }),
    };

    const engine = new OptionValueBindingInferenceEngine(fakeClient as any);
    const result = await engine.infer({
      submittedValue: '学校章',
      userMessage: '把用印类型改成学校章',
      field: {
        key: 'seal_types',
        label: '用印类型',
        type: 'select',
      },
      options: [
        { label: '党委公章', value: '党委公章' },
        { label: '学校公章', value: '学校公章' },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.resolvedValue).toBe('学校公章');
    expect(result.llmSucceeded).toBe(true);
  });
});
