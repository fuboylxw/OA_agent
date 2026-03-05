import type { Metadata } from 'next';
import './globals.css';
import UserHeader from './components/UserHeader';

export const metadata: Metadata = {
  title: '智能办事系统 - UniFlow OA Copilot',
  description: '面向高校的AI智能办公助手，一句话办事',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      </head>
      <body className="bg-gray-50 h-screen w-full flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm h-16 flex items-center justify-between px-6 flex-shrink-0 z-50">
          <div className="flex items-center space-x-4">
            <div className="font-['Pacifico'] text-xl text-primary">logo</div>
            <nav className="hidden md:flex space-x-6">
              <a href="/" className="text-gray-700 hover:text-primary font-medium">首页</a>
              <a href="/chat" className="text-gray-500 hover:text-primary font-medium">对话工作台</a>
              <a href="/submissions" className="text-gray-500 hover:text-primary font-medium">我的申请</a>
              <a href="/processes" className="text-gray-500 hover:text-primary font-medium">流程库</a>
              <a href="/bootstrap" className="text-gray-500 hover:text-primary font-medium">初始化中心</a>
              <a href="/connectors" className="text-gray-500 hover:text-primary font-medium">连接器管理</a>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <button className="p-2 text-gray-500 hover:text-gray-700">
              <i className="fas fa-bell w-5 h-5"></i>
            </button>
            <UserHeader />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
        <footer className="bg-white border-t border-gray-200 h-16 flex-shrink-0 z-40">
          <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
            <div className="font-['Pacifico'] text-lg text-primary">logo</div>
            <div className="text-sm text-gray-600">© 2024 智能办事系统. 保留所有权利.</div>
          </div>
        </footer>
      </body>
    </html>
  );
}
