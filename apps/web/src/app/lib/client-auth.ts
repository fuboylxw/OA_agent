export function readCookieValue(name: string) {
  if (typeof document === 'undefined') {
    return '';
  }

  const target = `${name}=`;
  const record = document.cookie
    .split('; ')
    .find((item) => item.startsWith(target));

  if (!record) {
    return '';
  }

  return decodeURIComponent(record.slice(target.length));
}

export function getClientSessionToken() {
  if (typeof window === 'undefined') {
    return '';
  }

  return localStorage.getItem('sessionToken') || readCookieValue('auth_session');
}

export function hasClientSession() {
  return Boolean(getClientSessionToken());
}

export function requireClientSessionToken() {
  const sessionToken = getClientSessionToken();
  if (!sessionToken) {
    throw new Error('Missing auth session');
  }
  return sessionToken;
}

export function getClientUserInfo() {
  if (typeof window === 'undefined') {
    return {
      userId: '',
      tenantId: '',
    };
  }

  if (!getClientSessionToken()) {
    return {
      userId: '',
      tenantId: '',
    };
  }

  return {
    userId: localStorage.getItem('userId') || '',
    tenantId: localStorage.getItem('tenantId') || '',
  };
}

export function clearClientAuth() {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem('userId');
  localStorage.removeItem('username');
  localStorage.removeItem('displayName');
  localStorage.removeItem('roles');
  localStorage.removeItem('tenantId');
  localStorage.removeItem('sessionToken');

  document.cookie = 'auth_session=;path=/;max-age=0';
  document.cookie = 'roles=;path=/;max-age=0';
  document.cookie = 'userId=;path=/;max-age=0';
  document.cookie = 'tenantId=;path=/;max-age=0';
  document.cookie = 'displayName=;path=/;max-age=0';
}

export function buildClientAuthHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers);
  const sessionToken = requireClientSessionToken();
  if (!merged.has('Authorization')) {
    merged.set('Authorization', `Bearer ${sessionToken}`);
  }
  return merged;
}
