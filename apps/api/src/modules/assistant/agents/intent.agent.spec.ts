import { IntentAgent } from './intent.agent';
import { ChatIntent } from '@uniflow/shared-types';

const ZH = {
  reimbursementTrip: '\u6211\u8981\u62a5\u9500\u5dee\u65c5\u8d39',
  requestProgress: '\u6211\u7684\u7533\u8bf7\u8fdb\u5ea6\u600e\u4e48\u6837\u4e86',
  leaveWhere: '\u6211\u7684\u8bf7\u5047\u7533\u8bf7\u5230\u54ea\u4e86',
  withdrawRequest: '\u6211\u8981\u64a4\u56de\u7533\u8bf7',
  reimbursementAmount: '\u6211\u8981\u62a5\u95001000\u5143',
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
    const result = await agent.detectIntent(ZH.reimbursementTrip, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.CREATE_SUBMISSION);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect query_status intent', async () => {
    const result = await agent.detectIntent(ZH.requestProgress, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.QUERY_STATUS);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should prefer query_status when query hints and flow keywords appear together', async () => {
    const result = await agent.detectIntent(ZH.leaveWhere, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.QUERY_STATUS);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect cancel intent', async () => {
    const result = await agent.detectIntent(ZH.withdrawRequest, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.CANCEL_SUBMISSION);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect English process phrases without relying on LLM', async () => {
    const result = await agent.detectIntent('I want to submit an expense application', {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.CREATE_SUBMISSION);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should extract amount from message', async () => {
    const result = await agent.detectIntent(ZH.reimbursementAmount, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.extractedEntities?.amount).toBe(1000);
  });

  it('should extract date from message', async () => {
    const result = await agent.detectIntent(ZH.dateValue, {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.extractedEntities?.date).toBe('2024-01-15');
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
