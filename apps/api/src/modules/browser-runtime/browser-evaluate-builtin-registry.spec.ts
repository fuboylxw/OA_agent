import * as vm from 'vm';
import { BrowserEvaluateBuiltinRegistry } from './browser-evaluate-builtin-registry';

describe('BrowserEvaluateBuiltinRegistry', () => {
  it('returns a syntactically valid capture_form_submit script without component-library hardcoded selectors', () => {
    const registry = new BrowserEvaluateBuiltinRegistry();
    const script = registry.resolve({
      type: 'evaluate',
      builtin: 'capture_form_submit',
    } as any);

    expect(() => new vm.Script(`(async function () {\n${script}\n})`)).not.toThrow();
    expect(script).not.toContain('cap4-');
    expect(script).not.toContain('.cap-field');
    expect(script).toContain('isAttachmentLikeElement');
    expect(script).toContain('isChoiceLikeElement');
    expect(script).toContain('findSemanticFieldRoot');
    expect(script).toContain('resolveRangeFieldAlternativeTarget');
    expect(script).toContain('looksLikeDateBoundaryLabel');
    expect(script).toContain('normalizeComparableLabel');
    expect(script).toContain('labelsRoughlyMatch');
    expect(script).toContain('findBindingContainer');
    expect(script).toContain('pickBestResolvedElementCandidate');
    expect(script).toContain('pickBestCapturedRequest');
  });
});
