import { FlowAgent } from './flow.agent';

jest.mock('@uniflow/agent-kernel', () => ({
  LLMClientFactory: {
    createFromEnv: () => ({
      chat: jest.fn().mockRejectedValue(new Error('LLM unavailable in test')),
    }),
  },
  LLMMessage: {},
}));

describe('FlowAgent', () => {
  let agent: FlowAgent;

  beforeEach(() => {
    agent = new FlowAgent();
  });

  const mockFlows = [
    { processCode: 'travel_expense', processName: '差旅费报销', processCategory: '财务' },
    { processCode: 'leave_request', processName: '请假申请', processCategory: '人事' },
    { processCode: 'purchase_request', processName: '采购申请', processCategory: '采购' },
  ];

  it('should match flow by exact name', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          matched: true,
          processCode: 'travel_expense',
          processName: '差旅费报销',
          confidence: 0.97,
        }),
      }),
    };

    const result = await agent.matchFlow('create_submission', '我要申请差旅费报销', mockFlows);

    expect(result.matchedFlow).toBeDefined();
    expect(result.matchedFlow?.processCode).toBe('travel_expense');
    expect(result.needsClarification).toBe(false);
  });

  it('should match flow by keyword', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          matched: true,
          processCode: 'leave_request',
          processName: '请假申请',
          confidence: 0.95,
        }),
      }),
    };

    const result = await agent.matchFlow('create_submission', '我要请假', mockFlows);

    expect(result.matchedFlow).toBeDefined();
    expect(result.matchedFlow?.processCode).toBe('leave_request');
    expect(result.needsClarification).toBe(false);
  });

  it('should only accept direct flow match when llm confidence is high enough', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          matched: true,
          processCode: 'leave_request',
          processName: '请假申请',
          confidence: 0.89,
        }),
      }),
    };

    const result = await agent.matchFlow('create_submission', '我要请假', mockFlows);

    expect(result.matchedFlow).toBeUndefined();
    expect(result.needsClarification).toBe(true);
  });

  it('should request clarification for ambiguous input', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          matched: false,
          candidateProcessCodes: ['travel_expense', 'leave_request'],
          clarificationQuestion: '您是想办理“差旅费报销”还是“请假申请”？',
        }),
      }),
    };

    const result = await agent.matchFlow('create_submission', '我要办事', mockFlows);

    expect(result.needsClarification).toBe(true);
    expect(result.clarificationQuestion).toContain('差旅费报销');
    expect(result.candidateFlows).toEqual([
      { processCode: 'travel_expense', processName: '差旅费报销' },
      { processCode: 'leave_request', processName: '请假申请' },
    ]);
  });

  it('should handle empty flow list', async () => {
    const result = await agent.matchFlow(
      'create_submission',
      '我要报销',
      [],
    );

    expect(result.needsClarification).toBe(true);
    expect(result.clarificationQuestion).toContain('没有可用的流程');
  });

  it('should conservatively match a single available flow when llm is unavailable', async () => {
    const result = await agent.matchFlow(
      'create_submission',
      '我要办理流程',
      [{ processCode: 'travel_expense', processName: '差旅费报销', processCategory: '财务' }],
    );

    expect(result.needsClarification).toBe(false);
    expect(result.matchedFlow?.processCode).toBe('travel_expense');
  });

  it('should not match by mere substring inclusion in fallback mode', async () => {
    const result = await agent.matchFlow(
      'create_submission',
      '我想了解请假申请的审批规则',
      mockFlows,
    );

    expect(result.needsClarification).toBe(true);
    expect(result.matchedFlow).toBeUndefined();
  });

  it('should match when the user explicitly quotes the process name itself in fallback mode', async () => {
    const result = await agent.matchFlow(
      'create_submission',
      '请帮我办理“请假申请”',
      mockFlows,
    );

    expect(result.needsClarification).toBe(false);
    expect(result.matchedFlow?.processCode).toBe('leave_request');
  });

  it('should match an explicit process code in fallback mode', async () => {
    const result = await agent.matchFlow(
      'create_submission',
      '流程编码 leave_request',
      mockFlows,
    );

    expect(result.needsClarification).toBe(false);
    expect(result.matchedFlow?.processCode).toBe('leave_request');
  });
});
