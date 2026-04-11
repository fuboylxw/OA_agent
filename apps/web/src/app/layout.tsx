import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import AuthBootstrap from './components/AuthBootstrap';
import UserHeader from './components/UserHeader';
import NavBar from './components/NavBar';

export const metadata: Metadata = {
  title: '智能办事系统 - UniFlow OA 智能助理',
  description: '面向高校的 AI 智能办公助手，一句话办事',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 h-screen w-full flex flex-col overflow-hidden">
        <AuthBootstrap />
        <header className="bg-white shadow-sm h-16 flex items-center justify-between px-6 flex-shrink-0 z-50">
          <div className="flex items-center space-x-4">
            <Link href="/" className="font-brand text-xl text-blue-600">UniFlow</Link>
            <NavBar />
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
            <div className="font-brand text-sm text-blue-600">UniFlow</div>
            <div className="text-xs text-gray-500">© 2024 智能办事系统</div>
          </div>
        </footer>
      </body>
    </html>
  );
}
