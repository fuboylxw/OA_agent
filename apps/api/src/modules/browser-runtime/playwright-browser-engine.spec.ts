import { PlaywrightBrowserEngineAdapter } from './playwright-browser-engine';

describe('PlaywrightBrowserEngineAdapter', () => {
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
});
