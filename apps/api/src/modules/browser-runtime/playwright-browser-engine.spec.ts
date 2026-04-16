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
});
