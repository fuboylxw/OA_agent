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
    const result = await agent.matchFlow(
      'create_submission',
      '我要申请差旅费报销',
      mockFlows,
    );

    expect(result.matchedFlow).toBeDefined();
    expect(result.matchedFlow?.processCode).toBe('travel_expense');
    expect(result.needsClarification).toBe(false);
  });

  it('should match flow by keyword', async () => {
    const result = await agent.matchFlow(
      'create_submission',
      '我要请假',
      mockFlows,
    );

    expect(result.matchedFlow).toBeDefined();
    expect(result.matchedFlow?.processCode).toBe('leave_request');
  });

  it('should request clarification for ambiguous input', async () => {
    const result = await agent.matchFlow(
      'create_submission',
      '我要办事',
      mockFlows,
    );

    expect(result.needsClarification).toBe(true);
    expect(result.clarificationQuestion).toBeDefined();
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
});
