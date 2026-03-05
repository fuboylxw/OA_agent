'use client';

import { useState, useEffect } from 'react';
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

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConnectors();
  }, []);

  const loadConnectors = async () => {
    try {
      const tenantId = 'default-tenant';
      const response = await axios.get(`${API_URL}/api/v1/connectors`, {
        params: { tenantId },
      });
      setConnectors(response.data);
    } catch (error) {
      console.error('Failed to load connectors:', error);
    } finally {
      setLoading(false);
    }
  };

  const runHealthCheck = async (id: string) => {
    try {
      await axios.post(`${API_URL}/api/v1/connectors/${id}/health-check`);
      loadConnectors();
    } catch (error) {
      console.error('Health check failed:', error);
    }
  };

  const getOclColor = (level: string) => OCL_COLORS[level] || { bg: 'bg-blue-100', text: 'text-blue-600' };

  if (loading) {
    return (
      <main className="h-full overflow-y-auto flex items-center justify-center">
        <div className="flex items-center gap-3">
          <i className="fas fa-spinner fa-spin text-blue-600"></i>
          <span className="text-gray-500">加载中...</span>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Page Header */}
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

      {/* Stats Cards */}
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

      {/* Connectors Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {connectors.map((connector) => {
          const oaType = OA_TYPE_MAP[connector.oaType] || { label: connector.oaType, icon: 'fa-plug' };
          const oclColor = getOclColor(connector.oclLevel);
          return (
            <div key={connector.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow">
              {/* Connector Header */}
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

              {/* Connector Info */}
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

              {/* Actions */}
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
              </div>
            </div>
          );
        })}
      </div>

      {connectors.length === 0 && !loading && (
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
    </main>
  );
}
