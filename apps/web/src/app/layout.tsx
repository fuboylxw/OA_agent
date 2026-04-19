import type { Metadata } from 'next';
import './globals.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import AuthBootstrap from './components/AuthBootstrap';
import MobileBottomNav from './components/MobileBottomNav';
import ResponsiveAppHeader from './components/ResponsiveAppHeader';
import AppViewport from './components/AppViewport';

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
      <body className="flex h-screen min-h-dvh w-full flex-col overflow-hidden bg-gray-50">
        <AuthBootstrap />
        <ResponsiveAppHeader />
        <AppViewport>
          {children}
        </AppViewport>
        <MobileBottomNav />
        <footer className="hidden h-12 flex-shrink-0 border-t border-gray-200 bg-white md:flex">
          <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
            <div className="font-brand text-sm text-blue-600">UniFlow</div>
            <div className="text-xs text-gray-500">© 2024 智能办事系统</div>
          </div>
        </footer>
      </body>
    </html>
  );
}
