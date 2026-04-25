import { PlaywrightBrowserEngineAdapter } from './playwright-browser-engine';

describe('PlaywrightBrowserEngineAdapter', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('prefers text locators for ad-hoc text click targets', async () => {
    const engine = new PlaywrightBrowserEngineAdapter();
    const labelLocator = {
      click: jest.fn().mockResolvedValue(undefined),
    };
    const textLocator = {
      click: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      getByLabel: jest.fn(() => ({
        first: () => labelLocator,
      })),
      getByText: jest.fn(() => ({
        first: () => textLocator,
      })),
    };

    (engine as any).sessions.set('session-1', {
      browser: {},
      context: {},
      page,
    });

    await engine.click(
      { sessionId: 'session-1' } as any,
      { artifacts: {} } as any,
      {
        ref: 'adhoc-click',
        role: 'button',
        label: '点击 请假申请',
        text: '请假申请',
        targetHints: [{ kind: 'text', value: '请假申请' }],
      } as any,
      { kind: 'text', value: '请假申请' } as any,
    );

    expect(page.getByText).toHaveBeenCalledWith('请假申请', { exact: false });
    expect(textLocator.click).toHaveBeenCalled();
    expect(page.getByLabel).not.toHaveBeenCalled();
  });

  it('restores storageState and skips duplicate bootstrap cookies', async () => {
    const addCookies = jest.fn().mockResolvedValue(undefined);
    const newContext = jest.fn().mockResolvedValue({
      addCookies,
      newPage: jest.fn().mockResolvedValue({}),
    });

    jest.doMock('playwright', () => ({
      chromium: {
        launch: jest.fn().mockResolvedValue({
          newContext,
          close: jest.fn().mockResolvedValue(undefined),
        }),
      },
    }), { virtual: true });

    const { PlaywrightBrowserEngineAdapter: Adapter } = require('./playwright-browser-engine');
    const engine = new Adapter();

    await (engine as any).ensureSession({
      sessionId: 'session-storage',
      headless: true,
      storageState: JSON.stringify({
        cookies: [{
          name: 'XPU-SESSION',
          value: 'from-storage',
          url: 'https://sz.xpu.edu.cn',
        }],
        origins: [],
      }),
      cookieHeader: 'XPU-SESSION=from-header',
      cookieOrigin: 'https://sz.xpu.edu.cn',
    });

    expect(newContext).toHaveBeenCalledWith({
      storageState: {
        cookies: [{
          name: 'XPU-SESSION',
          value: 'from-storage',
          url: 'https://sz.xpu.edu.cn',
        }],
        origins: [],
      },
    });
    expect(addCookies).not.toHaveBeenCalled();
  });

  it('adds bootstrap cookies when no storageState is available', async () => {
    const addCookies = jest.fn().mockResolvedValue(undefined);
    const newContext = jest.fn().mockResolvedValue({
      addCookies,
      newPage: jest.fn().mockResolvedValue({}),
    });

    jest.doMock('playwright', () => ({
      chromium: {
        launch: jest.fn().mockResolvedValue({
          newContext,
          close: jest.fn().mockResolvedValue(undefined),
        }),
      },
    }), { virtual: true });

    const { PlaywrightBrowserEngineAdapter: Adapter } = require('./playwright-browser-engine');
    const engine = new Adapter();

    await (engine as any).ensureSession({
      sessionId: 'session-cookie',
      headless: true,
      cookieHeader: 'XPU-SESSION=header-value; route=portal',
      cookieOrigin: 'https://sz.xpu.edu.cn',
    });

    expect(addCookies).toHaveBeenCalledWith([
      {
        name: 'XPU-SESSION',
        value: 'header-value',
        path: '/',
        url: 'https://sz.xpu.edu.cn',
      },
      {
        name: 'route',
        value: 'portal',
        path: '/',
        url: 'https://sz.xpu.edu.cn',
      },
    ]);
  });

  it('prefers field-key locators over inferred labels for form inputs', async () => {
    const engine = new PlaywrightBrowserEngineAdapter();
    const fill = jest.fn().mockResolvedValue(undefined);
    const fieldKeyLocator = {
      evaluate: jest.fn().mockResolvedValue({
        tagName: 'input',
        type: 'text',
        value: '',
      }),
      fill,
    };
    const page = {
      locator: jest.fn(() => ({
        first: () => fieldKeyLocator,
      })),
      getByLabel: jest.fn(() => ({
        first: () => ({
          evaluate: jest.fn().mockResolvedValue({
            tagName: 'input',
            type: 'text',
            value: '',
          }),
          fill: jest.fn(),
        }),
      })),
    };

    (engine as any).sessions.set('session-2', {
      browser: {},
      context: {},
      page,
    });

    await engine.input(
      { sessionId: 'session-2' } as any,
      { formValues: {} } as any,
      {
        ref: 'captured-input',
        role: 'input',
        fieldKey: 'field_1',
        label: '寮€濮嬫棩鏈?',
      } as any,
      '2026-04-09',
    );

    expect(page.locator).toHaveBeenCalledWith('[name=\"field_1\"]:visible, [id=\"field_1\"]:visible');
    expect(fill).toHaveBeenCalledWith('2026-04-09');
    expect(page.getByLabel).not.toHaveBeenCalled();
  });

  it('does not fail initialization when title lookup races with navigation', async () => {
    const engine = new PlaywrightBrowserEngineAdapter();
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue('https://sz.xpu.edu.cn/'),
      title: jest.fn().mockRejectedValue(new Error('Execution context was destroyed')),
    };

    (engine as any).sessions.set('session-3', {
      browser: {},
      context: {},
      page,
    });

    const tab = {
      url: 'https://sz.xpu.edu.cn/',
      title: '请假申请',
      history: ['https://sz.xpu.edu.cn/'],
      pageVersion: 1,
    };

    await expect(
      engine.initialize(
        { sessionId: 'session-3' } as any,
        tab as any,
      ),
    ).resolves.toBeUndefined();

    expect(tab.url).toBe('https://sz.xpu.edu.cn/');
    expect(tab.title).toBe('请假申请');
  });

  it('does not fuzzy-match generic select fragments', () => {
    const engine = new PlaywrightBrowserEngineAdapter();

    const result = (engine as any).findMatchingSelectOption(
      [
        { value: 'offline', label: '线下办理', text: '线下办理' },
        { value: 'online', label: '线上办理', text: '线上办理' },
      ],
      '办理',
    );

    expect(result).toBeNull();
  });

  it('executes evaluation scripts against the page context', async () => {
    const engine = new PlaywrightBrowserEngineAdapter();
    const page = {
      evaluate: jest.fn(async (fn: any, arg: any) => fn(arg)),
    };

    (engine as any).sessions.set('session-4', {
      browser: {},
      context: {},
      page,
    });

    const tab = {
      artifacts: {},
    } as any;

    const result = await engine.evaluate(
      { sessionId: 'session-4' } as any,
      tab,
      'return { reason: context.formData.reason, jumpUrl: context.ticket.jumpUrl };',
      {
        formData: {
          reason: '出差开会',
        },
        ticket: {
          jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
        },
      },
    );

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      reason: '出差开会',
      jumpUrl: 'https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl',
    });
    expect(tab.artifacts.lastEvaluatedValue).toEqual(result);
  });

  it('falls back to the only file input across frames for upload steps', async () => {
    const engine = new PlaywrightBrowserEngineAdapter();
    const uploadLocator = {
      setInputFiles: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(''),
    };
    const emptyLocator = {
      count: jest.fn().mockResolvedValue(0),
      first: jest.fn().mockReturnThis(),
      nth: jest.fn().mockReturnThis(),
      evaluate: jest.fn().mockResolvedValue(''),
    };
    const fileLocatorCollection = {
      count: jest.fn().mockResolvedValue(1),
      nth: jest.fn().mockReturnValue(uploadLocator),
      first: jest.fn().mockReturnValue(uploadLocator),
    };
    const mainFrame = {};
    const childFrame = {
      locator: jest.fn((selector: string) => {
        if (selector === 'input[type="file"]') {
          return fileLocatorCollection;
        }
        return emptyLocator;
      }),
      getByLabel: jest.fn(() => emptyLocator),
      evaluate: jest.fn().mockResolvedValue({
        index: 0,
        requestFieldName: '',
        score: 2,
      }),
      url: jest.fn(() => 'https://oa2023.xpu.edu.cn/custom-frame'),
    };
    const page = {
      locator: jest.fn(() => emptyLocator),
      getByLabel: jest.fn(() => emptyLocator),
      frames: jest.fn(() => [mainFrame, childFrame]),
      mainFrame: jest.fn(() => mainFrame),
    };

    (engine as any).sessions.set('session-upload', {
      browser: {},
      context: {},
      page,
    });

    const tab = {
      uploads: [],
      extractedValues: {},
    } as any;

    await engine.upload(
      { sessionId: 'session-upload' } as any,
      tab,
      {
        ref: 'upload-1',
        role: 'upload',
        fieldKey: 'field_2',
        label: '用印附件',
      } as any,
      '/tmp/test-upload.pdf',
    );

    expect(uploadLocator.setInputFiles).toHaveBeenCalledWith(['/tmp/test-upload.pdf']);
    expect(tab.uploads).toEqual([
      {
        fieldKey: 'field_2',
        filename: 'test-upload.pdf',
      },
    ]);
  });

  it('uses shared upload inference to choose the scoped frame upload input when direct rules are ambiguous', async () => {
    const engine = new PlaywrightBrowserEngineAdapter();
    const frameUrl = 'https://example.com/frame/upload';
    const mainUploadLocator = {
      setInputFiles: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(''),
    };
    const frameUploadLocator = {
      setInputFiles: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(''),
    };
    const emptyLocator = {
      count: jest.fn().mockResolvedValue(0),
      first: jest.fn().mockReturnThis(),
      nth: jest.fn().mockReturnThis(),
      locator: jest.fn().mockReturnThis(),
      evaluate: jest.fn().mockResolvedValue(''),
    };
    const buildScope = (uploadLocator: any, nearbyText: string, scopeUrl: string) => ({
      locator: jest.fn((selector: string) => {
        if (selector === 'input[type="file"]') {
          return {
            count: jest.fn().mockResolvedValue(1),
            nth: jest.fn().mockReturnValue(uploadLocator),
            first: jest.fn().mockReturnValue(uploadLocator),
          };
        }
        return emptyLocator;
      }),
      getByLabel: jest.fn(() => emptyLocator),
      evaluate: jest.fn((_fn?: any, arg?: any) => {
        if (arg && Object.prototype.hasOwnProperty.call(arg, 'hintText')) {
          return Promise.resolve(null);
        }
        return Promise.resolve([
          {
            index: 0,
            requestFieldName: scopeUrl === frameUrl ? 'seal_attachment' : 'other_attachment',
            inputName: '',
            inputId: '',
            directMeta: 'attach-file',
            nearbyText,
            fileInputCountInScope: 1,
          },
        ]);
      }),
      url: jest.fn(() => scopeUrl),
    });
    const mainFrame = {};
    const page = {
      ...buildScope(mainUploadLocator, '用印附件 上传', 'https://example.com/main'),
      frames: jest.fn(() => [mainFrame, buildScope(frameUploadLocator, '用印附件 上传', frameUrl)]),
      mainFrame: jest.fn(() => mainFrame),
    };

    (engine as any).sessions.set('session-upload-infer', {
      browser: {},
      context: {},
      page,
    });

    const tab = {
      uploads: [],
      extractedValues: {},
    } as any;

    await engine.upload(
      { sessionId: 'session-upload-infer' } as any,
      tab,
      {
        ref: 'upload-frame',
        role: 'upload',
        fieldKey: 'seal_attachment',
        label: '用印附件',
        targetHints: [
          {
            kind: 'url',
            value: frameUrl,
            label: 'scope:frame',
          },
        ],
      } as any,
      '/tmp/frame-upload.pdf',
    );

    expect(frameUploadLocator.setInputFiles).toHaveBeenCalledWith(['/tmp/frame-upload.pdf']);
    expect(mainUploadLocator.setInputFiles).not.toHaveBeenCalled();
  });

  it('merges accessible child-frame captures into the page snapshot', async () => {
    const engine = new PlaywrightBrowserEngineAdapter();
    const mainFrame = {};
    const childFrame = {
      evaluate: jest.fn().mockResolvedValue({
        title: 'Frame Form',
        url: 'https://example.com/frame/form',
        regions: [],
        forms: [],
        tables: [],
        dialogs: [],
        importantTexts: ['Frame Form'],
        interactiveElements: [
          {
            ref: 'frame-e1',
            role: 'input',
            selector: '[name="frame_field"]',
            label: 'Frame 字段',
          },
        ],
      }),
      url: jest.fn(() => 'https://example.com/frame/form'),
    };
    const page = {
      evaluate: jest.fn().mockResolvedValue({
        title: 'Main Page',
        url: 'https://example.com/main',
        regions: [],
        forms: [],
        tables: [],
        dialogs: [],
        importantTexts: ['Main Page'],
        interactiveElements: [
          {
            ref: 'main-e1',
            role: 'button',
            selector: '#submit',
            label: '提交',
          },
        ],
      }),
      frames: jest.fn(() => [mainFrame, childFrame]),
      mainFrame: jest.fn(() => mainFrame),
    };

    (engine as any).sessions.set('session-capture-frame', {
      browser: {},
      context: {},
      page,
    });

    const capture = await engine.capturePage(
      { sessionId: 'session-capture-frame' } as any,
      { artifacts: {} } as any,
    );

    expect(capture?.interactiveElements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selector: '[name="frame_field"]',
        regionId: 'frame-1',
        targetHints: expect.arrayContaining([
          expect.objectContaining({
            kind: 'url',
            value: 'https://example.com/frame/form',
            label: 'scope:frame',
          }),
        ]),
      }),
    ]));
    expect(capture?.regions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'frame-1',
        summary: 'https://example.com/frame/form',
      }),
    ]));
  });

  it('prefers the scoped frame locator before checking the main page', async () => {
    const engine = new PlaywrightBrowserEngineAdapter();
    const mainFrame = {};
    const childTextLocator = {
      count: jest.fn().mockResolvedValue(1),
      click: jest.fn().mockResolvedValue(undefined),
    };
    const childFrame = {
      getByText: jest.fn(() => ({
        first: () => childTextLocator,
      })),
      url: jest.fn(() => 'https://example.com/frame/send'),
    };
    const page = {
      getByText: jest.fn(() => ({
        first: () => ({
          count: jest.fn().mockResolvedValue(1),
          click: jest.fn().mockResolvedValue(undefined),
        }),
      })),
      frames: jest.fn(() => [mainFrame, childFrame]),
      mainFrame: jest.fn(() => mainFrame),
    };

    (engine as any).sessions.set('session-frame-click', {
      browser: {},
      context: {},
      page,
    });

    await engine.click(
      { sessionId: 'session-frame-click' } as any,
      { artifacts: {} } as any,
      {
        ref: 'frame-send',
        role: 'button',
        text: '发送',
        targetHints: [
          {
            kind: 'url',
            value: 'https://example.com/frame/send',
            label: 'scope:frame',
          },
        ],
      } as any,
      { kind: 'text', value: '发送' } as any,
    );

    expect(childFrame.getByText).toHaveBeenCalledWith('发送', { exact: false });
    expect(childTextLocator.click).toHaveBeenCalled();
    expect(page.getByText).not.toHaveBeenCalled();
  });
});
