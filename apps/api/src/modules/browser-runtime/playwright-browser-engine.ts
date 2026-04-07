import * as path from 'path';
import type { BrowserSnapshotElement, RpaTargetDefinition } from '@uniflow/shared-types';
import type {
  BrowserPageCapture,
  BrowserSessionRecord,
  BrowserTabRecord,
} from './browser-runtime.types';
import type { BrowserEngineAdapter } from './browser-engine-adapter';
import { PngImageTemplateMatcher } from './png-image-template-matcher';

interface PlaywrightSessionState {
  browser: any;
  context: any;
  page: any;
}

export class PlaywrightBrowserEngineAdapter implements BrowserEngineAdapter {
  readonly provider = 'playwright';
  private readonly sessions = new Map<string, PlaywrightSessionState>();
  private readonly pngTemplateMatcher = new PngImageTemplateMatcher();

  async initialize(session: BrowserSessionRecord, tab: BrowserTabRecord) {
    const state = await this.ensureSession(session);
    if (tab.url && tab.url !== 'about:blank') {
      await state.page.goto(tab.url, { waitUntil: 'domcontentloaded' });
      tab.url = state.page.url();
      tab.title = await state.page.title();
    }
  }

  async dispose(session: BrowserSessionRecord) {
    const state = this.sessions.get(session.sessionId);
    if (!state) {
      return;
    }

    await state.context?.close?.().catch(() => undefined);
    await state.browser?.close?.().catch(() => undefined);
    this.sessions.delete(session.sessionId);
  }

  async capturePage(session: BrowserSessionRecord, _tab: BrowserTabRecord): Promise<BrowserPageCapture | undefined> {
    const state = await this.ensureSession(session);
    const capture = await state.page.evaluate(() => {
      function textOf(node: Element | null | undefined) {
        return (node?.textContent || '').replace(/\s+/g, ' ').trim();
      }

      function cssPath(node: Element | null): string | undefined {
        if (!node || !(node instanceof Element)) {
          return undefined;
        }

        if (node.id) {
          return `#${node.id}`;
        }

        const parts: string[] = [];
        let current: Element | null = node;
        while (current && parts.length < 5) {
          let selector = current.tagName.toLowerCase();
          if (current.classList.length > 0) {
            selector += `.${Array.from(current.classList).slice(0, 2).join('.')}`;
          } else if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName);
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${index})`;
          }
          parts.unshift(selector);
          current = current.parentElement;
        }
        return parts.join(' > ');
      }

      function roleOf(node: Element): string {
        const tag = node.tagName.toLowerCase();
        const role = node.getAttribute('role') || '';
        if (tag === 'button' || role === 'button') return 'button';
        if (tag === 'a' || role === 'link') return 'link';
        if (tag === 'select') return 'select';
        if (tag === 'textarea') return 'textarea';
        if (tag === 'input') {
          const type = (node.getAttribute('type') || 'text').toLowerCase();
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'file') return 'upload';
          return 'input';
        }
        return 'unknown';
      }

      function imageHints(node: Element): Array<RpaTargetDefinition> {
        const directImage = node.tagName.toLowerCase() === 'img'
          ? node as HTMLImageElement
          : node.querySelector('img');

        if (!directImage) {
          return [];
        }

        const src = (directImage.getAttribute('src') || '').trim();
        const filename = src.split('/').pop() || src;
        const alt = (directImage.getAttribute('alt') || directImage.getAttribute('title') || '').trim();
        return [{
          kind: 'image',
          value: filename || alt || 'image-target',
          label: alt || undefined,
          imageUrl: src || undefined,
        }];
      }

      function importantTexts() {
        const candidates = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], .title, .ant-page-header-heading-title'))
          .map((node) => textOf(node))
          .filter(Boolean);
        return Array.from(new Set(candidates)).slice(0, 20);
      }

      function forms() {
        return Array.from(document.querySelectorAll('form')).slice(0, 10).map((form, index) => ({
          id: form.id || `form-${index + 1}`,
          name: form.getAttribute('name') || textOf(form.querySelector('legend, h1, h2, h3')) || `表单${index + 1}`,
          fields: Array.from(form.querySelectorAll('input, select, textarea')).slice(0, 40).map((field) => ({
            label: textOf(field.closest('label') || field.parentElement?.querySelector('label') || null) || undefined,
            fieldKey: field.getAttribute('name') || field.getAttribute('id') || undefined,
            required: field.hasAttribute('required'),
            selector: cssPath(field),
          })),
        }));
      }

      function regions() {
        const regionDefs = [
          { selector: 'header', id: 'header', role: 'header', name: 'Header' },
          { selector: 'nav, [role="navigation"]', id: 'navigation', role: 'navigation', name: 'Navigation' },
          { selector: 'main, [role="main"]', id: 'main', role: 'main', name: 'Main' },
          { selector: 'aside', id: 'sidebar', role: 'sidebar', name: 'Sidebar' },
          { selector: 'footer', id: 'footer', role: 'footer', name: 'Footer' },
          { selector: 'dialog, [role="dialog"], .ant-modal-root, .el-dialog', id: 'dialog', role: 'dialog', name: 'Dialog' },
        ];

        return regionDefs.map((definition) => {
          const node = document.querySelector(definition.selector);
          if (!node) {
            return null;
          }
          const interactiveChildren = Array.from(
            node.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [onclick]')
          )
            .map((item) => cssPath(item))
            .filter(Boolean);
          return {
            id: definition.id,
            role: definition.role,
            name: definition.name,
            summary: textOf(node).slice(0, 120) || undefined,
            elementSelectors: interactiveChildren,
          };
        }).filter(Boolean);
      }

      const elements = Array.from(
        document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [onclick]')
      )
        .slice(0, 120)
        .map((node) => {
          const selector = cssPath(node);
          const tag = node.tagName.toLowerCase();
          const label = textOf(node.closest('label') || node.parentElement?.querySelector('label') || null)
            || node.getAttribute('aria-label')
            || node.getAttribute('title')
            || undefined;
          const text = textOf(node) || undefined;
          const href = tag === 'a' ? (node.getAttribute('href') || undefined) : undefined;
          const fieldKey = node.getAttribute('name') || node.getAttribute('id') || undefined;
          const rect = node.getBoundingClientRect();
          return {
            role: roleOf(node),
            text,
            label,
            fieldKey,
            selector,
            href,
            required: node.hasAttribute('required'),
            disabled: (node as HTMLInputElement).disabled || node.getAttribute('aria-disabled') === 'true',
            value: 'value' in (node as any) ? String((node as any).value || '') : undefined,
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            targetHints: imageHints(node),
          };
        });

      return {
        title: document.title,
        url: window.location.href,
        regions: regions(),
        forms: forms(),
        dialogs: Array.from(document.querySelectorAll('dialog, [role="dialog"], .ant-modal-root, .el-dialog')).slice(0, 10).map((node, index) => ({
          id: node.id || `dialog-${index + 1}`,
          title: textOf(node.querySelector('h1, h2, h3, .ant-modal-title, .el-dialog__title')) || `弹窗${index + 1}`,
          summary: textOf(node).slice(0, 120) || undefined,
        })),
        tables: Array.from(document.querySelectorAll('table')).slice(0, 10).map((node, index) => ({
          id: node.id || `table-${index + 1}`,
          name: textOf(node.querySelector('caption, thead')) || `表格${index + 1}`,
          summary: textOf(node).slice(0, 120) || undefined,
        })),
        importantTexts: importantTexts(),
        interactiveElements: elements,
      };
    });

    return capture as BrowserPageCapture;
  }

  async stabilize(session: BrowserSessionRecord, tab: BrowserTabRecord, timeoutMs?: number) {
    const state = await this.ensureSession(session);
    const timeout = timeoutMs || 5000;
    await state.page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);
    await state.page.waitForLoadState('networkidle', { timeout }).catch(() => undefined);
    tab.url = state.page.url();
    tab.title = await state.page.title().catch(() => tab.title);
  }

  async navigate(session: BrowserSessionRecord, tab: BrowserTabRecord, url: string) {
    const state = await this.ensureSession(session);
    await state.page.goto(url, { waitUntil: 'domcontentloaded' });
    tab.url = state.page.url();
    tab.title = await state.page.title();
    tab.history.push(tab.url);
    tab.pageVersion += 1;
  }

  async input(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ) {
    const locator = await this.resolveLocator(session, element);
    const normalizedValue = await this.normalizeInputValue(locator, value);
    await locator.fill(normalizedValue);
    if (element?.fieldKey) {
      tab.formValues[element.fieldKey] = value;
    }
  }

  async select(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ) {
    const locator = await this.resolveLocator(session, element);
    await this.selectOptionWithFallback(locator, String(value ?? ''));
    if (element?.fieldKey) {
      tab.formValues[element.fieldKey] = value;
    }
  }

  async click(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    target?: RpaTargetDefinition,
  ) {
    const state = await this.ensureSession(session);
    const pixelClicked = await this.tryTemplateClick(state.page, tab, element, target);
    if (pixelClicked) {
      tab.artifacts.lastClickedRef = pixelClicked.ref;
      tab.artifacts.lastClickedLabel = pixelClicked.label || pixelClicked.text;
      return;
    }

    const locator = await this.resolveLocator(session, element);
    await locator.click();
    tab.artifacts.lastClickedRef = element?.ref;
    tab.artifacts.lastClickedLabel = element?.label || element?.text;
  }

  async upload(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ) {
    const locator = await this.resolveLocator(session, element);
    const inputFiles = this.normalizeInputFiles(value);
    await locator.setInputFiles(inputFiles);
    for (const file of inputFiles) {
      tab.uploads.push({
        fieldKey: element?.fieldKey,
        filename: typeof file === 'string' ? path.basename(file) : file.name,
      });
    }
  }

  async extract(session: BrowserSessionRecord, tab: BrowserTabRecord, element: BrowserSnapshotElement | undefined) {
    const locator = await this.resolveLocator(session, element);
    const tagName = await locator.evaluate((node: Element) => node.tagName.toLowerCase()).catch(() => '');
    const value = tagName === 'input' || tagName === 'textarea' || tagName === 'select'
      ? await locator.inputValue().catch(() => '')
      : await locator.textContent().catch(() => '');
    if (element?.fieldKey) {
      tab.extractedValues[element.fieldKey] = value;
    }
    return value;
  }

  async download(session: BrowserSessionRecord, tab: BrowserTabRecord, element: BrowserSnapshotElement | undefined) {
    const state = await this.ensureSession(session);
    const locator = await this.resolveLocator(session, element);
    const downloadPromise = state.page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await locator.click();
    const download = await downloadPromise;
    if (!download) {
      return undefined;
    }

    const suggestedFilename = await download.suggestedFilename();
    tab.artifacts.lastDownload = suggestedFilename;
    return suggestedFilename;
  }

  async screenshot(session: BrowserSessionRecord, tab: BrowserTabRecord) {
    const state = await this.ensureSession(session);
    const outputDir = path.join(process.cwd(), 'tmp', 'browser-runtime');
    await require('fs').promises.mkdir(outputDir, { recursive: true });
    const screenshotCount = Number(tab.artifacts.screenshotCount || 0) + 1;
    tab.artifacts.screenshotCount = screenshotCount;
    const filePath = path.join(outputDir, `${session.sessionId}-${tab.pageVersion}-shot-${screenshotCount}.png`);
    await state.page.screenshot({ path: filePath, fullPage: true });
    tab.artifacts.lastScreenshot = filePath;
    return filePath;
  }

  private async ensureSession(session: BrowserSessionRecord): Promise<PlaywrightSessionState> {
    const existing = this.sessions.get(session.sessionId);
    if (existing) {
      return existing;
    }

    const playwright = require('playwright');
    const browser = await playwright.chromium.launch({
      headless: session.headless,
      executablePath: session.browserExecutablePath || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const created = { browser, context, page };
    this.sessions.set(session.sessionId, created);
    return created;
  }

  private async selectOptionWithFallback(locator: any, rawValue: string) {
    const desiredValue = rawValue.trim();
    try {
      await locator.selectOption(desiredValue);
      return;
    } catch (error) {
      const options = await locator.evaluate((node: HTMLSelectElement) =>
        Array.from(node.options || []).map((option) => ({
          value: option.value || '',
          label: option.label || '',
          text: option.textContent || '',
        })),
      ).catch(() => [] as Array<{ value: string; label: string; text: string }>);

      const matchedOption = this.findMatchingSelectOption(options, desiredValue);
      if (!matchedOption) {
        throw error;
      }

      await locator.selectOption(matchedOption.value);
    }
  }

  private findMatchingSelectOption(
    options: Array<{ value: string; label: string; text: string }>,
    desiredValue: string,
  ) {
    const normalizedDesired = this.normalizeSelectOptionValue(desiredValue);
    if (!normalizedDesired) {
      return null;
    }

    const exactMatch = options.find((option) =>
      [option.value, option.label, option.text].some((candidate) =>
        this.normalizeSelectOptionValue(candidate) === normalizedDesired,
      ),
    );
    if (exactMatch) {
      return exactMatch;
    }

    return options.find((option) =>
      [option.value, option.label, option.text].some((candidate) => {
        const normalizedCandidate = this.normalizeSelectOptionValue(candidate);
        return normalizedCandidate
          && (
            normalizedCandidate.includes(normalizedDesired)
            || normalizedDesired.includes(normalizedCandidate)
          );
      }),
    ) || null;
  }

  private normalizeSelectOptionValue(value: string | undefined | null) {
    return String(value || '')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase();
  }

  private async normalizeInputValue(locator: any, value: any) {
    const rawValue = String(value ?? '');
    const descriptor = await locator.evaluate((node: Element) => {
      if (node instanceof HTMLInputElement) {
        return {
          tagName: node.tagName.toLowerCase(),
          type: node.type || '',
          value: node.value || '',
        };
      }

      return {
        tagName: node.tagName.toLowerCase(),
        type: '',
        value: '',
      };
    }).catch(() => null);

    if (descriptor?.tagName === 'input' && descriptor.type === 'datetime-local') {
      return this.normalizeDatetimeLocalValue(rawValue, descriptor.value);
    }

    return rawValue;
  }

  private normalizeDatetimeLocalValue(value: string, currentValue: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return trimmed;
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 16);
    }

    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(trimmed)) {
      return trimmed.replace(/\s+/, 'T').slice(0, 16);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const timeSuffix = currentValue.match(/T\d{2}:\d{2}/)?.[0] || 'T09:00';
      return `${trimmed}${timeSuffix}`;
    }

    return trimmed;
  }

  private async resolveLocator(session: BrowserSessionRecord, element: BrowserSnapshotElement | undefined) {
    if (!element) {
      throw new Error('Browser element target is required');
    }

    const state = await this.ensureSession(session);
    if (element.selector) {
      return state.page.locator(element.selector).first();
    }

    if (element.label) {
      return state.page.getByLabel(element.label).first();
    }

    if (element.text) {
      return state.page.getByText(element.text, { exact: false }).first();
    }

    const imageHint = element.targetHints?.find((hint) => hint.kind === 'image');
    if (imageHint?.imageUrl) {
      const srcSelector = `img[src*="${this.escapeCssValue(imageHint.imageUrl)}"]`;
      return state.page.locator(srcSelector).locator('xpath=..').first();
    }

    if (imageHint?.label) {
      return state.page.getByAltText(imageHint.label).locator('xpath=..').first();
    }

    throw new Error(`Unable to build locator for browser element ${element.ref}`);
  }

  private normalizeInputFiles(value: any) {
    const items = Array.isArray(value) ? value : [value];
    return items.map((item: any, index: number) => {
      if (item && Buffer.isBuffer(item.buffer)) {
        return {
          name: item.filename || item.name || `upload-${index + 1}.bin`,
          mimeType: item.mimeType || 'application/octet-stream',
          buffer: item.buffer,
        };
      }

      if (item && typeof item.content === 'string') {
        return {
          name: item.filename || item.name || `upload-${index + 1}.bin`,
          mimeType: item.mimeType || 'application/octet-stream',
          buffer: Buffer.from(item.content, 'base64'),
        };
      }

      if (typeof item === 'string') {
        return item;
      }

      throw new Error('Unsupported upload payload for Playwright engine');
    });
  }

  private escapeCssValue(value: string) {
    return value.replace(/["\\]/g, '\\$&');
  }

  private async tryTemplateClick(
    page: any,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    target?: RpaTargetDefinition,
  ) {
    if (!target || target.kind !== 'image') {
      return undefined;
    }

    const pageCapture = tab.artifacts.lastPageCapture as BrowserPageCapture | undefined;
    const candidates = this.collectImageCandidates(pageCapture, element);
    if (candidates.length === 0) {
      return undefined;
    }

    try {
      const screenshot = await page.screenshot({ type: 'png', fullPage: false });
      const matched = await this.pngTemplateMatcher.matchTargetOnScreenshot(screenshot, target, candidates);
      if (!matched.matched || !matched.bounds) {
        return undefined;
      }

      await page.mouse.click(
        matched.bounds.x + matched.bounds.width / 2,
        matched.bounds.y + matched.bounds.height / 2,
      );
      tab.artifacts.lastTemplateMatchScore = matched.score;
      return matched.element;
    } catch (error: any) {
      tab.artifacts.lastTemplateMatchError = error.message || String(error);
      return undefined;
    }
  }

  private collectImageCandidates(pageCapture: BrowserPageCapture | undefined, currentElement: BrowserSnapshotElement | undefined) {
    const candidates = (pageCapture?.interactiveElements || [])
      .filter((element) => !!element.bounds)
      .filter((element) =>
        (element.targetHints || []).some((hint) => hint.kind === 'image')
        || element.role === 'button'
        || element.role === 'link',
      );

    if (currentElement?.bounds) {
      candidates.unshift(currentElement);
    }

    const unique = new Map<string, BrowserSnapshotElement>();
    for (const candidate of candidates) {
      const key = candidate.selector || `${candidate.bounds?.x}:${candidate.bounds?.y}:${candidate.bounds?.width}:${candidate.bounds?.height}`;
      if (!unique.has(key)) {
        unique.set(key, candidate as BrowserSnapshotElement);
      }
    }
    return [...unique.values()];
  }
}
