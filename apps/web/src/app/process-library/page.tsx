'use client';

import { useState, useEffect } from 'react';
import { FileText, CheckCircle, Clock, AlertCircle, Search } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ProcessTemplate {
  id: string;
  processCode: string;
  processName: string;
  processCategory: string;
  status: string;
  falLevel: string;
  uiHints: any;
  createdAt: string;
  updatedAt: string;
}

export default function ProcessLibraryPage() {
  const [processes, setProcesses] = useState<ProcessTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedTenantId = localStorage.getItem('tenantId');
    if (!storedTenantId) {
      setError('缺少租户信息，请先登录。');
      setLoading(false);
      return;
    }

    void fetchProcesses(storedTenantId);
  }, []);

  const fetchProcesses = async (tenantId: string) => {
    try {
      setError(null);
      const response = await fetch(
        `${API_URL}/api/v1/process-library?tenantId=${encodeURIComponent(tenantId)}`,
      );

      if (!response.ok) {
        throw new Error('流程库加载失败');
      }

      const data = await response.json();
      setProcesses(data);
    } catch (err: any) {
      console.error('Failed to fetch processes:', err);
      setProcesses([]);
      setError(err.message || '流程库加载失败');
    } finally {
      setLoading(false);
    }
  };

  const filteredProcesses = processes.filter((process) => {
    const matchesSearch =
      process.processName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      process.processCode.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory =
      categoryFilter === 'all' || process.processCategory === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set(processes.map((p) => p.processCategory)));

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'published':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'draft':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'published':
        return '已发布';
      case 'draft':
        return '草稿';
      case 'archived':
        return '已归档';
      default:
        return status;
    }
  };

  const getFalLevelColor = (level: string) => {
    const colors: Record<string, string> = {
      F0: 'bg-gray-100 text-gray-700',
      F1: 'bg-blue-100 text-blue-700',
      F2: 'bg-green-100 text-green-700',
      F3: 'bg-yellow-100 text-yellow-700',
      F4: 'bg-purple-100 text-purple-700',
    };
    return colors[level] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">流程库</h1>
        <p className="text-gray-600">管理和查看所有办事流程</p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 搜索和筛选 */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="搜索流程名称或代码..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md"
          >
            <option value="all">所有分类</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-blue-600">{processes.length}</div>
          <div className="text-sm text-gray-600">总流程数</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-green-600">
            {processes.filter((p) => p.status === 'published').length}
          </div>
          <div className="text-sm text-gray-600">已发布</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-yellow-600">
            {processes.filter((p) => p.status === 'draft').length}
          </div>
          <div className="text-sm text-gray-600">草稿</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-purple-600">{categories.length}</div>
          <div className="text-sm text-gray-600">分类数</div>
        </div>
      </div>

      {/* 流程列表 */}
      <div className="space-y-4">
        {filteredProcesses.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">没有找到匹配的流程</p>
          </div>
        ) : (
          filteredProcesses.map((process) => (
            <div key={process.id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-semibold">{process.processName}</h3>
                    {getStatusIcon(process.status)}
                    <span className="text-sm text-gray-500">{getStatusText(process.status)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>代码: {process.processCode}</span>
                    <span>分类: {process.processCategory}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getFalLevelColor(process.falLevel)}`}>
                    {process.falLevel}
                  </span>
                </div>
              </div>

              {/* API信息 */}
              {process.uiHints && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
                      {process.uiHints.apiMethod}
                    </span>
                    <span className="font-mono text-sm text-gray-700">{process.uiHints.apiPath}</span>
                  </div>
                  {process.uiHints.confidence && (
                    <div className="text-sm text-gray-600">
                      识别置信度: {(process.uiHints.confidence * 100).toFixed(0)}%
                    </div>
                  )}
                  {process.uiHints.validationResult && (
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      {process.uiHints.validationResult.isAccessible ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <span className="text-green-600">接口验证通过</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4 text-red-500" />
                          <span className="text-red-600">接口验证失败</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 时间信息 */}
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>创建时间: {new Date(process.createdAt).toLocaleString('zh-CN')}</span>
                <span>更新时间: {new Date(process.updatedAt).toLocaleString('zh-CN')}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
