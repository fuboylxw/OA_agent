import { Injectable } from '@nestjs/common';
import type {
  BrowserPageSnapshot,
  BrowserSnapshotElement,
  BrowserSnapshotElementRole,
  RpaStepDefinition,
} from '@uniflow/shared-types';
import { ImageTargetMatcher } from '../browser-runtime/image-target-matcher';

export interface ResolvedVisionTarget {
  element?: BrowserSnapshotElement;
  strategy: 'element_ref' | 'selector' | 'field_key' | 'text' | 'image' | 'description' | 'none';
  score: number;
  reason?: string;
}

@Injectable()
export class VisionTargetResolver {
  private readonly imageTargetMatcher = new ImageTargetMatcher();

  resolve(step: RpaStepDefinition, snapshot?: BrowserPageSnapshot): ResolvedVisionTarget {
    const elements = snapshot?.interactiveElements || [];
    if (elements.length === 0) {
      return {
        strategy: 'none',
        score: 0,
        reason: 'snapshot_has_no_interactive_elements',
      };
    }

    const explicitTarget = step.target;
    if (explicitTarget?.kind === 'element_ref') {
      const matched = elements.find((element) => element.ref === explicitTarget.value);
      return matched
        ? { element: matched, strategy: 'element_ref', score: 150, reason: 'matched_by_element_ref' }
        : { strategy: 'none', score: 0, reason: `element_ref_not_found:${explicitTarget.value}` };
    }

    if (explicitTarget?.kind === 'selector') {
      return this.resolveBySelector(explicitTarget.value, elements);
    }

    if (explicitTarget?.kind === 'image') {
      const imageMatched = this.imageTargetMatcher.match(explicitTarget, elements);
      if (imageMatched.element && imageMatched.score > 0) {
        return {
          element: imageMatched.element,
          strategy: 'image',
          score: imageMatched.score,
          reason: imageMatched.reason || 'matched_by_image_target',
        };
      }

      const textFallback = this.resolveByText(
        explicitTarget.label || explicitTarget.value,
        elements,
        this.preferredRoles(step),
        'image_text_fallback',
      );
      if (textFallback.element) {
        return textFallback;
      }

      return {
        strategy: 'none',
        score: 0,
        reason: imageMatched.reason || `image_target_not_found:${explicitTarget.value}`,
      };
    }

    if (explicitTarget?.kind === 'text') {
      const textMatched = this.resolveByText(
        explicitTarget.label || explicitTarget.value,
        elements,
        this.preferredRoles(step),
        'target_text',
      );
      if (textMatched.element) {
        return textMatched;
      }
    }

    if (step.selector) {
      const selectorMatched = this.resolveBySelector(step.selector, elements);
      if (selectorMatched.element) {
        return selectorMatched;
      }
    }

    if (step.fieldKey) {
      const fieldKeyMatched = this.resolveByFieldKey(step.fieldKey, elements, this.preferredRoles(step));
      if (fieldKeyMatched.element) {
        return fieldKeyMatched;
      }
    }

    if (step.description) {
      const descriptionMatched = this.resolveByText(
        step.description,
        elements,
        this.preferredRoles(step),
        'step_description',
      );
      if (descriptionMatched.element) {
        return descriptionMatched;
      }
    }

    return {
      strategy: 'none',
      score: 0,
      reason: `no_target_match_for_step:${step.type}`,
    };
  }

  private resolveBySelector(selector: string, elements: BrowserSnapshotElement[]): ResolvedVisionTarget {
    const normalizedSelector = this.normalize(selector);
    const exact = elements.find((element) => this.normalize(element.selector) === normalizedSelector);
    if (exact) {
      return {
        element: exact,
        strategy: 'selector',
        score: 140,
        reason: 'matched_exact_selector',
      };
    }

    const partial = elements.find((element) => this.normalize(element.selector).includes(normalizedSelector));
    if (partial) {
      return {
        element: partial,
        strategy: 'selector',
        score: 110,
        reason: 'matched_partial_selector',
      };
    }

    return {
      strategy: 'none',
      score: 0,
      reason: `selector_not_found:${selector}`,
    };
  }

  private resolveByFieldKey(
    fieldKey: string,
    elements: BrowserSnapshotElement[],
    preferredRoles: BrowserSnapshotElementRole[],
  ): ResolvedVisionTarget {
    const normalizedFieldKey = this.normalize(fieldKey);
    let best: ResolvedVisionTarget = { strategy: 'none', score: 0, reason: `field_key_not_found:${fieldKey}` };

    for (const element of elements) {
      const candidateKey = this.normalize(element.fieldKey);
      if (!candidateKey) {
        continue;
      }

      let score = 0;
      if (candidateKey === normalizedFieldKey) {
        score += 130;
      } else if (candidateKey.includes(normalizedFieldKey) || normalizedFieldKey.includes(candidateKey)) {
        score += 95;
      }

      if (score === 0) {
        continue;
      }

      score += this.roleBonus(element.role, preferredRoles);
      if (score > best.score) {
        best = {
          element,
          strategy: 'field_key',
          score,
          reason: 'matched_by_field_key',
        };
      }
    }

    return best;
  }

  private resolveByText(
    text: string,
    elements: BrowserSnapshotElement[],
    preferredRoles: BrowserSnapshotElementRole[],
    reasonPrefix: string,
  ): ResolvedVisionTarget {
    const normalizedText = this.normalize(text);
    if (!normalizedText) {
      return {
        strategy: 'none',
        score: 0,
        reason: `${reasonPrefix}:empty_text`,
      };
    }

    let best: ResolvedVisionTarget = { strategy: 'none', score: 0, reason: `${reasonPrefix}:not_found` };

    for (const element of elements) {
      const texts = [
        this.normalize(element.label),
        this.normalize(element.text),
        this.normalize(element.fieldKey),
        this.normalize(element.selector),
      ].filter(Boolean);

      let score = 0;
      for (const candidate of texts) {
        if (candidate === normalizedText) {
          score = Math.max(score, 120);
        } else if (candidate.includes(normalizedText) || normalizedText.includes(candidate)) {
          score = Math.max(score, 85);
        } else if (this.tokenOverlap(candidate, normalizedText) > 0) {
          score = Math.max(score, 65);
        }
      }

      if (score === 0) {
        continue;
      }

      score += this.roleBonus(element.role, preferredRoles);
      if (element.bounds) {
        score += 3;
      }

      if (score > best.score) {
        best = {
          element,
          strategy: reasonPrefix === 'step_description' ? 'description' : 'text',
          score,
          reason: `${reasonPrefix}:matched`,
        };
      }
    }

    return best;
  }

  private preferredRoles(step: RpaStepDefinition): BrowserSnapshotElementRole[] {
    switch (step.type) {
      case 'click':
        return ['button', 'link', 'checkbox', 'radio'];
      case 'input':
        return ['input', 'textarea'];
      case 'select':
        return ['select', 'radio'];
      case 'upload':
        return ['upload', 'button'];
      case 'extract':
        return ['status', 'text', 'input', 'textarea', 'select', 'link'];
      case 'download':
        return ['link', 'button'];
      default:
        return [];
    }
  }

  private roleBonus(
    role: BrowserSnapshotElementRole | undefined,
    preferredRoles: BrowserSnapshotElementRole[],
  ) {
    if (!role || preferredRoles.length === 0) {
      return 0;
    }
    if (preferredRoles.includes(role)) {
      return 18;
    }
    if (role === 'unknown') {
      return 0;
    }
    return 4;
  }

  private tokenOverlap(left: string, right: string) {
    const leftTokens = left.split(/[\s_\-:.#/]+/).filter(Boolean);
    const rightTokens = new Set(right.split(/[\s_\-:.#/]+/).filter(Boolean));
    return leftTokens.filter((token) => rightTokens.has(token)).length;
  }

  private normalize(value: unknown) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }
}
