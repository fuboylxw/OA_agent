import { ImageTargetMatcher } from './image-target-matcher';

describe('ImageTargetMatcher', () => {
  it('prefers elements with matching image hints', () => {
    const matcher = new ImageTargetMatcher();
    const result = matcher.match(
      {
        kind: 'image',
        value: 'submit-button.png',
        imageUrl: '/assets/submit-button.png',
      },
      [
        {
          ref: 'e1',
          role: 'button',
          label: '提交',
          selector: '#plain-submit',
        },
        {
          ref: 'e2',
          role: 'button',
          label: '提交',
          selector: '#image-submit',
          targetHints: [{
            kind: 'image',
            value: 'submit-button.png',
            imageUrl: '/assets/submit-button.png',
          }],
        },
      ],
    );

    expect(result.element?.ref).toBe('e2');
    expect(result.score).toBeGreaterThan(100);
  });
});
