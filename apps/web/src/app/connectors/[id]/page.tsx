'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import AuthGuard from '../../components/AuthGuard';
import { apiClient } from '../../lib/api-client';
import {
  RESOLVED_ACCESS_MODE_META,
  type ResolvedAccessModeKey,
  formatExecutionModes,
  resolvePublishedAccessMode,
} from '../../lib/connector-access-mode';
import { IDENTITY_SCOPE_META, normalizeIdentityScope } from '../../lib/identity-scope';

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

function renderBoolean(value: boolean | null | undefined) {
  if (value === true) return '支持';
  if (value === false) return '不支持';
  return '-';
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

function ConnectorDetail() {
  const params = useParams<{ id: string }>();
  const [connector, setConnector] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!params.id) return;
    apiClient.get(`/connectors/${params.id}`).then((res) => {
      setConnector(res.data);
    }).catch((err) => {
      setError(err.response?.status === 404 ? '连接器不存在' : '加载失败');
    }).finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"></div>
          <p className="text-sm text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  if (error || !connector) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">{error || '连接器不存在'}</p>
          <Link href="/connectors" className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-800">返回连接器列表</Link>
        </div>
      </div>
    );
  }

  const capability = connector.capability || {};
  const connectorAccessMode = resolveConnectorAccessMode(connector);

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <Link href="/connectors" className="text-sm text-blue-600 hover:text-blue-800">
              返回连接器列表
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">{connector.name}</h1>
            <p className="mt-1 text-sm text-gray-600">
              {connector.oaVendor || '未知厂商'} · {connector.oaType} · 创建于 {formatDate(connector.createdAt)}
            </p>
          </div>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
            {connector.status}
          </span>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">基础地址</div>
            <div className="mt-2 break-all text-sm text-gray-900">{connector.baseUrl}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">接入方式</div>
            <div className="mt-2 text-sm text-gray-900">
              {connectorAccessMode === 'unknown' ? '-' : RESOLVED_ACCESS_MODE_META[connectorAccessMode].label}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">适用范围</div>
            <div className="mt-2 text-sm text-gray-900">
              {IDENTITY_SCOPE_META[normalizeIdentityScope(connector.identityScope)].label}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">认证方式</div>
            <div className="mt-2 text-sm text-gray-900">{connector.authType}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">最近健康检查</div>
            <div className="mt-2 text-sm text-gray-900">{formatDate(connector.lastHealthCheck)}</div>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">基础信息</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm text-gray-500">连接器 ID</div>
              <div className="mt-1 break-all font-mono text-sm text-gray-900">{connector.id}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">租户 ID</div>
              <div className="mt-1 break-all font-mono text-sm text-gray-900">{connector.tenantId}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">业务系统版本</div>
              <div className="mt-1 text-sm text-gray-900">{connector.oaVersion || '-'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">认证 / 检测入口</div>
              <div className="mt-1 break-all text-sm text-gray-900">{connector.healthCheckUrl || '-'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">OCL 等级</div>
              <div className="mt-1 text-sm text-gray-900">{connector.oclLevel}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">FAL 等级</div>
              <div className="mt-1 text-sm text-gray-900">{connector.falLevel || '-'}</div>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">能力矩阵</h2>
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-4">自动发现: {renderBoolean(capability.supportsDiscovery)}</div>
            <div className="rounded-lg bg-gray-50 p-4">Schema 同步: {renderBoolean(capability.supportsSchemaSync)}</div>
            <div className="rounded-lg bg-gray-50 p-4">字典同步: {renderBoolean(capability.supportsReferenceSync)}</div>
            <div className="rounded-lg bg-gray-50 p-4">状态拉取: {renderBoolean(capability.supportsStatusPull)}</div>
            <div className="rounded-lg bg-gray-50 p-4">Webhook: {renderBoolean(capability.supportsWebhook)}</div>
            <div className="rounded-lg bg-gray-50 p-4">幂等: {renderBoolean(capability.supportsIdempotency)}</div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">已发布流程</h2>
          {connector.processTemplates?.length ? (
            <div className="space-y-4">
              {connector.processTemplates.map((template: any) => {
                const uiHints = (template.uiHints as Record<string, any> | null) || null;
                const accessMode = resolvePublishedAccessMode({
                  uiHints,
                  authConfig: connector.authConfig,
                });
                const hasPageFlowDefinition = Boolean(uiHints?.rpaDefinition);
                return (
                  <div key={template.id} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-medium text-gray-900">{template.processName}</div>
                        <div className="mt-1 text-sm text-gray-500">
                          {template.processCode} · {template.processCategory || '未分类'}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">v{template.version}</div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">FAL</div>
                        <div className="mt-1 text-gray-900">{template.falLevel || '-'}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">接入方式</div>
                        <div className="mt-1 text-gray-900">
                          {accessMode === 'unknown' ? '-' : RESOLVED_ACCESS_MODE_META[accessMode].label}
                        </div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">执行模式</div>
                        <div className="mt-1 text-gray-900">{formatExecutionModes(uiHints)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">页面流程定义</div>
                        <div className="mt-1 text-gray-900">{hasPageFlowDefinition ? '已配置' : '未配置'}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-500">暂无已发布流程</div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ConnectorDetailPage() {
  return (
    <AuthGuard allowedRoles={['admin']}>
      <ConnectorDetail />
    </AuthGuard>
  );
}
