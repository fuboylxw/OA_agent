class LocalStorageStub {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

describe('api client auth redirects', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();

    const localStorage = new LocalStorageStub();
    const cookieState = { value: '' };
    const locationState = {
      pathname: '/chat',
      search: '?sessionId=abc',
      href: 'http://localhost/chat?sessionId=abc',
    };

    (global as any).window = {
      localStorage,
      dispatchEvent: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      location: locationState,
    };

    (global as any).localStorage = localStorage;
    (global as any).document = {};
    Object.defineProperty(global.document, 'cookie', {
      configurable: true,
      get: () => cookieState.value,
      set: (next: string) => {
        const [pair] = String(next || '').split(';');
        const [rawName, ...rawValue] = pair.split('=');
        const name = rawName?.trim() || '';
        const value = rawValue.join('=').trim();
        const cookieMap = new Map(
          cookieState.value
            .split('; ')
            .filter(Boolean)
            .map((entry) => {
              const [entryName, ...entryValue] = entry.split('=');
              return [entryName, entryValue.join('=')];
            }),
        );

        if (!name) {
          return;
        }

        if (value) {
          cookieMap.set(name, value);
        } else {
          cookieMap.delete(name);
        }

        cookieState.value = [...cookieMap.entries()]
          .map(([entryName, entryValue]) => `${entryName}=${entryValue}`)
          .join('; ');
      },
    });
  });

  afterEach(() => {
    (global as any).window = originalWindow;
    (global as any).document = originalDocument;
    delete (global as any).localStorage;
    global.fetch = originalFetch;
  });

  it('redirects to login before fetch when session token is missing', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    const { authFetch } = await import('./api-client');

    void authFetch('/api/v1/submissions');
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.location.href).toBe('/login?returnTo=%2Fchat%3FsessionId%3Dabc');
  });

  it('redirects to login when fetch returns 401', async () => {
    localStorage.setItem('sessionToken', 'token-123');
    global.fetch = jest.fn().mockResolvedValue({
      status: 401,
    }) as any;
    const { authFetch } = await import('./api-client');

    void authFetch('/api/v1/submissions');
    await Promise.resolve();
    await Promise.resolve();

    expect(window.location.href).toBe('/login?returnTo=%2Fchat%3FsessionId%3Dabc');
  });
});
