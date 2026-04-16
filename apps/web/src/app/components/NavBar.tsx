'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  getClientAuthServerSnapshot,
  getClientAuthSnapshot,
  subscribeClientAuth,
} from '../lib/client-auth';

const NAV_ITEMS = [
  { href: '/', label: '首页' },
  { href: '/chat', label: '对话工作台' },
  { href: '/submissions', label: '我的申请' },
  { href: '/processes', label: '流程库' },
  { href: '/bootstrap', label: '初始化中心', roles: ['admin'] },
  { href: '/connectors', label: '连接器管理', roles: ['admin', 'flow_manager'] },
];

export default function NavBar() {
  const pathname = usePathname() || '';
  const snapshot = useSyncExternalStore(
    subscribeClientAuth,
    getClientAuthSnapshot,
    getClientAuthServerSnapshot,
  );

  if (pathname.startsWith('/login')) {
    return null;
  }

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    return item.roles.some((role) => snapshot.roles.includes(role));
  });

  return (
    <nav className="hidden md:flex space-x-6">
      {visibleItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`font-medium ${
            (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href))
              ? 'text-blue-600'
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
