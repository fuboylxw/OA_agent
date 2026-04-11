'use client';

import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'next/navigation';
import { withBrowserApiBase } from '../../lib/browser-api-base-url';
import { getOauthProviderName } from '../../lib/auth-mode';
import { persistClientSessionAuth } from '../../lib/client-auth';

function normalizeRedirectTarget(value: unknown) {
  if (typeof value !== 'string') {
    return '/';
  }

  const normalized = value.trim();
  if (!normalized || !normalized.startsWith('/') || normalized.startsWith('//')) {
    return '/';
  }

  return normalized;
}

export default function LoginCallbackPage() {
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const providerName = getOauthProviderName();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const code = searchParams.get('code') || '';
    const state = searchParams.get('state') || '';
    const oauthError = searchParams.get('error') || '';

    if (oauthError) {
      setError(`统一认证返回错误：${oauthError}`);
      return;
    }

    if (!code || !state) {
      setError('缺少统一认证回调参数，无法完成登录。');
      return;
    }

    const run = async () => {
      try {
        const response = await axios.post(withBrowserApiBase('/api/v1/auth/oauth2/exchange'), {
          code,
          state,
        });

        const {
          userId,
          username,
          displayName,
          roles,
          tenantId,
          sessionToken,
          sessionExpiresAt,
          redirectTo,
        } = response.data || {};

        await fetch('/api/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionToken,
            sessionExpiresAt,
          }),
        }).then(async (result) => {
          if (!result.ok) {
            const payload = await result.json().catch(() => null);
            throw new Error(payload?.message || 'SESSION_SETUP_FAILED');
          }
        });

        persistClientSessionAuth({
          userId: userId || '',
          username: username || '',
          displayName: displayName || username || userId || '',
          roles: Array.isArray(roles) ? roles : ['user'],
          tenantId: tenantId || '',
          sessionToken: sessionToken || '',
        });

        window.location.href = normalizeRedirectTarget(redirectTo);
      } catch (err: any) {
        const message = err?.response?.data?.message;
        if (Array.isArray(message)) {
          const first = message.find((item) => typeof item === 'string' && item.trim());
          setError(first || '统一认证登录失败。');
          return;
        }
        setError(
          (typeof message === 'string' && message.trim())
          || err?.message
          || '统一认证登录失败。',
        );
      }
    };

    void run();
  }, [searchParams]);

  return (
    <div className="flex min-h-[calc(100vh-180px)] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600">
            <i className="fas fa-shield-alt text-2xl text-white" />
          </div>
          <h1 className="font-brand text-2xl font-bold text-gray-900">{providerName}登录中</h1>
          <p className="mt-2 text-sm text-gray-500">正在完成授权回调，请稍候。</p>
        </div>

        {error ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
            <a
              href="/login"
              className="block w-full rounded-lg bg-blue-600 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              返回登录页
            </a>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 text-sm text-blue-700">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
            正在建立本系统登录态
          </div>
        )}
      </div>
    </div>
  );
}
