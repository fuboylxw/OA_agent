import {
  BrowserUploadLocatorInferenceEngine,
  inferBrowserUploadLocatorHeuristically,
} from './browser-upload-locator';

describe('BrowserUploadLocatorInferenceEngine', () => {
  it('prefers the candidate whose request field name exactly matches the requested field key', () => {
    const result = inferBrowserUploadLocatorHeuristically({
      element: {
        ref: 'upload-1',
        fieldKey: 'seal_attachment',
        label: '用印附件',
      },
      labels: ['用印附件'],
      candidates: [
        {
          candidateId: 'scope-main:0',
          scopeDescription: 'page',
          scopeUrl: 'https://example.com/form',
          requestFieldName: 'other_attachment',
          nearbyText: '其他附件 上传',
          directMeta: 'other_attachment attach-file',
          fileInputCountInScope: 2,
        },
        {
          candidateId: 'scope-main:1',
          scopeDescription: 'page',
          scopeUrl: 'https://example.com/form',
          requestFieldName: 'seal_attachment',
          nearbyText: '用印附件 上传',
          directMeta: 'seal_attachment attach-file',
          fileInputCountInScope: 2,
        },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.matchedCandidateId).toBe('scope-main:1');
  });

  it('does not resolve from nearby text or label similarity without a protocol key match', () => {
    const result = inferBrowserUploadLocatorHeuristically({
      element: {
        ref: 'upload-1',
        label: '用印附件',
      },
      labels: ['用印附件'],
      candidates: [
        {
          candidateId: 'scope-main:0',
          scopeDescription: 'page',
          scopeUrl: 'https://example.com/form',
          requestFieldName: 'file_a',
          nearbyText: '用印附件 上传',
          directMeta: 'file_a attach-file',
          fileInputCountInScope: 1,
        },
      ],
    });

    expect(result.canResolve).toBe(false);
  });

  it('prefers the active frame candidate when upload fields are otherwise equivalent', () => {
    const childFrameUrl = 'https://example.com/frame/upload';
    const result = inferBrowserUploadLocatorHeuristically({
      element: {
        ref: 'upload-1',
        fieldKey: 'seal_attachment',
        label: '用印附件',
      },
      labels: ['用印附件'],
      preferredFrameUrl: childFrameUrl,
      candidates: [
        {
          candidateId: 'scope-main:0',
          scopeDescription: 'page',
          scopeUrl: 'https://example.com/form',
          requestFieldName: 'seal_attachment',
          nearbyText: '用印附件 上传',
          directMeta: 'seal_attachment attach-file',
          fileInputCountInScope: 1,
        },
        {
          candidateId: 'scope-frame:0',
          scopeDescription: `frame:${childFrameUrl}`,
          scopeUrl: childFrameUrl,
          requestFieldName: 'seal_attachment',
          nearbyText: '用印附件 上传',
          directMeta: 'seal_attachment attach-file',
          fileInputCountInScope: 1,
        },
      ],
    });

    expect(result.canResolve).toBe(true);
    expect(result.matchedCandidateId).toBe('scope-frame:0');
  });

  it('accepts a valid LLM result when heuristic evidence is weak', async () => {
    const fakeClient = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          canResolve: true,
          confidence: 0.83,
          reason: '附件字段名与附近说明最匹配',
          candidateId: 'scope-main:1',
          signals: ['nearby text matches upload label'],
        }),
        model: 'fake-upload-model',
        usage: {
          promptTokens: 120,
          completionTokens: 18,
          totalTokens: 138,
        },
      }),
    };

    const result = await new BrowserUploadLocatorInferenceEngine(fakeClient as any).infer({
      element: {
        ref: 'upload-1',
        label: '申请附件',
      },
      labels: ['申请附件'],
      candidates: [
        {
          candidateId: 'scope-main:0',
          requestFieldName: 'file_a',
          nearbyText: '图片上传',
          directMeta: 'file_a',
        },
        {
          candidateId: 'scope-main:1',
          requestFieldName: 'file_b',
          nearbyText: '申请附件',
          directMeta: 'file_b',
        },
      ],
    });

    expect(fakeClient.chat).toHaveBeenCalled();
    expect(result.canResolve).toBe(true);
    expect(result.source).toBe('llm');
    expect(result.matchedCandidateId).toBe('scope-main:1');
  });
});
