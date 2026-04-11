export type ClientUserProfile = {
  userId: string;
  username: string;
  displayName: string;
  roles: string[];
  tenantId: string;
};

export type ClientAuthSnapshot = ClientUserProfile & {
  sessionToken: string;
  hasSession: boolean;
  hasProfile: boolean;
};

const AUTH_CHANGE_EVENT = 'uniflow:auth-change';
const EMPTY_AUTH_SNAPSHOT: ClientAuthSnapshot = {
  userId: '',
  username: '',
  displayName: '',
  roles: [],
  tenantId: '',
  sessionToken: '',
  hasSession: false,
  hasProfile: false,
};

let cachedSnapshot: ClientAuthSnapshot = EMPTY_AUTH_SNAPSHOT;

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

function parseStoredRoles() {
  if (typeof window === 'undefined') {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(localStorage.getItem('roles') || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function dispatchClientAuthChange() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function subscribeClientAuth(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const listener = callback as EventListener;
  window.addEventListener('storage', listener);
  window.addEventListener(AUTH_CHANGE_EVENT, listener);

  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(AUTH_CHANGE_EVENT, listener);
  };
}

export function getClientAuthSnapshot(): ClientAuthSnapshot {
  if (typeof window === 'undefined') {
    return EMPTY_AUTH_SNAPSHOT;
  }

  const sessionToken = getClientSessionToken();
  const userId = localStorage.getItem('userId') || '';
  const username = localStorage.getItem('username') || '';
  const displayName = localStorage.getItem('displayName') || '';
  const tenantId = localStorage.getItem('tenantId') || '';
  const roles = parseStoredRoles();

  const nextSnapshot: ClientAuthSnapshot = {
    userId,
    username,
    displayName,
    roles,
    tenantId,
    sessionToken,
    hasSession: Boolean(sessionToken),
    hasProfile: Boolean(userId && tenantId),
  };

  if (
    cachedSnapshot.userId === nextSnapshot.userId
    && cachedSnapshot.username === nextSnapshot.username
    && cachedSnapshot.displayName === nextSnapshot.displayName
    && cachedSnapshot.tenantId === nextSnapshot.tenantId
    && cachedSnapshot.sessionToken === nextSnapshot.sessionToken
    && cachedSnapshot.hasSession === nextSnapshot.hasSession
    && cachedSnapshot.hasProfile === nextSnapshot.hasProfile
    && cachedSnapshot.roles.length === nextSnapshot.roles.length
    && cachedSnapshot.roles.every((role, index) => role === nextSnapshot.roles[index])
  ) {
    return cachedSnapshot;
  }

  cachedSnapshot = nextSnapshot;
  return cachedSnapshot;
}

export function hasClientSession() {
  return Boolean(getClientSessionToken());
}

export function hasClientUserProfile() {
  return getClientAuthSnapshot().hasProfile;
}

export function requireClientSessionToken() {
  const sessionToken = getClientSessionToken();
  if (!sessionToken) {
    throw new Error('Missing auth session');
  }
  return sessionToken;
}

export function getClientUserInfo() {
  const snapshot = getClientAuthSnapshot();
  return {
    userId: snapshot.userId,
    username: snapshot.username,
    displayName: snapshot.displayName,
    roles: snapshot.roles,
    tenantId: snapshot.tenantId,
  };
}

export function persistClientUserProfile(profile: Partial<ClientUserProfile>) {
  if (typeof window === 'undefined') {
    return;
  }

  if (typeof profile.userId === 'string') {
    localStorage.setItem('userId', profile.userId);
  }
  if (typeof profile.username === 'string') {
    localStorage.setItem('username', profile.username);
  }
  if (typeof profile.displayName === 'string') {
    localStorage.setItem('displayName', profile.displayName);
  }
  if (Array.isArray(profile.roles)) {
    localStorage.setItem('roles', JSON.stringify(profile.roles));
  }
  if (typeof profile.tenantId === 'string') {
    localStorage.setItem('tenantId', profile.tenantId);
  }

  dispatchClientAuthChange();
}

export function persistClientSessionAuth(input: ClientUserProfile & { sessionToken: string }) {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem('sessionToken', input.sessionToken);
  persistClientUserProfile(input);
}

export function normalizeClientReturnTo(value?: string | null) {
  const normalized = (value || '').trim();
  if (!normalized || !normalized.startsWith('/') || normalized.startsWith('//')) {
    return '/';
  }

  return normalized;
}

export function buildLoginHref(returnTo?: string | null) {
  const normalized = normalizeClientReturnTo(returnTo);
  if (normalized === '/') {
    return '/login';
  }

  return `/login?returnTo=${encodeURIComponent(normalized)}`;
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

  dispatchClientAuthChange();
}

export function buildClientAuthHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers);
  const sessionToken = requireClientSessionToken();
  if (!merged.has('Authorization')) {
    merged.set('Authorization', `Bearer ${sessionToken}`);
  }
  return merged;
}
