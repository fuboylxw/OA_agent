import {
  RuntimeJudgementEngine,
  inferExternalStatusHeuristically,
  inferSubmitOutcomeHeuristically,
  normalizeExternalSubmissionId,
} from './runtime-judgement';

describe('RuntimeJudgementEngine', () => {
  it('does not use text-pattern heuristics to label draft-only submit outcomes', () => {
    const result = inferSubmitOutcomeHeuristically({
      actionDefinition: {
        successAssert: {
          type: 'text',
          value: '已成功保存至待发列表',
        },
      },
      extractedValues: {
        message: '已成功保存至待发列表',
      },
      finalSnapshot: {
        snapshotId: 'snapshot-1',
        title: '保存成功',
        url: 'https://oa.example.com/leave',
        generatedAt: new Date().toISOString(),
        regions: [],
        forms: [],
        tables: [],
        dialogs: [],
        importantTexts: ['已成功保存至待发列表'],
        interactiveElements: [],
        structuredText: '已成功保存至待发列表',
      },
    });

    expect(result.outcome).toBe('submitted');
    expect(result.confirmed).toBe(true);
    expect(result.matchedDraftSignal).toBe(false);
  });

  it('allows llm to resolve ambiguous external status evidence', async () => {
    const engine = new RuntimeJudgementEngine({
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          mappedStatus: 'approved',
          confidence: 0.86,
          reason: 'The payload explicitly says approval completed',
          signals: ['completed approval'],
        }),
        model: 'test-model',
        usage: {
          promptTokens: 10,
          completionTokens: 4,
          totalTokens: 14,
        },
      }),
    } as any);

    const result = await engine.interpretExternalStatus({
      externalStatus: 'done',
      fallbackStatus: 'submitted',
      payload: {
        message: '审批完成，已通过',
      },
      source: 'webhook',
    });

    expect(result.mappedStatus).toBe('approved');
    expect(result.source).toBe('llm');
    expect(result.llmSucceeded).toBe(true);
    expect(result.model).toBe('test-model');
  });

  it('normalizes internal synthetic ids out of submit evidence', () => {
    expect(normalizeExternalSubmissionId('RPA-BROWSER-LEAVE-001')).toBeUndefined();
    expect(normalizeExternalSubmissionId('OA-LEAVE-001')).toBe('OA-LEAVE-001');
  });

  it('keeps strong heuristic terminal mapping without llm', () => {
    const result = inferExternalStatusHeuristically({
      externalStatus: 'revoked',
      fallbackStatus: 'submitted',
      source: 'status_poll',
    });

    expect(result.mappedStatus).toBe('cancelled');
    expect(result.source).toBe('heuristic');
  });
});
