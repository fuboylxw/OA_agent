'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import UserHeader from './UserHeader';
import NavBar from './NavBar';

function shouldHideHeader(pathname: string) {
  return pathname.startsWith('/login') || pathname.startsWith('/logout');
}

export default function ResponsiveAppHeader() {
  const pathname = usePathname() || '';

  if (shouldHideHeader(pathname)) {
    return null;
  }

  const showMobileHeader = pathname === '/';

  return (
    <>
      {showMobileHeader ? (
        <header className="z-50 flex h-14 flex-shrink-0 items-center justify-between bg-white px-4 shadow-sm md:hidden">
          <div className="flex items-center">
            <Link href="/" className="font-brand text-lg text-blue-600">
              UniFlow
            </Link>
          </div>
          <div className="flex items-center">
            <UserHeader />
          </div>
        </header>
      ) : null}

      <header className="hidden md:flex md:h-16 md:flex-shrink-0 md:items-center md:justify-between md:bg-white md:px-6 md:shadow-sm">
        <div className="flex items-center space-x-4">
          <Link href="/" className="font-brand text-xl text-blue-600">
            UniFlow
          </Link>
          <NavBar />
        </div>
        <div className="flex items-center space-x-4">
          <UserHeader />
        </div>
      </header>
    </>
  );
}
