import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import UserHeader from './components/UserHeader';
import NavBar from './components/NavBar';

export const metadata: Metadata = {
  title: '智能办事系统 - UniFlow OA Copilot',
  description: '面向高校的AI智能办公助手，一句话办事',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const rolesCookie = cookieStore.get('roles')?.value;
  let roles: string[] = [];
  try {
    roles = rolesCookie ? JSON.parse(decodeURIComponent(rolesCookie)) : [];
  } catch { /* ignore */ }

  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-gray-50 h-screen w-full flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm h-16 flex items-center justify-between px-6 flex-shrink-0 z-50">
          <div className="flex items-center space-x-4">
            <a href="/" className="font-['Pacifico'] text-xl text-blue-600">UniFlow</a>
            <NavBar roles={roles} />
          </div>
          <div className="flex items-center space-x-4">
            <UserHeader />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
        <footer className="bg-white border-t border-gray-200 h-12 flex-shrink-0 z-40">
          <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
            <div className="font-['Pacifico'] text-sm text-blue-600">UniFlow</div>
            <div className="text-xs text-gray-500">© 2024 智能办事系统</div>
          </div>
        </footer>
      </body>
    </html>
  );
}
