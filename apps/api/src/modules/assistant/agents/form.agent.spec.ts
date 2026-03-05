import { FormAgent } from './form.agent';

describe('FormAgent', () => {
  let agent: FormAgent;

  beforeEach(() => {
    agent = new FormAgent();
  });

  const mockSchema = {
    fields: [
      { key: 'amount', label: '金额', type: 'number', required: true },
      { key: 'reason', label: '事由', type: 'textarea', required: true },
      { key: 'date', label: '日期', type: 'date', required: true },
    ],
  };

  it('should extract number field', async () => {
    const result = await agent.extractFields(
      'travel_expense',
      mockSchema,
      '金额1000元',
    );

    expect(result.extractedFields.amount).toBe(1000);
  });

  it('should extract date field', async () => {
    const result = await agent.extractFields(
      'travel_expense',
      mockSchema,
      '日期2024-01-15',
    );

    expect(result.extractedFields.date).toBe('2024-01-15');
  });

  it('should identify missing required fields', async () => {
    const result = await agent.extractFields(
      'travel_expense',
      mockSchema,
      '金额1000元',
    );

    expect(result.isComplete).toBe(false);
    expect(result.missingFields.length).toBeGreaterThan(0);
    expect(result.missingFields.some(f => f.key === 'reason')).toBe(true);
  });

  it('should mark as complete when all fields filled', async () => {
    const result = await agent.extractFields(
      'travel_expense',
      mockSchema,
      '金额1000元 原因出差 日期2024-01-15',
      { amount: 1000, reason: '出差', date: '2024-01-15' },
    );

    expect(result.isComplete).toBe(true);
    expect(result.missingFields.length).toBe(0);
  });

  it('should generate appropriate questions for missing fields', async () => {
    const result = await agent.extractFields(
      'travel_expense',
      mockSchema,
      'hello',
    );

    expect(result.missingFields[0].question).toBeDefined();
    expect(result.missingFields[0].question).toContain('金额');
  });
});
