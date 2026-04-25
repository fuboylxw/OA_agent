import {
  AttachmentFieldBindingInferenceEngine,
  inferAttachmentFieldBindingHeuristically,
} from './attachment-field-binding';

describe('AttachmentFieldBindingInferenceEngine', () => {
  it('binds to the only available file field', () => {
    const result = inferAttachmentFieldBindingHeuristically({
      userMessage: '已上传附件',
      attachment: {
        fileName: 'seal.pdf',
      },
      candidates: [
        {
          fieldKey: 'field_2',
          label: '申请附件',
          required: true,
          missing: true,
        },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.matchedFieldKey).toBe('field_2');
  });

  it('binds to the only missing file field when others are already satisfied', () => {
    const result = inferAttachmentFieldBindingHeuristically({
      userMessage: '我已上传发票附件',
      attachment: {
        fileName: '差旅发票.pdf',
      },
      candidates: [
        {
          fieldKey: 'project_attachment',
          label: '立项材料',
          description: '上传立项申请书扫描件',
          example: '立项申请书.pdf',
          required: true,
          missing: false,
        },
        {
          fieldKey: 'invoice_attachment',
          label: '发票附件',
          description: '上传报销发票扫描件',
          example: '发票.pdf',
          required: true,
          missing: true,
        },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.matchedFieldKey).toBe('invoice_attachment');
  });

  it('refuses to resolve when only the user message mentions one candidate label', () => {
    const result = inferAttachmentFieldBindingHeuristically({
      userMessage: '我已上传发票附件',
      attachment: {
        fileName: '差旅发票.pdf',
      },
      candidates: [
        {
          fieldKey: 'project_attachment',
          label: '立项材料',
          description: '上传立项申请书扫描件',
          example: '立项申请书.pdf',
          required: true,
          missing: true,
        },
        {
          fieldKey: 'invoice_attachment',
          label: '发票附件',
          description: '上传报销发票扫描件',
          example: '发票.pdf',
          required: true,
          missing: true,
        },
      ],
    });

    expect(result.canResolve).toBe(false);
  });

  it('refuses to resolve when evidence is too ambiguous', () => {
    const result = inferAttachmentFieldBindingHeuristically({
      userMessage: '已上传文件',
      attachment: {
        fileName: 'document.pdf',
      },
      candidates: [
        {
          fieldKey: 'field_a',
          label: '申请附件',
          required: true,
          missing: true,
        },
        {
          fieldKey: 'field_b',
          label: '补充附件',
          required: true,
          missing: true,
        },
      ],
    });

    expect(result.canResolve).toBe(false);
  });

  it('accepts a high-confidence llm override for ambiguous cases', async () => {
    const fakeClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          canResolve: true,
          confidence: 0.93,
          reason: 'the attachment clearly matches the invoice field',
          fieldKey: 'invoice_attachment',
          signals: ['filename and user message both mention invoice'],
        }),
        model: 'fake-model',
        usage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
        },
      }),
    };

    const engine = new AttachmentFieldBindingInferenceEngine(fakeClient as any);
    const result = await engine.infer({
      userMessage: '已上传票据',
      attachment: {
        fileName: '票据图片.png',
      },
      candidates: [
        {
          fieldKey: 'proof_attachment',
          label: '证明附件',
          missing: true,
        },
        {
          fieldKey: 'invoice_attachment',
          label: '票据附件',
          missing: true,
        },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.matchedFieldKey).toBe('invoice_attachment');
    expect(result.llmSucceeded).toBe(true);
  });
});
