'use client';

import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, CheckCircle, AlertCircle, Search, Plus } from 'lucide-react';
import { apiClient, authFetch } from '../lib/api-client';
import { withBrowserApiBase } from '../lib/browser-api-base-url';
import { getClientUserInfo, hasClientSession } from '../lib/client-auth';

interface ProcessTemplate {
  id: string;
  processCode: string;
  processName: string;
  processCategory: string | null;
  version?: number;
  status: string;
  falLevel: string | null;
  uiHints: any;
  createdAt: string;
  updatedAt: string;
  sourceType: 'published';
  connector?: {
    id: string;
    name: string;
    oaType: string;
    oclLevel: string;
  } | null;
}

interface ConnectorOption {
  id: string;
  name: string;
  baseUrl?: string | null;
}

type CreateFormState = {
  connectorId: string;
  processCode: string;
  processName: string;
  processCategory: string;
  description: string;
  falLevel: string;
  rpaFlowContent: string;
};

function createEmptyFormState(): CreateFormState {
  return {
    connectorId: '',
    processCode: '',
    processName: '',
    processCategory: '',
    description: '',
    falLevel: 'F2',
    rpaFlowContent: JSON.stringify({
      flows: [{
        processCode: 'leave_request',
        processName: '请假申请',
        fields: [
          { key: 'start_date', label: '开始日期', type: 'date', required: true },
          { key: 'end_date', label: '结束日期', type: 'date', required: true },
          { key: 'reason', label: '请假原因', type: 'textarea', required: true },
        ],
        actions: {
          submit: {
            steps: [
              { type: 'goto', value: 'https://oa.example.com/leave' },
              { type: 'input', fieldKey: 'start_date', target: { kind: 'text', value: '开始日期' } },
              { type: 'input', fieldKey: 'end_date', target: { kind: 'text', value: '结束日期' } },
              { type: 'input', fieldKey: 'reason', target: { kind: 'text', value: '请假原因' } },
              { type: 'click', target: { kind: 'text', value: '提交' } },
            ],
          },
        },
      }],
    }, null, 2),
  };
}

export default function ProcessLibraryPage() {
  const router = useRouter();
  const [processes, setProcesses] = useState<ProcessTemplate[]>([]);
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [connectorFilter, setConnectorFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(createEmptyFormState());
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const canManage = (() => {
    const roles = getClientUserInfo().roles || [];
    return roles.includes('admin') || roles.includes('flow_manager');
  })();

  const fetchProcesses = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (connectorFilter !== 'all') {
        params.set('connectorId', connectorFilter);
      }
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const response = await authFetch(withBrowserApiBase(`/api/v1/process-library${suffix}`));

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
  }, [connectorFilter]);

  const fetchConnectors = useCallback(async () => {
    try {
      const response = await apiClient.get('/connectors');
      setConnectors(response.data || []);
    } catch (err) {
      console.error('Failed to fetch connectors:', err);
      setConnectors([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!hasClientSession()) {
      router.replace('/login');
      return;
    }

    void fetchProcesses();
    void fetchConnectors();
  }, [fetchProcesses, fetchConnectors, router]);

  const filteredProcesses = processes.filter((process) => {
    const matchesSearch =
      process.processName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      process.processCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (process.connector?.name || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory =
      categoryFilter === 'all' || process.processCategory === categoryFilter;
    const matchesConnector =
      connectorFilter === 'all' || process.connector?.id === connectorFilter;
    return matchesSearch && matchesCategory && matchesConnector;
  });

  const categories = Array.from(new Set(processes.map((p) => p.processCategory).filter((value): value is string => !!value)));
  const connectorOptions = Array.from(new Map(
    connectors
      .filter((connector) => connector.id)
      .map((connector) => [connector.id, connector]),
  ).values());

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'published':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'published':
        return '已发布';
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

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const content = String(loadEvent.target?.result || '');
      setCreateForm((prev) => ({ ...prev, rpaFlowContent: content }));
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateError('');
    try {
      await apiClient.post('/process-library', {
        connectorId: createForm.connectorId,
        processCode: createForm.processCode.trim(),
        processName: createForm.processName.trim(),
        processCategory: createForm.processCategory.trim() || undefined,
        description: createForm.description.trim() || undefined,
        falLevel: createForm.falLevel,
        rpaFlowContent: createForm.rpaFlowContent,
      });
      setShowCreateModal(false);
      setCreateForm(createEmptyFormState());
      await fetchProcesses();
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || '创建流程失败';
      setCreateError(typeof message === 'string' ? message : JSON.stringify(message));
    } finally {
      setCreating(false);
    }
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">流程库</h1>
            <p className="text-gray-600">只展示正式发布流程。每个流程都必须隶属于一个连接器。</p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              单个添加流程
            </button>
          )}
        </div>
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
          <select
            value={connectorFilter}
            onChange={(e) => setConnectorFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md"
          >
            <option value="all">所有连接器</option>
            {connectorOptions.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.name}
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
            {connectorOptions.length}
          </div>
          <div className="text-sm text-gray-600">连接器数</div>
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
                    <span>分类: {process.processCategory || '-'}</span>
                    <span>所属连接器: {process.connector?.name || '-'}</span>
                  </div>
                </div>
                {process.falLevel && (
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getFalLevelColor(process.falLevel)}`}>
                      {process.falLevel}
                    </span>
                  </div>
                )}
              </div>

              {/* API信息 */}
              {process.uiHints && typeof process.uiHints === 'object' && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  {process.sourceType === 'published' && process.uiHints.apiMethod && process.uiHints.apiPath && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
                        {process.uiHints.apiMethod}
                      </span>
                      <span className="font-mono text-sm text-gray-700">{process.uiHints.apiPath}</span>
                    </div>
                  )}
                  {process.sourceType === 'published' && process.uiHints.confidence && (
                    <div className="text-sm text-gray-600">
                      识别置信度: {(process.uiHints.confidence * 100).toFixed(0)}%
                    </div>
                  )}
                  {process.sourceType === 'published' && process.connector && (
                    <div className="mt-2 text-sm text-gray-600">
                      所属连接器: {process.connector.name}
                    </div>
                  )}
                  {process.uiHints.validationResult && (
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        {process.uiHints.validationResult.status === 'passed' ? (
                          <>
                            <CheckCircle className="w-4 h-4 text-green-500" />
                            <span className="text-green-600">接口验证通过</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-4 h-4 text-red-500" />
                            <span className="text-red-600">接口验证未通过</span>
                          </>
                        )}
                      </div>
                      {process.uiHints.validationResult.reason && (
                        <div className="text-gray-600">
                          原因: {process.uiHints.validationResult.reason}
                        </div>
                      )}
                      {typeof process.uiHints.validationResult.endpointCheckedCount === 'number' && (
                        <div className="text-gray-600">
                          端点验证: {process.uiHints.validationResult.endpointPassedCount || 0}/
                          {process.uiHints.validationResult.endpointCheckedCount} 通过
                        </div>
                      )}
                      {Array.isArray(process.uiHints.validationResult.failedEndpoints) &&
                        process.uiHints.validationResult.failedEndpoints.length > 0 && (
                          <div className="text-gray-600">
                            失败端点:
                            {' '}
                            {process.uiHints.validationResult.failedEndpoints
                              .map((endpoint: any) => `${endpoint.method} ${endpoint.path}`)
                              .join('；')}
                          </div>
                        )}
                      {process.uiHints.validationResult.error && (
                        <div className="text-gray-600">
                          错误: {process.uiHints.validationResult.error}
                        </div>
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

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-8 py-5">
              <div>
                <h2 className="text-xl font-bold text-gray-900">单个添加流程</h2>
                <p className="mt-0.5 text-sm text-gray-500">流程库中的流程必须先选择所属连接器。</p>
              </div>
              <button onClick={() => { setShowCreateModal(false); setCreateError(''); }} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100">
                <i className="fas fa-times text-gray-500"></i>
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-8 py-6">
              {createError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {createError}
                </div>
              )}

              <section className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 p-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">所属连接器</label>
                  <select
                    value={createForm.connectorId}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, connectorId: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">请选择连接器</option>
                    {connectors.map((connector) => (
                      <option key={connector.id} value={connector.id}>
                        {connector.name}
                        {connector.baseUrl ? ` - ${connector.baseUrl}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">流程编码</label>
                  <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={createForm.processCode} onChange={(e) => setCreateForm((prev) => ({ ...prev, processCode: e.target.value }))} placeholder="leave_request" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">流程名称</label>
                  <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={createForm.processName} onChange={(e) => setCreateForm((prev) => ({ ...prev, processName: e.target.value }))} placeholder="请假申请" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">流程分类</label>
                  <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={createForm.processCategory} onChange={(e) => setCreateForm((prev) => ({ ...prev, processCategory: e.target.value }))} placeholder="人事" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">FAL</label>
                  <select className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={createForm.falLevel} onChange={(e) => setCreateForm((prev) => ({ ...prev, falLevel: e.target.value }))}>
                    <option value="F0">F0</option>
                    <option value="F1">F1</option>
                    <option value="F2">F2</option>
                    <option value="F3">F3</option>
                    <option value="F4">F4</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">流程描述</label>
                  <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={createForm.description} onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="用于员工请假申请" />
                </div>
              </section>

              <section className="space-y-4 rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">流程定义</h3>
                    <p className="mt-1 text-xs text-gray-500">使用现有页面/链接流程 JSON。单个添加只允许一个流程定义。</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-blue-400 hover:bg-blue-50">
                    <input type="file" className="hidden" accept=".json,.txt" onChange={handleFileUpload} />
                    上传流程文件
                  </label>
                </div>
                <textarea
                  rows={14}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={createForm.rpaFlowContent}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, rpaFlowContent: e.target.value }))}
                />
              </section>
            </div>

            <div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-8 py-5">
              <button onClick={() => { setShowCreateModal(false); setCreateError(''); }} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">取消</button>
              <div className="flex-1 text-xs text-gray-500">没有连接器时，请先去初始化中心创建或批量初始化一个连接器。</div>
              <button
                onClick={handleCreate}
                disabled={creating || !createForm.connectorId || !createForm.processCode.trim() || !createForm.processName.trim() || !createForm.rpaFlowContent.trim()}
                className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? '创建中...' : '创建流程'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
