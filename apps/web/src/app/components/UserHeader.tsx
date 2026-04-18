'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import {
  buildLoggedOutLoginHref,
  clearClientAuth,
  getClientAuthServerSnapshot,
  getClientAuthSnapshot,
  normalizeClientReturnTo,
  subscribeClientAuth,
} from '../lib/client-auth';
import { withBrowserApiBase } from '../lib/browser-api-base-url';
import { getOauthProviderName, isOauth2AuthMode } from '../lib/auth-mode';
import { OAUTH_TOP_LEVEL_LOGOUT_WAIT_MS } from '../lib/oauth-logout';
import { getRoleDisplayName } from '../lib/access-control';

function shouldHideUserHeader(pathname: string) {
  return pathname.startsWith('/login') || pathname.startsWith('/logout');
}

export default function UserHeader() {
  const [showMenu, setShowMenu] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname() || '';
  const snapshot = useSyncExternalStore(
    subscribeClientAuth,
    getClientAuthSnapshot,
    getClientAuthServerSnapshot,
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (shouldHideUserHeader(pathname)) {
    return null;
  }

  const displayName = snapshot.displayName || snapshot.username || snapshot.userId || 'User';
  const initial = (displayName || 'U').charAt(0).toUpperCase();
  const roles = snapshot.roles;
  const providerName = getOauthProviderName();

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setShowMenu(false);
    const currentPath = typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search || ''}`
      : '/';
    const returnTo = normalizeClientReturnTo(currentPath);

    if (!isOauth2AuthMode()) {
      window.location.href = `/logout?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }

    const reauthStartUrl = withBrowserApiBase(
      `/api/v1/auth/oauth2/start?returnTo=${encodeURIComponent(returnTo)}`,
    );
    const popupReturnHref = buildLoggedOutLoginHref('/');
    const logoutUrl = withBrowserApiBase(
      `/api/v1/auth/oauth2/logout?returnTo=${encodeURIComponent(popupReturnHref)}`,
    );
    const popup = window.open(
      logoutUrl,
      'uniflow-oauth-logout',
      'popup=yes,width=520,height=720',
    );

    setLogoutError('');
    setIsLoggingOut(true);

    if (!popup) {
      setLogoutError(`浏览器阻止了${providerName}退出窗口，正在回退到普通退出流程。`);
      window.setTimeout(() => {
        window.location.href = `/logout?returnTo=${encodeURIComponent(returnTo)}`;
      }, 300);
      return;
    }

    try {
      await fetch('/api/session', {
        method: 'DELETE',
      }).catch(() => undefined);

      clearClientAuth();

      await new Promise((resolve) => {
        window.setTimeout(resolve, OAUTH_TOP_LEVEL_LOGOUT_WAIT_MS);
      });
    } finally {
      try {
        popup.close();
      } catch {
        // ignore
      }

      window.location.replace(reauthStartUrl);
    }
  };

  const isAdmin = roles.includes('admin');
  const isFlowManager = roles.includes('flow_manager');
  const roleDisplayName = getRoleDisplayName(roles);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center space-x-2 rounded-lg px-2 py-1 transition-colors hover:bg-gray-50"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
          <span className="text-sm font-medium text-blue-600">{initial}</span>
        </div>
        <span className="text-sm text-gray-700">{snapshot.hasProfile ? displayName : '加载中...'}</span>
        {(isAdmin || isFlowManager) && (
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-600">管理员</span>
        )}
        <i className="fas fa-chevron-down text-xs text-gray-400"></i>
      </button>

      {showMenu && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <div className="border-b border-gray-100 px-4 py-2">
            <p className="text-sm font-medium text-gray-900">{displayName}</p>
            <p className="text-xs text-gray-500">{roleDisplayName}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
          >
            <i className="fas fa-sign-out-alt text-xs"></i>
            退出登录
          </button>
        </div>
      )}

      {isLoggingOut && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-white/90 px-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-lg">
            <div className="mb-4 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600">
                <i className="fas fa-sign-out-alt text-2xl text-white" />
              </div>
              <h1 className="font-brand text-2xl font-bold text-gray-900">正在退出登录</h1>
              <p className="mt-2 text-sm text-gray-500">
                正在退出{providerName}并准备重新认证，完成后会自动回到当前页面。
              </p>
            </div>

            {logoutError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {logoutError}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3 text-sm text-blue-700">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                正在打开统一认证退出页，并强制进入重新登录
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
