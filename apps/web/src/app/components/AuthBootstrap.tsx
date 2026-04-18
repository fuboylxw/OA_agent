'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { withBrowserApiBase } from '../lib/browser-api-base-url';
import {
  buildClientAuthHeaders,
  buildLoginHref,
  clearClientAuth,
  getClientAuthSnapshot,
  hasClientUserProfile,
  persistClientUserProfile,
} from '../lib/client-auth';

function isPublicRoute(pathname?: string | null) {
  const normalized = pathname || '';
  return normalized === '/login'
    || normalized.startsWith('/login/')
    || normalized === '/logout'
    || normalized.startsWith('/logout/');
}

function getCurrentReturnTo() {
  if (typeof window === 'undefined') {
    return '/';
  }

  return `${window.location.pathname}${window.location.search}`;
}

export default function AuthBootstrap() {
  const router = useRouter();
  const pathname = usePathname() || '';
  const inflightSessionRef = useRef('');

  useEffect(() => {
    const snapshot = getClientAuthSnapshot();

    if (!snapshot.hasSession) {
      inflightSessionRef.current = '';
      if (!isPublicRoute(pathname)) {
        router.replace(buildLoginHref(getCurrentReturnTo()));
      }
      return;
    }

    if (pathname === '/login' && snapshot.hasProfile) {
      router.replace('/');
      return;
    }

    if (hasClientUserProfile()) {
      inflightSessionRef.current = '';
      return;
    }

    if (inflightSessionRef.current === snapshot.sessionToken) {
      return;
    }

    inflightSessionRef.current = snapshot.sessionToken;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(withBrowserApiBase('/api/v1/auth/me'), {
          headers: buildClientAuthHeaders(),
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`AUTH_ME_${response.status || 500}`);
        }

        const payload = await response.json().catch(() => null) as {
          userId?: string;
          username?: string;
          displayName?: string;
          roles?: string[];
          tenantId?: string;
        } | null;

        if (cancelled || !payload) {
          return;
        }

        persistClientUserProfile({
          userId: payload.userId || '',
          username: payload.username || '',
          displayName: payload.displayName || payload.username || payload.userId || '',
          roles: Array.isArray(payload.roles) ? payload.roles : ['user'],
          tenantId: payload.tenantId || '',
        });

        if (pathname === '/login') {
          router.replace('/');
        }
      } catch {
        if (cancelled) {
          return;
        }

        clearClientAuth();
        if (!isPublicRoute(pathname)) {
          router.replace(buildLoginHref(getCurrentReturnTo()));
        }
      } finally {
        if (!cancelled) {
          inflightSessionRef.current = '';
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
