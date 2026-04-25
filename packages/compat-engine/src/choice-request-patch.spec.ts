import {
  ChoiceRequestPatchInferenceEngine,
  inferChoiceRequestPatchHeuristically,
} from './choice-request-patch';

describe('ChoiceRequestPatchInferenceEngine', () => {
  it('preserves observed boolean convention without calling llm', async () => {
    const fakeClient = {
      chat: jest.fn(),
    };

    const engine = new ChoiceRequestPatchInferenceEngine(fakeClient as any);
    const result = await engine.infer({
      submittedValue: true,
      currentValue: false,
      mapping: {
        label: '同意',
      },
    });

    expect(result.canResolve).toBe(true);
    expect(result.shouldSelect).toBe(true);
    expect(result.patchValue).toBe(true);
    expect(result.source).toBe('heuristic');
    expect(fakeClient.chat).not.toHaveBeenCalled();
  });

  it('maps user option text to checkbox paths only when it exactly matches declared options', () => {
    const result = inferChoiceRequestPatchHeuristically({
      submittedValue: ['党委公章'],
      currentValue: '',
      mapping: {
        label: '党委公章',
        optionAliases: ['党委公章'],
      },
      knownOptionAliases: ['党委公章', '学校公章'],
      siblingOptionCount: 2,
    });

    expect(result.canResolve).toBe(true);
    expect(result.shouldSelect).toBe(true);
    expect(result.patchValue).toBe('1');
  });

  it('still refuses free-text option guesses when submitted text does not exactly match declared options', () => {
    const result = inferChoiceRequestPatchHeuristically({
      submittedValue: ['帮我盖党委那个章'],
      currentValue: '',
      mapping: {
        label: '党委公章',
        optionAliases: ['党委公章'],
      },
      knownOptionAliases: ['党委公章', '学校公章'],
      siblingOptionCount: 2,
    });

    expect(result.canResolve).toBe(false);
    expect(result.patchValue).toBeUndefined();
  });

  it('refuses weak single-option guesses when there is no protocol evidence', () => {
    const result = inferChoiceRequestPatchHeuristically({
      submittedValue: true,
      currentValue: '',
      mapping: {
        label: '',
        optionAliases: [],
      },
      siblingOptionCount: 1,
    });

    expect(result.canResolve).toBe(false);
    expect(result.patchValue).toBeUndefined();
  });

  it('accepts a high-confidence llm override for ambiguous text conventions', async () => {
    const fakeClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          canResolve: true,
          shouldSelect: true,
          confidence: 0.92,
          reason: 'the target system uses YES/NO semantics for this path',
          patchValue: 'YES',
          signals: ['observed target value family is textual yes/no'],
        }),
        model: 'fake-model',
        usage: {
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
        },
      }),
    };

    const engine = new ChoiceRequestPatchInferenceEngine(fakeClient as any);
    const result = await engine.infer({
      submittedValue: true,
      currentValue: '',
      mapping: {
        label: '同意',
        optionAliases: ['同意'],
      },
      siblingOptionCount: 1,
    });

    expect(result.canResolve).toBe(true);
    expect(result.patchValue).toBe('YES');
    expect(result.source).toBe('mixed');
    expect(result.llmSucceeded).toBe(true);
  });
});
