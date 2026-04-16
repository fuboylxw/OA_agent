import { confirmRpaSubmit, normalizeExternalSubmissionId } from './rpa-submit-confirmation.util';

describe('rpa-submit-confirmation.util', () => {
  it('confirms submit when a real submission id is extracted', () => {
    const result = confirmRpaSubmit({
      actionDefinition: {
        steps: [],
      },
      extractedValues: {
        submissionId: 'OA-20260415-001',
        message: '提交成功',
      },
      finalSnapshot: {
        snapshotId: 'snapshot-1',
        title: '提交成功',
        url: 'https://oa.example.com/apply',
        generatedAt: new Date().toISOString(),
        regions: [],
        forms: [],
        tables: [],
        dialogs: [],
        importantTexts: ['提交成功', '审批中'],
        interactiveElements: [],
        structuredText: '申请已提交，审批中',
      },
    });

    expect(result).toMatchObject({
      confirmed: true,
      submissionId: 'OA-20260415-001',
      matchedDraftSignal: false,
    });
  });

  it('rejects draft/save-only signals even if successAssert text is present', () => {
    const result = confirmRpaSubmit({
      actionDefinition: {
        steps: [],
        successAssert: {
          type: 'text',
          value: '已成功保存至待发列表',
        },
      },
      extractedValues: {
        message: '已成功保存至待发列表',
      },
      finalSnapshot: {
        snapshotId: 'snapshot-2',
        title: '保存成功',
        url: 'https://oa.example.com/apply',
        generatedAt: new Date().toISOString(),
        regions: [],
        forms: [],
        tables: [],
        dialogs: [],
        importantTexts: ['已成功保存至待发列表'],
        interactiveElements: [],
        structuredText: '已成功保存至待发列表',
      },
    });

    expect(result).toMatchObject({
      confirmed: false,
      matchedDraftSignal: true,
      matchedSuccessAssert: true,
    });
    expect(result.failureReason).toContain('未真正送审');
  });

  it('filters internal synthetic submission ids', () => {
    expect(normalizeExternalSubmissionId('VISION-LEAVE-001')).toBeUndefined();
    expect(normalizeExternalSubmissionId('RPA-BROWSER-LEAVE-001')).toBeUndefined();
    expect(normalizeExternalSubmissionId('OA-LEAVE-001')).toBe('OA-LEAVE-001');
  });
});
