'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { withBrowserApiBase } from '../lib/browser-api-base-url';
import {
  buildLoginHref,
  clearClientAuth,
  normalizeClientReturnTo,
} from '../lib/client-auth';
import { getOauthProviderName, isOauth2AuthMode } from '../lib/auth-mode';
import {
  OAUTH_LOGOUT_WAIT_MS,
  triggerOauthLogout,
} from '../lib/oauth-logout';

export default function LogoutPage() {
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const providerName = getOauthProviderName();
  const returnTo = useMemo(
    () => normalizeClientReturnTo(searchParams.get('returnTo') || '/'),
    [searchParams],
  );
  const reauthHref = useMemo(
    () => buildLoginHref(returnTo),
    [returnTo],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await fetch('/api/session', {
        method: 'DELETE',
      }).catch(() => undefined);

      clearClientAuth();

      if (!isOauth2AuthMode()) {
        if (!cancelled) {
          window.location.replace(reauthHref);
        }
        return;
      }

      const logoutUrl = withBrowserApiBase(
        `/api/v1/auth/oauth2/logout?returnTo=${encodeURIComponent(reauthHref)}`,
      );
      void triggerOauthLogout(logoutUrl).catch(() => undefined);

      await new Promise((resolve) => {
        window.setTimeout(resolve, OAUTH_LOGOUT_WAIT_MS);
      });

      if (!cancelled) {
        window.location.replace(reauthHref);
      }
    })().catch(() => {
      clearClientAuth();
      if (cancelled) {
        return;
      }
      setError(`退出${providerName}时出现异常，正在重新发起认证。`);
      window.setTimeout(() => {
        window.location.replace(reauthHref);
      }, 300);
    });

    return () => {
      cancelled = true;
    };
  }, [providerName, reauthHref]);

  return (
    <div className="flex min-h-[calc(100vh-180px)] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600">
            <i className="fas fa-sign-out-alt text-2xl text-white" />
          </div>
          <h1 className="font-brand text-2xl font-bold text-gray-900">正在退出登录</h1>
          <p className="mt-2 text-sm text-gray-500">
            正在清理本系统登录态，并退出{providerName}认证，随后自动重新认证并返回当前页面。
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 text-sm text-blue-700">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
            退出完成后将自动跳转到认证平台并回到系统
          </div>
        )}
      </div>
    </div>
  );
}
