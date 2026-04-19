'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const MOBILE_NAV_ITEMS = [
  { href: '/', label: '首页', icon: 'fa-home' },
  { href: '/chat', label: '对话', icon: 'fa-comments' },
  { href: '/submissions', label: '我的申请', icon: 'fa-file-alt' },
];

export default function MobileBottomNav() {
  const pathname = usePathname() || '';

  if (pathname.startsWith('/login') || pathname.startsWith('/logout')) {
    return null;
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white md:hidden">
      <div
        className="grid h-[var(--mobile-bottom-nav-height)] grid-cols-3"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {MOBILE_NAV_ITEMS.map((item) => {
          const active = item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                active ? 'text-sky-700' : 'text-slate-500'
              }`}
            >
              <i className={`fas ${item.icon} text-[15px] ${active ? 'text-sky-600' : 'text-slate-400'}`}></i>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
