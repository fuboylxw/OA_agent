import {
  normalizeAttachmentFileName,
  normalizeAttachmentRef,
} from './attachment.utils';

describe('attachment.utils', () => {
  it('repairs utf8 file names that were decoded as latin1', () => {
    expect(
      normalizeAttachmentFileName('å\u0088\u0098å\u0085´ä¼\u009F-18291622902-aiå¼\u0080å\u008F\u0091.pdf'),
    ).toBe('刘兴伟-18291622902-ai开发.pdf');
  });

  it('keeps already-correct utf8 file names unchanged', () => {
    expect(normalizeAttachmentFileName('西安工程大学用印申请单.pdf')).toBe('西安工程大学用印申请单.pdf');
  });

  it('normalizes attachment refs for display', () => {
    expect(
      normalizeAttachmentRef({
        attachmentId: 'att-1',
        fileId: 'att-1',
        fileName: 'å\u008F°ç­¾æ¨¡æ\u009D¿ - å\u008D\u0095ä¸ª.docx',
        fileSize: 1024,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toEqual(
      expect.objectContaining({
        attachmentId: 'att-1',
        fileName: '台签模板 - 单个.docx',
      }),
    );
  });
});
