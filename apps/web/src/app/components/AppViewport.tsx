'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function AppViewport({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || '';
  const lockOuterScroll = pathname === '/chat' || pathname.startsWith('/chat/');

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    if (lockOuterScroll) {
      root.classList.add('chat-scroll-lock');
      body.classList.add('chat-scroll-lock');
    } else {
      root.classList.remove('chat-scroll-lock');
      body.classList.remove('chat-scroll-lock');
    }

    return () => {
      root.classList.remove('chat-scroll-lock');
      body.classList.remove('chat-scroll-lock');
    };
  }, [lockOuterScroll]);

  return (
    <div className={`min-h-0 flex-1 ${lockOuterScroll ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      {children}
    </div>
  );
}
