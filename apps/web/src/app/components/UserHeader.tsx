'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import {
  getClientAuthServerSnapshot,
  clearClientAuth,
  getClientAuthSnapshot,
  subscribeClientAuth,
} from '../lib/client-auth';
import { withBrowserApiBase } from '../lib/browser-api-base-url';
import { isOauth2AuthMode } from '../lib/auth-mode';

export default function UserHeader() {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname() || '';
  const snapshot = useSyncExternalStore(
    subscribeClientAuth,
    getClientAuthSnapshot,
    getClientAuthServerSnapshot,
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (pathname.startsWith('/login')) {
    return null;
  }

  const displayName = snapshot.displayName || snapshot.username || snapshot.userId || 'User';
  const initial = (displayName || 'U').charAt(0).toUpperCase();
  const roles = snapshot.roles;

  const handleLogout = async () => {
    setShowMenu(false);
    await fetch('/api/session', {
      method: 'DELETE',
    }).catch(() => undefined);
    clearClientAuth();
    if (isOauth2AuthMode()) {
      window.location.href = withBrowserApiBase('/api/v1/auth/oauth2/logout?returnTo=%2Flogin%3FloggedOut%3D1');
      return;
    }
    window.location.href = '/login';
  };

  const isAdmin = roles.includes('admin');

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center space-x-2 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors"
      >
        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
          <span className="text-blue-600 text-sm font-medium">{initial}</span>
        </div>
        <span className="text-gray-700 text-sm">{snapshot.hasProfile ? displayName : '加载中...'}</span>
        {isAdmin && (
          <span className="px-1.5 py-0.5 bg-orange-100 text-orange-600 text-xs rounded font-medium">管理员</span>
        )}
        <i className="fas fa-chevron-down text-gray-400 text-xs"></i>
      </button>

      {showMenu && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900">{displayName}</p>
            <p className="text-xs text-gray-500">{isAdmin ? '超级管理员' : '普通用户'}</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
          >
            <i className="fas fa-sign-out-alt text-xs"></i>
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
