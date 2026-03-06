'use client';

import { useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  children: React.ReactNode;
  allowedRoles?: string[];
}

type AuthState = 'authorized' | 'no_login' | 'no_permission';

function checkAuth(allowedRoles?: string[]): AuthState {
  if (typeof window === 'undefined') return 'no_login';
  const userId = localStorage.getItem('userId');
  if (!userId) return 'no_login';
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
    () => 'authorized' as AuthState,
  );

  if (state === 'no_login') {
    router.push('/login');
    return null;
  }

  if (state === 'no_permission') {
    router.push('/');
    return null;
  }

  return <>{children}</>;
}
