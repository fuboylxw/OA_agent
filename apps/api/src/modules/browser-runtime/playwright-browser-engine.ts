import * as path from 'path';
import type { BrowserSnapshotElement, RpaTargetDefinition } from '@uniflow/shared-types';
import { BrowserUploadLocatorInferenceEngine } from '@uniflow/compat-engine';
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

interface PlaywrightLocatorScope {
  scope: any;
  description: string;
}

interface UploadLocatorMatch {
  locator: any;
  requestFieldName?: string;
}

interface UploadLocatorCandidateMatch extends UploadLocatorMatch {
  candidateId: string;
  scopeDescription: string;
  scopeUrl?: string;
  inputName?: string;
  inputId?: string;
  directMeta?: string;
  nearbyText?: string;
  fileInputCountInScope?: number;
}

const CAPTURE_PAGE_SCRIPT = String.raw`
(() => {
  function textOf(node) {
    return (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(node) {
    if (!node || !(node instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(node);
    if (
      style.display === 'none'
      || style.visibility === 'hidden'
      || style.visibility === 'collapse'
      || style.opacity === '0'
    ) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cssPath(node) {
    if (!node || !(node instanceof Element)) {
      return undefined;
    }

    if (node.id) {
      return '#' + node.id;
    }

    const parts = [];
    let current = node;
    while (current && parts.length < 5) {
      let selector = current.tagName.toLowerCase();
      if (current.classList.length > 0) {
        selector += '.' + Array.from(current.classList).slice(0, 2).join('.');
      } else if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter((item) => item.tagName === current.tagName);
        const index = siblings.indexOf(current) + 1;
        selector += ':nth-of-type(' + index + ')';
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function roleOf(node) {
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

  function imageHints(node) {
    const directImage = node.tagName.toLowerCase() === 'img'
      ? node
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
      .filter((node) => isVisible(node))
      .map((node) => textOf(node))
      .filter(Boolean);
    return Array.from(new Set(candidates)).slice(0, 20);
  }

  function forms() {
    return Array.from(document.querySelectorAll('form'))
      .filter((form) => isVisible(form))
      .slice(0, 10)
      .map((form, index) => ({
        id: form.id || 'form-' + (index + 1),
        name: form.getAttribute('name') || textOf(form.querySelector('legend, h1, h2, h3')) || '表单' + (index + 1),
        fields: Array.from(form.querySelectorAll('input, select, textarea'))
          .filter((field) => isVisible(field))
          .slice(0, 40)
          .map((field) => ({
            label: textOf(field.closest('label') || (field.parentElement ? field.parentElement.querySelector('label') : null)) || undefined,
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
      if (!node || !isVisible(node)) {
        return null;
      }
      const interactiveChildren = Array.from(
        node.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [onclick]')
      )
        .filter((item) => isVisible(item))
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
    .filter((node) => isVisible(node))
    .slice(0, 120)
    .map((node) => {
      const selector = cssPath(node);
      const tag = node.tagName.toLowerCase();
      const label = textOf(node.closest('label') || (node.parentElement ? node.parentElement.querySelector('label') : null))
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
        disabled: Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true',
        value: 'value' in node ? String(node.value || '') : undefined,
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
    dialogs: Array.from(document.querySelectorAll('dialog, [role="dialog"], .ant-modal-root, .el-dialog'))
      .filter((node) => isVisible(node))
      .slice(0, 10)
      .map((node, index) => ({
        id: node.id || 'dialog-' + (index + 1),
        title: textOf(node.querySelector('h1, h2, h3, .ant-modal-title, .el-dialog__title')) || '弹窗' + (index + 1),
        summary: textOf(node).slice(0, 120) || undefined,
      })),
    tables: Array.from(document.querySelectorAll('table'))
      .filter((node) => isVisible(node))
      .slice(0, 10)
      .map((node, index) => ({
        id: node.id || 'table-' + (index + 1),
        name: textOf(node.querySelector('caption, thead')) || '表格' + (index + 1),
        summary: textOf(node).slice(0, 120) || undefined,
      })),
    importantTexts: importantTexts(),
    interactiveElements: elements,
  };
})()
`;

export class PlaywrightBrowserEngineAdapter implements BrowserEngineAdapter {
  readonly provider = 'playwright';
  private readonly sessions = new Map<string, PlaywrightSessionState>();
  private readonly pngTemplateMatcher = new PngImageTemplateMatcher();
  private readonly uploadLocatorInference = new BrowserUploadLocatorInferenceEngine();

  async initialize(session: BrowserSessionRecord, tab: BrowserTabRecord) {
    const state = await this.ensureSession(session);
    if (tab.url && tab.url !== 'about:blank') {
      await state.page.goto(tab.url, { waitUntil: 'domcontentloaded' });
      await this.syncPageState(state, tab);
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
    const pageCapture = await this.captureScope(state.page);
    const mainFrame = typeof state.page.mainFrame === 'function'
      ? state.page.mainFrame()
      : undefined;
    const frameCaptures: Array<{ regionId: string; url: string; capture: BrowserPageCapture }> = [];

    if (typeof state.page.frames === 'function') {
      let frameIndex = 0;
      for (const frame of state.page.frames()) {
        if (!frame || frame === mainFrame) {
          continue;
        }

        const capture = await this.captureScope(frame).catch(() => undefined);
        if (!capture) {
          continue;
        }

        frameIndex += 1;
        frameCaptures.push({
          regionId: `frame-${frameIndex}`,
          url: typeof frame.url === 'function' ? frame.url() : '',
          capture,
        });
      }
    }

    return this.mergeCapturedScopes(pageCapture, frameCaptures);
  }

  async stabilize(session: BrowserSessionRecord, tab: BrowserTabRecord, timeoutMs?: number) {
    const state = await this.ensureSession(session);
    await this.syncPageState(state, tab, timeoutMs);
  }

  async navigate(session: BrowserSessionRecord, tab: BrowserTabRecord, url: string) {
    const state = await this.ensureSession(session);
    await state.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.syncPageState(state, tab, undefined, true);
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
    const uploadTarget = await this.resolveUploadLocator(session, element);
    const locator = uploadTarget.locator;
    const inputFiles = this.normalizeInputFiles(value);
    await locator.setInputFiles(inputFiles);
    if (element?.fieldKey && uploadTarget.requestFieldName) {
      const attachmentFieldMap = (tab.extractedValues.attachmentFieldMap
        && typeof tab.extractedValues.attachmentFieldMap === 'object')
        ? tab.extractedValues.attachmentFieldMap as Record<string, string>
        : {};
      attachmentFieldMap[element.fieldKey] = uploadTarget.requestFieldName;
      tab.extractedValues.attachmentFieldMap = attachmentFieldMap;
    }
    for (const file of inputFiles) {
      tab.uploads.push({
        fieldKey: element?.fieldKey,
        filename: typeof file === 'string' ? path.basename(file) : file.name,
      });
    }
  }

  async extract(session: BrowserSessionRecord, tab: BrowserTabRecord, element: BrowserSnapshotElement | undefined) {
    const locator = await this.resolveLocator(session, element);
    const value = await locator.evaluate((node: Element) => {
      const tagName = node.tagName.toLowerCase();
      const readAttr = (name: string) => node.getAttribute(name) || '';

      if (tagName === 'meta') {
        return readAttr('content');
      }

      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        const htmlNode = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        return htmlNode.value
          || readAttr('value')
          || readAttr('content')
          || node.textContent
          || '';
      }

      return readAttr('value')
        || readAttr('content')
        || readAttr('href')
        || readAttr('src')
        || node.textContent
        || '';
    }).catch(() => '');
    if (element?.fieldKey) {
      tab.extractedValues[element.fieldKey] = value;
    }
    return value;
  }

  async evaluate(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    script: string,
    context: Record<string, any> = {},
  ) {
    const state = await this.ensureSession(session);
    const value = await state.page.evaluate(async ({ scriptSource, executionContext }: any) => {
      const evaluator = new Function(
        'context',
        `
          const scope = typeof window !== 'undefined' ? window : globalThis;
          return (async function () {
            ${scriptSource}
          }).call(scope);
        `,
      );
      return await evaluator(executionContext);
    }, {
      scriptSource: String(script || ''),
      executionContext: context,
    });

    tab.artifacts.lastEvaluatedScript = String(script || '').slice(0, 2000);
    tab.artifacts.lastEvaluatedValue = value;
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
    const contextOptions: Record<string, any> = {};
    const storageState = this.parseStorageState(session.storageState);
    if (storageState) {
      contextOptions.storageState = storageState;
    }
    const context = await browser.newContext(contextOptions);
    const bootstrapCookies = storageState?.cookies?.length
      ? [] as Array<Record<string, any>>
      : this.normalizeBootstrapCookies(session);
    if (bootstrapCookies.length > 0) {
      await context.addCookies(bootstrapCookies);
    }
    const page = await context.newPage();
    const created = { browser, context, page };
    this.sessions.set(session.sessionId, created);
    return created;
  }

  private async syncPageState(
    state: PlaywrightSessionState,
    tab: BrowserTabRecord,
    timeoutMs?: number,
    appendHistory = false,
  ) {
    const timeout = timeoutMs || 5000;
    await state.page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);
    await state.page.waitForLoadState('networkidle', { timeout }).catch(() => undefined);
    const nextUrl = state.page.url();
    tab.url = nextUrl;
    tab.title = await this.readPageTitle(state.page, tab.title);
    if (appendHistory && tab.history[tab.history.length - 1] !== nextUrl) {
      tab.history.push(nextUrl);
    }
  }

  private async readPageTitle(page: any, fallbackTitle = '') {
    try {
      return await page.title();
    } catch {
      return fallbackTitle;
    }
  }

  private parseStorageState(value: BrowserSessionRecord['storageState']) {
    if (!value) {
      return undefined;
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value;
  }

  private normalizeBootstrapCookies(session: BrowserSessionRecord) {
    if (Array.isArray(session.cookies) && session.cookies.length > 0) {
      return session.cookies
        .map((cookie) => this.normalizeCookie(cookie, session.cookieOrigin))
        .filter(Boolean) as Array<Record<string, any>>;
    }

    if (!session.cookieHeader) {
      return [];
    }

    return session.cookieHeader
      .split(';')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const separatorIndex = segment.indexOf('=');
        if (separatorIndex <= 0) {
          return undefined;
        }

        return this.normalizeCookie({
          name: segment.slice(0, separatorIndex).trim(),
          value: segment.slice(separatorIndex + 1).trim(),
          path: '/',
        }, session.cookieOrigin);
      })
      .filter(Boolean) as Array<Record<string, any>>;
  }

  private normalizeCookie(cookie: any, cookieOrigin?: string) {
    if (!cookie || typeof cookie !== 'object' || !cookie.name) {
      return undefined;
    }

    const normalized: Record<string, any> = {
      name: String(cookie.name),
      value: String(cookie.value || ''),
      path: String(cookie.path || '/'),
    };

    if (cookie.domain) {
      normalized.domain = String(cookie.domain);
    } else if (cookie.url) {
      normalized.url = String(cookie.url);
    } else if (cookieOrigin) {
      normalized.url = cookieOrigin;
    } else {
      return undefined;
    }

    if (cookie.expires !== undefined) normalized.expires = cookie.expires;
    if (cookie.httpOnly !== undefined) normalized.httpOnly = Boolean(cookie.httpOnly);
    if (cookie.secure !== undefined) normalized.secure = Boolean(cookie.secure);
    if (cookie.sameSite !== undefined) normalized.sameSite = cookie.sameSite;
    return normalized;
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

    return null;
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
    const scopes = this.rankLocatorScopes(this.getLocatorScopes(state), element);
    const prefersTextLocator = element.targetHints?.some((hint) => hint.kind === 'text') && element.text;
    if (element.selector) {
      const matched = await this.findFirstScopedLocator(
        scopes,
        (scope) => scope.locator(element.selector!).first(),
      );
      if (matched) {
        return matched;
      }
    }

    if (element.role === 'upload' && element.label) {
      const matched = await this.findFirstScopedLocator(
        scopes,
        (scope) => scope.getByLabel(element.label!).first(),
      );
      if (matched) {
        return matched;
      }
    }

    if (prefersTextLocator) {
      const matched = await this.findFirstScopedLocator(
        scopes,
        (scope) => scope.getByText(element.text!, { exact: false }).first(),
      );
      if (matched) {
        return matched;
      }
    }

    if (element.fieldKey) {
      const matched = await this.findFirstScopedLocator(
        scopes,
        (scope) => scope.locator(this.buildVisibleFieldKeySelector(element.fieldKey!)).first(),
      );
      if (matched) {
        return matched;
      }
    }

    if (element.label) {
      const matched = await this.findFirstScopedLocator(
        scopes,
        (scope) => scope.getByLabel(element.label!).first(),
      );
      if (matched) {
        return matched;
      }
    }

    if (element.text) {
      const matched = await this.findFirstScopedLocator(
        scopes,
        (scope) => scope.getByText(element.text!, { exact: false }).first(),
      );
      if (matched) {
        return matched;
      }
    }

    const imageHint = element.targetHints?.find((hint) => hint.kind === 'image');
    if (imageHint?.imageUrl) {
      const srcSelector = `img[src*="${this.escapeCssValue(imageHint.imageUrl)}"]`;
      const matched = await this.findFirstScopedLocator(
        scopes,
        (scope) => scope.locator(srcSelector).locator('xpath=..').first(),
      );
      if (matched) {
        return matched;
      }
    }

    if (imageHint?.label) {
      const matched = await this.findFirstScopedLocator(
        scopes,
        (scope) => scope.getByAltText(imageHint.label!).locator('xpath=..').first(),
      );
      if (matched) {
        return matched;
      }
    }

    throw new Error(`Unable to build locator for browser element ${element.ref}`);
  }

  private async resolveUploadLocator(
    session: BrowserSessionRecord,
    element: BrowserSnapshotElement | undefined,
  ): Promise<UploadLocatorMatch> {
    if (!element) {
      throw new Error('Browser upload target is required');
    }

    const deadline = Date.now() + 15000;
    let lastError: Error | null = null;

    while (Date.now() <= deadline) {
      try {
        const match = await this.tryResolveUploadLocator(session, element);
        if (match) {
          return match;
        }
      } catch (error: any) {
        lastError = error instanceof Error
          ? error
          : new Error(error?.message || String(error));
      }

      const state = await this.ensureSession(session);
      if (typeof state.page.waitForTimeout === 'function') {
        await state.page.waitForTimeout(500).catch(() => undefined);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (lastError) {
      throw lastError;
    }

    const debug = await this.describeUploadLocatorState(session, element).catch(() => null);
    if (debug) {
      console.warn('[PlaywrightBrowserEngineAdapter] Upload locator unresolved', JSON.stringify(debug));
    }

    throw new Error(`Unable to resolve upload locator for ${element.label || element.text || element.fieldKey || element.ref}`);
  }

  private async tryResolveUploadLocator(
    session: BrowserSessionRecord,
    element: BrowserSnapshotElement,
  ): Promise<UploadLocatorMatch | null> {
    const state = await this.ensureSession(session);
    const scopes = this.getLocatorScopes(state);
    const labels = this.collectUploadLocatorLabels(element);

    if (element.selector) {
      const selectorMatch = await this.findUploadLocatorBySelector(scopes, element.selector);
      if (selectorMatch) {
        return selectorMatch;
      }
    }

    if (element.fieldKey) {
      const fieldKeySelector = `input[type="file"][name="${this.escapeCssValue(element.fieldKey)}"], input[type="file"][id="${this.escapeCssValue(element.fieldKey)}"]`;
      const fieldKeyMatch = await this.findFirstMatchingLocator(
        scopes,
        (scope) => scope.locator(fieldKeySelector).first(),
      );
      if (fieldKeyMatch) {
        return fieldKeyMatch;
      }
    }

    for (const label of labels) {
      const labelMatch = await this.findFirstMatchingLocator(
        scopes,
        (scope) => scope.getByLabel(label).first(),
      );
      if (labelMatch) {
        return labelMatch;
      }
    }

    for (const label of labels) {
      const attributeSelector = [
        `input[type="file"][name*="${this.escapeCssValue(label)}"]`,
        `input[type="file"][id*="${this.escapeCssValue(label)}"]`,
        `input[type="file"][title*="${this.escapeCssValue(label)}"]`,
        `input[type="file"][aria-label*="${this.escapeCssValue(label)}"]`,
        `input[type="file"][placeholder*="${this.escapeCssValue(label)}"]`,
      ].join(', ');
      const attributeMatch = await this.findFirstMatchingLocator(
        scopes,
        (scope) => scope.locator(attributeSelector).first(),
      );
      if (attributeMatch) {
        return attributeMatch;
      }
    }

    const inferredMatch = await this.findInferredUploadLocator(scopes, element, labels);
    if (inferredMatch) {
      return inferredMatch;
    }

    const uniqueFileInput = await this.findUniqueFileInputLocator(scopes);
    if (uniqueFileInput) {
      return uniqueFileInput;
    }

    return null;
  }

  private async findUploadLocatorBySelector(
    scopes: PlaywrightLocatorScope[],
    selector: string,
  ): Promise<UploadLocatorMatch | null> {
    for (const entry of scopes) {
      const nestedLocator = entry.scope.locator(selector).locator('input[type="file"]').first();
      const nestedCount = await nestedLocator.count().catch(() => 0);
      if (nestedCount > 0) {
        return {
          locator: nestedLocator,
          requestFieldName: await this.readLocatorRequestFieldName(nestedLocator),
        };
      }

      const directLocator = entry.scope.locator(selector).first();
      const directCount = await directLocator.count().catch(() => 0);
      if (directCount === 0) {
        continue;
      }

      const isDirectFileInput = await directLocator.evaluate((node: Element) =>
        node instanceof HTMLInputElement && node.type === 'file').catch(() => false);
      if (!isDirectFileInput) {
        continue;
      }

      return {
        locator: directLocator,
        requestFieldName: await this.readLocatorRequestFieldName(directLocator),
      };
    }

    return null;
  }

  private getLocatorScopes(state: PlaywrightSessionState): PlaywrightLocatorScope[] {
    const scopes: PlaywrightLocatorScope[] = [{
      scope: state.page,
      description: 'page',
    }];

    if (typeof state.page.frames === 'function') {
      const mainFrame = typeof state.page.mainFrame === 'function'
        ? state.page.mainFrame()
        : undefined;
      for (const frame of state.page.frames()) {
        if (!frame || frame === mainFrame) {
          continue;
        }
        scopes.push({
          scope: frame,
          description: `frame:${typeof frame.url === 'function' ? frame.url() : 'unknown'}`,
        });
      }
    }

    return scopes;
  }

  private async captureScope(scope: any): Promise<BrowserPageCapture | undefined> {
    if (typeof scope?.evaluate !== 'function') {
      return undefined;
    }

    const capture = await scope.evaluate(CAPTURE_PAGE_SCRIPT).catch(() => undefined);
    return capture as BrowserPageCapture | undefined;
  }

  private mergeCapturedScopes(
    pageCapture: BrowserPageCapture | undefined,
    frameCaptures: Array<{ regionId: string; url: string; capture: BrowserPageCapture }>,
  ): BrowserPageCapture | undefined {
    if (!pageCapture && frameCaptures.length === 0) {
      return undefined;
    }

    const base: BrowserPageCapture = pageCapture
      ? JSON.parse(JSON.stringify(pageCapture))
      : {
          title: '',
          url: '',
          regions: [],
          forms: [],
          tables: [],
          dialogs: [],
          importantTexts: [],
          interactiveElements: [],
        };

    for (const frameEntry of frameCaptures) {
      const frameUrl = String(frameEntry.url || '').trim();
      base.regions = [
        ...(base.regions || []),
        {
          id: frameEntry.regionId,
          role: 'main',
          name: `Frame ${frameEntry.regionId}`,
          summary: frameUrl || 'iframe scope',
          elementSelectors: frameEntry.capture.interactiveElements
            .map((element) => element.selector)
            .filter(Boolean) as string[],
        },
      ];
      base.forms = [
        ...(base.forms || []),
        ...(frameEntry.capture.forms || []).map((form) => ({
          ...form,
          id: `${frameEntry.regionId}:${form.id}`,
          name: `${form.name} [Frame]`,
        })),
      ];
      base.tables = [
        ...(base.tables || []),
        ...(frameEntry.capture.tables || []).map((table) => ({
          ...table,
          id: `${frameEntry.regionId}:${table.id}`,
        })),
      ];
      base.dialogs = [
        ...(base.dialogs || []),
        ...(frameEntry.capture.dialogs || []).map((dialog) => ({
          ...dialog,
          id: `${frameEntry.regionId}:${dialog.id}`,
        })),
      ];
      base.importantTexts = Array.from(new Set([
        ...(base.importantTexts || []),
        ...(frameEntry.capture.importantTexts || []).map((text) => `[Frame] ${text}`),
      ]));
      base.interactiveElements = [
        ...(base.interactiveElements || []),
        ...(frameEntry.capture.interactiveElements || []).map((element) => ({
          ...element,
          regionId: frameEntry.regionId,
          targetHints: [
            ...(element.targetHints || []),
            ...(frameUrl ? [{ kind: 'url', value: frameUrl, label: 'scope:frame' } as RpaTargetDefinition] : []),
          ],
        })),
      ];
    }

    return base;
  }

  private rankLocatorScopes(
    scopes: PlaywrightLocatorScope[],
    element: BrowserSnapshotElement,
  ) {
    const preferredFrameUrl = this.extractFrameScopeUrl(element);
    if (!preferredFrameUrl) {
      return scopes;
    }

    const normalized = preferredFrameUrl.trim();
    return [
      ...scopes.filter((entry) => entry.description.includes(normalized)),
      ...scopes.filter((entry) => !entry.description.includes(normalized)),
    ];
  }

  private extractFrameScopeUrl(element: BrowserSnapshotElement) {
    return element.targetHints?.find((hint) =>
      hint.kind === 'url' && hint.label === 'scope:frame',
    )?.value;
  }

  private async findFirstScopedLocator(
    scopes: PlaywrightLocatorScope[],
    buildLocator: (scope: any) => any,
  ) {
    for (const entry of scopes) {
      const locator = buildLocator(entry.scope);
      if (!locator) {
        continue;
      }

      if (typeof locator.count === 'function') {
        const count = await locator.count().catch(() => 0);
        if (!count) {
          continue;
        }
      }

      return locator;
    }

    return null;
  }

  private collectUploadLocatorLabels(element: BrowserSnapshotElement) {
    return Array.from(new Set([
      element.label,
      element.text,
      ...((element.targetHints || []).flatMap((hint) => [hint.label, hint.value])),
    ]
      .map((value) => this.normalizeLocatorText(value))
      .filter(Boolean))) as string[];
  }

  private normalizeLocatorText(value: string | undefined) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  private async findFirstMatchingLocator(
    scopes: PlaywrightLocatorScope[],
    buildLocator: (scope: any) => any,
  ): Promise<UploadLocatorMatch | null> {
    for (const entry of scopes) {
      const locator = buildLocator(entry.scope);
      const count = await locator.count().catch(() => 0);
      if (!count) {
        continue;
      }

      return {
        locator,
        requestFieldName: await this.readLocatorRequestFieldName(locator),
      };
    }

    return null;
  }

  private async findInferredUploadLocator(
    scopes: PlaywrightLocatorScope[],
    element: BrowserSnapshotElement,
    labels: string[],
  ): Promise<UploadLocatorMatch | null> {
    const candidates = await this.collectUploadLocatorCandidates(scopes);
    if (candidates.length === 0) {
      return null;
    }

    const judgement = await this.uploadLocatorInference.infer({
      element: {
        ref: element.ref,
        fieldKey: element.fieldKey,
        label: element.label,
        text: element.text,
        targetHints: element.targetHints,
      },
      labels,
      preferredFrameUrl: this.extractFrameScopeUrl(element),
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        scopeDescription: candidate.scopeDescription,
        scopeUrl: candidate.scopeUrl,
        requestFieldName: candidate.requestFieldName,
        inputName: candidate.inputName,
        inputId: candidate.inputId,
        directMeta: candidate.directMeta,
        nearbyText: candidate.nearbyText,
        fileInputCountInScope: candidate.fileInputCountInScope,
      })),
    });

    if (!judgement.canResolve || !judgement.matchedCandidateId) {
      return null;
    }

    const matched = candidates.find((candidate) => candidate.candidateId === judgement.matchedCandidateId);
    return matched
      ? {
          locator: matched.locator,
          requestFieldName: matched.requestFieldName,
        }
      : null;
  }

  private async collectUploadLocatorCandidates(
    scopes: PlaywrightLocatorScope[],
  ): Promise<UploadLocatorCandidateMatch[]> {
    const collected: UploadLocatorCandidateMatch[] = [];

    for (let scopeIndex = 0; scopeIndex < scopes.length; scopeIndex += 1) {
      const entry = scopes[scopeIndex];
      if (typeof entry.scope?.evaluate !== 'function') {
        continue;
      }

      const candidates = await entry.scope.evaluate(() => {
        const normalize = (value: string | null | undefined) => String(value || '')
          .replace(/\s+/g, ' ')
          .trim();
        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
        const readNearbyText = (input: HTMLInputElement) => {
          const chunks = [
            input.closest('label')?.textContent,
            input.id ? document.querySelector(`label[for="${input.id}"]`)?.textContent : '',
            input.parentElement?.textContent,
            input.closest('[class*="upload"], [class*="attach"], [id*="upload"], [id*="attach"]')?.textContent,
            input.previousElementSibling?.textContent,
            input.nextElementSibling?.textContent,
          ];
          return normalize(chunks.filter(Boolean).join(' '));
        };

        return fileInputs.map((input, index) => ({
          index,
          requestFieldName: normalize(input.name || input.id || ''),
          inputName: normalize(input.name || ''),
          inputId: normalize(input.id || ''),
          directMeta: normalize([
            input.name,
            input.id,
            input.title,
            input.getAttribute('aria-label'),
            input.getAttribute('placeholder'),
            input.className,
          ].filter(Boolean).join(' ')),
          nearbyText: readNearbyText(input),
          fileInputCountInScope: fileInputs.length,
        }));
      }).catch(() => []);

      if (!Array.isArray(candidates)) {
        continue;
      }

      for (const candidate of candidates) {
        if (!Number.isFinite(candidate?.index)) {
          continue;
        }

        collected.push({
          candidateId: `scope-${scopeIndex}:${candidate.index}`,
          locator: entry.scope.locator('input[type="file"]').nth(candidate.index),
          requestFieldName: candidate.requestFieldName || undefined,
          scopeDescription: entry.description,
          scopeUrl: typeof entry.scope?.url === 'function' ? entry.scope.url() : undefined,
          inputName: candidate.inputName || undefined,
          inputId: candidate.inputId || undefined,
          directMeta: candidate.directMeta || undefined,
          nearbyText: candidate.nearbyText || undefined,
          fileInputCountInScope: candidate.fileInputCountInScope,
        });
      }
    }

    return collected;
  }

  private async findUniqueFileInputLocator(
    scopes: PlaywrightLocatorScope[],
  ): Promise<UploadLocatorMatch | null> {
    const matches: Array<{ scope: any; index: number; requestFieldName?: string }> = [];

    for (const entry of scopes) {
      const count = await entry.scope.locator('input[type="file"]').count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const locator = entry.scope.locator('input[type="file"]').nth(index);
        matches.push({
          scope: entry.scope,
          index,
          requestFieldName: await this.readLocatorRequestFieldName(locator),
        });
      }
    }

    if (matches.length !== 1) {
      return null;
    }

    return {
      locator: matches[0].scope.locator('input[type="file"]').nth(matches[0].index),
      requestFieldName: matches[0].requestFieldName,
    };
  }

  private async readLocatorRequestFieldName(locator: any) {
    return locator.evaluate((node: Element) => {
      if (!(node instanceof HTMLInputElement)) {
        return '';
      }
      return String(node.name || node.id || '').trim();
    }).catch(() => '');
  }

  private async describeUploadLocatorState(
    session: BrowserSessionRecord,
    element: BrowserSnapshotElement,
  ) {
    const state = await this.ensureSession(session);
    const scopes = this.getLocatorScopes(state);
    const labels = this.collectUploadLocatorLabels(element);
    const scopeSummaries = await Promise.all(scopes.map(async (entry) => {
      const fileInputCount = await entry.scope.locator('input[type="file"]').count().catch(() => 0);
      const bodyPreview = typeof entry.scope?.evaluate === 'function'
        ? await entry.scope.evaluate(() =>
          (document.body?.innerText || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300),
        ).catch(() => '')
        : '';

      return {
        description: entry.description,
        fileInputCount,
        url: typeof entry.scope?.url === 'function' ? entry.scope.url() : state.page.url(),
        bodyPreview,
      };
    }));

    return {
      element: {
        ref: element.ref,
        fieldKey: element.fieldKey,
        label: element.label,
        text: element.text,
      },
      labels,
      pageUrl: state.page.url(),
      scopeSummaries,
    };
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

  private buildVisibleFieldKeySelector(fieldKey: string) {
    const escaped = this.escapeCssValue(fieldKey);
    return `[name="${escaped}"]:visible, [id="${escaped}"]:visible`;
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
