import {
  buildClientAuthHeaders,
  buildLoggedOutLoginHref,
  buildLoginHref,
  clearClientAuth,
} from './client-auth';

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

describe('client auth href helpers', () => {
  const originalWindow = global.window;
  const originalDocument = global.document;

  beforeEach(() => {
    const localStorage = new LocalStorageStub();
    const cookieState = { value: '' };

    (global as any).window = {
      localStorage,
      dispatchEvent: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
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
  });

  it('builds login href for a specific return path', () => {
    expect(buildLoginHref('/chat?tab=history')).toBe('/login?returnTo=%2Fchat%3Ftab%3Dhistory');
  });

  it('builds logged-out login href for the home page', () => {
    expect(buildLoggedOutLoginHref('/')).toBe('/login?loggedOut=1');
  });

  it('builds logged-out login href with a preserved return path', () => {
    expect(buildLoggedOutLoginHref('/chat?tab=history')).toBe('/login?loggedOut=1&returnTo=%2Fchat%3Ftab%3Dhistory');
  });

  it('builds bearer auth headers from the stored session token', () => {
    localStorage.setItem('sessionToken', 'token-123');
    const headers = buildClientAuthHeaders();
    expect(headers.get('Authorization')).toBe('Bearer token-123');
  });

  it('clears stored auth snapshot and auth_session cookie', () => {
    localStorage.setItem('sessionToken', 'token-123');
    localStorage.setItem('userId', 'user-1');
    document.cookie = 'auth_session=token-123;path=/';

    clearClientAuth();

    expect(localStorage.getItem('sessionToken')).toBeNull();
    expect(localStorage.getItem('userId')).toBeNull();
    expect(document.cookie.includes('auth_session=')).toBe(false);
  });
});
