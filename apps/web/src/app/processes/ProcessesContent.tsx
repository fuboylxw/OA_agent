'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '../lib/api-client';

const CATEGORY_ICONS: Record<string, string> = {
  '财务': 'fa-money-bill-wave',
  '人事': 'fa-users',
  '行政': 'fa-clipboard-list',
  '采购': 'fa-shopping-cart',
  '其他': 'fa-folder',
};

const CATEGORY_COLORS: Record<string, string> = {
  '财务': 'text-blue-600 bg-blue-100',
  '人事': 'text-green-600 bg-green-100',
  '行政': 'text-purple-600 bg-purple-100',
  '采购': 'text-orange-600 bg-orange-100',
  '其他': 'text-gray-600 bg-gray-100',
};

const FAL_COLORS: Record<string, { bg: string; text: string }> = {
  F0: { bg: 'bg-orange-100', text: 'text-orange-600' },
  F1: { bg: 'bg-orange-100', text: 'text-orange-600' },
  F2: { bg: 'bg-blue-100', text: 'text-blue-600' },
  F3: { bg: 'bg-green-100', text: 'text-green-600' },
  F4: { bg: 'bg-green-100', text: 'text-green-600' },
};

export default function ProcessesContent({ initialProcesses }: { initialProcesses: any[] }) {
  const [processes, setProcesses] = useState<any[]>(initialProcesses);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    apiClient.get('/process-library').then((res) => setProcesses(res.data)).catch(() => {});
  }, []);

  const filteredProcesses = processes.filter((p) =>
    (p.processName || '').includes(searchTerm)
    || (p.processCode || '').includes(searchTerm)
    || (p.connector?.name || '').includes(searchTerm)
  );

  const grouped: Record<string, any[]> = {};
  filteredProcesses.forEach((p) => {
    const category = p.processCategory || '其他';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(p);
  });

  const getFalColor = (level: string) => FAL_COLORS[level] || { bg: 'bg-blue-100', text: 'text-blue-600' };

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">流程库</h1>
            <p className="text-gray-600">浏览所有可用的办事流程，点击即可发起申请</p>
          </div>
          <div className="relative">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
            <input
              type="text"
              className="pl-11 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-72"
              placeholder="搜索流程名称或代码..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {Object.entries(grouped).map(([category, items]) => {
        const iconClass = CATEGORY_ICONS[category] || 'fa-folder';
        const colorClass = CATEGORY_COLORS[category] || 'text-gray-600 bg-gray-100';
        return (
          <div key={category} className="mb-10">
            <div className="flex items-center gap-3 mb-5">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClass}`}>
                <i className={`fas ${iconClass}`}></i>
              </div>
              <h2 className="text-xl font-bold text-gray-900">{category}</h2>
              <span className="inline-block px-2.5 py-1 bg-blue-50 text-blue-600 text-xs rounded-full font-medium">{items.length} 个流程</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {items.map((process: any) => {
                const falColor = getFalColor(process.falLevel);
                return (
                  <div key={process.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-lg font-semibold text-gray-900">{process.processName}</h3>
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${falColor.bg} ${falColor.text}`}>
                        {process.falLevel}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mb-2 font-mono">{process.processCode}</p>
                    <p className="mb-4 text-xs text-gray-500">
                      所属连接器：{process.connector?.name || '-'}
                    </p>
                    <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                      <span className="text-xs text-gray-500">版本 v{process.version || '-'}</span>
                      <a
                        href={`/chat?flow=${process.processCode}`}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1"
                      >
                        发起申请
                        <i className="fas fa-arrow-right text-xs"></i>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {filteredProcesses.length === 0 && (
        <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-book text-gray-400 text-2xl"></i>
          </div>
          <p className="text-gray-500 mb-4">
            {searchTerm ? '未找到匹配的流程' : '暂无流程模板'}
          </p>
          {!searchTerm && (
            <Link href="/bootstrap" className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors">
              <i className="fas fa-cogs"></i>
              前往初始化中心导入 OA 系统
            </Link>
          )}
        </div>
      )}
      </div>
    </main>
  );
}
