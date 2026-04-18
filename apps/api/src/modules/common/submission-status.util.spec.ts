import {
  getSubmissionStatusText,
  inferSubmissionCompletionKind,
  normalizeSubmissionStatus,
} from './submission-status.util';

describe('submission-status util', () => {
  it('detects draft completion from explicit metadata', () => {
    expect(inferSubmissionCompletionKind({
      metadata: {
        request: {
          completionKind: 'draft',
        },
      },
    })).toBe('draft');
  });

  it('detects draft completion from legacy endSaveDraft response bodies', () => {
    expect(inferSubmissionCompletionKind({
      metadata: {
        response: {
          data: '<script>parent.endSaveDraft(\"1\",\"2\",\"3\")</script>',
        },
      },
    })).toBe('draft');
  });

  it('normalizes persisted pending draft-save records to draft_saved', () => {
    const status = normalizeSubmissionStatus('pending', {
      submitResult: {
        metadata: {
          request: {
            completionKind: 'draft',
          },
        },
      },
    });

    expect(status).toBe('draft_saved');
    expect(getSubmissionStatusText(status)).toBe('已保存待发');
  });
});
