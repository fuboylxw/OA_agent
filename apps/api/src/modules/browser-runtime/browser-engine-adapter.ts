import type { BrowserSnapshotElement, RpaTargetDefinition } from '@uniflow/shared-types';
import type {
  BrowserPageCapture,
  BrowserSessionRecord,
  BrowserTabRecord,
  BrowserTaskWarning,
} from './browser-runtime.types';
import { PlaywrightBrowserEngineAdapter } from './playwright-browser-engine';

export interface BrowserEngineAdapter {
  readonly provider: string;
  initialize(session: BrowserSessionRecord, tab: BrowserTabRecord): Promise<void>;
  dispose(session: BrowserSessionRecord): Promise<void>;
  capturePage(session: BrowserSessionRecord, tab: BrowserTabRecord): Promise<BrowserPageCapture | undefined>;
  stabilize(session: BrowserSessionRecord, tab: BrowserTabRecord, timeoutMs?: number): Promise<void>;
  navigate(session: BrowserSessionRecord, tab: BrowserTabRecord, url: string): Promise<void>;
  input(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ): Promise<void>;
  select(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ): Promise<void>;
  click(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    target?: RpaTargetDefinition,
  ): Promise<void>;
  upload(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ): Promise<void>;
  extract(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
  ): Promise<any>;
  download(
    session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
  ): Promise<any>;
  screenshot(session: BrowserSessionRecord, tab: BrowserTabRecord): Promise<any>;
}

export class BrowserEngineFactory {
  create(provider: string | undefined) {
    if (!provider || provider === 'stub') {
      return {
        adapter: new StubBrowserEngineAdapter(),
        warnings: [] as BrowserTaskWarning[],
      };
    }

    if (provider === 'playwright') {
      try {
        const pw = require('playwright');
        const execPath = pw.chromium?.executablePath?.();
        if (!execPath) {
          throw new Error('no executable path');
        }
        const fs = require('fs');
        if (!fs.existsSync(execPath)) {
          throw new Error('browser binary not found');
        }
        return {
          adapter: new PlaywrightBrowserEngineAdapter(),
          warnings: [] as BrowserTaskWarning[],
        };
      } catch {
        return {
          adapter: new StubBrowserEngineAdapter(),
          warnings: [{
            code: 'browser_provider_fallback',
            message: 'Playwright browsers are not installed in the current runtime, falling back to stub browser engine',
          }],
        };
      }
    }

    return {
      adapter: new StubBrowserEngineAdapter(),
      warnings: [{
        code: 'browser_provider_fallback',
        message: `Browser provider "${provider}" is not available yet, falling back to stub runtime`,
      }],
    };
  }
}

class StubBrowserEngineAdapter implements BrowserEngineAdapter {
  readonly provider = 'stub';

  async initialize(_session: BrowserSessionRecord, _tab: BrowserTabRecord) {
    return;
  }

  async dispose(_session: BrowserSessionRecord) {
    return;
  }

  async capturePage(_session: BrowserSessionRecord, _tab: BrowserTabRecord) {
    return undefined;
  }

  async stabilize(_session: BrowserSessionRecord, _tab: BrowserTabRecord, _timeoutMs?: number) {
    return;
  }

  async navigate(_session: BrowserSessionRecord, tab: BrowserTabRecord, url: string) {
    tab.url = url;
    tab.title = `${tab.flow.processName} - ${tab.action === 'submit' ? 'Submit' : 'Status'}`;
    tab.history.push(url);
    tab.pageVersion += 1;
  }

  async input(
    _session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ) {
    const key = element?.fieldKey || element?.label || element?.selector || `field_${Object.keys(tab.formValues).length + 1}`;
    tab.formValues[key] = value;
  }

  async select(
    _session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ) {
    const key = element?.fieldKey || element?.label || element?.selector || `select_${Object.keys(tab.formValues).length + 1}`;
    tab.formValues[key] = value;
  }

  async click(
    _session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    _target?: RpaTargetDefinition,
  ) {
    tab.artifacts.lastClickedRef = element?.ref;
    tab.artifacts.lastClickedLabel = element?.label || element?.text;
  }

  async upload(
    _session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
    value: any,
  ) {
    const filename = typeof value === 'string'
      ? value
      : value?.filename || value?.name || 'upload.bin';
    tab.uploads.push({
      fieldKey: element?.fieldKey,
      filename,
    });
  }

  async extract(
    _session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
  ) {
    if (element?.fieldKey && tab.formValues[element.fieldKey] !== undefined) {
      return tab.formValues[element.fieldKey];
    }

    if (element?.fieldKey && tab.extractedValues[element.fieldKey] !== undefined) {
      return tab.extractedValues[element.fieldKey];
    }

    if (element?.role === 'status') {
      return tab.extractedValues.status || 'submitted';
    }

    return element?.text || element?.label || '';
  }

  async download(
    _session: BrowserSessionRecord,
    tab: BrowserTabRecord,
    element: BrowserSnapshotElement | undefined,
  ) {
    const filename = `${tab.flow.processCode}-${element?.fieldKey || 'download'}.dat`;
    tab.artifacts.lastDownload = filename;
    return filename;
  }

  async screenshot(_session: BrowserSessionRecord, tab: BrowserTabRecord) {
    const screenshotCount = Number(tab.artifacts.screenshotCount || 0) + 1;
    tab.artifacts.screenshotCount = screenshotCount;
    const screenshotId = `screenshot-${tab.pageVersion}-${screenshotCount}`;
    tab.artifacts.lastScreenshot = screenshotId;
    return screenshotId;
  }
}
