'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function UserHeader() {
  const [displayName, setDisplayName] = useState('');
  const [initial, setInitial] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const name = localStorage.getItem('displayName') || '';
    const rolesStr = localStorage.getItem('roles');
    const userId = localStorage.getItem('userId');

    if (!userId) {
      router.push('/login');
      return;
    }

    setDisplayName(name || userId);
    setInitial((name || userId).charAt(0).toUpperCase());
    setRoles(rolesStr ? JSON.parse(rolesStr) : ['user']);
  }, [router]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('displayName');
    localStorage.removeItem('roles');
    localStorage.removeItem('tenantId');
    document.cookie = 'roles=;path=/;max-age=0';
    document.cookie = 'userId=;path=/;max-age=0';
    document.cookie = 'tenantId=;path=/;max-age=0';
    document.cookie = 'displayName=;path=/;max-age=0';
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
        <span className="text-gray-700 text-sm">{displayName || '加载中...'}</span>
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
