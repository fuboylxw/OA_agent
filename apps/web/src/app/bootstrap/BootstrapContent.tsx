'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const STATUS_MAP: Record<string, { label: string; icon: string; bgClass: string; textClass: string }> = {
  CREATED: { label: '已入队', icon: 'fa-file-alt', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  DISCOVERING: { label: '识别中', icon: 'fa-search', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  PARSING: { label: '解析中', icon: 'fa-cog fa-spin', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  AUTH_PROBING: { label: '认证探测', icon: 'fa-key', bgClass: 'bg-yellow-100', textClass: 'text-yellow-600' },
  VALIDATING: { label: '验证中', icon: 'fa-check-double', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  SELF_HEALING: { label: '自动修复中', icon: 'fa-magic', bgClass: 'bg-orange-100', textClass: 'text-orange-600' },
  REVALIDATING: { label: '修复后复验', icon: 'fa-vial', bgClass: 'bg-amber-100', textClass: 'text-amber-700' },
  NORMALIZING: { label: '归一化', icon: 'fa-sync', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  COMPILING: { label: '编译发布中', icon: 'fa-hammer', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  AUTO_RECOVERING: { label: '自动恢复中', icon: 'fa-redo', bgClass: 'bg-orange-100', textClass: 'text-orange-700' },
  AUTO_RECONCILING: { label: '自动补齐中', icon: 'fa-tools', bgClass: 'bg-amber-100', textClass: 'text-amber-700' },
  VALIDATION_FAILED: { label: '验证未通过', icon: 'fa-exclamation-triangle', bgClass: 'bg-red-100', textClass: 'text-red-600' },
  MANUAL_REVIEW: { label: '待人工处理', icon: 'fa-user', bgClass: 'bg-red-100', textClass: 'text-red-700' },
  PARTIALLY_PUBLISHED: { label: '部分发布', icon: 'fa-layer-group', bgClass: 'bg-yellow-100', textClass: 'text-yellow-700' },
  PUBLISHED: { label: '已发布', icon: 'fa-check-circle', bgClass: 'bg-green-100', textClass: 'text-green-600' },
  FAILED: { label: '失败', icon: 'fa-times-circle', bgClass: 'bg-red-100', textClass: 'text-red-600' },
  CONNECTOR_DELETED: { label: '连接器已删除', icon: 'fa-unlink', bgClass: 'bg-gray-100', textClass: 'text-gray-500' },
};

export default function BootstrapContent({ initialJobs, tenantId }: { initialJobs: any[]; tenantId: string }) {
  const [jobs, setJobs] = useState<any[]>(initialJobs);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    oaUrl: '',
    apiDocType: 'openapi' as 'openapi' | 'swagger' | 'custom',
    apiDocContent: '',
    apiDocUrl: '',
    authConfig: {} as Record<string, any>,
  });
  const [uploadFileName, setUploadFileName] = useState('');

  const [docInputTab, setDocInputTab] = useState<'upload' | 'link' | 'paste'>('upload');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [reactivateJob, setReactivateJob] = useState<any>(null);
  const [reactivateMode, setReactivateMode] = useState<'reuse' | 'new'>('reuse');
  const [reactivateDoc, setReactivateDoc] = useState({
    apiDocContent: '',
    apiDocUrl: '',
    apiDocType: 'openapi',
    oaUrl: '',
    authConfig: {} as Record<string, any>,
  });
  const [reactivateFileName, setReactivateFileName] = useState('');
  const [reactivating, setReactivating] = useState(false);
  const [reactivateError, setReactivateError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);

  const TERMINAL_STATUSES = ['PUBLISHED', 'FAILED', 'VALIDATION_FAILED', 'PARTIALLY_PUBLISHED', 'MANUAL_REVIEW'];

  const loadJobs = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/v1/bootstrap/jobs`, { params: { tenantId } });
      setJobs(response.data);
      return response.data;
    } catch (error) {
      console.error('Failed to load jobs:', error);
      return null;
    }
  }, [tenantId]);

  // 当有进行中的任务时，自动轮询状态
  useEffect(() => {
    const hasInProgress = jobs.some((j) => !TERMINAL_STATUSES.includes(j.status));
    if (!hasInProgress) return undefined;

    const intervalId = window.setInterval(() => {
      void loadJobs();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [jobs, loadJobs]);

  const createJob = async () => {
    setCreating(true);
    setCreateError('');
    try {
      // 构建 payload，过滤空值
      const { authConfig, ...rest } = formData;
      const payload: any = Object.fromEntries(
        Object.entries({ ...rest, tenantId }).filter(([_, v]) => v !== '')
      );
      // 只有在有认证信息时才传 authConfig
      if (authConfig.username || authConfig.password || authConfig.token) {
        payload.authConfig = authConfig;
      }
      await axios.post(`${API_URL}/api/v1/bootstrap/jobs`, payload);
      setShowCreateModal(false);
      setFormData({ name: '', oaUrl: '', apiDocType: 'openapi', apiDocContent: '', apiDocUrl: '', authConfig: {} });
      setUploadFileName('');
      loadJobs();
    } catch (error: any) {
      const msg = error.response?.data?.message || error.message || '创建失败';
      setCreateError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setCreating(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setFormData((prev) => ({ ...prev, apiDocContent: content }));
    };
    reader.readAsText(file);
  };

  const getStatus = (status: string) => STATUS_MAP[status] || { label: status, icon: 'fa-clipboard', bgClass: 'bg-blue-100', textClass: 'text-blue-600' };

  // 判断"连接器已删除"：PUBLISHED 状态但 connectorId 为空
  const isConnectorDeleted = (job: any) =>
    ['PUBLISHED', 'PARTIALLY_PUBLISHED'].includes(job.status) && !job.connectorId;

  const getEffectiveStatus = (job: any) =>
    isConnectorDeleted(job) ? 'CONNECTOR_DELETED' : job.status;

  const normalizeAuthConfig = (value: Record<string, any> | null | undefined) =>
    Object.fromEntries(
      Object.entries(value || {}).filter(([key, val]) => !key.startsWith('_') && val !== ''),
    );

  const getEditableAuthConfig = (value: Record<string, any> | null | undefined) => {
    const normalized = normalizeAuthConfig(value);
    return Object.fromEntries(
      Object.entries(normalized).filter(([key]) => ['username', 'password', 'token'].includes(key)),
    );
  };

  const openReactivateModal = (job: any) => {
    setReactivateJob(job);
    setReactivateMode('reuse');
    setReactivateError('');
    setReactivateFileName('');
    setReactivateDoc({
      apiDocContent: '',
      apiDocUrl: job.openApiUrl || '',
      apiDocType: 'openapi',
      oaUrl: job.oaUrl || '',
      authConfig: getEditableAuthConfig(job.authConfig),
    });
  };

  const handleReactivate = async () => {
    if (!reactivateJob) return;
    setReactivating(true);
    setReactivateError('');
    try {
      const payload: any = {
        mode: reactivateMode,
        oaUrl: reactivateDoc.oaUrl || undefined,
      };
      if (reactivateMode === 'new') {
        if (reactivateDoc.apiDocContent) payload.apiDocContent = reactivateDoc.apiDocContent;
        if (reactivateDoc.apiDocUrl) payload.apiDocUrl = reactivateDoc.apiDocUrl;
        payload.apiDocType = reactivateDoc.apiDocType;
      }
      payload.authConfig = normalizeAuthConfig(reactivateDoc.authConfig);
      await axios.post(`${API_URL}/api/v1/bootstrap/jobs/${reactivateJob.id}/reactivate`, payload);
      setReactivateJob(null);
      setReactivateDoc({ apiDocContent: '', apiDocUrl: '', apiDocType: 'openapi', oaUrl: '', authConfig: {} });
      setReactivateFileName('');
      loadJobs();
    } catch (error: any) {
      const msg = error.response?.data?.message || error.message || '重新激活失败';
      setReactivateError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setReactivating(false);
    }
  };

  const handleReactivateFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReactivateFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setReactivateDoc((prev) => ({ ...prev, apiDocContent: ev.target?.result as string }));
    };
    reader.readAsText(file);
  };

  const handleDeleteJob = async (jobId: string) => {
    setDeleting(true);
    try {
      await axios.delete(`${API_URL}/api/v1/bootstrap/jobs/${jobId}`);
      setDeleteConfirm(null);
      loadJobs();
    } catch (error: any) {
      alert(error.response?.data?.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-6">
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 mb-1">初始化中心</h1>
            <p className="text-sm text-gray-600">自动识别和接入 OA 系统，生成适配器和流程库</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors"
          >
            <i className="fas fa-plus"></i>
            创建初始化任务
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm px-4 py-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500">全部任务</p>
              <p className="text-xl font-bold text-gray-900">{jobs.length}</p>
            </div>
            <div className="w-8 h-8 bg-blue-100 rounded-md flex items-center justify-center">
              <i className="fas fa-tasks text-blue-600 text-xs"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm px-4 py-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500">进行中</p>
              <p className="text-xl font-bold text-blue-600">
                {jobs.filter((j) => !TERMINAL_STATUSES.includes(j.status)).length}
              </p>
            </div>
            <div className="w-8 h-8 bg-blue-100 rounded-md flex items-center justify-center">
              <i className="fas fa-spinner text-blue-600 text-xs"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm px-4 py-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500">失败</p>
              <p className="text-xl font-bold text-red-600">
                {jobs.filter((j) => ['FAILED', 'VALIDATION_FAILED', 'MANUAL_REVIEW'].includes(j.status)).length}
              </p>
            </div>
            <div className="w-8 h-8 bg-red-100 rounded-md flex items-center justify-center">
              <i className="fas fa-times-circle text-red-600 text-xs"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm px-4 py-3 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500">已发布</p>
              <p className="text-xl font-bold text-green-600">
                {jobs.filter((j) => ['PUBLISHED', 'PARTIALLY_PUBLISHED'].includes(j.status)).length}
              </p>
            </div>
            <div className="w-8 h-8 bg-green-100 rounded-md flex items-center justify-center">
              <i className="fas fa-check-circle text-green-600 text-xs"></i>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">任务名称</th>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3 hidden sm:table-cell">来源</th>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">状态</th>
              <th className="text-left text-xs font-medium text-gray-500 px-4 py-3 hidden md:table-cell">创建时间</th>
              <th className="text-right text-xs font-medium text-gray-500 px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map((job) => {
              const effectiveStatus = getEffectiveStatus(job);
              const status = getStatus(effectiveStatus);
              return (
                <tr key={job.id} className={`hover:bg-gray-50/50 transition-colors ${effectiveStatus === 'CONNECTOR_DELETED' ? 'opacity-70' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 ${status.bgClass} rounded-md flex items-center justify-center flex-shrink-0`}>
                        <i className={`fas ${status.icon} ${status.textClass} text-xs`}></i>
                      </div>
                      <span className="text-sm font-medium text-gray-900 truncate max-w-[200px]">
                        {job.name || `任务 #${job.id.substring(0, 8)}`}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-xs text-gray-500 truncate block max-w-[200px]">
                      {job.oaUrl || job.openApiUrl || job.harFileUrl || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${status.bgClass} ${status.textClass}`}>
                      {status.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-gray-500">{new Date(job.createdAt).toLocaleString('zh-CN')}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <a href={`/bootstrap/${job.id}`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                        详情
                      </a>
                      {effectiveStatus !== 'CONNECTOR_DELETED' && ['FAILED', 'VALIDATION_FAILED', 'PARTIALLY_PUBLISHED', 'MANUAL_REVIEW'].includes(job.status) && (
                        <>
                          <button
                            onClick={() => openReactivateModal(job)}
                            className="text-xs text-orange-600 hover:text-orange-800 font-medium inline-flex items-center gap-1"
                          >
                            <i className="fas fa-redo text-[10px]"></i>
                            重新处理
                          </button>
                          {['FAILED', 'VALIDATION_FAILED', 'MANUAL_REVIEW'].includes(job.status) && (
                            <button
                              onClick={() => setDeleteConfirm(job)}
                              className="text-xs text-red-500 hover:text-red-700 font-medium inline-flex items-center gap-1"
                            >
                              <i className="fas fa-trash-alt text-[10px]"></i>
                              删除
                            </button>
                          )}
                        </>
                      )}
                      {effectiveStatus === 'CONNECTOR_DELETED' && (
                        <>
                          <button
                            onClick={() => openReactivateModal(job)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1"
                          >
                            <i className="fas fa-redo text-[10px]"></i>
                            重新激活
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(job)}
                            className="text-xs text-red-500 hover:text-red-700 font-medium inline-flex items-center gap-1"
                          >
                            <i className="fas fa-trash-alt text-[10px]"></i>
                            彻底删除
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {jobs.length === 0 && (
        <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <i className="fas fa-cogs text-blue-600 text-3xl"></i>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">还没有初始化任务</h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto">
            创建初始化任务，系统将自动识别您的 OA 系统并生成适配器
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors"
          >
            <i className="fas fa-plus"></i>
            创建初始化任务
          </button>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-xl font-bold text-gray-900">创建初始化任务</h2>
                <p className="text-sm text-gray-500 mt-0.5">填写 OA 系统信息并导入 API 文档</p>
              </div>
              <button
                onClick={() => { setShowCreateModal(false); setCreateError(''); }}
                className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
              >
                <i className="fas fa-times text-gray-500"></i>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              {createError && (
                <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
                  <i className="fas fa-exclamation-circle"></i>
                  {createError}
                </div>
              )}

              {/* Section 1: Basic Info */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center">1</span>
                  基本信息
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">OA 系统名称</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="例如：泛微 OA、致远 OA"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">OA 系统地址</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="https://oa.example.com"
                      value={formData.oaUrl}
                      onChange={(e) => setFormData({ ...formData, oaUrl: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">API 文档类型</label>
                  <select
                    className="w-full sm:w-1/2 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    value={formData.apiDocType}
                    onChange={(e) => setFormData({ ...formData, apiDocType: e.target.value as any })}
                  >
                    <option value="openapi">OpenAPI 3.0</option>
                    <option value="swagger">Swagger 2.0</option>
                    <option value="custom">其他格式</option>
                  </select>
                </div>
              </div>

              {/* Section 2: Auth Config */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center">2</span>
                  认证信息
                  <span className="text-xs font-normal text-gray-400 ml-1">可选，系统会自动探测认证方式</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">用户名</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="OA 系统登录用户名"
                      value={formData.authConfig.username || ''}
                      onChange={(e) => setFormData({ ...formData, authConfig: { ...formData.authConfig, username: e.target.value } })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">密码</label>
                    <input
                      type="password"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="••••••••"
                      value={formData.authConfig.password || ''}
                      onChange={(e) => setFormData({ ...formData, authConfig: { ...formData.authConfig, password: e.target.value } })}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 border-t border-gray-200"></div>
                  <span className="text-xs text-gray-400">或</span>
                  <div className="flex-1 border-t border-gray-200"></div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Token / API Key</label>
                  <input
                    type="password"
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="如果有现成的令牌，可以直接填入"
                    value={formData.authConfig.token || ''}
                    onChange={(e) => setFormData({ ...formData, authConfig: { ...formData.authConfig, token: e.target.value } })}
                  />
                  <p className="text-xs text-gray-400 mt-1.5">认证方式和登录路径将从 API 文档中自动识别</p>
                </div>
              </div>

              {/* Section 3: API Doc Import */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center">3</span>
                  导入 API 文档
                  <span className="text-xs font-normal text-gray-400 ml-1">选择以下任意一种方式</span>
                </h3>

                {/* Tabs */}
                <div className="flex border border-gray-200 rounded-lg p-1 bg-gray-50 mb-4">
                  {([
                    { key: 'upload' as const, icon: 'fa-cloud-upload-alt', label: '上传文件' },
                    { key: 'link' as const, icon: 'fa-link', label: '文档链接' },
                    { key: 'paste' as const, icon: 'fa-paste', label: '粘贴内容' },
                  ]).map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setDocInputTab(tab.key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        docInputTab === tab.key
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <i className={`fas ${tab.icon} text-xs`}></i>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                {docInputTab === 'upload' && (
                  <label className="flex items-center justify-center w-full px-4 py-8 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                    <input type="file" className="hidden" accept=".json,.yaml,.yml,.txt" onChange={handleFileUpload} />
                    {uploadFileName ? (
                      <div className="flex items-center gap-2 text-sm text-blue-600">
                        <i className="fas fa-file-code text-lg"></i>
                        <span>{uploadFileName}</span>
                        <button
                          type="button"
                          className="ml-2 text-gray-400 hover:text-red-500"
                          onClick={(e) => { e.preventDefault(); setUploadFileName(''); setFormData((prev) => ({ ...prev, apiDocContent: '' })); }}
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-gray-500">
                        <i className="fas fa-cloud-upload-alt text-2xl text-gray-400"></i>
                        <span className="text-sm">点击选择文件</span>
                        <span className="text-xs text-gray-400">支持 .json / .yaml / .yml / .txt</span>
                      </div>
                    )}
                  </label>
                )}

                {docInputTab === 'link' && (
                  <div>
                    <input
                      type="text"
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="https://oa.example.com/api-docs.json"
                      value={formData.apiDocUrl}
                      onChange={(e) => setFormData({ ...formData, apiDocUrl: e.target.value })}
                    />
                    <p className="text-xs text-gray-500 mt-1.5">智能体将自动访问该链接，读取并解析流程接口</p>
                  </div>
                )}

                {docInputTab === 'paste' && (
                  <textarea
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono"
                    rows={8}
                    placeholder='{"openapi":"3.0.0","info":{...},"paths":{...}}'
                    value={formData.apiDocContent}
                    onChange={(e) => setFormData({ ...formData, apiDocContent: e.target.value })}
                  />
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-8 py-5 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex-shrink-0">
              <button
                onClick={() => { setShowCreateModal(false); setCreateError(''); }}
                disabled={creating}
                className="px-5 py-2.5 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                取消
              </button>
              <div className="flex-1" />
              <button
                onClick={createJob}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                disabled={creating || (!formData.apiDocUrl && !formData.apiDocContent)}
              >
                {creating ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i>
                    创建中...
                  </>
                ) : (
                  <>
                    <i className="fas fa-check"></i>
                    确认创建
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactivate Modal */}
      {reactivateJob && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">重新激活</h2>
                <p className="text-xs text-gray-500 mt-0.5">{reactivateJob.name || `任务 #${reactivateJob.id.substring(0, 8)}`}</p>
              </div>
              <button
                onClick={() => { setReactivateJob(null); setReactivateError(''); }}
                className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"
              >
                <i className="fas fa-times text-gray-500"></i>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {reactivateError && (
                <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
                  <i className="fas fa-exclamation-circle"></i>
                  {reactivateError}
                </div>
              )}

              <div className="space-y-3 mb-5">
                <label
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${reactivateMode === 'reuse' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                  onClick={() => setReactivateMode('reuse')}
                >
                  <input type="radio" name="reactivateMode" checked={reactivateMode === 'reuse'} readOnly className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">使用原有文档恢复</p>
                    <p className="text-xs text-gray-500 mt-0.5">复用原文档重新验证，可同时修正 OA 地址和认证信息</p>
                  </div>
                </label>
                <label
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${reactivateMode === 'new' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                  onClick={() => setReactivateMode('new')}
                >
                  <input type="radio" name="reactivateMode" checked={reactivateMode === 'new'} readOnly className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">上传新文档</p>
                    <p className="text-xs text-gray-500 mt-0.5">上传最新文档后重新验证，并按通过结果重新发布</p>
                  </div>
                </label>
              </div>

              <div className="space-y-3 mb-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">OA 系统地址</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="https://oa.example.com"
                    value={reactivateDoc.oaUrl}
                    onChange={(e) => setReactivateDoc((prev) => ({ ...prev, oaUrl: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={reactivateDoc.authConfig.username || ''}
                      onChange={(e) => setReactivateDoc((prev) => ({
                        ...prev,
                        authConfig: { ...prev.authConfig, username: e.target.value },
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
                    <input
                      type="password"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={reactivateDoc.authConfig.password || ''}
                      onChange={(e) => setReactivateDoc((prev) => ({
                        ...prev,
                        authConfig: { ...prev.authConfig, password: e.target.value },
                      }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Token / API Key</label>
                  <input
                    type="password"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={reactivateDoc.authConfig.token || ''}
                    onChange={(e) => setReactivateDoc((prev) => ({
                      ...prev,
                      authConfig: { ...prev.authConfig, token: e.target.value },
                    }))}
                  />
                </div>
              </div>

              {reactivateMode === 'new' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">上传文档</label>
                    <label className="flex items-center justify-center w-full h-20 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                      <div className="text-center">
                        {reactivateFileName ? (
                          <span className="text-sm text-blue-600">{reactivateFileName}</span>
                        ) : (
                          <span className="text-sm text-gray-500">点击选择文件</span>
                        )}
                      </div>
                      <input type="file" className="hidden" accept=".json,.yaml,.yml,.har" onChange={handleReactivateFileUpload} />
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">或输入文档链接</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="https://example.com/api-docs.json"
                      value={reactivateDoc.apiDocUrl}
                      onChange={(e) => setReactivateDoc((prev) => ({ ...prev, apiDocUrl: e.target.value }))}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-gray-200 flex-shrink-0">
              <button
                onClick={() => { setReactivateJob(null); setReactivateError(''); }}
                disabled={reactivating}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleReactivate}
                disabled={reactivating || (reactivateMode === 'new' && !reactivateDoc.apiDocContent && !reactivateDoc.apiDocUrl)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {reactivating ? (
                  <><i className="fas fa-spinner fa-spin"></i>处理中...</>
                ) : (
                  <><i className="fas fa-redo"></i>{reactivateMode === 'reuse' ? '重新验证' : '上传并重新验证'}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full">
            <div className="px-6 py-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <i className="fas fa-exclamation-triangle text-red-600"></i>
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">彻底删除</h3>
                  <p className="text-xs text-gray-500">{deleteConfirm.name || `任务 #${deleteConfirm.id.substring(0, 8)}`}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-1">此操作将永久删除：</p>
              <ul className="text-xs text-gray-500 space-y-1 mb-4 ml-4 list-disc">
                <li>初始化任务及解析记录</li>
                <li>上传的 API 文档</li>
                <li>识别出的流程定义</li>
                <li>兼容性评估报告</li>
              </ul>
              <p className="text-xs text-red-600 font-medium">删除后无法恢复，重新接入需从头开始。</p>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-200">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => handleDeleteJob(deleteConfirm.id)}
                disabled={deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <><i className="fas fa-spinner fa-spin"></i>删除中...</>
                ) : (
                  <><i className="fas fa-trash-alt"></i>确认删除</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
