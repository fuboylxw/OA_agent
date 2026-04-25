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

    expect(result.missingFields.find((field) => field.key === 'leave_type')?.label).toBe('leave type');
    expect(result.missingFields.find((field) => field.key === 'start_time')?.label).toBe('start time');
    expect(result.missingFields.find((field) => field.key === 'leave_type')?.question).not.toContain('leave_type');
    expect(result.missingFields.find((field) => field.key === 'start_time')?.question).not.toContain('start_time');
  });

  it('does not use regex fallback for natural-language field extraction when llm is unavailable', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    };

    const genericSchema = {
      fields: [
        { key: 'request_kind', label: '申请类型', type: 'select', required: true, options: ['事假', '病假', '年假'] },
        { key: 'start_time', label: '开始时间', type: 'date', required: true },
        { key: 'end_time', label: '结束时间', type: 'date', required: true },
        { key: 'reason', label: '事由', type: 'text', required: true },
      ],
    };
    const result = await agent.extractFields(
      'generic_request',
      genericSchema,
      '我要提交申请，申请类型是事假，开始时间是明天，事由是出去旅游',
    );

    expect(result.extractedFields).toEqual({});
    expect(result.fieldOrigins).toEqual({});
    expect(result.missingFields.map((field) => field.key)).toEqual([
      'request_kind',
      'start_time',
      'end_time',
      'reason',
    ]);
  });

  it('accepts llm duplication when one user expression should populate multiple fields', async () => {
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
            field_4: '去北京出差',
            field_5: '去北京出差',
            field_6: '北京',
            field_7: '13800138000',
          },
          missingFieldQuestions: {
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

  it('does not use regex fallback for natural-language modifications when llm is unavailable', async () => {
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
      '把开始时间提前一天，结束时间改成2026-03-27',
      current,
    );

    expect(result.modifiedFields).toEqual({});
    expect(result.fieldOrigins).toEqual({});
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

  it('keeps file-field question concise while retaining description/example in metadata', async () => {
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
    expect(result.missingFields[0].question).toContain('还需要上传用印附件');
    expect(result.missingFields[0].question).toContain('支持上传多份文件');
    expect(result.missingFields[0].question).not.toContain('说明：');
    expect(result.missingFields[0].question).not.toContain('示例：');
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

  it('does not use regex fallback for option modifications when llm is unavailable', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    };

    const schema = {
      fields: [
        {
          key: 'apply_mode',
          label: '办理方式',
          type: 'select',
          required: true,
          options: ['线下办理', '线上办理'],
        },
        {
          key: 'remark',
          label: '备注',
          type: 'text',
          required: false,
        },
      ],
    };

    const result = await agent.extractModifications(
      'generic_apply',
      schema,
      '把办理方式改成线上办理，备注改成线下办理',
      {
        apply_mode: '线下办理',
        remark: '旧备注',
      },
    );

    expect(result.modifiedFields).toEqual({});
  });

  it('keeps option normalization conservative and does not fuzzy-map generic fragments', () => {
    const schema = {
      fields: [
        {
          key: 'seal_types',
          label: '用印类型',
          type: 'select',
          required: true,
          options: ['党委公章', '学校公章', '书记签名章'],
        },
      ],
    };

    expect(agent.normalizeDirectFieldValue('seal_apply', schema, 'seal_types', '公章')).toBeUndefined();
  });

  it('includes options in missing-field prompts and metadata for option-like fields', async () => {
    (agent as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    };

    const schema = {
      fields: [
        {
          key: 'seal_types',
          label: '用印类型',
          type: 'checkbox',
          required: true,
          multiple: true,
          options: ['党委公章', '学校公章', '书记签名章'],
        },
      ],
    };

    const result = await agent.extractFields('seal_apply', schema, '我要申请用印');

    expect(result.missingFields).toHaveLength(1);
    expect(result.missingFields[0]).toMatchObject({
      key: 'seal_types',
      type: 'checkbox',
      multiple: true,
      options: [
        { label: '党委公章', value: '党委公章' },
        { label: '学校公章', value: '学校公章' },
        { label: '书记签名章', value: '书记签名章' },
      ],
    });
    expect(result.missingFields[0].question).toContain('可选项有：党委公章、学校公章、书记签名章');
  });

  it('does not treat a process name mention as a field value when llm follows conservative extraction', async () => {
    const schema = {
      fields: [
        {
          key: 'seal_types',
          label: '用印类型',
          type: 'checkbox',
          required: true,
          multiple: true,
          options: ['党委公章', '学校公章', '书记签名章'],
        },
        {
          key: 'file_summary',
          label: '文件类型、名称及份数',
          type: 'textarea',
          required: true,
        },
      ],
    };

    (agent as any).llmClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          extractedFields: {},
          missingFieldQuestions: {
            seal_types: '请问您需要哪些用印类型？',
            file_summary: '请提供文件类型、名称及份数。',
          },
        }),
      }),
    };

    const result = await agent.extractFields(
      'seal_apply',
      schema,
      '我要办理西安工程大学用印申请单',
    );

    expect(result.extractedFields).toEqual({});
    expect(result.missingFields.map((field) => field.key)).toEqual([
      'seal_types',
      'file_summary',
    ]);
  });
});
