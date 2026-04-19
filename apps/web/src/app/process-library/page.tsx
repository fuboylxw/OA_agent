'use client';

import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, CheckCircle, AlertCircle, Search, Plus, Trash2 } from 'lucide-react';
import AuthGuard from '../components/AuthGuard';
import { apiClient, authFetch } from '../lib/api-client';
import { withBrowserApiBase } from '../lib/browser-api-base-url';
import { getClientUserInfo, hasClientSession } from '../lib/client-auth';
import { IDENTITY_SCOPE_META, normalizeIdentityScope } from '../lib/identity-scope';
import {
  PROCESS_ACCESS_MODE_META,
  PROCESS_FILE_ACCEPT,
  PROCESS_INPUT_MODE_META,
  PROCESS_TEXT_TEMPLATE_PLACEHOLDERS,
  resolveProcessAuthoringAccessMode,
  resolveProcessAuthoringInputMode,
  resolveProcessAuthoringTextTemplate,
  type ProcessAuthoringAccessMode,
  type ProcessAuthoringInputMode,
} from './process-authoring';

interface ProcessTemplate {
  id: string;
  processCode: string;
  processName: string;
  processCategory: string | null;
  description?: string | null;
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
    identityScope?: 'teacher' | 'student' | 'both';
    oaType: string;
    oclLevel: string;
  } | null;
}

interface ConnectorOption {
  id: string;
  name: string;
  baseUrl?: string | null;
  identityScope?: 'teacher' | 'student' | 'both';
}

type CreateFormState = {
  connectorId: string;
  processCode: string;
  processName: string;
  processCategory: string;
  description: string;
  falLevel: string;
  accessMode: ProcessAuthoringAccessMode;
  inputMethod: ProcessAuthoringInputMode;
  textTemplateContent: string;
  uploadedFileName: string;
};

type ProcessEditorMode = 'create' | 'edit';

const FAL_LEVEL_META: Record<string, { label: string; description: string }> = {
  F0: { label: '纯人工', description: '系统只展示流程，主要靠人工办理。' },
  F1: { label: '人工为主', description: '系统能提供少量辅助，办理仍以人工为主。' },
  F2: { label: '半自动', description: '系统可辅助填写和跳转，人工参与较多。' },
  F3: { label: '高自动化', description: '大部分步骤可自动完成，仅少量人工确认。' },
  F4: { label: '全自动', description: '流程几乎可自动闭环执行。' },
};

function createEmptyFormState(): CreateFormState {
  return {
    connectorId: '',
    processCode: '',
    processName: '',
    processCategory: '',
    description: '',
    falLevel: 'F2',
    accessMode: 'url',
    inputMethod: 'manual',
    textTemplateContent: '',
    uploadedFileName: '',
  };
}

function ProcessLibraryContent() {
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
  const [editorMode, setEditorMode] = useState<ProcessEditorMode>('create');
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);
  const [deletingProcessId, setDeletingProcessId] = useState<string | null>(null);

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
    if (!canManage) {
      setConnectors([]);
      return;
    }
    try {
      const response = await apiClient.get('/connectors');
      setConnectors(response.data || []);
    } catch (err) {
      console.error('Failed to fetch connectors:', err);
      setConnectors([]);
    }
  }, [canManage]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!hasClientSession()) {
      router.replace('/login');
      return;
    }

    void fetchProcesses();
    if (canManage) {
      void fetchConnectors();
    }
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
    [
      ...processes
        .map((process) => process.connector)
        .filter((connector): connector is NonNullable<ProcessTemplate['connector']> => Boolean(connector?.id))
        .map((connector) => ({
          id: connector.id,
          name: connector.name,
          identityScope: normalizeIdentityScope(connector.identityScope),
        })),
      ...connectors
        .filter((connector) => connector.id)
        .map((connector) => ({
          ...connector,
          identityScope: normalizeIdentityScope(connector.identityScope),
        })),
    ].map((connector) => [connector.id, connector]),
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

  const getFalLevelMeta = (level: string | null | undefined) => {
    return FAL_LEVEL_META[level || ''] || {
      label: level || '未设置',
      description: '用于表示这个流程的自动化程度。',
    };
  };

  const activeFlowContent = createForm.textTemplateContent.trim();

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const content = String(loadEvent.target?.result || '');
      setCreateForm((prev) => ({
        ...prev,
        inputMethod: 'file',
        uploadedFileName: file.name || '',
        textTemplateContent: content,
      }));
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateError('');
    try {
      const payload = {
        connectorId: createForm.connectorId,
        processCode: createForm.processCode.trim(),
        processName: createForm.processName.trim(),
        processCategory: createForm.processCategory.trim() || undefined,
        description: createForm.description.trim() || undefined,
        falLevel: createForm.falLevel,
        accessMode: createForm.accessMode,
        authoringMode: 'text',
        inputMethod: createForm.inputMethod,
        rpaFlowContent: createForm.textTemplateContent,
      };
      if (editorMode === 'edit' && editingProcessId) {
        await apiClient.put(`/process-library/id/${editingProcessId}`, payload);
      } else {
        await apiClient.post('/process-library', payload);
      }
      closeEditor();
      await fetchProcesses();
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || (editorMode === 'edit' ? '修改流程失败' : '创建流程失败');
      setCreateError(typeof message === 'string' ? message : JSON.stringify(message));
    } finally {
      setCreating(false);
    }
  };

  const closeEditor = () => {
    setShowCreateModal(false);
    setCreateError('');
    setCreateForm(createEmptyFormState());
    setEditorMode('create');
    setEditingProcessId(null);
  };

  const openCreateEditor = () => {
    setEditorMode('create');
    setEditingProcessId(null);
    setCreateForm(createEmptyFormState());
    setCreateError('');
    setShowCreateModal(true);
  };

  const openEditEditor = (process: ProcessTemplate) => {
    const definition = process.uiHints && typeof process.uiHints === 'object'
      ? process.uiHints.rpaDefinition
      : null;
    const accessMode = resolveProcessAuthoringAccessMode({
      uiHints: process.uiHints,
      definition,
    });

    setEditorMode('edit');
    setEditingProcessId(process.id);
    setCreateError('');
    setCreateForm({
      connectorId: process.connector?.id || '',
      processCode: process.processCode,
      processName: process.processName,
      processCategory: process.processCategory || '',
      description: process.description || '',
      falLevel: process.falLevel || 'F2',
      accessMode,
      inputMethod: resolveProcessAuthoringInputMode({
        uiHints: process.uiHints,
      }),
      textTemplateContent: resolveProcessAuthoringTextTemplate({
        uiHints: process.uiHints,
        definition,
        processName: process.processName,
        processCode: process.processCode,
      }),
      uploadedFileName: '',
    });
    setShowCreateModal(true);
  };

  const handleDelete = async (process: ProcessTemplate) => {
    const confirmed = window.confirm(`确定删除“${process.processName}”吗？删除后该流程不会再出现在流程库中，但历史记录仍会保留。`);
    if (!confirmed) {
      return;
    }

    setDeletingProcessId(process.id);
    setError(null);
    try {
      await apiClient.delete(`/process-library/id/${process.id}`);
      await fetchProcesses();
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || '删除流程失败';
      setError(typeof message === 'string' ? message : JSON.stringify(message));
    } finally {
      setDeletingProcessId(null);
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
              onClick={openCreateEditor}
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
                {connector.identityScope ? `（${IDENTITY_SCOPE_META[normalizeIdentityScope(connector.identityScope)].badge}）` : ''}
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
                    {(() => {
                      const mode = resolveProcessAuthoringAccessMode({
                        uiHints: process.uiHints,
                        definition: process.uiHints?.rpaDefinition,
                      });
                      return (
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                          {PROCESS_ACCESS_MODE_META[mode].badge}
                        </span>
                      );
                    })()}
                    {getStatusIcon(process.status)}
                    <span className="text-sm text-gray-500">{getStatusText(process.status)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>代码: {process.processCode}</span>
                    <span>分类: {process.processCategory || '-'}</span>
                    <span>所属连接器: {process.connector?.name || '-'}</span>
                    {process.connector?.identityScope && (
                      <span>适用范围: {IDENTITY_SCOPE_META[normalizeIdentityScope(process.connector.identityScope)].badge}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {process.falLevel && (
                    <div className="text-right">
                      <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold ${getFalLevelColor(process.falLevel)}`}>
                        自动化等级 {process.falLevel}
                      </span>
                      <div className="mt-1 text-xs text-gray-500">{getFalLevelMeta(process.falLevel).label}</div>
                    </div>
                  )}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditEditor(process)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                      >
                        修改
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(process)}
                        disabled={deletingProcessId === process.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingProcessId === process.id ? '删除中...' : '删除'}
                      </button>
                    </>
                  )}
                </div>
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
                      {process.connector.identityScope ? ` · ${IDENTITY_SCOPE_META[normalizeIdentityScope(process.connector.identityScope)].label}` : ''}
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
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-8 py-5">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{editorMode === 'edit' ? '修改流程' : '单个添加流程'}</h2>
                <p className="mt-0.5 text-sm text-gray-500">
                  {editorMode === 'edit'
                    ? '这里修改的是流程库里的管理配置；保存后会发布一个新版本。'
                    : '流程库中的单个流程，必须先选择所属连接器。'}
                </p>
              </div>
              <button onClick={closeEditor} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100">
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
                    disabled={editorMode === 'edit'}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, connectorId: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    <option value="">请选择连接器</option>
                    {connectors.map((connector) => (
                      <option key={connector.id} value={connector.id}>
                        {connector.name}
                        {connector.identityScope ? `（${IDENTITY_SCOPE_META[normalizeIdentityScope(connector.identityScope)].badge}）` : ''}
                        {connector.baseUrl ? ` - ${connector.baseUrl}` : ''}
                      </option>
                    ))}
                  </select>
                  {editorMode === 'edit' && (
                    <p className="mt-1 text-xs text-gray-500">修改流程时保持所属连接器不变，系统会发布一个新版本。</p>
                  )}
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
                  <label className="mb-1 block text-sm font-medium text-gray-700">自动化等级（FAL）</label>
                  <select className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={createForm.falLevel} onChange={(e) => setCreateForm((prev) => ({ ...prev, falLevel: e.target.value }))}>
                    <option value="F0">F0（纯人工）</option>
                    <option value="F1">F1（人工为主）</option>
                    <option value="F2">F2（半自动）</option>
                    <option value="F3">F3（高自动化）</option>
                    <option value="F4">F4（全自动）</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">{getFalLevelMeta(createForm.falLevel).description}</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">流程描述</label>
                  <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={createForm.description} onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="用于员工请假申请" />
                </div>
              </section>

              <section className="space-y-4 rounded-xl border border-gray-200 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">办理方式</h3>
                  <p className="mt-1 text-xs text-gray-500">URL、RPA、API 三种方式完全分开选择，避免把链接直达、模拟点击、接口接入混在一起。</p>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {(['url', 'rpa', 'api'] as ProcessAuthoringAccessMode[]).map((mode) => {
                    const meta = PROCESS_ACCESS_MODE_META[mode];
                    const selected = createForm.accessMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCreateForm((prev) => ({ ...prev, accessMode: mode }))}
                        className={`rounded-xl border p-4 text-left transition ${selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/40'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{meta.badge}</span>
                          <span className="text-sm font-medium text-gray-900">{meta.label}</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-gray-500">{meta.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-4 rounded-xl border border-gray-200 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">录入方式</h3>
                  <p className="mt-1 text-xs text-gray-500">这里只是录入流程配置的方式，不是业务办理时让用户上传正式材料的入口。</p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {(['manual', 'file'] as ProcessAuthoringInputMode[]).map((mode) => {
                    const meta = PROCESS_INPUT_MODE_META[mode];
                    const selected = createForm.inputMethod === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCreateForm((prev) => ({ ...prev, inputMethod: mode }))}
                        className={`rounded-xl border p-4 text-left transition ${selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/40'}`}
                      >
                        <div className="text-sm font-medium text-gray-900">{meta.label}</div>
                        <p className="mt-2 text-xs leading-5 text-gray-500">{meta.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)]">
                <div className="space-y-4 rounded-xl border border-gray-200 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">
                      {createForm.inputMethod === 'file' ? '上传后编辑' : '粘贴 / 手动填写'}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      全程都按纯文字方式维护。你只需要写清楚该流程需要填写什么、上传什么、最后如何提交或判断完成。
                    </p>
                  </div>

                  <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs leading-5 text-blue-800">
                    当前办理方式：<span className="font-semibold">{PROCESS_ACCESS_MODE_META[createForm.accessMode].label}</span>；
                    录入方式：<span className="font-semibold">{PROCESS_INPUT_MODE_META[createForm.inputMethod].label}</span>。
                    模板里写了几个“需要填写的信息”或“需要上传的材料”，系统就按几个字段解析，不会默认多加字段。
                  </div>

                  {createForm.inputMethod === 'file' && (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900">上传模板文件</div>
                          <p className="mt-1 text-xs leading-5 text-gray-500">
                            支持把现成的说明文档读进来，再继续在下面直接改文字。
                          </p>
                          {createForm.uploadedFileName && (
                            <p className="mt-2 text-xs text-gray-700">当前文件：{createForm.uploadedFileName}</p>
                          )}
                        </div>
                        <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-blue-400 hover:bg-blue-50">
                          <input type="file" className="hidden" accept={PROCESS_FILE_ACCEPT[createForm.accessMode]} onChange={handleFileUpload} />
                          选择文件
                        </label>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      {createForm.inputMethod === 'file' ? '文件内容（可继续修改）' : '流程模板内容'}
                    </label>
                    <textarea
                      rows={18}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={createForm.textTemplateContent}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, textTemplateContent: e.target.value }))}
                      placeholder={PROCESS_TEXT_TEMPLATE_PLACEHOLDERS[createForm.accessMode]}
                    />
                  </div>

                  <p className="text-xs text-gray-500">
                    这里维护的是流程库配置文本。后续真正给办理人展示的“需补充信息 / 文件上传入口”，会根据这里识别出的字段自动生成。
                  </p>
                </div>

                <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{PROCESS_ACCESS_MODE_META[createForm.accessMode].helperTitle}</h3>
                    <p className="mt-1 text-xs leading-5 text-gray-600">{PROCESS_ACCESS_MODE_META[createForm.accessMode].helperText}</p>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="text-sm font-medium text-gray-900">当前建议你这样写</div>
                    <ul className="mt-3 space-y-2 text-xs leading-5 text-gray-600">
                      <li>• 先写清楚流程名称、流程编码、流程描述。</li>
                      <li>• 再写“需要填写的信息”和“需要上传的材料”。</li>
                      <li>• URL / RPA 模式补充步骤；API 模式补充提交接口和查询接口。</li>
                      <li>• 附件字段是否必传，直接在模板里写说明和示例即可。</li>
                    </ul>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="text-sm font-medium text-gray-900">当前配置摘要</div>
                    <dl className="mt-3 space-y-2 text-xs text-gray-600">
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-gray-500">办理方式</dt>
                        <dd className="text-right font-medium text-gray-900">{PROCESS_ACCESS_MODE_META[createForm.accessMode].label}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-gray-500">录入方式</dt>
                        <dd className="text-right font-medium text-gray-900">{PROCESS_INPUT_MODE_META[createForm.inputMethod].label}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-gray-500">流程编码</dt>
                        <dd className="text-right font-medium text-gray-900">{createForm.processCode.trim() || '未填写'}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-gray-500">流程名称</dt>
                        <dd className="text-right font-medium text-gray-900">{createForm.processName.trim() || '未填写'}</dd>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <dt className="text-gray-500">所属连接器</dt>
                        <dd className="text-right font-medium text-gray-900">
                          {connectorOptions.find((item) => item.id === createForm.connectorId)?.name || '未选择'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </section>
            </div>

            <div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-8 py-5">
              <button onClick={closeEditor} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">取消</button>
              <div className="flex-1 text-xs text-gray-500">
                <div>
                  当前将按
                  <span className="mx-1 font-semibold text-gray-700">{PROCESS_INPUT_MODE_META[createForm.inputMethod].label}</span>
                  录入，办理方式为
                  <span className="mx-1 font-semibold text-gray-700">{PROCESS_ACCESS_MODE_META[createForm.accessMode].label}</span>。
                </div>
                <div className="mt-1">
                  {editorMode === 'edit'
                    ? '保存后会发布一个新版本，并自动归档当前已发布版本。'
                    : '没有连接器时，请先去初始化中心创建或批量初始化一个连接器。'}
                </div>
              </div>
              <button
                onClick={handleCreate}
                disabled={creating || !createForm.connectorId || !createForm.processCode.trim() || !createForm.processName.trim() || !activeFlowContent}
                className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? (editorMode === 'edit' ? '保存中...' : '创建中...') : (editorMode === 'edit' ? '保存修改' : '创建流程')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProcessLibraryPage() {
  return (
    <AuthGuard allowedRoles={['admin', 'flow_manager']}>
      <ProcessLibraryContent />
    </AuthGuard>
  );
}
