'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '../lib/api-client';
import {
  RESOLVED_ACCESS_MODE_META,
  type ResolvedAccessModeKey,
  resolvePublishedAccessMode,
} from '../lib/connector-access-mode';
import { IDENTITY_SCOPE_META, normalizeIdentityScope } from '../lib/identity-scope';

const OA_TYPE_MAP: Record<string, { label: string; icon: string }> = {
  openapi: { label: '开放接口型', icon: 'fa-plug' },
  form: { label: '表单型', icon: 'fa-file-alt' },
  'form-page': { label: '表单型', icon: 'fa-file-alt' },
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

function isFormConnector(connector: { oaType?: string }) {
  return connector.oaType === 'form' || connector.oaType === 'form-page';
}

function formatConnectorStatus(status?: string) {
  if (status === 'active') return '启用中';
  if (status === 'inactive') return '未启用';
  return status || '-';
}

function resolveConnectorAccessMode(connector: any): ResolvedAccessModeKey {
  const templates = Array.isArray(connector?.processTemplates) ? connector.processTemplates : [];

  for (const template of templates) {
    const resolved = resolvePublishedAccessMode({
      uiHints: template?.uiHints,
      authConfig: connector?.authConfig,
    });
    if (resolved !== 'unknown') {
      return resolved;
    }
  }

  return resolvePublishedAccessMode({ authConfig: connector?.authConfig });
}

export default function ConnectorsContent({ initialConnectors }: { initialConnectors: any[] }) {
  const [connectors, setConnectors] = useState<any[]>(initialConnectors);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiClient.get('/connectors').then((res) => setConnectors(res.data)).catch(() => {});
  }, []);

  const stats = useMemo(() => ({
    total: connectors.length,
    active: connectors.filter((connector) => connector.status === 'active').length,
    openapi: connectors.filter((connector) => connector.oaType === 'openapi').length,
    form: connectors.filter((connector) => isFormConnector(connector)).length,
  }), [connectors]);

  const runHealthCheck = async (id: string) => {
    try {
      await apiClient.post(`/connectors/${id}/health-check`);
      const response = await apiClient.get('/connectors');
      setConnectors(response.data);
    } catch (error) {
      console.error('Health check failed:', error);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await apiClient.delete(`/connectors/${id}`);
      setConnectors((prev) => prev.filter((connector) => connector.id !== id));
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
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">连接器管理</h1>
            <p className="text-gray-600">查看已经发布的接口型、链接直达型和页面型连接器。</p>
          </div>
          <Link href="/bootstrap" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700">
            <i className="fas fa-plus"></i>
            新建接入
          </Link>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-6 md:grid-cols-4">
          {[
            { label: '全部连接器', value: stats.total, icon: 'fa-plug', tone: 'text-gray-900' },
            { label: '启用中', value: stats.active, icon: 'fa-check-circle', tone: 'text-green-600' },
            { label: '开放接口型', value: stats.openapi, icon: 'fa-code', tone: 'text-blue-600' },
            { label: '表单型 / 页面型', value: stats.form, icon: 'fa-file-alt', tone: 'text-purple-600' },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">{item.label}</p>
                  <p className={`text-2xl font-bold ${item.tone}`}>{item.value}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                  <i className={`fas ${item.icon} text-blue-600`}></i>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {connectors.map((connector) => {
            const oaType = OA_TYPE_MAP[connector.oaType] || { label: connector.oaType, icon: 'fa-plug' };
            const oclColor = getOclColor(connector.oclLevel);
            const accessMode = resolveConnectorAccessMode(connector);

            return (
              <div key={connector.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                      <i className={`fas ${oaType.icon} text-blue-600`}></i>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{connector.name}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="text-xs text-gray-500">{oaType.label}</p>
                        {accessMode !== 'unknown' && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            {RESOLVED_ACCESS_MODE_META[accessMode].badge}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${connector.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                    {formatConnectorStatus(connector.status)}
                  </span>
                </div>

                <div className="mb-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">厂商</span>
                    <span className="font-medium text-gray-900">{connector.oaVendor || '未知'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">OCL</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${oclColor.bg} ${oclColor.text}`}>
                      {connector.oclLevel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">FAL</span>
                    <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-600">
                      {connector.falLevel || 'F0'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">接入方式</span>
                    <span className="text-right font-medium text-gray-900">
                      {accessMode === 'unknown' ? '-' : RESOLVED_ACCESS_MODE_META[accessMode].label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">适用范围</span>
                    <span className="text-right font-medium text-gray-900">
                      {IDENTITY_SCOPE_META[normalizeIdentityScope(connector.identityScope)].label}
                    </span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-gray-500">地址</span>
                    <span className="max-w-[60%] truncate text-right font-mono text-xs text-gray-700" title={connector.baseUrl}>
                      {connector.baseUrl}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 border-t border-gray-200 pt-4">
                  <button
                    onClick={() => runHealthCheck(connector.id)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-blue-600 transition-all hover:bg-blue-50 hover:text-blue-800"
                  >
                    <i className="fas fa-heartbeat text-xs"></i>
                    健康检查
                  </button>
                  <Link
                    href={`/connectors/${connector.id}`}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-all hover:bg-gray-50 hover:text-gray-900"
                  >
                    详情
                    <i className="fas fa-arrow-right text-xs"></i>
                  </Link>
                  <button
                    onClick={() => setDeleteConfirm({ id: connector.id, name: connector.name })}
                    className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-50 hover:text-red-800"
                  >
                    <i className="fas fa-trash text-xs"></i>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {connectors.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white py-20 text-center shadow-sm">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-100">
              <i className="fas fa-plug text-3xl text-blue-600"></i>
            </div>
            <h3 className="mb-2 text-xl font-bold text-gray-900">还没有连接器</h3>
            <p className="mx-auto mb-6 max-w-md text-gray-500">先到初始化中心上传接口文档、页面流程定义，或直接提供文字操作说明，创建一个连接器。</p>
            <Link href="/bootstrap" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700">
              <i className="fas fa-cogs"></i>
              前往初始化中心
            </Link>
          </div>
        )}
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
            <div className="mb-6 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <i className="fas fa-exclamation-triangle text-xl text-red-600"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">确认删除连接器</h2>
                <p className="mt-1 text-sm text-gray-500">此操作不可撤销</p>
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-800">删除连接器 <strong>{deleteConfirm.name}</strong> 会同时删除相关流程模板、草稿和提交记录。</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="flex-1 rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.id)}
                disabled={deleting}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-3 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
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
