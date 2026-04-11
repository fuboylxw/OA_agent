'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { withBrowserApiBase } from '../lib/browser-api-base-url';
import { hasClientSession } from '../lib/client-auth';
import { getOauthProviderName } from '../lib/auth-mode';

function buildOauthStartUrl(returnTo?: string | null) {
  const query = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
    ? `?returnTo=${encodeURIComponent(returnTo)}`
    : '';

  return withBrowserApiBase(`/api/v1/auth/oauth2/start${query}`);
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const providerName = getOauthProviderName();
  const startedRef = useRef(false);
  const returnTo = searchParams.get('returnTo');
  const loggedOut = searchParams.get('loggedOut') === '1';

  useEffect(() => {
    if (hasClientSession()) {
      window.location.href = '/';
      return;
    }

    if (loggedOut) {
      startedRef.current = false;
      setLoading(false);
      return;
    }

    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    setError('');
    setLoading(true);
    window.location.href = buildOauthStartUrl(returnTo);
  }, [loggedOut, returnTo]);

  const handleOauthLogin = () => {
    startedRef.current = true;
    setError('');
    setLoading(true);
    window.location.href = buildOauthStartUrl(returnTo);
  };

  return (
    <div className="relative flex min-h-[calc(100vh-180px)] items-center justify-center overflow-hidden">
      <div className="absolute left-1/4 top-1/4 h-[500px] w-[500px] rounded-full bg-blue-100 opacity-40 blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 h-[400px] w-[400px] rounded-full bg-indigo-100 opacity-40 blur-3xl" />

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600">
              <i className="fas fa-bolt text-2xl text-white" />
            </div>
            <h1 className="font-brand text-3xl font-bold text-gray-900">UniFlow</h1>
            <p className="mt-2 text-gray-500">智能办公助手 · 第三方认证登录</p>
          </div>

          {error ? (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              <i className="fas fa-exclamation-circle" />
              {error}
            </div>
          ) : null}

          <div className="space-y-5">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              {loggedOut
                ? `您已退出系统。如需继续使用，请重新发起${providerName}登录。`
                : `当前系统仅支持 ${providerName} 第三方认证登录，不再提供本地用户名密码登录。`}
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={handleOauthLogin}
              className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? `正在跳转到${providerName}...` : `使用${providerName}登录`}
            </button>
            <p className="text-center text-xs text-gray-400">
              {loggedOut
                ? '退出后已停留在本系统页面，不会自动再次跳到统一认证。'
                : '当前页面会自动跳转到学校统一认证；如果浏览器未跳转，可点击上方按钮重试。'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
