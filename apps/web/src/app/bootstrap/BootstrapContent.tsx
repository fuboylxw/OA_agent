'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import Link from 'next/link';
import { apiClient } from '../lib/api-client';
import {
  ACCESS_MODE_META,
  type AccessModeKey as AccessMode,
  resolveAccessModeFromAuthConfig,
} from '../lib/connector-access-mode';
import {
  IDENTITY_SCOPE_META,
  type IdentityScope,
  normalizeIdentityScope,
} from '../lib/identity-scope';

const TERMINAL_STATUSES = ['PUBLISHED', 'FAILED', 'VALIDATION_FAILED', 'PARTIALLY_PUBLISHED', 'MANUAL_REVIEW'];
type ReactivateMode = 'reuse' | 'new';
type ExecutorMode = 'local' | 'browser' | 'http' | 'stub';
type ApiDocType = 'openapi' | 'swagger' | 'custom';
type ConnectorMode = 'new' | 'existing';
type FormSetter = Dispatch<SetStateAction<BootstrapFormState>>;

type PlatformConfig = {
  entryUrl: string;
  targetSystem: string;
  jumpUrlTemplate: string;
  ticketBrokerUrl: string;
  executorMode: ExecutorMode;
};

type BootstrapFormState = {
  connectorMode: ConnectorMode;
  connectorId: string;
  name: string;
  oaUrl: string;
  identityScope: IdentityScope | '';
  accessMode: AccessMode;
  apiDocType: ApiDocType;
  apiDocContent: string;
  apiDocUrl: string;
  rpaFlowContent: string;
  platformConfig: PlatformConfig;
  authConfig: Record<string, any>;
};

type BootstrapJob = {
  id: string;
  name?: string | null;
  oaUrl?: string | null;
  identityScope?: IdentityScope | null;
  openApiUrl?: string | null;
  createdAt?: string | null;
  status: string;
  connectorId?: string | null;
  authConfig?: Record<string, any> | null;
};

type ConnectorOption = {
  id: string;
  name: string;
  baseUrl?: string | null;
  identityScope?: IdentityScope | null;
  oaType?: string | null;
};

function createEmptyFormState(): BootstrapFormState {
  return {
    connectorMode: 'new',
    connectorId: '',
    name: '',
    oaUrl: '',
    identityScope: '',
    accessMode: 'backend_api',
    apiDocType: 'openapi',
    apiDocContent: '',
    apiDocUrl: '',
    rpaFlowContent: '',
    platformConfig: {
      entryUrl: '',
      targetSystem: '',
      jumpUrlTemplate: '',
      ticketBrokerUrl: '',
      executorMode: 'browser',
    },
    authConfig: {},
  };
}

const AUTH_NOTICE = '认证信息可选。不要把用户真实密码交给模型或机器人，优先使用会话票据、外部密钥或让用户自行登录。';
const TEXT_GUIDE_FILE_ACCEPT = '.txt,.md,.markdown,.text,.log';
const DIRECT_LINK_FILE_ACCEPT = '.json,.txt,.md,.markdown,.text,.log';
const TEXT_GUIDE_TEMPLATE_DOWNLOAD_URL = '/examples/text-guide-example.txt';
const DIRECT_LINK_TEMPLATE_DOWNLOAD_URL = '/examples/direct-link-example.txt';
const TEXT_GUIDE_PLACEHOLDER = [
  '# 系统基本信息',
  '系统名称: 示例 OA',
  '系统网址: https://oa.example.com/',
  '适用对象: 教职工',
  '登录说明: 统一认证登录',
  '流程入口: 工作台 > 流程中心 > 用印申请',
  '办理完成标志: 看到 保存待发成功 就结束',
  '',
  '## 流程: 用印申请',
  '描述: 公章或合同章申请示例',
  '用户办理时需要补充的信息:',
  '- 文件类型、名称及份数 | 必填 | 说明: 填写需要用印的文件类型、名称和份数 | 示例: 劳务合同 2份',
  '- 用印类型 | 必填 | 说明: 选择本次需要办理的印章类型 | 示例: 党委公章、学校公章 | 可选值: 党委公章、学校公章、书记签名章、校长签名章 | 可多选',
  '- 用印附件 | 必填 | 说明: 上传本次用印对应的附件材料 | 示例: 用印申请材料.pdf | 上传要求: 支持上传多份，未上传视为信息缺失 | 可多选',
  '办理步骤:',
  '- 打开 OA 首页',
  '- 点击 流程中心',
  '- 点击 用印申请',
  '- 输入 文件类型、名称及份数',
  '- 勾选 用印类型',
  '- 上传 用印附件',
  '- 点击 保存待发',
  '- 看到 保存待发成功 就结束',
  '测试样例:',
  '- 文件类型、名称及份数: 劳务合同 2份',
  '- 用印类型: 党委公章、学校公章',
  '- 用印附件: 用印申请材料.pdf',
].join('\n');
const DIRECT_LINK_GUIDE_PLACEHOLDER = [
  '# 系统基本信息',
  '系统名称: 示例 OA',
  '认证入口: https://auth.example.com/',
  '系统网址: https://oa.example.com/',
  '适用对象: 教职工',
  '登录说明: 统一认证登录',
  '办理完成标志: 看到 保存待发成功 就结束',
  '',
  '## 流程: 用印申请',
  '描述: 公章或合同章申请示例',
  '流程页面: https://oa.example.com/workflow/new?templateId=seal_apply',
  '用户办理时需要补充的信息:',
  '- 文件类型、名称及份数 | 必填 | 说明: 填写需要用印的文件类型、名称和份数 | 示例: 劳务合同 2份',
  '- 用印类型 | 必填 | 说明: 选择本次需要办理的印章类型 | 示例: 党委公章、学校公章 | 可选值: 党委公章、学校公章、书记签名章、校长签名章 | 可多选',
  '- 用印附件 | 必填 | 说明: 上传本次用印对应的附件材料 | 示例: 用印申请材料.pdf | 上传要求: 支持上传多份，未上传视为信息缺失 | 可多选',
  '办理步骤:',
  '- 访问 https://auth.example.com/',
  '- 访问 https://oa.example.com/',
  '- 访问 https://oa.example.com/workflow/new?templateId=seal_apply',
  '- 输入 文件类型、名称及份数',
  '- 勾选 用印类型',
  '- 上传 用印附件',
  '- 点击 保存待发',
  '- 看到 保存待发成功 就结束',
  '测试样例:',
  '- 文件类型、名称及份数: 劳务合同 2份',
  '- 用印类型: 党委公章、学校公章',
  '- 用印附件: 用印申请材料.pdf',
].join('\n');

function normalizeAuthConfig(value: Record<string, any> | null | undefined) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key, val]) => !key.startsWith('_') && val !== ''));
}

function normalizePlatformConfig(value: Record<string, any> | null | undefined) {
  return Object.fromEntries(Object.entries(value || {}).filter(([_, val]) => val !== '' && val !== undefined && val !== null));
}

function toLegacyBootstrapMode(accessMode: AccessMode) {
  return accessMode === 'backend_api' ? 'api_only' : 'rpa_only';
}

function resolveAccessModeFromJob(job: BootstrapJob): AccessMode {
  return resolveAccessModeFromAuthConfig(job?.authConfig) || 'backend_api';
}

function getBootstrapValidationMessage(
  value: Pick<BootstrapFormState, 'connectorMode' | 'connectorId' | 'oaUrl' | 'identityScope' | 'accessMode' | 'apiDocContent' | 'apiDocUrl' | 'rpaFlowContent'>,
) {
  if (value.connectorMode === 'existing' && !value.connectorId) return '请选择要导入的连接器。';
  if (value.connectorMode === 'new' && !value.oaUrl.trim()) return '创建新连接器时必须填写系统网址。';
  if (value.connectorMode === 'new' && !value.identityScope) return '创建新连接器时必须指定适用身份范围。';

  const hasApi = Boolean(value.apiDocContent.trim());
  const hasRpa = Boolean(value.rpaFlowContent.trim());

  if (value.accessMode === 'backend_api' && !hasApi) return '接口接入必须提供接口文档。';
  if (value.accessMode === 'direct_link' && !hasRpa) return '链接直达接入必须提供页面流程 JSON 或流程化文字模板。';
  if (value.accessMode === 'text_guide' && !hasRpa) return '文字示教接入必须填写操作步骤说明。';
  return '';
}

function buildPayload(formData: BootstrapFormState) {
  const payload: Record<string, any> = {
    accessMode: formData.accessMode,
    bootstrapMode: toLegacyBootstrapMode(formData.accessMode),
  };
  if (formData.connectorMode === 'existing') {
    if (formData.connectorId) payload.connectorId = formData.connectorId;
  } else {
    if (formData.name.trim()) payload.name = formData.name.trim();
    if (formData.oaUrl.trim()) payload.oaUrl = formData.oaUrl.trim();
    if (formData.identityScope) payload.identityScope = formData.identityScope;
  }

  const authConfig = normalizeAuthConfig(formData.authConfig);
  if (Object.keys(authConfig).length > 0) payload.authConfig = authConfig;

  if (formData.accessMode === 'backend_api') {
    payload.apiDocType = formData.apiDocType;
    if (formData.apiDocContent.trim()) payload.apiDocContent = formData.apiDocContent.trim();
    return payload;
  }

  if (formData.rpaFlowContent.trim()) {
    payload.rpaFlowContent = formData.rpaFlowContent.trim();
    payload.rpaSourceType = formData.accessMode === 'text_guide' ? 'text_guide' : 'direct_link';
  }

  const platformConfig = normalizePlatformConfig(formData.platformConfig);
  if (Object.keys(platformConfig).length > 0) payload.platformConfig = platformConfig;
  return payload;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

function getStatusMeta(job: BootstrapJob) {
  const effective = ['PUBLISHED', 'PARTIALLY_PUBLISHED'].includes(job.status) && !job.connectorId ? 'CONNECTOR_DELETED' : job.status;
  const map: Record<string, { label: string; tone: string }> = {
    PUBLISHED: { label: '已发布', tone: 'bg-green-100 text-green-700' },
    PARTIALLY_PUBLISHED: { label: '部分发布', tone: 'bg-yellow-100 text-yellow-800' },
    FAILED: { label: '失败', tone: 'bg-red-100 text-red-700' },
    VALIDATION_FAILED: { label: '校验失败', tone: 'bg-red-100 text-red-700' },
    MANUAL_REVIEW: { label: '人工审核', tone: 'bg-red-100 text-red-700' },
    CONNECTOR_DELETED: { label: '连接器已删除', tone: 'bg-slate-100 text-slate-600' },
  };
  return { code: effective, ...(map[effective] || { label: effective, tone: 'bg-blue-100 text-blue-700' }) };
}

function ModeCards({ value, onChange }: { value: AccessMode; onChange: (mode: AccessMode) => void }) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">接入方式</h3>
        <p className="mt-1 text-xs text-gray-500">选最接近你手头材料的一种方式，然后按提示上传即可。</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(Object.keys(ACCESS_MODE_META) as AccessMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={`rounded-xl border p-4 text-left ${value === mode ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
          >
            <div className="text-sm font-semibold text-gray-900">{ACCESS_MODE_META[mode].label}</div>
            <p className="mt-2 text-xs leading-5 text-gray-600">{ACCESS_MODE_META[mode].description}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function BasicFields({ state, onChange }: { state: BootstrapFormState; onChange: FormSetter }) {
  return (
    <section className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 p-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">系统名称（选填）</label>
        <input disabled={state.connectorMode === 'existing'} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500" value={state.name} onChange={(e) => onChange((prev) => ({ ...prev, name: e.target.value }))} placeholder="例如：财务 OA" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">系统网址（必填）</label>
        <input disabled={state.connectorMode === 'existing'} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500" value={state.oaUrl} onChange={(e) => onChange((prev) => ({ ...prev, oaUrl: e.target.value }))} placeholder="https://oa.example.com" />
        <p className="mt-1 text-xs text-gray-500">{state.connectorMode === 'existing' ? '已有连接器的名称和地址由连接器管理维护。' : '创建新连接器时必须提供业务系统网址，后续流程会默认继承它。'}</p>
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium text-gray-700">适用身份范围（必填）</label>
        <select
          disabled={state.connectorMode === 'existing'}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
          value={state.identityScope}
          onChange={(e) => onChange((prev) => ({ ...prev, identityScope: e.target.value === '' ? '' : normalizeIdentityScope(e.target.value) }))}
        >
          <option value="">请选择适用范围</option>
          <option value="teacher">老师可用</option>
          <option value="student">学生可用</option>
          <option value="both">老师和学生都可用</option>
        </select>
        <p className="mt-1 text-xs text-gray-500">
          {state.connectorMode === 'existing'
            ? `已有连接器的适用身份范围由连接器管理维护，当前为：${IDENTITY_SCOPE_META[normalizeIdentityScope(state.identityScope)].label}。`
            : state.identityScope
              ? IDENTITY_SCOPE_META[normalizeIdentityScope(state.identityScope)].description
              : '请选择该连接器下流程面向的使用身份：老师、学生或都可。'}
        </p>
      </div>
    </section>
  );
}

function SourceSystemFields({
  connectors,
  state,
  onChange,
}: {
  connectors: ConnectorOption[];
  state: BootstrapFormState;
  onChange: FormSetter;
}) {
  const selectedConnector = connectors.find((connector) => connector.id === state.connectorId);

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">所属连接器</h3>
        <p className="mt-1 text-xs text-gray-500">初始化中心用于批量导入流程。先选择已有连接器；如果没有，就创建一个新的连接器。</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => onChange((prev) => ({ ...prev, connectorMode: 'existing' }))}
          className={`rounded-xl border p-4 text-left ${state.connectorMode === 'existing' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
        >
          <div className="text-sm font-semibold text-gray-900">导入到已有连接器</div>
          <p className="mt-1 text-xs leading-5 text-gray-600">适合同一个 OA 连接器继续批量添加新流程。</p>
        </button>
        <button
          type="button"
          onClick={() => onChange((prev) => ({
            ...prev,
            connectorMode: 'new',
            connectorId: '',
            identityScope: prev.connectorMode === 'new' ? prev.identityScope : '',
          }))}
          className={`rounded-xl border p-4 text-left ${state.connectorMode === 'new' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
        >
          <div className="text-sm font-semibold text-gray-900">创建新连接器</div>
          <p className="mt-1 text-xs leading-5 text-gray-600">适合还没有初始化过的新 OA 系统。</p>
        </button>
      </div>

      {state.connectorMode === 'existing' && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">选择连接器</label>
          <select
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={state.connectorId}
            onChange={(event) => {
              const connector = connectors.find((item) => item.id === event.target.value);
              onChange((prev) => ({
                ...prev,
                connectorId: event.target.value,
                name: connector?.name || '',
                oaUrl: connector?.baseUrl || '',
                identityScope: normalizeIdentityScope(connector?.identityScope),
              }));
            }}
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
          {selectedConnector && (
            <p className="mt-1 text-xs text-gray-500">
              将把本次批量解析出的流程发布到连接器：{selectedConnector.name}
              {selectedConnector.identityScope ? ` · ${IDENTITY_SCOPE_META[normalizeIdentityScope(selectedConnector.identityScope)].label}` : ''}
            </p>
          )}
          {connectors.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">当前还没有连接器，请选择“创建新连接器”。</p>
          )}
        </div>
      )}
    </section>
  );
}

function AuthFields({ state, onChange }: { state: BootstrapFormState; onChange: FormSetter }) {
  return (
    <section className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 p-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">用户名（可选）</label>
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.authConfig.username || ''} onChange={(e) => onChange((prev) => ({ ...prev, authConfig: { ...prev.authConfig, username: e.target.value } }))} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">密码（可选）</label>
        <input type="password" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.authConfig.password || ''} onChange={(e) => onChange((prev) => ({ ...prev, authConfig: { ...prev.authConfig, password: e.target.value } }))} />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium text-gray-700">令牌 / 密钥（可选）</label>
        <input type="password" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.authConfig.token || ''} onChange={(e) => onChange((prev) => ({ ...prev, authConfig: { ...prev.authConfig, token: e.target.value } }))} />
      </div>
      <p className="sm:col-span-2 text-xs text-amber-700">{AUTH_NOTICE}</p>
    </section>
  );
}

function PlatformFields({ state, onChange }: { state: BootstrapFormState; onChange: FormSetter }) {
  return (
    <section className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 p-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">执行方式</label>
        <select className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.executorMode} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, executorMode: e.target.value as ExecutorMode } }))}>
          <option value="browser">浏览器</option>
          <option value="local">本地</option>
          <option value="http">HTTP 接口</option>
          <option value="stub">模拟</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">入口链接（覆盖）</label>
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.entryUrl} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, entryUrl: e.target.value } }))} placeholder="https://oa.example.com/portal" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">目标系统</label>
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.targetSystem} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, targetSystem: e.target.value } }))} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">跳转链接模板</label>
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.jumpUrlTemplate} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, jumpUrlTemplate: e.target.value } }))} />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium text-gray-700">票据服务地址</label>
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.ticketBrokerUrl} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, ticketBrokerUrl: e.target.value } }))} />
      </div>
    </section>
  );
}

function AdvancedFields({
  state,
  onChange,
  showPlatformFields,
}: {
  state: BootstrapFormState;
  onChange: FormSetter;
  showPlatformFields: boolean;
}) {
  return (
    <details className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
      <summary className="cursor-pointer list-none text-sm font-semibold text-gray-900">高级设置（可选）</summary>
      <p className="mt-2 text-xs leading-5 text-gray-500">
        初始化默认不需要账号密码、入口链接覆盖、目标系统、跳转模板或票据服务地址。只有在需要代填登录、覆盖默认起点或接入票据跳转时再填写。
      </p>
      <div className="mt-4 space-y-4">
        <AuthFields state={state} onChange={onChange} />
        {showPlatformFields ? <PlatformFields state={state} onChange={onChange} /> : null}
      </div>
    </details>
  );
}

function ApiDocFields({
  uploadFileName,
  onFileUpload,
}: {
  uploadFileName: string;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">上传接口文档</h3>
          <p className="mt-1 text-xs text-gray-500">只需要上传接口文档文件即可，系统会自动读取内容。</p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">接口文档文件</div>
            <p className="mt-1 text-xs leading-5 text-gray-500">支持 .json / .yaml / .yml / .txt，上传后系统会自动填充初始化内容。</p>
          </div>
          <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-blue-400 hover:bg-blue-50">
            <input type="file" className="hidden" accept=".json,.yaml,.yml,.txt" onChange={onFileUpload} />
            {uploadFileName || '选择接口文档文件'}
          </label>
        </div>
      </div>
    </section>
  );
}

function FlowFields({
  state,
  onChange,
  uploadFileName,
  onFileUpload,
}: {
  state: BootstrapFormState;
  onChange: FormSetter;
  uploadFileName: string;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const isTextGuide = state.accessMode === 'text_guide';
  const isDirectLink = state.accessMode === 'direct_link';
  const placeholder = isTextGuide
    ? TEXT_GUIDE_PLACEHOLDER
    : (isDirectLink
      ? DIRECT_LINK_GUIDE_PLACEHOLDER
      : JSON.stringify({ flows: [{ processCode: 'expense_submit', processName: '费用报销', actions: { submit: { steps: [{ type: 'goto', value: 'https://oa.example.com/expense' }, { type: 'click', target: { kind: 'text', value: '新建申请' } }, { type: 'click', target: { kind: 'text', value: '提交' } }] } } }] }, null, 2));

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{isTextGuide ? '文字示教步骤' : '页面流程定义'}</h3>
        <p className="mt-1 text-xs text-gray-500">
          {isTextGuide
            ? '不会写流程也没关系，把平时怎么点、怎么填、最后看到什么结果，按顺序写下来就行。'
            : isDirectLink
              ? '链接直达接入支持两种材料：简易文字模板，或专家使用的页面流程 JSON。一次可以在同一份模板里写多个流程；模板里写了几个“填写/上传”项，就按几个字段解析。'
              : '填写可执行的页面流程 JSON，也可以先上传文件再继续编辑。'}
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">{isTextGuide ? '上传步骤说明' : '上传流程文件'}</div>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              {isTextGuide
                ? '支持 .txt / .md / .markdown / .text / .log。上传后会自动填入下方输入框，你还能继续改。'
                : isDirectLink
                  ? '支持 .json / .txt / .md / .markdown / .text / .log。推荐先用简易模板描述“先访问什么、再填写什么、最后点击什么”；字段后还可以补充“说明: ...”“示例: ...”；也支持直接上传 JSON。'
                  : '支持 .json / .txt，上传后会自动填入下方文本框。'}
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-blue-400 hover:bg-blue-50">
            <input
              type="file"
              className="hidden"
              accept={isTextGuide ? TEXT_GUIDE_FILE_ACCEPT : DIRECT_LINK_FILE_ACCEPT}
              onChange={onFileUpload}
            />
            {uploadFileName || (isTextGuide ? '选择步骤文件' : '选择流程文件')}
          </label>
        </div>
      </div>

      {isTextGuide && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">不会写也没关系</h4>
              <p className="mt-1 text-xs leading-5 text-gray-500">先下载模板，把你平时怎么办这件事按顺序写进去，再上传或粘贴到下面即可。看不懂“流程编码”也没关系，先按自然语言把步骤写清楚就行。</p>
            </div>
            <a
              href={TEXT_GUIDE_TEMPLATE_DOWNLOAD_URL}
              download
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              <i className="fas fa-download" />
              下载模板
            </a>
          </div>
        </div>
      )}

      {isDirectLink && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">推荐先用简易模板</h4>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                不用先写 JSON。直接按“先访问什么、再访问什么、填写什么、最后点击什么”来写即可；需要时可在字段后补充说明和示例。
                如果同一个业务系统下有多个流程，可以在同一份模板里连续写多个“流程:”分段，一次性初始化多个流程；模板里实际写了几个填写或上传项，就只解析几个字段。
              </p>
            </div>
            <a
              href={DIRECT_LINK_TEMPLATE_DOWNLOAD_URL}
              download
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              <i className="fas fa-download" />
              下载 URL 模板
            </a>
          </div>
        </div>
      )}

      <textarea
        rows={12}
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={state.rpaFlowContent}
        onChange={(e) => onChange((prev) => ({ ...prev, rpaFlowContent: e.target.value }))}
        placeholder={placeholder}
      />
      <p className="text-xs text-gray-500">
        {isTextGuide
          ? '先把步骤写出来就行，大多数情况下不用管下面的高级设置。'
          : isDirectLink
            ? '推荐优先写文字模板；字段后可补充说明和示例，帮助后续更准确理解用户输入。模板里出现几个填写或上传项，初始化时就解析几个字段。默认会使用模板里的系统网址、认证入口或步骤中的 URL 作为起点。'
            : '默认会使用 OA 地址或流程里的 URL 作为起点。需要覆盖入口或调整执行方式时，再到“高级设置”填写。'}
      </p>

      <div className="hidden grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">执行方式</label>
          <select className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.executorMode} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, executorMode: e.target.value as ExecutorMode } }))}>
            <option value="browser">浏览器</option>
            <option value="local">本地</option>
            <option value="http">HTTP 接口</option>
            <option value="stub">模拟</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">入口链接</label>
          <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.entryUrl} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, entryUrl: e.target.value } }))} placeholder="https://oa.example.com/portal" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">目标系统</label>
          <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.targetSystem} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, targetSystem: e.target.value } }))} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">跳转链接模板</label>
          <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.jumpUrlTemplate} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, jumpUrlTemplate: e.target.value } }))} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-700">票据服务地址</label>
          <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.platformConfig.ticketBrokerUrl} onChange={(e) => onChange((prev) => ({ ...prev, platformConfig: { ...prev.platformConfig, ticketBrokerUrl: e.target.value } }))} />
        </div>
      </div>
    </section>
  );
}

export default function BootstrapContent({ initialJobs }: { initialJobs: BootstrapJob[] }) {
  const [jobs, setJobs] = useState<BootstrapJob[]>(initialJobs);
  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState(createEmptyFormState());
  const [uploadFileName, setUploadFileName] = useState('');
  const [flowUploadFileName, setFlowUploadFileName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [reactivateJob, setReactivateJob] = useState<BootstrapJob | null>(null);
  const [reactivateMode, setReactivateMode] = useState<ReactivateMode>('reuse');
  const [reactivateDoc, setReactivateDoc] = useState(createEmptyFormState());
  const [reactivateFileName, setReactivateFileName] = useState('');
  const [reactivateFlowFileName, setReactivateFlowFileName] = useState('');
  const [reactivateError, setReactivateError] = useState('');
  const [reactivating, setReactivating] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<BootstrapJob | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const response = await apiClient.get('/bootstrap/jobs');
      setJobs(response.data);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  }, []);

  const loadConnectors = useCallback(async () => {
    try {
      const response = await apiClient.get('/connectors');
      setConnectors(response.data || []);
    } catch (error) {
      console.error('Failed to load connectors:', error);
      setConnectors([]);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
    void loadConnectors();
  }, [loadJobs, loadConnectors]);

  useEffect(() => {
    if (!jobs.some((job) => !TERMINAL_STATUSES.includes(job.status))) return undefined;
    const id = window.setInterval(() => { void loadJobs(); }, 5000);
    return () => window.clearInterval(id);
  }, [jobs, loadJobs]);

  const stats = useMemo(() => ({
    total: jobs.length,
    running: jobs.filter((job) => !TERMINAL_STATUSES.includes(job.status)).length,
    published: jobs.filter((job) => ['PUBLISHED', 'PARTIALLY_PUBLISHED'].includes(job.status)).length,
    failed: jobs.filter((job) => ['FAILED', 'VALIDATION_FAILED', 'MANUAL_REVIEW'].includes(job.status)).length,
  }), [jobs]);

  const createValidationMessage = getBootstrapValidationMessage(formData);
  const reactivateValidationMessage = reactivateMode === 'new' ? getBootstrapValidationMessage(reactivateDoc) : '';

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setFormData(createEmptyFormState());
    setCreateError('');
    setUploadFileName('');
    setFlowUploadFileName('');
  };

  const closeReactivateModal = () => {
    setReactivateJob(null);
    setReactivateMode('reuse');
    setReactivateDoc(createEmptyFormState());
    setReactivateFileName('');
    setReactivateFlowFileName('');
    setReactivateError('');
  };

  const handleFileUpload = (
    event: ChangeEvent<HTMLInputElement>,
    setter: FormSetter,
    field: 'apiDocContent' | 'rpaFlowContent',
    setName?: (name: string) => void,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setName?.(file.name);
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const content = String(loadEvent.target?.result || '');
      setter((prev) => (
        field === 'apiDocContent'
          ? { ...prev, apiDocContent: content }
          : { ...prev, rpaFlowContent: content }
      ));
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const createJob = async () => {
    setCreating(true);
    setCreateError('');
    try {
      await apiClient.post('/bootstrap/jobs', buildPayload(formData));
      closeCreateModal();
      await loadJobs();
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || '创建初始化任务失败';
      setCreateError(typeof message === 'string' ? message : JSON.stringify(message));
    } finally {
      setCreating(false);
    }
  };

  const openReactivateModal = (job: BootstrapJob) => {
    setReactivateJob(job);
    setReactivateMode('reuse');
    setReactivateError('');
    setReactivateFileName('');
    setReactivateFlowFileName('');
    setReactivateDoc({
      ...createEmptyFormState(),
      accessMode: resolveAccessModeFromJob(job),
      oaUrl: job.oaUrl || '',
      identityScope: normalizeIdentityScope(job.identityScope),
      platformConfig: { ...createEmptyFormState().platformConfig, ...normalizePlatformConfig(job?.authConfig?.platformConfig) },
      authConfig: {},
    });
  };

  const handleReactivate = async () => {
    if (!reactivateJob) return;
    setReactivating(true);
    setReactivateError('');
    try {
      const normalizedReactivateAuthConfig = normalizeAuthConfig(reactivateDoc.authConfig);
      const normalizedReactivatePlatformConfig = normalizePlatformConfig(reactivateDoc.platformConfig);
      const payload: Record<string, any> = reactivateMode === 'new'
        ? { mode: 'new', ...buildPayload(reactivateDoc) }
        : {
            mode: 'reuse',
            accessMode: reactivateDoc.accessMode,
            bootstrapMode: toLegacyBootstrapMode(reactivateDoc.accessMode),
            oaUrl: reactivateDoc.oaUrl || undefined,
            identityScope: reactivateDoc.identityScope,
            authConfig: Object.keys(normalizedReactivateAuthConfig).length > 0 ? normalizedReactivateAuthConfig : undefined,
            platformConfig: reactivateDoc.accessMode !== 'backend_api' && Object.keys(normalizedReactivatePlatformConfig).length > 0
              ? normalizedReactivatePlatformConfig
              : undefined,
          };
      await apiClient.post(`/bootstrap/jobs/${reactivateJob.id}/reactivate`, payload);
      closeReactivateModal();
      await loadJobs();
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || '重新激活初始化任务失败';
      setReactivateError(typeof message === 'string' ? message : JSON.stringify(message));
    } finally {
      setReactivating(false);
    }
  };

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="mb-1 text-xl font-bold text-gray-900">初始化中心</h1>
            <p className="text-sm text-gray-600">按接口文件、网页链接、文字步骤三种方式管理初始化任务。</p>
          </div>
          <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"><i className="fas fa-plus"></i>新建任务</button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {[['全部任务', stats.total], ['进行中', stats.running], ['已发布', stats.published], ['失败', stats.failed]].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-gray-500">{label}</div>
              <div className="text-xl font-bold text-gray-900">{value}</div>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full">
            <thead><tr className="border-b border-gray-200 bg-gray-50"><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">任务</th><th className="hidden px-4 py-3 text-left text-xs font-medium text-gray-500 sm:table-cell">接入方式</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">状态</th><th className="hidden px-4 py-3 text-left text-xs font-medium text-gray-500 md:table-cell">创建时间</th><th className="px-4 py-3 text-right text-xs font-medium text-gray-500">操作</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {jobs.map((job) => {
                const status = getStatusMeta(job);
                const accessMode = resolveAccessModeFromJob(job);
                const canReactivate = ['FAILED', 'VALIDATION_FAILED', 'PARTIALLY_PUBLISHED', 'MANUAL_REVIEW', 'CONNECTOR_DELETED'].includes(status.code);
                const canDelete = ['FAILED', 'VALIDATION_FAILED', 'MANUAL_REVIEW', 'CONNECTOR_DELETED'].includes(status.code)
                  || (['PUBLISHED', 'PARTIALLY_PUBLISHED'].includes(status.code) && !job.connectorId);
                return (
                  <tr key={job.id}>
                    <td className="px-4 py-3"><div className="text-sm font-medium text-gray-900">{job.name || `任务 #${job.id.substring(0, 8)}`}</div><div className="text-xs text-gray-500">{job.oaUrl || job.openApiUrl || '-'}{` · ${IDENTITY_SCOPE_META[normalizeIdentityScope(job.identityScope)].badge}`}</div></td>
                    <td className="hidden px-4 py-3 sm:table-cell"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{ACCESS_MODE_META[accessMode].badge}</span></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span></td>
                    <td className="hidden px-4 py-3 text-xs text-gray-500 md:table-cell">{formatDate(job.createdAt)}</td>
                    <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-2"><Link href={`/bootstrap/${job.id}`} className="text-xs font-medium text-blue-600 hover:text-blue-800">详情</Link>{canReactivate && <button onClick={() => openReactivateModal(job)} className="text-xs font-medium text-orange-600 hover:text-orange-800">重新激活</button>}{canDelete && <button onClick={() => setDeleteConfirm(job)} className="text-xs font-medium text-red-600 hover:text-red-800">删除</button>}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {showCreateModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-gray-200 px-8 py-5"><div><h2 className="text-xl font-bold text-gray-900">新建初始化任务</h2><p className="mt-0.5 text-sm text-gray-500">初始化中心用于批量导入流程，并在需要时创建新的连接器。</p></div><button onClick={closeCreateModal} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"><i className="fas fa-times text-gray-500"></i></button></div><div className="flex-1 space-y-6 overflow-y-auto px-8 py-6">{createError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{createError}</div>}<SourceSystemFields connectors={connectors} state={formData} onChange={setFormData} /><ModeCards value={formData.accessMode} onChange={(accessMode) => setFormData((prev) => ({ ...prev, accessMode }))} /><BasicFields state={formData} onChange={setFormData} />{formData.accessMode === 'backend_api' ? <ApiDocFields uploadFileName={uploadFileName} onFileUpload={(event) => handleFileUpload(event, setFormData, 'apiDocContent', setUploadFileName)} /> : <FlowFields state={formData} onChange={setFormData} uploadFileName={flowUploadFileName} onFileUpload={(event) => handleFileUpload(event, setFormData, 'rpaFlowContent', setFlowUploadFileName)} />}<AdvancedFields state={formData} onChange={setFormData} showPlatformFields={formData.accessMode !== 'backend_api'} /></div><div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-8 py-5"><button onClick={closeCreateModal} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">取消</button><div className="flex-1">{createValidationMessage && <p className="text-xs text-amber-700">{createValidationMessage}</p>}</div><button onClick={createJob} disabled={creating || Boolean(createValidationMessage)} title={createValidationMessage || undefined} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{creating ? '创建中...' : '创建任务'}</button></div></div></div>}

        {reactivateJob && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-gray-200 px-8 py-5"><div><h2 className="text-xl font-bold text-gray-900">重新激活初始化任务</h2><p className="mt-0.5 text-sm text-gray-500">{reactivateJob.name || `任务 #${reactivateJob.id.substring(0, 8)}`}</p></div><button onClick={closeReactivateModal} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"><i className="fas fa-times text-gray-500"></i></button></div><div className="flex-1 space-y-6 overflow-y-auto px-8 py-6">{reactivateError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{reactivateError}</div>}<div className="rounded-lg border border-blue-100 bg-blue-50/80 px-4 py-3 text-xs leading-5 text-blue-800">重新激活会重新创建该任务对应的连接器，并恢复这条初始化任务导入的流程。</div><div className="space-y-3"><label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${reactivateMode === 'reuse' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`} onClick={() => setReactivateMode('reuse')}><input type="radio" checked={reactivateMode === 'reuse'} readOnly className="mt-0.5" /><div><p className="text-sm font-medium text-gray-900">复用历史材料</p><p className="mt-0.5 text-xs text-gray-500">沿用这条初始化任务上次的材料，恢复它原先导入的流程。</p></div></label><label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${reactivateMode === 'new' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`} onClick={() => setReactivateMode('new')}><input type="radio" checked={reactivateMode === 'new'} readOnly className="mt-0.5" /><div><p className="text-sm font-medium text-gray-900">换新材料</p><p className="mt-0.5 text-xs text-gray-500">切换接入方式或重新上传新的初始化内容。</p></div></label></div><ModeCards value={reactivateDoc.accessMode} onChange={(accessMode) => setReactivateDoc((prev) => ({ ...prev, accessMode }))} /><BasicFields state={reactivateDoc} onChange={setReactivateDoc} />{reactivateMode === 'new' && (reactivateDoc.accessMode === 'backend_api' ? <ApiDocFields uploadFileName={reactivateFileName} onFileUpload={(event) => handleFileUpload(event, setReactivateDoc, 'apiDocContent', setReactivateFileName)} /> : <FlowFields state={reactivateDoc} onChange={setReactivateDoc} uploadFileName={reactivateFlowFileName} onFileUpload={(event) => handleFileUpload(event, setReactivateDoc, 'rpaFlowContent', setReactivateFlowFileName)} />)}<AdvancedFields state={reactivateDoc} onChange={setReactivateDoc} showPlatformFields={reactivateDoc.accessMode !== 'backend_api'} /></div><div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-8 py-5"><button onClick={closeReactivateModal} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">取消</button><div className="flex-1">{reactivateValidationMessage && <p className="text-xs text-amber-700">{reactivateValidationMessage}</p>}</div><button onClick={handleReactivate} disabled={reactivating || (reactivateMode === 'new' && Boolean(reactivateValidationMessage))} title={reactivateValidationMessage || undefined} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{reactivating ? '处理中...' : '重新激活'}</button></div></div></div>}

        {deleteConfirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-sm rounded-2xl bg-white shadow-xl"><div className="px-6 py-5"><h3 className="text-base font-bold text-gray-900">删除初始化任务</h3><p className="mt-2 text-sm text-gray-600">{deleteConfirm.connectorId && ['PUBLISHED', 'PARTIALLY_PUBLISHED'].includes(deleteConfirm.status) ? '要彻底删除这个系统，请先在连接器管理中删除连接器。连接器删除后，其关联流程会一并删除；然后才能回来删除这条初始化记录。' : '这会永久删除当前初始化任务及其相关产物。'}</p></div><div className="flex gap-3 border-t border-gray-200 px-6 py-4"><button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">关闭</button>{!(deleteConfirm.connectorId && ['PUBLISHED', 'PARTIALLY_PUBLISHED'].includes(deleteConfirm.status)) && <button onClick={async () => { if (!deleteConfirm) return; setDeleting(true); try { await apiClient.delete(`/bootstrap/jobs/${deleteConfirm.id}`); setDeleteConfirm(null); await loadJobs(); } catch { /* deletion failed — keep dialog open so user can retry */ } finally { setDeleting(false); } }} disabled={deleting} className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{deleting ? '删除中...' : '删除'}</button>}</div></div></div>}
      </div>
    </main>
  );
}
