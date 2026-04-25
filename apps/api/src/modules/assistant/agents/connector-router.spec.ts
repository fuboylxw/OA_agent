import { ConnectorRouter } from './connector-router';

describe('ConnectorRouter', () => {
  let router: ConnectorRouter;

  beforeEach(() => {
    router = new ConnectorRouter({
      connector: {
        findMany: jest.fn(),
      },
    } as any);
  });

  it('selects the only available connector without consulting llm', async () => {
    const result = await router.route(
      'tenant-1',
      'user-1',
      '我要办理流程',
      null,
      [
        { id: 'conn-1', name: '总部OA', oaVendor: 'vendor-a', oaType: 'page' },
      ],
    );

    expect(result.needsSelection).toBe(false);
    expect(result.connectorId).toBe('conn-1');
    expect(result.connectorName).toBe('总部OA');
  });

  it('reuses the session connector when it is still in the candidate set', async () => {
    const result = await router.route(
      'tenant-1',
      'user-1',
      '继续办理',
      'conn-2',
      [
        { id: 'conn-1', name: '总部OA', oaVendor: 'vendor-a', oaType: 'page' },
        { id: 'conn-2', name: '分部OA', oaVendor: 'vendor-b', oaType: 'page' },
      ],
    );

    expect(result.needsSelection).toBe(false);
    expect(result.connectorId).toBe('conn-2');
    expect(result.connectorName).toBe('分部OA');
  });

  it('asks the user to choose when llm routing is unavailable for multiple connectors', async () => {
    (router as any).llmClient = {
      chat: jest.fn().mockRejectedValue(new Error('llm unavailable')),
    };

    const result = await router.route(
      'tenant-1',
      'user-1',
      '我要办理流程',
      null,
      [
        { id: 'conn-1', name: '总部OA', oaVendor: 'vendor-a', oaType: 'page' },
        { id: 'conn-2', name: '分部OA', oaVendor: 'vendor-b', oaType: 'page' },
      ],
    );

    expect(result.needsSelection).toBe(true);
    expect(result.connectorId).toBeNull();
    expect(result.candidates).toEqual([
      { id: 'conn-1', name: '总部OA' },
      { id: 'conn-2', name: '分部OA' },
    ]);
    expect(result.selectionQuestion).toContain('您想在哪个系统中办理');
  });
});
