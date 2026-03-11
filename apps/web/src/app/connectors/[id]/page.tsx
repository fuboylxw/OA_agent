import { getApiUrl, getServerAuth } from '../../lib/auth';
import { notFound, redirect } from 'next/navigation';

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

function renderBoolean(value: boolean | null | undefined) {
  if (value === true) return '支持';
  if (value === false) return '不支持';
  return '-';
}

export default async function ConnectorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { userId, roles } = await getServerAuth();
  if (!userId) redirect('/login');
  if (!roles.includes('admin') && !roles.includes('flow_manager')) redirect('/');

  const API_URL = getApiUrl();
  const response = await fetch(`${API_URL}/api/v1/connectors/${params.id}`, {
    cache: 'no-store',
  });

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error(`Failed to load connector: ${response.status}`);
  }

  const connector = await response.json();
  const capability = connector.capability || {};

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <a href="/connectors" className="text-sm text-blue-600 hover:text-blue-800">
              返回连接器列表
            </a>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">{connector.name}</h1>
            <p className="mt-1 text-sm text-gray-600">
              {connector.oaVendor || '未知厂商'} · {connector.oaType} · 创建于 {formatDate(connector.createdAt)}
            </p>
          </div>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700">
            {connector.status}
          </span>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="text-sm text-gray-500">基础地址</div>
            <div className="mt-2 break-all text-sm text-gray-900">{connector.baseUrl}</div>
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
              <div className="text-sm text-gray-500">OA 版本</div>
              <div className="mt-1 text-sm text-gray-900">{connector.oaVersion || '-'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">健康检查地址</div>
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
            <div className="rounded-lg bg-gray-50 p-4">自动发现：{renderBoolean(capability.supportsDiscovery)}</div>
            <div className="rounded-lg bg-gray-50 p-4">Schema 同步：{renderBoolean(capability.supportsSchemaSync)}</div>
            <div className="rounded-lg bg-gray-50 p-4">字典同步：{renderBoolean(capability.supportsReferenceSync)}</div>
            <div className="rounded-lg bg-gray-50 p-4">状态拉取：{renderBoolean(capability.supportsStatusPull)}</div>
            <div className="rounded-lg bg-gray-50 p-4">Webhook：{renderBoolean(capability.supportsWebhook)}</div>
            <div className="rounded-lg bg-gray-50 p-4">幂等：{renderBoolean(capability.supportsIdempotency)}</div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">已发布流程</h2>
          {connector.processTemplates?.length ? (
            <div className="space-y-3">
              {connector.processTemplates.map((template: any) => (
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
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">暂无已发布流程</div>
          )}
        </div>
      </div>
    </main>
  );
}
