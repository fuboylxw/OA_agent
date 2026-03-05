import { IntentAgent } from './intent.agent';
import { ChatIntent } from '@uniflow/shared-types';

describe('IntentAgent', () => {
  let agent: IntentAgent;

  beforeEach(() => {
    agent = new IntentAgent();
  });

  it('should detect create_submission intent', async () => {
    const result = await agent.detectIntent('我要报销差旅费', {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.CREATE_SUBMISSION);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect query_status intent', async () => {
    const result = await agent.detectIntent('我的申请进度怎么样了', {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.QUERY_STATUS);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should detect cancel intent', async () => {
    const result = await agent.detectIntent('我要撤回申请', {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.intent).toBe(ChatIntent.CANCEL_SUBMISSION);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should extract amount from message', async () => {
    const result = await agent.detectIntent('我要报销1000元', {
      userId: 'test-user',
      tenantId: 'test-tenant',
      sessionId: 'test-session',
    });

    expect(result.extractedEntities?.amount).toBe(1000);
  });

  it('should extract date from message', async () => {
    const result = await agent.detectIntent('日期是2024-01-15', {
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
