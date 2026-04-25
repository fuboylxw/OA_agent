import {
  NavigationTargetInferenceEngine,
  inferNavigationTargetHeuristically,
} from './navigation-target-inference';

describe('NavigationTargetInferenceEngine', () => {
  it('prefers the concrete business form page over portal and shell pages', () => {
    const result = inferNavigationTargetHeuristically({
      action: 'submit',
      portalUrl: 'https://portal.example.com/home',
      preferredOrigins: ['https://oa.example.com'],
      candidates: [
        {
          candidateId: 'preflight:0',
          url: 'https://portal.example.com/home',
          sourcePhase: 'preflight',
          stepIndex: 0,
        },
        {
          candidateId: 'preflight:1',
          url: 'https://oa.example.com/main.do',
          sourcePhase: 'preflight',
          stepIndex: 1,
        },
        {
          candidateId: 'submit:2',
          url: 'https://oa.example.com/seeyon/collaboration/collaboration.do?method=newColl&templateId=123',
          sourcePhase: 'submit',
          stepIndex: 2,
        },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.matchedCandidateId).toBe('submit:2');
  });

  it('prefers query-status pages for queryStatus actions', () => {
    const result = inferNavigationTargetHeuristically({
      action: 'queryStatus',
      portalUrl: 'https://portal.example.com/home',
      preferredOrigins: ['https://oa.example.com'],
      candidates: [
        {
          candidateId: 'submit:1',
          url: 'https://oa.example.com/form/new?templateId=12',
          sourcePhase: 'submit',
          stepIndex: 1,
        },
        {
          candidateId: 'queryStatus:2',
          url: 'https://oa.example.com/workflow/record/detail?recordId=991',
          sourcePhase: 'queryStatus',
          stepIndex: 2,
        },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.matchedCandidateId).toBe('queryStatus:2');
  });

  it('refuses to resolve when only auth and portal-shell pages are available', () => {
    const result = inferNavigationTargetHeuristically({
      action: 'submit',
      portalUrl: 'https://portal.example.com/home',
      preferredOrigins: ['https://oa.example.com'],
      candidates: [
        {
          candidateId: 'preflight:0',
          url: 'https://portal.example.com/home',
          sourcePhase: 'preflight',
          stepIndex: 0,
        },
        {
          candidateId: 'preflight:1',
          url: 'https://oa.example.com/login/sso?ticket=abc',
          sourcePhase: 'preflight',
          stepIndex: 1,
        },
      ],
    });

    expect(result.canResolve).toBe(false);
  });

  it('accepts a high-confidence llm override when heuristic candidates are ambiguous', async () => {
    const fakeClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          canResolve: true,
          confidence: 0.91,
          reason: 'candidate queryStatus:2 is the concrete record detail page',
          candidateId: 'queryStatus:2',
          signals: ['contains concrete record-detail hints'],
        }),
        model: 'fake-model',
        usage: {
          promptTokens: 11,
          completionTokens: 9,
          totalTokens: 20,
        },
      }),
    };

    const engine = new NavigationTargetInferenceEngine(fakeClient as any);
    const result = await engine.infer({
      action: 'queryStatus',
      portalUrl: 'https://portal.example.com/home',
      preferredOrigins: ['https://oa.example.com'],
      candidates: [
        {
          candidateId: 'queryStatus:1',
          url: 'https://oa.example.com/form/view?id=11',
          sourcePhase: 'queryStatus',
          stepIndex: 1,
        },
        {
          candidateId: 'queryStatus:2',
          url: 'https://oa.example.com/workflow/record/detail?id=11',
          sourcePhase: 'queryStatus',
          stepIndex: 2,
        },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.matchedCandidateId).toBe('queryStatus:2');
    expect(result.llmSucceeded).toBe(true);
  });

  it('refuses to resolve when candidates are distinguished only by path semantics', () => {
    const result = inferNavigationTargetHeuristically({
      action: 'queryStatus',
      portalUrl: 'https://portal.example.com/home',
      preferredOrigins: ['https://oa.example.com'],
      candidates: [
        {
          candidateId: 'queryStatus:1',
          url: 'https://oa.example.com/form/view?id=11',
          sourcePhase: 'queryStatus',
          stepIndex: 1,
        },
        {
          candidateId: 'queryStatus:2',
          url: 'https://oa.example.com/workflow/record/detail?id=11',
          sourcePhase: 'queryStatus',
          stepIndex: 1,
        },
      ],
    });

    expect(result.canResolve).toBe(false);
  });
});
