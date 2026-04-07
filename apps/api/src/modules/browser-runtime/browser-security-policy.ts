import type { BrowserPageSnapshot, RpaStepDefinition } from '@uniflow/shared-types';

const UNSAFE_URL_PATTERN = /^(javascript|data|file):/i;

export class BrowserSecurityPolicy {
  sanitizeText(value: unknown, maxLength = 240) {
    const normalized = String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return '';
    }

    return normalized.slice(0, maxLength);
  }

  sanitizeUrl(value: string | undefined) {
    const url = this.sanitizeText(value, 500);
    if (!url) {
      return 'about:blank';
    }
    if (UNSAFE_URL_PATTERN.test(url)) {
      throw new Error(`Blocked unsafe URL: ${url}`);
    }
    return url;
  }

  assertStepAllowed(step: RpaStepDefinition) {
    const targetUrl = step.type === 'goto'
      ? step.target?.value || step.value || step.selector
      : undefined;

    if (targetUrl) {
      this.sanitizeUrl(targetUrl);
    }
  }

  sanitizeSnapshot(snapshot: BrowserPageSnapshot): BrowserPageSnapshot {
    return {
      ...snapshot,
      title: this.sanitizeText(snapshot.title, 160),
      url: this.sanitizeUrl(snapshot.url),
      regions: snapshot.regions.map((region) => ({
        ...region,
        name: this.sanitizeText(region.name, 120),
        summary: this.sanitizeText(region.summary, 240),
      })),
      forms: snapshot.forms.map((form) => ({
        ...form,
        name: this.sanitizeText(form.name, 120),
        fields: form.fields.map((field) => ({
          ...field,
          label: this.sanitizeText(field.label, 120),
        })),
      })),
      tables: snapshot.tables.map((table) => ({
        ...table,
        name: this.sanitizeText(table.name, 120),
        summary: this.sanitizeText(table.summary, 240),
      })),
      dialogs: snapshot.dialogs.map((dialog) => ({
        ...dialog,
        title: this.sanitizeText(dialog.title, 120),
        summary: this.sanitizeText(dialog.summary, 240),
      })),
      importantTexts: snapshot.importantTexts
        .map((text) => this.sanitizeText(text, 240))
        .filter(Boolean),
      interactiveElements: snapshot.interactiveElements.map((element) => ({
        ...element,
        text: this.sanitizeText(element.text, 160),
        label: this.sanitizeText(element.label, 120),
        value: this.sanitizeText(element.value, 120),
        href: element.href ? this.sanitizeUrl(element.href) : undefined,
      })),
      structuredText: this.sanitizeText(snapshot.structuredText, 4000),
    };
  }
}
