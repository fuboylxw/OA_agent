import { FormAgent } from './form.agent';

function addDays(date: Date, days: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextWeekday(date: Date, targetDay: number) {
  const currentDay = date.getDay();
  const offset = ((7 - currentDay + targetDay) % 7) + 7;
  return addDays(date, offset);
}

describe('FormAgent', () => {
  let agent: FormAgent;

  beforeEach(() => {
    agent = new FormAgent();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const leaveSchema = {
    fields: [
      { key: 'leave_type', label: 'leave_type', type: 'text', required: true },
      { key: 'start_time', label: 'start_time', type: 'text', required: true },
      { key: 'end_time', label: 'end_time', type: 'text', required: true },
      { key: 'reason', label: 'reason', type: 'text', required: true },
    ],
  };

  it('replaces raw field names with user-friendly labels in follow-up questions', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    };

    const result = await agent.extractFields('leave', leaveSchema, '我要请假');

    expect(result.missingFields.find((field) => field.key === 'leave_type')?.label).toBe('请假类型');
    expect(result.missingFields.find((field) => field.key === 'start_time')?.label).toBe('开始时间');
    expect(result.missingFields.find((field) => field.key === 'leave_type')?.question).not.toContain('leave_type');
    expect(result.missingFields.find((field) => field.key === 'start_time')?.question).not.toContain('start_time');
  });

  it('falls back to rules for relative dates, duration, and reason aliases', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    };

    const today = new Date();
    const result = await agent.extractFields(
      'leave',
      leaveSchema,
      '我要请假，明天开始，请假三天，理由是出去旅游',
    );

    expect(result.extractedFields.start_time).toBe(formatDate(addDays(today, 1)));
    expect(result.extractedFields.end_time).toBe(formatDate(addDays(today, 3)));
    expect(result.extractedFields.reason).toBe('出去旅游');
    expect(result.fieldOrigins.start_time).toBe('user');
    expect(result.fieldOrigins.end_time).toBe('derived');
    expect(result.missingFields).toHaveLength(1);
    expect(result.missingFields[0].key).toBe('leave_type');
  });

  it('normalizes llm extracted dates and string options before returning fields', async () => {
    const typedLeaveSchema = {
      fields: [
        { key: 'leaveType', label: '请假类型', type: 'select', required: true, options: ['年假', '病假', '事假'] },
        { key: 'startDate', label: '开始日期', type: 'date', required: true },
        { key: 'endDate', label: '结束日期', type: 'date', required: true },
        { key: 'reason', label: '请假原因', type: 'text', required: true },
      ],
    };

    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          extractedFields: {
            leaveType: '事假',
            startDate: '明天',
            endDate: '后天',
            reason: '出去旅游',
          },
          missingFieldQuestions: {},
        }),
      }),
    };

    const today = new Date();
    const result = await agent.extractFields(
      'leave_request',
      typedLeaveSchema,
      '明天开始，后天结束，事假，理由是出去旅游',
    );

    expect(result.extractedFields.leaveType).toBe('事假');
    expect(result.extractedFields.startDate).toBe(formatDate(addDays(today, 1)));
    expect(result.extractedFields.endDate).toBe(formatDate(addDays(today, 2)));
    expect(result.extractedFields.reason).toBe('出去旅游');
    expect(result.fieldOrigins.leaveType).toBe('user');
    expect(result.fieldOrigins.startDate).toBe('user');
    expect(result.missingFields).toHaveLength(0);
    expect(result.isComplete).toBe(true);
  });

  it('extracts modifications from llm output and normalizes changed values', async () => {
    const typedLeaveSchema = {
      fields: [
        { key: 'leaveType', label: '请假类型', type: 'select', required: true, options: ['年假', '病假', '事假'] },
        { key: 'startDate', label: '开始日期', type: 'date', required: true },
        { key: 'endDate', label: '结束日期', type: 'date', required: true },
        { key: 'reason', label: '请假原因', type: 'text', required: true },
      ],
    };

    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          modifiedFields: {
            leaveType: '年假',
            endDate: '下周一',
          },
        }),
      }),
    };

    const today = new Date();
    const current = {
      leaveType: '事假',
      startDate: '2026-03-26',
      endDate: '2026-03-28',
      reason: '出去旅游',
    };

    const result = await agent.extractModifications(
      'leave_request',
      typedLeaveSchema,
      '请假类型改成年假，结束时间改成下周一',
      current,
    );

    expect(result.modifiedFields.leaveType).toBe('年假');
    expect(result.modifiedFields.endDate).toBe(formatDate(nextWeekday(today, 1)));
    expect(result.fieldOrigins.leaveType).toBe('user');
    expect(result.fieldOrigins.endDate).toBe('user');
  });

  it('falls back to targeted modification rules and re-derives dependent dates', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    };

    const current = {
      leave_type: '事假',
      start_time: '2026-03-26',
      end_time: '2026-03-28',
      reason: '出去旅游',
    };

    const result = await agent.extractModifications(
      'leave',
      leaveSchema,
      '把开始时间提前一天，请假改三天',
      current,
    );

    expect(result.modifiedFields.start_time).toBe('2026-03-25');
    expect(result.modifiedFields.end_time).toBe('2026-03-27');
    expect(result.fieldOrigins.start_time).toBe('user');
    expect(result.fieldOrigins.end_time).toBe('derived');
  });

  it('prefers llm-generated user-facing questions when available', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          extractedFields: {},
          missingFieldQuestions: {
            leave_type: '请告诉我请假类型，例如年假、事假或病假',
          },
        }),
      }),
    };

    const result = await agent.extractFields('leave', leaveSchema, '我要请假');
    const leaveTypeField = result.missingFields.find((field) => field.key === 'leave_type');

    expect(leaveTypeField?.question).toBe('请告诉我请假类型，例如年假、事假或病假。');
    expect(leaveTypeField?.question).not.toContain('leave_type');
  });
});
