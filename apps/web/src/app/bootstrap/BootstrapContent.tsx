'use client';

import { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const STATUS_MAP: Record<string, { label: string; icon: string; bgClass: string; textClass: string }> = {
  CREATED: { label: '已创建', icon: 'fa-file-alt', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  DISCOVERING: { label: '识别中', icon: 'fa-search', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  PARSING: { label: '解析中', icon: 'fa-cog fa-spin', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  NORMALIZING: { label: '归一化', icon: 'fa-sync', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  COMPILING: { label: '编译中', icon: 'fa-hammer', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  REPLAYING: { label: '回放测试', icon: 'fa-play', bgClass: 'bg-blue-100', textClass: 'text-blue-600' },
  REVIEW: { label: '待审核', icon: 'fa-eye', bgClass: 'bg-orange-100', textClass: 'text-orange-600' },
  PUBLISHED: { label: '已发布', icon: 'fa-check-circle', bgClass: 'bg-green-100', textClass: 'text-green-600' },
  FAILED: { label: '失败', icon: 'fa-times-circle', bgClass: 'bg-red-100', textClass: 'text-red-600' },
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
  });
  const [uploadFileName, setUploadFileName] = useState('');

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadJobs = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/v1/bootstrap/jobs`, { params: { tenantId } });
      setJobs(response.data);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  };

  const createJob = async () => {
    setCreating(true);
    setCreateError('');
    try {
      await axios.post(`${API_URL}/api/v1/bootstrap/jobs`, { ...formData, tenantId });
      setShowCreateModal(false);
      setFormData({ name: '', oaUrl: '', apiDocType: 'openapi', apiDocContent: '', apiDocUrl: '' });
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

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">初始化中心</h1>
            <p className="text-gray-600">自动识别和接入 OA 系统，生成适配器和流程库</p>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">全部任务</p>
              <p className="text-2xl font-bold text-gray-900">{jobs.length}</p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-tasks text-blue-600"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">进行中</p>
              <p className="text-2xl font-bold text-blue-600">
                {jobs.filter((j) => !['PUBLISHED', 'FAILED', 'REVIEW'].includes(j.status)).length}
              </p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-spinner text-blue-600"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">待审核</p>
              <p className="text-2xl font-bold text-orange-600">
                {jobs.filter((j) => j.status === 'REVIEW').length}
              </p>
            </div>
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-eye text-orange-600"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">已发布</p>
              <p className="text-2xl font-bold text-green-600">
                {jobs.filter((j) => j.status === 'PUBLISHED').length}
              </p>
            </div>
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-check-circle text-green-600"></i>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {jobs.map((job) => {
          const status = getStatus(job.status);
          return (
            <div key={job.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <i className={`fas ${status.icon} text-blue-600`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">
                        {job.name || `初始化任务 #${job.id.substring(0, 8)}`}
                      </h3>
                      <p className="text-sm text-gray-500 truncate">
                        {job.oaUrl || job.openApiUrl || job.harFileUrl || '未指定来源'}
                      </p>
                    </div>
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${status.bgClass} ${status.textClass}`}>
                      {status.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-6 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <i className="fas fa-clock text-xs"></i>
                      {new Date(job.createdAt).toLocaleString('zh-CN')}
                    </span>
                    {job.updatedAt && (
                      <span className="flex items-center gap-1">
                        <i className="fas fa-sync text-xs"></i>
                        更新于 {new Date(job.updatedAt).toLocaleString('zh-CN')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-200">
                    <a href={`/bootstrap/${job.id}`} className="text-sm text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1">
                      查看详情
                      <i className="fas fa-arrow-right text-xs"></i>
                    </a>
                    {job.status === 'REVIEW' && (
                      <button className="text-sm text-green-600 hover:text-green-800 font-medium">发布到流程库</button>
                    )}
                    {job.status === 'FAILED' && (
                      <button className="text-sm text-orange-600 hover:text-orange-800 font-medium">重试</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
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
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-lg w-full">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">创建初始化任务</h2>
              <button
                onClick={() => { setShowCreateModal(false); setCreateError(''); }}
                className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
              >
                <i className="fas fa-times text-gray-500"></i>
              </button>
            </div>

            {createError && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
                <i className="fas fa-exclamation-circle"></i>
                {createError}
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5">
              <p className="text-sm text-blue-800">
                <i className="fas fa-info-circle mr-1"></i>
                提供以下任意一种方式，智能体将自动读取并识别 OA 系统的流程接口：
              </p>
              <ul className="text-xs text-blue-700 mt-2 space-y-1 ml-5 list-disc">
                <li>填写 API 文档链接（智能体自动访问并解析）</li>
                <li>上传 API 文档文件（支持 OpenAPI / Swagger 格式）</li>
                <li>直接粘贴 API 文档内容</li>
              </ul>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">OA 系统名称</label>
                <input
                  type="text"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="例如：泛微 OA、致远 OA"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">为 OA 系统设置一个名称，方便后续区分</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">OA 系统地址</label>
                <input
                  type="text"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="https://oa.example.com"
                  value={formData.oaUrl}
                  onChange={(e) => setFormData({ ...formData, oaUrl: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">OA 系统的访问地址</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">API 文档类型</label>
                <select
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  value={formData.apiDocType}
                  onChange={(e) => setFormData({ ...formData, apiDocType: e.target.value as any })}
                >
                  <option value="openapi">OpenAPI 3.0</option>
                  <option value="swagger">Swagger 2.0</option>
                  <option value="custom">其他格式</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="fas fa-cloud-upload-alt text-blue-500 mr-1"></i>
                  上传 API 文档
                </label>
                <label className="flex items-center justify-center w-full px-4 py-4 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                  <input type="file" className="hidden" accept=".json,.yaml,.yml,.txt" onChange={handleFileUpload} />
                  {uploadFileName ? (
                    <div className="flex items-center gap-2 text-sm text-blue-600">
                      <i className="fas fa-file-code"></i>
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
                    <div className="flex flex-col items-center gap-1 text-gray-500">
                      <i className="fas fa-cloud-upload-alt text-xl"></i>
                      <span className="text-sm">点击选择文件，支持 .json / .yaml / .yml</span>
                    </div>
                  )}
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="fas fa-link text-blue-500 mr-1"></i>
                  API 文档链接
                </label>
                <input
                  type="text"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="https://oa.example.com/api-docs.json"
                  value={formData.apiDocUrl}
                  onChange={(e) => setFormData({ ...formData, apiDocUrl: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">智能体将自动访问该链接，读取并解析流程接口</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="fas fa-paste text-blue-500 mr-1"></i>
                  或直接粘贴文档内容
                </label>
                <textarea
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono"
                  rows={5}
                  placeholder='{"openapi":"3.0.0","info":{...},"paths":{...}}'
                  value={formData.apiDocContent}
                  onChange={(e) => setFormData({ ...formData, apiDocContent: e.target.value })}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => { setShowCreateModal(false); setCreateError(''); }}
                disabled={creating}
                className="flex-1 px-6 py-3 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={createJob}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                disabled={creating || (!formData.apiDocUrl && !formData.apiDocContent)}
              >
                {creating ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i>
                    创建中...
                  </>
                ) : (
                  '创建任务'
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
