import { BrowserActionExecutor } from './browser-action-executor';

describe('BrowserActionExecutor', () => {
  it('interpolates selector templates and falls back to ad-hoc elements for extract', async () => {
    const engine = {
      extract: jest.fn().mockResolvedValue('IN_APPROVAL'),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue(undefined),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const session = { sessionId: 'session-1' } as any;
    const tab = {
      tabId: 'tab-1',
      payload: {
        submissionId: 'LV-001',
      },
      extractedValues: {},
      artifacts: {},
    } as any;

    const result = await executor.executeStep(
      session,
      tab,
      {
        type: 'extract',
        fieldKey: 'status',
        selector: 'xpath=//article[contains(., "{{submissionId}}")]//*[contains(@class, "status-chip")]',
        description: 'Read status',
      },
      0,
      'snapshot-1',
    );

    expect(engine.extract).toHaveBeenCalledWith(
      session,
      tab,
      expect.objectContaining({
        fieldKey: 'status',
        selector: 'xpath=//article[contains(., "LV-001")]//*[contains(@class, "status-chip")]',
      }),
    );
    expect(result.extractedValue).toEqual({
      key: 'status',
      value: 'IN_APPROVAL',
    });
  });

  it('prefers runtime formData over step sample values for input steps', async () => {
    const engine = {
      input: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue({
        ref: 'amount-input',
        role: 'input',
        selector: '#amount',
        fieldKey: 'amount',
      }),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const session = { sessionId: 'session-1' } as any;
    const tab = {
      tabId: 'tab-1',
      payload: {
        formData: {
          amount: '888.00',
        },
      },
      extractedValues: {},
      artifacts: {},
    } as any;

    const result = await executor.executeStep(
      session,
      tab,
      {
        type: 'input',
        selector: '#amount',
        fieldKey: 'amount',
        value: '100.00',
        description: 'Fill amount',
      },
      1,
      'snapshot-2',
    );

    expect(engine.input).toHaveBeenCalledWith(
      session,
      tab,
      expect.objectContaining({
        ref: 'amount-input',
        fieldKey: 'amount',
      }),
      '888.00',
    );
    expect(result.stepResult).toMatchObject({
      type: 'input',
      fieldKey: 'amount',
      value: '888.00',
      status: 'executed',
    });
  });

  it('falls back to delegated auth payload for login credential steps', async () => {
    const engine = {
      input: jest.fn().mockResolvedValue(undefined),
      stabilize: jest.fn().mockResolvedValue(undefined),
    };
    const refCache = {
      resolveElement: jest.fn().mockReturnValue({
        ref: 'username-input',
        role: 'input',
        selector: '#username',
        fieldKey: 'username',
      }),
    };
    const securityPolicy = {
      assertStepAllowed: jest.fn(),
      sanitizeUrl: jest.fn((value: string) => value),
    };

    const executor = new BrowserActionExecutor(
      engine as any,
      refCache as any,
      securityPolicy as any,
    );

    const session = { sessionId: 'session-1' } as any;
    const tab = {
      tabId: 'tab-1',
      payload: {
        auth: {
          username: 'delegated-user',
        },
      },
      extractedValues: {},
      artifacts: {},
    } as any;

    await executor.executeStep(
      session,
      tab,
      {
        type: 'input',
        selector: '#username',
        fieldKey: 'username',
        value: 'sample-user',
        description: 'Fill login username',
      },
      0,
      'snapshot-3',
    );

    expect(engine.input).toHaveBeenCalledWith(
      session,
      tab,
      expect.objectContaining({
        ref: 'username-input',
        fieldKey: 'username',
      }),
      'delegated-user',
    );
  });
});
