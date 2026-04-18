import axios from 'axios';
import { getBrowserApiBaseUrl } from './browser-api-base-url';
import {
  buildClientAuthHeaders,
  buildLoginHref,
  clearClientAuth,
  requireClientSessionToken,
} from './client-auth';

export const API_URL = getBrowserApiBaseUrl();

export const apiClient = axios.create({
  baseURL: `${API_URL || ''}/api/v1`,
  timeout: 30000,
});

function isAuthPage(pathname?: string | null) {
  const normalized = pathname || '';
  return normalized.startsWith('/login') || normalized.startsWith('/logout');
}

function getCurrentReturnTo() {
  if (typeof window === 'undefined') {
    return '/';
  }

  return `${window.location.pathname}${window.location.search}`;
}

function redirectToLogin() {
  if (typeof window === 'undefined' || isAuthPage(window.location.pathname)) {
    return;
  }

  clearClientAuth();
  window.location.href = buildLoginHref(getCurrentReturnTo());
}

// Inject auth token
apiClient.interceptors.request.use((config) => {
  if (typeof window === 'undefined') {
    return config;
  }
  try {
    const sessionToken = requireClientSessionToken();
    const headers = (config.headers || {}) as Record<string, string>;
    if (!headers.Authorization) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }
    config.headers = headers as any;
    return config;
  } catch {
    redirectToLogin();
    return new Promise(() => {}) as any;
  }
});

// Handle 401 → redirect to login
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      typeof window !== 'undefined'
    ) {
      redirectToLogin();
      return new Promise(() => {}); // never resolves — page is navigating
    }
    return Promise.reject(error);
  },
);

export async function authFetch(input: string, init?: RequestInit) {
  if (typeof window !== 'undefined') {
    try {
      requireClientSessionToken();
    } catch {
      redirectToLogin();
      return new Promise<Response>(() => {});
    }
  }

  const response = await fetch(input, {
    ...init,
    headers: buildClientAuthHeaders(init?.headers),
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    redirectToLogin();
    return new Promise<Response>(() => {});
  }

  return response;
}
