'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username && password) {
      localStorage.setItem('userId', username);
      router.push('/chat');
    }
  };

  return (
    <div className="min-h-[calc(100vh-180px)] flex items-center justify-center relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-100 rounded-full blur-3xl opacity-40"></div>
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-indigo-100 rounded-full blur-3xl opacity-40"></div>

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-bolt text-white text-2xl"></i>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 font-['Pacifico']">UniFlow</h1>
            <p className="text-gray-500 mt-2">智能办公助手 · 登录</p>
          </div>

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

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-gray-500 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-gray-300 accent-blue-600" />
                记住我
              </label>
              <a href="#" className="text-blue-600 hover:text-blue-800">
                忘记密码？
              </a>
            </div>

            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm font-medium transition-colors">
              登录
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-500 text-sm">
              还没有账号？
              <a href="#" className="text-blue-600 hover:text-blue-800 ml-1">
                联系管理员开通
              </a>
            </p>
          </div>
        </div>

        <p className="text-center text-gray-400 text-xs mt-6">
          面向高校的 AI 智能办公平台
        </p>
      </div>
    </div>
  );
}
