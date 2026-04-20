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

  it('stabilizes free-text reason fields when the utterance contains a clear natural-language cause segment', async () => {
    const duplicatedReasonSchema = {
      fields: [
        { key: 'field_1', label: '开始日期', type: 'date', required: true },
        { key: 'field_2', label: '结束日期', type: 'date', required: true },
        { key: 'field_3', label: '请假类型', type: 'text', required: true },
        { key: 'field_4', label: '请假原因', type: 'textarea', required: true },
        { key: 'field_5', label: '请假事由', type: 'textarea', required: true },
        { key: 'field_6', label: '外出地点', type: 'text', required: true },
        { key: 'field_7', label: '外出通讯方式', type: 'text', required: true },
        { key: 'field_8', label: '请假时间', type: 'text', required: true },
      ],
    };

    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          extractedFields: {
            field_1: '明天',
            field_2: '2026-04-18',
            field_3: '事假',
            field_6: '北京',
            field_7: '13800138000',
          },
          missingFieldQuestions: {
            field_4: '请说明一下请假的具体原因是什么？',
            field_5: '可以详细描述一下请假的事由吗？',
            field_8: '请问具体的请假时间是几点到几点？',
          },
        }),
      }),
    };

    const result = await agent.extractFields(
      'leave_request',
      duplicatedReasonSchema,
      '我要请假，明天开始，请假三天，事假，去北京出差，联系电话13800138000',
    );

    expect(result.extractedFields.field_4).toBe('去北京出差');
    expect(result.extractedFields.field_5).toBe('去北京出差');
    expect(result.missingFields.map((field) => field.key)).toEqual(['field_8']);
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

  it('keeps field description and example in metadata only while keeping file upload questions concise', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    };

    const schema = {
      fields: [
        {
          key: 'seal_attachment',
          label: '用印附件',
          type: 'file',
          required: true,
          description: '请上传需要盖章的完整材料',
          example: '盖章申请表.pdf',
          multiple: true,
        },
      ],
    };

    const result = await agent.extractFields('expense_submit', schema, '我要申请用印');

    expect(result.missingFields).toHaveLength(1);
    expect(result.missingFields[0]).toMatchObject({
      key: 'seal_attachment',
      description: '请上传需要盖章的完整材料',
      example: '盖章申请表.pdf',
      multiple: true,
    });
    expect(result.missingFields[0].question).toBe('还需要上传用印附件。');
    expect(result.missingFields[0].question).not.toContain('说明：');
    expect(result.missingFields[0].question).not.toContain('示例：');
  });

  it('sanitizes structured labels for upload fields while keeping selectable fields options visible', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    };

    const schema = {
      fields: [
        {
          key: 'seal_attachment',
          label: '用印附件 | 说明: 上传需要盖章的文件 | 示例: 劳务合同.pdf | 上传要求: 支持上传多份，未上传视为信息缺失 | 可多选',
          type: 'file',
          required: true,
          multiple: true,
        },
        {
          key: 'seal_type',
          label: '印章类型',
          type: 'select',
          required: true,
          options: ['党委公章', '学校公章', '书记签名章'],
        },
      ],
    };

    const result = await agent.extractFields('expense_submit', schema, '我要申请用印');
    const attachmentField = result.missingFields.find((field) => field.key === 'seal_attachment');
    const sealTypeField = result.missingFields.find((field) => field.key === 'seal_type');

    expect(attachmentField).toMatchObject({
      label: '用印附件',
      question: '还需要上传用印附件。',
    });
    expect(attachmentField?.question).not.toContain('说明');
    expect(attachmentField?.question).not.toContain('示例');
    expect(sealTypeField?.question).toContain('可选项有：党委公章、学校公章、书记签名章');
  });

  it('normalizes multi-select values when the field is marked multiple even if the type is select', async () => {
    const schema = {
      fields: [
        {
          key: 'seal_types',
          label: '用印类型',
          type: 'select',
          required: true,
          multiple: true,
          options: ['党委公章', '学校公章', '书记签名章'],
        },
      ],
    };

    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          modifiedFields: {
            seal_types: '党委公章、学校公章',
          },
        }),
      }),
    };

    const result = await agent.extractModifications(
      'seal_apply',
      schema,
      '把用印类型改成党委公章、学校公章',
      {
        seal_types: ['党委公章'],
      },
    );

    expect(result.modifiedFields.seal_types).toEqual(['党委公章', '学校公章']);
    expect(agent.normalizeDirectFieldValue('seal_apply', schema, 'seal_types', '党委公章、学校公章')).toEqual(['党委公章', '学校公章']);
  });
});
