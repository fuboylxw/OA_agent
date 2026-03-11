'use client';

import { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const OA_TYPE_MAP: Record<string, { label: string; icon: string }> = {
  openapi: { label: 'OpenAPI', icon: 'fa-plug' },
  form: { label: '表单型', icon: 'fa-file-alt' },
  hybrid: { label: '混合型', icon: 'fa-random' },
};

const OCL_COLORS: Record<string, { bg: string; text: string }> = {
  OCL0: { bg: 'bg-red-100', text: 'text-red-600' },
  OCL1: { bg: 'bg-orange-100', text: 'text-orange-600' },
  OCL2: { bg: 'bg-orange-100', text: 'text-orange-600' },
  OCL3: { bg: 'bg-blue-100', text: 'text-blue-600' },
  OCL4: { bg: 'bg-green-100', text: 'text-green-600' },
  OCL5: { bg: 'bg-green-100', text: 'text-green-600' },
};

export default function ConnectorsContent({ initialConnectors }: { initialConnectors: any[] }) {
  const [connectors, setConnectors] = useState<any[]>(initialConnectors);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const runHealthCheck = async (id: string) => {
    try {
      await axios.post(`${API_URL}/api/v1/connectors/${id}/health-check`);
      // reload
      const tenantId = localStorage.getItem('tenantId');
      if (tenantId) {
        const res = await axios.get(`${API_URL}/api/v1/connectors`, { params: { tenantId } });
        setConnectors(res.data);
      }
    } catch (error) {
      console.error('Health check failed:', error);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await axios.delete(`${API_URL}/api/v1/connectors/${id}`);
      setConnectors(connectors.filter((c) => c.id !== id));
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Delete failed:', error);
      alert('删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  const getOclColor = (level: string) => OCL_COLORS[level] || { bg: 'bg-blue-100', text: 'text-blue-600' };

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">连接器管理</h1>
            <p className="text-gray-600">管理已接入的 OA 系统连接器</p>
          </div>
          <a href="/bootstrap" className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors">
            <i className="fas fa-plus"></i>
            接入新系统
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">全部连接器</p>
              <p className="text-2xl font-bold text-gray-900">{connectors.length}</p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-plug text-blue-600"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">活跃</p>
              <p className="text-2xl font-bold text-green-600">
                {connectors.filter((c) => c.status === 'active').length}
              </p>
            </div>
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-check-circle text-green-600"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">OpenAPI 型</p>
              <p className="text-2xl font-bold text-blue-600">
                {connectors.filter((c) => c.oaType === 'openapi').length}
              </p>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-code text-blue-600"></i>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">表单型</p>
              <p className="text-2xl font-bold text-purple-600">
                {connectors.filter((c) => c.oaType === 'form').length}
              </p>
            </div>
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <i className="fas fa-file-alt text-purple-600"></i>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {connectors.map((connector) => {
          const oaType = OA_TYPE_MAP[connector.oaType] || { label: connector.oaType, icon: 'fa-plug' };
          const oclColor = getOclColor(connector.oclLevel);
          return (
            <div key={connector.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <i className={`fas ${oaType.icon} text-blue-600`}></i>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{connector.name}</h3>
                    <p className="text-xs text-gray-500">{oaType.label}</p>
                  </div>
                </div>
                <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${connector.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                  {connector.status === 'active' ? '活跃' : '停用'}
                </span>
              </div>

              <div className="space-y-2 text-sm mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">厂商</span>
                  <span className="font-medium text-gray-900">{connector.oaVendor || '未知'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">兼容等级</span>
                  <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${oclColor.bg} ${oclColor.text}`}>
                    {connector.oclLevel}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">自动化等级</span>
                  <span className="inline-block px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-600">{connector.falLevel || 'F0'}</span>
                </div>
                <div className="flex items-start justify-between">
                  <span className="text-gray-500">地址</span>
                  <span className="font-mono text-xs text-right truncate max-w-[60%] text-gray-700" title={connector.baseUrl}>
                    {connector.baseUrl}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-gray-200">
                <button
                  onClick={() => runHealthCheck(connector.id)}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition-all inline-flex items-center justify-center gap-2"
                >
                  <i className="fas fa-heartbeat text-xs"></i>
                  健康检查
                </button>
                <a
                  href={`/connectors/${connector.id}`}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all inline-flex items-center justify-center gap-2"
                >
                  查看详情
                  <i className="fas fa-arrow-right text-xs"></i>
                </a>
                <button
                  onClick={() => setDeleteConfirm({ id: connector.id, name: connector.name })}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:text-red-800 hover:bg-red-50 transition-all inline-flex items-center justify-center gap-2"
                >
                  <i className="fas fa-trash text-xs"></i>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {connectors.length === 0 && (
        <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <i className="fas fa-plug text-blue-600 text-3xl"></i>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">还没有连接器</h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto">
            通过初始化中心接入您的 OA 系统，系统将自动创建连接器
          </p>
          <a href="/bootstrap" className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors">
            <i className="fas fa-cogs"></i>
            前往初始化中心
          </a>
        </div>
      )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <i className="fas fa-exclamation-triangle text-red-600 text-xl"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">确认删除连接器</h2>
                <p className="text-sm text-gray-500 mt-1">此操作不可撤销</p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-800 mb-2">
                <strong>警告：</strong>删除连接器 <strong>{deleteConfirm.name}</strong> 将同时删除：
              </p>
              <ul className="text-sm text-red-700 space-y-1 ml-4">
                <li>• 所有关联的流程模板</li>
                <li>• 所有流程草稿</li>
                <li>• 所有历史申请记录</li>
                <li>• 所有申请状态记录</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 px-6 py-3 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                disabled={deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i>
                    删除中...
                  </>
                ) : (
                  <>
                    <i className="fas fa-trash"></i>
                    确认删除
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
