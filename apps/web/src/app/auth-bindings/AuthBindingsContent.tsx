'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '../lib/api-client';
import { getClientUserInfo } from '../lib/client-auth';

interface ConnectorSummary {
  id: string;
  name: string;
  oaType?: string;
  oaVendor?: string | null;
  authType?: string;
  status?: string;
  baseUrl?: string;
}

interface AuthSessionAssetSummary {
  id: string;
  assetType: string;
  status: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  lastValidatedAt?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

interface AuthBindingSummary {
  id: string;
  tenantId: string;
  connectorId: string;
  userId?: string | null;
  bindingName?: string | null;
  ownerType: 'user' | 'service';
  authType: string;
  authMode: string;
  status: string;
  isDefault: boolean;
  lastBoundAt?: string | null;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
  sessionAssets: AuthSessionAssetSummary[];
}

type CreateBindingForm = {
  connectorId: string;
  bindingName: string;
  ownerType: 'user' | 'service';
  authType: 'oauth2' | 'basic' | 'apikey' | 'cookie';
  authMode: 'password_bootstrap' | 'api_token' | 'cookie_session' | 'browser_session' | 'ticket_broker';
  isDefault: boolean;
};

type AssetForm = {
  assetType: 'auth_payload' | 'api_token' | 'cookie_session' | 'browser_session' | 'jump_ticket';
  status: 'active' | 'stale' | 'expired' | 'revoked';
  issuedAt: string;
  expiresAt: string;
  username: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  token: string;
  cookie: string;
  browserStorageState: string;
  jumpUrl: string;
  platformConfigJson: string;
  advancedJson: string;
  metadataNote: string;
};

const DEFAULT_CREATE_FORM: CreateBindingForm = {
  connectorId: '',
  bindingName: '',
  ownerType: 'user',
  authType: 'oauth2',
  authMode: 'api_token',
  isDefault: true,
};

const DEFAULT_ASSET_FORM: AssetForm = {
  assetType: 'api_token',
  status: 'active',
  issuedAt: '',
  expiresAt: '',
  username: '',
  password: '',
  accessToken: '',
  refreshToken: '',
  token: '',
  cookie: '',
  browserStorageState: '',
  jumpUrl: '',
  platformConfigJson: '',
  advancedJson: '',
  metadataNote: '',
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIsoString(value: string) {
  if (!value.trim()) return undefined;
  return new Date(value).toISOString();
}

function authModeToAssetType(
  authMode: CreateBindingForm['authMode'] | AuthBindingSummary['authMode'],
): AssetForm['assetType'] {
  switch (authMode) {
    case 'password_bootstrap':
      return 'auth_payload';
    case 'cookie_session':
      return 'cookie_session';
    case 'browser_session':
      return 'browser_session';
    case 'ticket_broker':
      return 'jump_ticket';
    case 'api_token':
    default:
      return 'api_token';
  }
}

function formatOwnerType(value: string) {
  return value === 'service' ? '服务绑定' : '个人绑定';
}

function formatAuthMode(value: string) {
  switch (value) {
    case 'password_bootstrap':
      return '账号密码';
    case 'api_token':
      return 'API Token';
    case 'cookie_session':
      return 'Cookie 会话';
    case 'browser_session':
      return '浏览器会话';
    case 'ticket_broker':
      return '跳转票据';
    default:
      return value;
  }
}

function formatAssetType(value: string) {
  switch (value) {
    case 'auth_payload':
      return '认证载荷';
    case 'api_token':
      return 'API Token';
    case 'cookie_session':
      return 'Cookie';
    case 'browser_session':
      return '浏览器会话';
    case 'jump_ticket':
      return '跳转票据';
    default:
      return value;
  }
}

function formatAuthType(value: string) {
  switch (value) {
    case 'oauth2':
      return 'OAuth2';
    case 'basic':
      return 'Basic';
    case 'apikey':
      return 'API Key';
    case 'cookie':
      return 'Cookie';
    default:
      return value;
  }
}

function parseJsonObject(text: string, fieldLabel: string) {
  if (!text.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${fieldLabel} 需要是 JSON 对象`);
    }
    return parsed as Record<string, any>;
  } catch (error: any) {
    throw new Error(error?.message || `${fieldLabel} 不是合法 JSON`);
  }
}

function parseJsonValue(text: string, fieldLabel: string) {
  if (!text.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error: any) {
    throw new Error(error?.message || `${fieldLabel} 不是合法 JSON`);
  }
}

function mergeRecord(left: Record<string, any>, right?: Record<string, any>) {
  if (!right) {
    return left;
  }

  const merged = {
    ...left,
    ...right,
  };

  if (
    left.platformConfig
    && right.platformConfig
    && typeof left.platformConfig === 'object'
    && typeof right.platformConfig === 'object'
    && !Array.isArray(left.platformConfig)
    && !Array.isArray(right.platformConfig)
  ) {
    merged.platformConfig = {
      ...left.platformConfig,
      ...right.platformConfig,
    };
  }

  return merged;
}

function buildAssetPayload(form: AssetForm) {
  const advanced = parseJsonValue(form.advancedJson, '高级 JSON');
  const platformConfig = parseJsonObject(form.platformConfigJson, 'platformConfig JSON');

  switch (form.assetType) {
    case 'auth_payload': {
      const payload: Record<string, any> = {};
      if (form.username.trim()) payload.username = form.username.trim();
      if (form.password.trim()) payload.password = form.password;
      if (form.accessToken.trim()) payload.accessToken = form.accessToken.trim();
      if (form.token.trim()) payload.token = form.token.trim();
      if (form.refreshToken.trim()) payload.refreshToken = form.refreshToken.trim();
      if (platformConfig) payload.platformConfig = platformConfig;

      const merged = mergeRecord(
        payload,
        advanced && typeof advanced === 'object' && !Array.isArray(advanced)
          ? advanced as Record<string, any>
          : undefined,
      );
      if (Object.keys(merged).length === 0) {
        throw new Error('请至少填写一个认证字段，或提供高级 JSON');
      }
      return merged;
    }
    case 'api_token': {
      if (advanced !== undefined) {
        return advanced;
      }
      const accessToken = form.accessToken.trim() || form.token.trim();
      if (!accessToken) {
        throw new Error('请填写 Token，或提供高级 JSON');
      }
      if (form.refreshToken.trim()) {
        return {
          accessToken,
          refreshToken: form.refreshToken.trim(),
        };
      }
      return accessToken;
    }
    case 'cookie_session': {
      if (advanced !== undefined) {
        return advanced;
      }
      if (!form.cookie.trim()) {
        throw new Error('请填写 Cookie 串，或提供高级 JSON');
      }
      return form.cookie.trim();
    }
    case 'browser_session': {
      if (advanced !== undefined) {
        return advanced;
      }
      if (!form.browserStorageState.trim()) {
        throw new Error('请填写 storageState JSON，或提供高级 JSON');
      }
      const parsed = parseJsonValue(form.browserStorageState, 'storageState JSON');
      return {
        storageState: parsed,
      };
    }
    case 'jump_ticket': {
      if (advanced !== undefined) {
        return advanced;
      }
      if (!form.jumpUrl.trim()) {
        throw new Error('请填写 jumpUrl，或提供高级 JSON');
      }
      return form.jumpUrl.trim();
    }
    default:
      throw new Error('不支持的资产类型');
  }
}

function buildAssetExample(assetType: AssetForm['assetType']) {
  switch (assetType) {
    case 'auth_payload':
      return `账号密码快捷录入：
username = alice
password = ********

高级 JSON 示例：
{
  "username": "alice",
  "password": "********",
  "platformConfig": {
    "ticketHeaderValue": "ticket-123"
  }
}`;
    case 'cookie_session':
      return `JSESSIONID=abc123; Path=/; HttpOnly`;
    case 'browser_session':
      return `{
  "cookies": [
    {
      "name": "sid",
      "value": "abc123",
      "domain": "oa.example.com",
      "path": "/"
    }
  ],
  "origins": []
}`;
    case 'jump_ticket':
      return `https://oa.example.com/portal?ticket=abc123`;
    case 'api_token':
    default:
      return `快捷录入：
accessToken = eyJhbGciOi...

高级 JSON 示例：
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "refresh-token"
}`;
  }
}

export default function AuthBindingsContent() {
  const searchParams = useSearchParams();
  const connectorIdFromQuery = searchParams.get('connectorId') || '';
  const currentUser = getClientUserInfo();

  const [roles, setRoles] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [bindings, setBindings] = useState<AuthBindingSummary[]>([]);
  const [selectedBindingId, setSelectedBindingId] = useState('');
  const [selectedConnectorId, setSelectedConnectorId] = useState(connectorIdFromQuery);
  const [includeAllUsers, setIncludeAllUsers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingBinding, setSavingBinding] = useState(false);
  const [savingAsset, setSavingAsset] = useState(false);
  const [markingDefaultId, setMarkingDefaultId] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [createForm, setCreateForm] = useState<CreateBindingForm>({
    ...DEFAULT_CREATE_FORM,
    connectorId: connectorIdFromQuery,
  });
  const [assetForm, setAssetForm] = useState<AssetForm>({
    ...DEFAULT_ASSET_FORM,
    assetType: authModeToAssetType(DEFAULT_CREATE_FORM.authMode),
  });

  useEffect(() => {
    try {
      setRoles(JSON.parse(localStorage.getItem('roles') || '[]'));
    } catch {
      setRoles([]);
    }
  }, []);

  const isPrivileged = useMemo(
    () => roles.includes('admin') || roles.includes('flow_manager'),
    [roles],
  );

  const connectorMap = useMemo(
    () => new Map(connectors.map((connector) => [connector.id, connector])),
    [connectors],
  );

  const selectedBinding = useMemo(
    () => bindings.find((binding) => binding.id === selectedBindingId) || null,
    [bindings, selectedBindingId],
  );

  const activeConnector = selectedConnectorId
    ? connectorMap.get(selectedConnectorId) || null
    : null;

  const visibleBindings = useMemo(() => {
    if (!selectedConnectorId) {
      return bindings;
    }
    return bindings.filter((binding) => binding.connectorId === selectedConnectorId);
  }, [bindings, selectedConnectorId]);

  useEffect(() => {
    const nextAssetType = authModeToAssetType(selectedBinding?.authMode || createForm.authMode);
    setAssetForm((prev) => ({
      ...prev,
      assetType: nextAssetType,
      issuedAt: prev.issuedAt || toDateTimeLocal(new Date().toISOString()),
    }));
  }, [createForm.authMode, selectedBinding?.authMode]);

  useEffect(() => {
    void loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCreateForm((prev) => ({
      ...prev,
      connectorId: selectedConnectorId || prev.connectorId,
    }));
    void loadBindings(selectedConnectorId, includeAllUsers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnectorId, includeAllUsers]);

  async function loadInitialData() {
    setLoading(true);
    setError('');
    try {
      const [connectorRes, bindingRes] = await Promise.all([
        apiClient.get('/connectors'),
        apiClient.get('/auth-bindings', {
          params: {
            connectorId: connectorIdFromQuery || undefined,
            includeAllUsers: isPrivileged ? 'true' : undefined,
          },
        }),
      ]);
      const nextConnectors = Array.isArray(connectorRes.data) ? connectorRes.data : [];
      const nextBindings = Array.isArray(bindingRes.data) ? bindingRes.data : [];
      setConnectors(nextConnectors);
      setBindings(nextBindings);

      const nextConnectorId = connectorIdFromQuery
        || nextBindings[0]?.connectorId
        || nextConnectors[0]?.id
        || '';
      setSelectedConnectorId(nextConnectorId);
      setCreateForm((prev) => ({
        ...prev,
        connectorId: prev.connectorId || nextConnectorId,
      }));

      const preferredBinding = nextBindings.find((binding: AuthBindingSummary) => binding.isDefault) || nextBindings[0];
      setSelectedBindingId(preferredBinding?.id || '');
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || '加载认证绑定失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadBindings(connectorId?: string, includeAll?: boolean) {
    try {
      const response = await apiClient.get('/auth-bindings', {
        params: {
          connectorId: connectorId || undefined,
          includeAllUsers: includeAll && isPrivileged ? 'true' : undefined,
        },
      });
      const nextBindings = Array.isArray(response.data) ? response.data : [];
      setBindings(nextBindings);

      if (!nextBindings.some((binding: AuthBindingSummary) => binding.id === selectedBindingId)) {
        const preferredBinding = nextBindings.find((binding: AuthBindingSummary) => binding.isDefault) || nextBindings[0];
        setSelectedBindingId(preferredBinding?.id || '');
      }
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || '刷新认证绑定失败');
    }
  }

  async function handleCreateBinding() {
    if (!createForm.connectorId) {
      setError('请先选择连接器');
      return;
    }

    setSavingBinding(true);
    setError('');
    setSuccessMessage('');
    try {
      const response = await apiClient.post('/auth-bindings', {
        connectorId: createForm.connectorId,
        bindingName: createForm.bindingName.trim() || undefined,
        ownerType: createForm.ownerType,
        authType: createForm.authType,
        authMode: createForm.authMode,
        isDefault: createForm.isDefault,
      });

      const created = response.data as AuthBindingSummary;
      await loadBindings(selectedConnectorId || createForm.connectorId, includeAllUsers);
      setSelectedBindingId(created.id);
      setSuccessMessage('认证绑定已创建。后续执行会优先使用默认绑定。');
      setAssetForm((prev) => ({
        ...DEFAULT_ASSET_FORM,
        assetType: authModeToAssetType(created.authMode),
        issuedAt: prev.issuedAt || toDateTimeLocal(new Date().toISOString()),
      }));
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || '创建认证绑定失败');
    } finally {
      setSavingBinding(false);
    }
  }

  async function handleMarkDefault(bindingId: string) {
    setMarkingDefaultId(bindingId);
    setError('');
    setSuccessMessage('');
    try {
      await apiClient.post(`/auth-bindings/${bindingId}/default`);
      await loadBindings(selectedConnectorId, includeAllUsers);
      setSelectedBindingId(bindingId);
      setSuccessMessage('默认认证绑定已更新。新的提交会自动使用它。');
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || '设置默认绑定失败');
    } finally {
      setMarkingDefaultId('');
    }
  }

  async function handleSaveAsset() {
    if (!selectedBinding) {
      setError('请先选择一个认证绑定');
      return;
    }

    setSavingAsset(true);
    setError('');
    setSuccessMessage('');
    try {
      const payload = buildAssetPayload(assetForm);
      await apiClient.post(`/auth-bindings/${selectedBinding.id}/assets`, {
        assetType: assetForm.assetType,
        status: assetForm.status,
        payload,
        issuedAt: toIsoString(assetForm.issuedAt),
        expiresAt: toIsoString(assetForm.expiresAt),
        metadata: assetForm.metadataNote.trim()
          ? { note: assetForm.metadataNote.trim() }
          : undefined,
      });
      await loadBindings(selectedConnectorId, includeAllUsers);
      setSuccessMessage('敏感认证资产已加密保存。后续执行会从服务端安全解析。');
    } catch (requestError: any) {
      setError(requestError.response?.data?.message || requestError.message || '保存认证资产失败');
    } finally {
      setSavingAsset(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"></div>
          <p className="text-sm text-gray-500">加载认证绑定中...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">认证绑定</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
              初始化负责注册流程，认证绑定负责保存 OA 登录态。账号密码、Cookie、Token 和浏览器会话都只加密存到服务端，
              不进入大模型。默认绑定会在 API、URL、Vision 三条执行路径中自动生效。
            </p>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <div className="font-medium">当前用户</div>
            <div className="mt-1 font-mono text-xs">
              tenant={currentUser.tenantId || '-'} / user={currentUser.userId || '-'}
            </div>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {successMessage ? (
          <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {successMessage}
          </div>
        ) : null}

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">连接器</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{connectors.length}</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">当前筛选绑定</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{visibleBindings.length}</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">默认绑定</div>
            <div className="mt-2 text-3xl font-bold text-blue-700">
              {visibleBindings.filter((binding) => binding.isDefault).length}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-gray-500">活跃资产</div>
            <div className="mt-2 text-3xl font-bold text-green-700">
              {visibleBindings.reduce((count, binding) => count + binding.sessionAssets.filter((asset) => asset.status === 'active').length, 0)}
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">新建认证绑定</h2>
              <p className="mt-1 text-sm text-gray-500">
                这里只登记认证方式和作用域，敏感值在右侧“认证资产录入”里单独保存。
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">连接器</span>
                <select
                  value={createForm.connectorId}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCreateForm((prev) => ({ ...prev, connectorId: value }));
                    setSelectedConnectorId(value);
                  }}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">请选择连接器</option>
                  {connectors.map((connector) => (
                    <option key={connector.id} value={connector.id}>
                      {connector.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">绑定名称</span>
                <input
                  value={createForm.bindingName}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, bindingName: event.target.value }))}
                  placeholder="例如：张三 OA 登录"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">认证类型</span>
                <select
                  value={createForm.authType}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, authType: event.target.value as CreateBindingForm['authType'] }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="oauth2">OAuth2</option>
                  <option value="basic">Basic</option>
                  <option value="apikey">API Key</option>
                  <option value="cookie">Cookie</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">认证模式</span>
                <select
                  value={createForm.authMode}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, authMode: event.target.value as CreateBindingForm['authMode'] }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="api_token">API Token</option>
                  <option value="password_bootstrap">账号密码</option>
                  <option value="cookie_session">Cookie 会话</option>
                  <option value="browser_session">浏览器会话</option>
                  <option value="ticket_broker">跳转票据</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">作用域</span>
                <select
                  value={createForm.ownerType}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, ownerType: event.target.value as CreateBindingForm['ownerType'] }))}
                  disabled={!isPrivileged}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
                >
                  <option value="user">个人绑定</option>
                  {isPrivileged ? <option value="service">服务绑定</option> : null}
                </select>
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={createForm.isDefault}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">创建后设为默认绑定</span>
              </label>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={() => void handleCreateBinding()}
                disabled={savingBinding}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {savingBinding ? '创建中...' : '创建绑定'}
              </button>
              <span className="text-xs text-gray-500">
                如果没有显式选择 `authBindingId`，系统会自动使用默认绑定。
              </span>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">筛选与说明</h2>
              <Link
                href={activeConnector ? `/connectors/${activeConnector.id}` : '/connectors'}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                查看连接器
              </Link>
            </div>

            <label className="mb-4 block">
              <span className="mb-2 block text-sm font-medium text-gray-700">按连接器筛选</span>
              <select
                value={selectedConnectorId}
                onChange={(event) => setSelectedConnectorId(event.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="">全部连接器</option>
                {connectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.name}
                  </option>
                ))}
              </select>
            </label>

            {isPrivileged ? (
              <label className="mb-4 flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={includeAllUsers}
                  onChange={(event) => setIncludeAllUsers(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">显示当前租户全部用户绑定</span>
              </label>
            ) : null}

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              解析顺序：个人默认绑定 -> 最近个人绑定 -> 服务绑定。
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">已创建绑定</h2>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                {visibleBindings.length} 个
              </span>
            </div>

            <div className="space-y-4">
              {visibleBindings.map((binding) => {
                const connector = connectorMap.get(binding.connectorId);
                const isSelected = binding.id === selectedBindingId;
                return (
                  <div
                    key={binding.id}
                    className={`rounded-2xl border p-4 ${
                      isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => setSelectedBindingId(binding.id)}
                            className="text-left text-base font-semibold text-gray-900"
                          >
                            {binding.bindingName || `${connector?.name || '连接器'} ${formatAuthMode(binding.authMode)}`}
                          </button>
                          {binding.isDefault ? (
                            <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-medium text-white">
                              默认
                            </span>
                          ) : null}
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                            {formatOwnerType(binding.ownerType)}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                          <div className="rounded-xl bg-gray-50 p-3">
                            <div className="text-xs text-gray-500">连接器</div>
                            <div className="mt-1 font-medium text-gray-900">{connector?.name || binding.connectorId}</div>
                          </div>
                          <div className="rounded-xl bg-gray-50 p-3">
                            <div className="text-xs text-gray-500">认证类型</div>
                            <div className="mt-1 font-medium text-gray-900">{formatAuthType(binding.authType)}</div>
                          </div>
                          <div className="rounded-xl bg-gray-50 p-3">
                            <div className="text-xs text-gray-500">最近绑定</div>
                            <div className="mt-1 font-medium text-gray-900">{formatDate(binding.lastBoundAt)}</div>
                          </div>
                          <div className="rounded-xl bg-gray-50 p-3">
                            <div className="text-xs text-gray-500">最近使用</div>
                            <div className="mt-1 font-medium text-gray-900">{formatDate(binding.lastUsedAt)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setSelectedBindingId(binding.id)}
                          className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          {isSelected ? '当前已选中' : '选中管理'}
                        </button>
                        {!binding.isDefault ? (
                          <button
                            onClick={() => void handleMarkDefault(binding.id)}
                            disabled={markingDefaultId === binding.id}
                            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                          >
                            {markingDefaultId === binding.id ? '设置中...' : '设为默认'}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {binding.sessionAssets.length > 0 ? (
                      <div className="mt-4 border-t border-gray-200 pt-4">
                        <div className="space-y-2">
                          {binding.sessionAssets.map((asset) => (
                            <div key={asset.id} className="flex flex-col gap-1 rounded-xl bg-gray-50 px-3 py-3 text-sm lg:flex-row lg:items-center lg:justify-between">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700">
                                  {formatAssetType(asset.assetType)}
                                </span>
                                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${asset.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                                  {asset.status}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500">
                                签发：{formatDate(asset.issuedAt)} / 失效：{formatDate(asset.expiresAt)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {visibleBindings.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
                  <div className="text-base font-medium text-gray-700">当前没有认证绑定</div>
                  <p className="mt-2 text-sm text-gray-500">
                    先在上方创建绑定，再录入 Token、Cookie 或浏览器会话。
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-gray-900">认证资产录入</h2>
              <p className="mt-1 text-sm text-gray-500">
                保存后服务端只存密文，前端不会回显敏感明文。
              </p>
            </div>

            {!selectedBinding ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center text-sm text-gray-500">
                先从左侧选中一个绑定。
              </div>
            ) : (
              <>
                <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-900">
                  <div className="font-medium">{selectedBinding.bindingName || selectedBinding.id}</div>
                  <div className="mt-1">
                    {formatOwnerType(selectedBinding.ownerType)} / {formatAuthType(selectedBinding.authType)} / {formatAuthMode(selectedBinding.authMode)}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">资产类型</span>
                    <select
                      value={assetForm.assetType}
                      onChange={(event) => setAssetForm((prev) => ({ ...prev, assetType: event.target.value as AssetForm['assetType'] }))}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="auth_payload">认证载荷</option>
                      <option value="api_token">API Token</option>
                      <option value="cookie_session">Cookie 会话</option>
                      <option value="browser_session">浏览器会话</option>
                      <option value="jump_ticket">跳转票据</option>
                    </select>
                  </label>

                  {assetForm.assetType === 'auth_payload' ? (
                    <>
                      <input
                        value={assetForm.username}
                        onChange={(event) => setAssetForm((prev) => ({ ...prev, username: event.target.value }))}
                        placeholder="用户名，例如 alice"
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <input
                        type="password"
                        value={assetForm.password}
                        onChange={(event) => setAssetForm((prev) => ({ ...prev, password: event.target.value }))}
                        placeholder="密码"
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </>
                  ) : null}

                  {assetForm.assetType === 'api_token' ? (
                    <textarea
                      rows={4}
                      value={assetForm.accessToken}
                      onChange={(event) => setAssetForm((prev) => ({ ...prev, accessToken: event.target.value }))}
                      placeholder="粘贴 access token"
                      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  ) : null}

                  {assetForm.assetType === 'cookie_session' ? (
                    <textarea
                      rows={5}
                      value={assetForm.cookie}
                      onChange={(event) => setAssetForm((prev) => ({ ...prev, cookie: event.target.value }))}
                      placeholder="JSESSIONID=abc123; Path=/; HttpOnly"
                      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  ) : null}

                  {assetForm.assetType === 'browser_session' ? (
                    <textarea
                      rows={8}
                      value={assetForm.browserStorageState}
                      onChange={(event) => setAssetForm((prev) => ({ ...prev, browserStorageState: event.target.value }))}
                      placeholder={'{\n  "cookies": [],\n  "origins": []\n}'}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  ) : null}

                  {assetForm.assetType === 'jump_ticket' ? (
                    <input
                      value={assetForm.jumpUrl}
                      onChange={(event) => setAssetForm((prev) => ({ ...prev, jumpUrl: event.target.value }))}
                      placeholder="https://oa.example.com/portal?ticket=abc123"
                      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  ) : null}

                  <textarea
                    rows={6}
                    value={assetForm.advancedJson}
                    onChange={(event) => setAssetForm((prev) => ({ ...prev, advancedJson: event.target.value }))}
                    placeholder={'可选：高级 JSON 自定义 payload，例如：\n{\n  "accessToken": "xxx",\n  "platformConfig": {\n    "serviceToken": "yyy"\n  }\n}'}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <input
                      type="datetime-local"
                      value={assetForm.issuedAt}
                      onChange={(event) => setAssetForm((prev) => ({ ...prev, issuedAt: event.target.value }))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <input
                      type="datetime-local"
                      value={assetForm.expiresAt}
                      onChange={(event) => setAssetForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  <input
                    value={assetForm.metadataNote}
                    onChange={(event) => setAssetForm((prev) => ({ ...prev, metadataNote: event.target.value }))}
                    placeholder="备注，例如：2026-03-30 手工登录获取"
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                  <div className="mb-2 text-sm font-medium text-gray-800">常见格式示例</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-gray-700">
                    {buildAssetExample(assetForm.assetType)}
                  </pre>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => void handleSaveAsset()}
                    disabled={savingAsset}
                    className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                  >
                    {savingAsset ? '保存中...' : '保存加密资产'}
                  </button>
                  <span className="text-xs text-gray-500">
                    若要切换执行账号，请把目标绑定设为默认。
                  </span>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
