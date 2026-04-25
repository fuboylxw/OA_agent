import { IntentAgent } from './intent.agent';
import { ChatIntent } from '@uniflow/shared-types';

const ZH = {
  createRequest: '\u5e2e\u6211\u53d1\u8d77\u4e00\u4e2a\u7533\u8bf7',
  requestProgress: '\u6211\u7684\u7533\u8bf7\u8fdb\u5ea6\u600e\u4e48\u6837\u4e86',
  leaveWhere: '\u6211\u7684\u8bf7\u5047\u7533\u8bf7\u5230\u54ea\u4e86',
  withdrawRequest: '\u6211\u8981\u64a4\u56de\u7533\u8bf7',
  createWithAmount: '\u6211\u8981\u63d0\u4ea4\u4e00\u4efd\u7533\u8bf7\uff0c\u91d1\u989d1000\u5143',
  dateValue: '\u65e5\u671f\u662f2024-01-15',
} as const;

describe('IntentAgent', () => {
  let agent: IntentAgent;

  beforeEach(() => {
    process.env.USE_LLM_FOR_INTENT = 'false';
    agent = new IntentAgent();
  });

  afterEach(() => {
    delete process.env.USE_LLM_FOR_INTENT;
  });

  it('should detect create_submission intent', async () => {
    const result = await agent.detectIntent(ZH.createRequest, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.UNKNOWN);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should detect query_status intent', async () => {
    const result = await agent.detectIntent(ZH.requestProgress, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.UNKNOWN);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should prefer query_status when query hints and flow keywords appear together', async () => {
    const result = await agent.detectIntent(ZH.leaveWhere, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.UNKNOWN);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should detect cancel intent', async () => {
    const result = await agent.detectIntent(ZH.withdrawRequest, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.UNKNOWN);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should detect English process phrases without relying on LLM', async () => {
    const result = await agent.detectIntent('I want to submit an expense application form', {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.UNKNOWN);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should not invent entities in conservative fallback mode', async () => {
    const result = await agent.detectIntent(ZH.createWithAmount, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.UNKNOWN);
    expect(result.extractedEntities).toEqual({});
  });

  it('should use llm result as the primary source when available', async () => {
    delete process.env.USE_LLM_FOR_INTENT;
    const llmAgent = new IntentAgent();
    (llmAgent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          intent: 'create_submission',
          confidence: 0.93,
          entities: {
            processCode: 'process_alpha',
            flowName: '流程A',
            date: '2024-01-15',
          },
        }),
      }),
    };

    const result = await llmAgent.detectIntent(ZH.dateValue, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.CREATE_SUBMISSION);
    expect(result.confidence).toBe(0.93);
    expect(result.extractedEntities).toEqual({
      flowCode: 'process_alpha',
      flowName: '流程A',
      date: '2024-01-15',
    });
  });

  it('should return unknown for unclear intent', async () => {
    const result = await agent.detectIntent('hello world', {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.UNKNOWN);
    expect(result.confidence).toBeLessThan(0.5);
  });
});
