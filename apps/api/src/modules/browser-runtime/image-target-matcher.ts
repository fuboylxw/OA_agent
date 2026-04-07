import type { BrowserSnapshotElement, RpaTargetDefinition } from '@uniflow/shared-types';

export interface ImageTargetMatchResult {
  element?: BrowserSnapshotElement;
  score: number;
  reason?: string;
}

export class ImageTargetMatcher {
  match(target: RpaTargetDefinition, elements: BrowserSnapshotElement[]): ImageTargetMatchResult {
    let best: ImageTargetMatchResult = { score: 0 };

    for (const element of elements) {
      const result = this.scoreElement(target, element);
      if (result.score > best.score) {
        best = result;
      }
    }

    return best;
  }

  private scoreElement(target: RpaTargetDefinition, element: BrowserSnapshotElement): ImageTargetMatchResult {
    let score = 0;
    const reasons: string[] = [];
    const targetValue = this.normalize(target.value);
    const targetImageUrl = this.normalize(target.imageUrl);
    const targetLabel = this.normalize(target.label);
    const texts = [
      this.normalize(element.label),
      this.normalize(element.text),
      this.normalize(element.fieldKey),
      this.normalize(element.selector),
    ].filter(Boolean);

    for (const hint of element.targetHints || []) {
      const hintValue = this.normalize(hint.value);
      const hintUrl = this.normalize(hint.imageUrl);
      const hintLabel = this.normalize(hint.label);

      if (targetImageUrl && hintUrl && targetImageUrl === hintUrl) {
        score += 120;
        reasons.push('same-image-url');
      }

      if (targetValue && hintValue === targetValue) {
        score += 100;
        reasons.push('same-image-value');
      } else if (targetValue && hintValue && (hintValue.includes(targetValue) || targetValue.includes(hintValue))) {
        score += 70;
        reasons.push('similar-image-value');
      }

      if (targetLabel && hintLabel && (hintLabel === targetLabel || hintLabel.includes(targetLabel))) {
        score += 45;
        reasons.push('same-image-label');
      }
    }

    for (const text of texts) {
      if (!text) {
        continue;
      }

      if (targetValue && text === targetValue) {
        score += 35;
        reasons.push('same-element-text');
      } else if (targetValue && text.includes(targetValue)) {
        score += 20;
        reasons.push('similar-element-text');
      }

      if (targetLabel && text === targetLabel) {
        score += 25;
        reasons.push('same-target-label');
      }
    }

    if ((element.targetHints || []).some((hint) => hint.kind === 'image')) {
      score += 10;
      reasons.push('has-image-hint');
    }

    if (element.role === 'button' || element.role === 'link') {
      score += 5;
      reasons.push('interactive-image-container');
    }

    return {
      element,
      score,
      reason: reasons.join(','),
    };
  }

  private normalize(value: unknown) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }
}
