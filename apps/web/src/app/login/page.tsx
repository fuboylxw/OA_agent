'use client';

import { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setError('');
    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/api/v1/auth/login`, {
        username,
        password,
      });

      const { userId, displayName, roles, tenantId } = response.data;

      localStorage.setItem('userId', userId);
      localStorage.setItem('username', username);
      localStorage.setItem('displayName', displayName);
      localStorage.setItem('roles', JSON.stringify(roles));
      localStorage.setItem('tenantId', tenantId);

      // 写入 cookie，供服务端读取
      const maxAge = 60 * 60 * 24 * 7;
      document.cookie = `roles=${encodeURIComponent(JSON.stringify(roles))};path=/;max-age=${maxAge}`;
      document.cookie = `userId=${encodeURIComponent(userId)};path=/;max-age=${maxAge}`;
      document.cookie = `tenantId=${encodeURIComponent(tenantId)};path=/;max-age=${maxAge}`;
      document.cookie = `displayName=${encodeURIComponent(displayName)};path=/;max-age=${maxAge}`;

      // 硬跳转，让服务端重新渲染 layout 读取 cookie
      window.location.href = '/';
    } catch (err: any) {
      setError(err.response?.data?.message || '登录失败，请检查用户名和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-180px)] flex items-center justify-center relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-100 rounded-full blur-3xl opacity-40"></div>
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-indigo-100 rounded-full blur-3xl opacity-40"></div>

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-bolt text-white text-2xl"></i>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 font-['Pacifico']">UniFlow</h1>
            <p className="text-gray-500 mt-2">智能办公助手 · 登录</p>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
              <i className="fas fa-exclamation-circle"></i>
              {error}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleLogin}>
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                用户名
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                密码
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-400 text-xs">
              测试账号：admin / admin（管理员）、testuser / testuser（普通用户）
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
