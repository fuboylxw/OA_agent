'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { hasClientSession } from '../lib/client-auth';

interface Props {
  children: React.ReactNode;
  allowedRoles?: string[];
}

type AuthState = 'checking' | 'authorized' | 'no_login' | 'no_permission';

function checkAuth(allowedRoles?: string[]): AuthState {
  if (typeof window === 'undefined') return 'no_login';
  if (!hasClientSession()) return 'no_login';
  if (!allowedRoles) return 'authorized';
  try {
    const roles: string[] = JSON.parse(localStorage.getItem('roles') || '[]');
    return allowedRoles.some((r) => roles.includes(r)) ? 'authorized' : 'no_permission';
  } catch {
    return 'no_permission';
  }
}

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
}

export default function AuthGuard({ children, allowedRoles }: Props) {
  const router = useRouter();

  const state = useSyncExternalStore(
    subscribe,
    () => checkAuth(allowedRoles),
    () => 'checking' as AuthState,
  );

  useEffect(() => {
    if (state === 'no_login') {
      router.replace('/login');
      return;
    }

    if (state === 'no_permission') {
      router.replace('/');
    }
  }, [router, state]);

  if (state !== 'authorized') {
    return null;
  }

  return <>{children}</>;
}
