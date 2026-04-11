'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  buildLoginHref,
  getClientAuthSnapshot,
  subscribeClientAuth,
} from '../lib/client-auth';

interface Props {
  children: React.ReactNode;
  allowedRoles?: string[];
}

type AuthState = 'checking' | 'authorized' | 'no_login' | 'no_permission';

function checkAuth(allowedRoles?: string[]): AuthState {
  if (typeof window === 'undefined') {
    return 'checking';
  }

  const snapshot = getClientAuthSnapshot();
  if (!snapshot.hasSession) {
    return 'no_login';
  }

  if (!snapshot.hasProfile) {
    return 'checking';
  }

  if (!allowedRoles) {
    return 'authorized';
  }

  return allowedRoles.some((role) => snapshot.roles.includes(role))
    ? 'authorized'
    : 'no_permission';
}

function getCurrentReturnTo() {
  if (typeof window === 'undefined') {
    return '/';
  }

  return `${window.location.pathname}${window.location.search}`;
}

export default function AuthGuard({ children, allowedRoles }: Props) {
  const router = useRouter();

  const state = useSyncExternalStore(
    subscribeClientAuth,
    () => checkAuth(allowedRoles),
    () => 'checking' as AuthState,
  );

  useEffect(() => {
    if (state === 'no_login') {
      router.replace(buildLoginHref(getCurrentReturnTo()));
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
