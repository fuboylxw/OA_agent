import axios from 'axios';
import { getBrowserApiBaseUrl } from './browser-api-base-url';
import { buildClientAuthHeaders, clearClientAuth, requireClientSessionToken } from './client-auth';

export const API_URL = getBrowserApiBaseUrl();

export const apiClient = axios.create({
  baseURL: `${API_URL || ''}/api/v1`,
  timeout: 30000,
});

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
  } catch {
    // no token available — let the request proceed unauthenticated;
    // the 401 response interceptor will redirect to login
  }
  return config;
});

// Handle 401 → redirect to login
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/login')
    ) {
      clearClientAuth();
      window.location.href = '/login';
      return new Promise(() => {}); // never resolves — page is navigating
    }
    return Promise.reject(error);
  },
);

export function authFetch(input: string, init?: RequestInit) {
  return fetch(input, {
    ...init,
    headers: buildClientAuthHeaders(init?.headers),
  });
}
