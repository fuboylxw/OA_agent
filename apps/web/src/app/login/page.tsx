'use client';

import { useState } from 'react';
import axios from 'axios';
import { withBrowserApiBase } from '../lib/browser-api-base-url';

const LOGIN_HINTS = [
  { username: 'admin', password: 'admin123', role: '管理员' },
  { username: 'testuser', password: 'test123', role: '普通用户' },
];

function resolveLoginError(error: any) {
  if (!error?.response) {
    return '无法连接后端服务，请确认 API 服务已启动。';
  }

  const status = Number(error.response.status || 0);
  const message = error.response?.data?.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  if (status >= 500) {
    return '后端或数据库未就绪，请先启动数据库和 API 服务。';
  }

  return '登录失败，请检查用户名和密码。';
}

function resolveDisplayedLoginError(error: any) {
  const plainMessage = typeof error?.message === 'string' ? error.message.trim() : '';

  if (!error?.response) {
    if (plainMessage && plainMessage !== 'SESSION_SETUP_FAILED') {
      return plainMessage;
    }
    return '无法连接后端服务，请确认 API 服务已启动。';
  }

  const status = Number(error.response.status || 0);
  const message = error.response?.data?.message;
  if (Array.isArray(message)) {
    const normalized = message.find((item) => typeof item === 'string' && item.trim());
    if (normalized) {
      return normalized;
    }
  }

  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  if (status === 401) {
    return '用户名或密码错误。开发环境请使用 admin / admin123 或 testuser / test123。';
  }

  if (status === 429) {
    return '登录尝试过于频繁，请等待 1 分钟后再试。';
  }

  if (status >= 500) {
    return '后端或数据库未就绪，请先启动数据库和 API 服务。';
  }

  return plainMessage || resolveLoginError(error);
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('请输入用户名和密码。');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await axios.post(withBrowserApiBase('/api/v1/auth/login'), {
        username,
        password,
      });

      const { userId, displayName, roles, tenantId, sessionToken, sessionExpiresAt } = response.data;
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

      localStorage.setItem('userId', userId);
      localStorage.setItem('username', username);
      localStorage.setItem('displayName', displayName);
      localStorage.setItem('roles', JSON.stringify(roles));
      localStorage.setItem('tenantId', tenantId);
      localStorage.setItem('sessionToken', sessionToken);

      document.cookie = 'roles=;path=/;max-age=0';
      document.cookie = 'userId=;path=/;max-age=0';
      document.cookie = 'tenantId=;path=/;max-age=0';
      document.cookie = 'displayName=;path=/;max-age=0';

      window.location.href = '/';
    } catch (err: any) {
      setError(resolveDisplayedLoginError(err));
    } finally {
      setLoading(false);
    }
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
            <p className="mt-2 text-gray-500">智能办公助手 · 登录</p>
          </div>

          {error ? (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              <i className="fas fa-exclamation-circle" />
              {error}
            </div>
          ) : null}

          <form className="space-y-5" onSubmit={handleLogin}>
            <div>
              <label htmlFor="username" className="mb-2 block text-sm font-medium text-gray-700">
                用户名
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-gray-700">
                密码
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <div className="space-y-1 text-xs text-gray-400">
              <p>当前开发环境测试账号：</p>
              {LOGIN_HINTS.map((item) => (
                <p key={item.username}>
                  {item.username} / {item.password}（{item.role}）
                </p>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              如果仍然无法登录，请确认数据库和 API 服务已经启动。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
