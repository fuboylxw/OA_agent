import type { BrowserSnapshotElement, RpaStepDefinition } from '@uniflow/shared-types';
import { ImageTargetMatcher } from './image-target-matcher';

interface ElementCacheRecord {
  nextRef: number;
  refByKey: Map<string, string>;
  elementByRef: Map<string, BrowserSnapshotElement>;
}

export class ElementRefCache {
  private readonly records = new Map<string, ElementCacheRecord>();
  private readonly imageTargetMatcher = new ImageTargetMatcher();

  cacheElements(sessionId: string, tabId: string, elements: BrowserSnapshotElement[]) {
    const record = this.getRecord(sessionId, tabId);
    return elements.map((element) => {
      const cacheKey = this.buildElementKey(element);
      const ref = record.refByKey.get(cacheKey) || `e${record.nextRef++}`;
      const normalized = {
        ...element,
        ref,
      };

      record.refByKey.set(cacheKey, ref);
      record.elementByRef.set(ref, normalized);
      return normalized;
    });
  }

  resolveElement(
    sessionId: string,
    tabId: string,
    step: RpaStepDefinition,
  ): BrowserSnapshotElement | undefined {
    const record = this.getRecord(sessionId, tabId);
    const elements = [...record.elementByRef.values()];

    const explicitTarget = step.target;
    if (explicitTarget?.kind === 'element_ref') {
      return record.elementByRef.get(explicitTarget.value);
    }

    if (explicitTarget?.kind === 'selector') {
      return elements.find((element) => element.selector === explicitTarget.value);
    }

    if (explicitTarget?.kind === 'text') {
      return elements.find((element) =>
        this.matchesText(element.text, explicitTarget.value) || this.matchesText(element.label, explicitTarget.value),
      );
    }

    if (explicitTarget?.kind === 'image') {
      const matched = this.imageTargetMatcher.match(explicitTarget, elements);
      return matched.score > 0 ? matched.element : undefined;
    }

    if (step.selector) {
      return elements.find((element) => element.selector === step.selector);
    }

    if (step.fieldKey) {
      return elements.find((element) => element.fieldKey === step.fieldKey);
    }

    return undefined;
  }

  private matchesText(left?: string, right?: string) {
    const normalizedLeft = String(left || '').trim().toLowerCase();
    const normalizedRight = String(right || '').trim().toLowerCase();
    return normalizedLeft.length > 0 && normalizedLeft.includes(normalizedRight);
  }
  private getRecord(sessionId: string, tabId: string) {
    const key = `${sessionId}:${tabId}`;
    const existing = this.records.get(key);
    if (existing) {
      return existing;
    }

    const created: ElementCacheRecord = {
      nextRef: 1,
      refByKey: new Map<string, string>(),
      elementByRef: new Map<string, BrowserSnapshotElement>(),
    };
    this.records.set(key, created);
    return created;
  }

  private buildElementKey(element: BrowserSnapshotElement) {
    const primaryHint = element.targetHints?.[0];
    return [
      element.role,
      element.selector || '',
      element.fieldKey || '',
      element.label || '',
      element.text || '',
      primaryHint?.kind || '',
      primaryHint?.value || '',
    ].join('|');
  }
}
