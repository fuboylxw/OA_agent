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

const TERMINAL_STATUSES = ['PUBLISHED', 'FAILED', 'VALIDATION_FAILED', 'PARTIALLY_PUBLISHED', 'MANUAL_REVIEW'];

const ACCESS_MODE_META = {
  backend_api: {
    label: '接口接入',
    description: '有接口或接口文档时使用。',
    badge: '接口接入',
  },
  direct_link: {
    label: '链接直达接入',
    description: '有入口链接或跳转链接，直接上传页面流程 JSON。',
    badge: '链接直达接入',
  },
  text_guide: {
    label: '文字示教接入',
    description: '只描述点击和输入步骤，系统自动生成流程。',
    badge: '文字示教接入',
  },
} as const;

type AccessMode = keyof typeof ACCESS_MODE_META;
type ReactivateMode = 'reuse' | 'new';
type DocInputTab = 'upload' | 'link' | 'paste';
type ExecutorMode = 'local' | 'browser' | 'http' | 'stub';
type ApiDocType = 'openapi' | 'swagger' | 'custom';
type FormSetter = Dispatch<SetStateAction<BootstrapFormState>>;

type PlatformConfig = {
  entryUrl: string;
  targetSystem: string;
  jumpUrlTemplate: string;
  ticketBrokerUrl: string;
  executorMode: ExecutorMode;
};

type BootstrapFormState = {
  name: string;
  oaUrl: string;
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
  openApiUrl?: string | null;
  createdAt?: string | null;
  status: string;
  connectorId?: string | null;
  authConfig?: Record<string, any> | null;
};

function createEmptyFormState(): BootstrapFormState {
  return {
    name: '',
    oaUrl: '',
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
const DIRECT_LINK_FILE_ACCEPT = '.json,.txt';
const TEXT_GUIDE_TEMPLATE_DOWNLOAD_URL = '/examples/text-guide-example.txt';
const TEXT_GUIDE_EXAMPLES = [
  {
    title: '推荐格式',
    description: '一行一步，字段和值尽量写完整，最适合稳定解析。',
    content: [
      '输入 用户名 为 alice',
      '输入 密码 为 alice123',
      '点击 登录工作台',
      '点击 申请中心',
      '选择 请假类型 为 年假',
      '输入 开始日期 为 2026-04-01',
      '输入 结束日期 为 2026-04-02',
      '输入 原因 为 家中有事',
      '点击 提交',
      '看到 已提交 就结束',
    ].join('\n'),
  },
  {
    title: '编号 / Markdown 格式',
    description: '支持编号、短横线、Markdown 列表，系统会忽略这些列表前缀。',
    content: [
      '1. 打开 https://oa.example.com',
      '2. 点击 新建申请',
      '3. 选择 请假类型 为 事假',
      '4. 输入 请假原因: 家中有事',
      '5. 上传 附件',
      '6. 等待 2 秒',
      '7. 点击 提交',
      '8. 看到 提交成功 就结束',
    ].join('\n'),
  },
  {
    title: '多流程模板',
    description: '一个 OA 有多个办事流程时，用“流程:”分段；全局和共享步骤只写一次。',
    content: [
      '# 全局',
      '入口链接: https://oa.example.com/workbench',
      '执行方式: browser',
      '# 共享步骤',
      '输入 用户名 为 alice',
      '输入 密码 为 alice123',
      '点击 登录工作台',
      '## 流程: 请假申请',
      '流程编码: leave_request',
      '步骤:',
      '点击 申请中心',
      '点击 请假申请',
      '输入 原因 为 家中有事',
      '点击 提交',
      '看到 已提交 就结束',
      '## 流程: 报销申请',
      '流程编码: expense_submit',
      '步骤:',
      '点击 申请中心',
      '点击 报销申请',
      '输入 金额 为 1200',
      '点击 提交',
      '看到 提交成功 就结束',
    ].join('\n'),
  },
] as const;

void TEXT_GUIDE_EXAMPLES;

const TEXT_GUIDE_EXAMPLES_V2 = [
  {
    title: '推荐模板',
    description: '把参数定义、操作步骤、测试样例分开写。初始化只注册流程和字段，真实提交时再用用户输入覆盖。',
    content: [
      '## 流程: 请假申请',
      '流程编码: leave_request',
      '参数:',
      '- 开始日期 | date | 必填',
      '- 结束日期 | date | 必填',
      '- 请假原因 | textarea | 必填',
      '步骤:',
      '- 点击 申请中心',
      '- 点击 请假申请',
      '- 输入 开始日期',
      '- 输入 结束日期',
      '- 输入 请假原因',
      '- 点击 提交',
      '- 看到 已提交 就结束',
      '测试样例:',
      '- 开始日期: 2026-04-01',
      '- 结束日期: 2026-04-02',
      '- 请假原因: 家中有事',
    ].join('\n'),
  },
  {
    title: '简洁步骤格式',
    description: '旧格式继续兼容。只写步骤也可以，系统会自动从步骤里推断字段。',
    content: [
      '1. 打开 https://oa.example.com',
      '2. 点击 新建申请',
      '3. 选择 请假类型',
      '4. 输入 请假原因',
      '5. 上传 附件',
      '6. 等待 2 秒',
      '7. 点击 提交',
      '8. 看到 提交成功 就结束',
    ].join('\n'),
  },
  {
    title: '多流程模板',
    description: '一个 OA 有多个办事流程时，用“流程:”分段；每个流程都可以单独声明参数和测试样例。',
    content: [
      '# 全局',
      '入口链接: https://oa.example.com/workbench',
      '执行方式: browser',
      '# 共享步骤',
      '点击 登录工作台',
      '## 流程: 请假申请',
      '流程编码: leave_request',
      '参数:',
      '- 开始日期 | date | 必填',
      '- 结束日期 | date | 必填',
      '- 请假原因 | textarea | 必填',
      '步骤:',
      '- 点击 申请中心',
      '- 点击 请假申请',
      '- 输入 开始日期',
      '- 输入 结束日期',
      '- 输入 请假原因',
      '- 点击 提交',
      '- 看到 已提交 就结束',
      '测试样例:',
      '- 开始日期: 2026-04-01',
      '- 结束日期: 2026-04-02',
      '- 请假原因: 家中有事',
      '## 流程: 报销申请',
      '流程编码: expense_submit',
      '参数:',
      '- 金额 | number | 必填',
      '- 说明 | textarea | 必填',
      '步骤:',
      '- 点击 申请中心',
      '- 点击 报销申请',
      '- 输入 金额',
      '- 输入 说明',
      '- 点击 提交',
      '- 看到 提交成功 就结束',
      '测试样例:',
      '- 金额: 1200',
      '- 说明: 客户拜访交通费',
    ].join('\n'),
  },
] as const;

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
  const accessMode = job?.authConfig?.accessMode;
  if (accessMode === 'backend_api' || accessMode === 'direct_link' || accessMode === 'text_guide') {
    return accessMode;
  }
  return job?.authConfig?.bootstrapMode === 'rpa_only' ? 'direct_link' : 'backend_api';
}

function getBootstrapValidationMessage(
  value: Pick<BootstrapFormState, 'accessMode' | 'apiDocContent' | 'apiDocUrl' | 'rpaFlowContent'>,
) {
  const hasApi = Boolean(value.apiDocContent.trim() || value.apiDocUrl.trim());
  const hasRpa = Boolean(value.rpaFlowContent.trim());

  if (value.accessMode === 'backend_api' && !hasApi) return '接口接入必须提供接口文档。';
  if (value.accessMode === 'direct_link' && !hasRpa) return '链接直达接入必须提供页面流程 JSON。';
  if (value.accessMode === 'text_guide' && !hasRpa) return '文字示教接入必须填写操作步骤说明。';
  return '';
}

function buildPayload(formData: BootstrapFormState) {
  const payload: Record<string, any> = {
    accessMode: formData.accessMode,
    bootstrapMode: toLegacyBootstrapMode(formData.accessMode),
  };
  if (formData.name.trim()) payload.name = formData.name.trim();
  if (formData.oaUrl.trim()) payload.oaUrl = formData.oaUrl.trim();

  const authConfig = normalizeAuthConfig(formData.authConfig);
  if (Object.keys(authConfig).length > 0) payload.authConfig = authConfig;

  if (formData.accessMode === 'backend_api') {
    payload.apiDocType = formData.apiDocType;
    if (formData.apiDocContent.trim()) payload.apiDocContent = formData.apiDocContent.trim();
    if (formData.apiDocUrl.trim()) payload.apiDocUrl = formData.apiDocUrl.trim();
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
        <p className="mt-1 text-xs text-gray-500">先选你手里拿到的材料，再补对应内容。</p>
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
        <label className="mb-1 block text-sm font-medium text-gray-700">连接器名称</label>
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.name} onChange={(e) => onChange((prev) => ({ ...prev, name: e.target.value }))} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">OA 地址</label>
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.oaUrl} onChange={(e) => onChange((prev) => ({ ...prev, oaUrl: e.target.value }))} placeholder="https://oa.example.com" />
        <p className="mt-1 text-xs text-gray-500">可选。作为默认入口页；不填也可以在步骤或文字示教里直接写 URL。</p>
      </div>
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
  state,
  onChange,
  docInputTab,
  onTabChange,
  uploadFileName,
  onFileUpload,
}: {
  state: BootstrapFormState;
  onChange: FormSetter;
  docInputTab: DocInputTab;
  onTabChange: (tab: DocInputTab) => void;
  uploadFileName: string;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">接口文档</h3>
          <p className="mt-1 text-xs text-gray-500">适用于后端接口接入。</p>
        </div>
        <div className="w-full max-w-[180px]">
          <label className="mb-1 block text-xs font-medium text-gray-500">文档类型</label>
          <select className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.apiDocType} onChange={(e) => onChange((prev) => ({ ...prev, apiDocType: e.target.value as ApiDocType }))}>
            <option value="openapi">OpenAPI 文档</option>
            <option value="swagger">Swagger 文档</option>
            <option value="custom">自定义文档</option>
          </select>
        </div>
      </div>

      <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
        {(['upload', 'link', 'paste'] as DocInputTab[]).map((tab) => (
          <button key={tab} type="button" onClick={() => onTabChange(tab)} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${docInputTab === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab === 'upload' ? '上传文件' : tab === 'link' ? '文档链接' : '粘贴内容'}
          </button>
        ))}
      </div>

      {docInputTab === 'upload' && (
        <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-4 py-8 text-sm text-gray-600 hover:border-blue-400 hover:bg-blue-50/50">
          <input type="file" className="hidden" accept=".json,.yaml,.yml,.txt" onChange={onFileUpload} />
          {uploadFileName || '选择接口文档'}
        </label>
      )}

      {docInputTab === 'link' && (
        <input className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.apiDocUrl} onChange={(e) => onChange((prev) => ({ ...prev, apiDocUrl: e.target.value }))} placeholder="请输入接口文档链接" />
      )}

      {docInputTab === 'paste' && (
        <textarea rows={10} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500" value={state.apiDocContent} onChange={(e) => onChange((prev) => ({ ...prev, apiDocContent: e.target.value }))} placeholder="请粘贴接口文档内容" />
      )}
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
  const placeholder = isTextGuide
    ? TEXT_GUIDE_EXAMPLES_V2[0].content
    : JSON.stringify({ flows: [{ processCode: 'expense_submit', processName: '费用报销', actions: { submit: { steps: [{ type: 'goto', value: 'https://oa.example.com/expense' }, { type: 'click', target: { kind: 'text', value: '新建申请' } }, { type: 'click', target: { kind: 'text', value: '提交' } }] } } }] }, null, 2);

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{isTextGuide ? '文字示教步骤' : '页面流程定义'}</h3>
        <p className="mt-1 text-xs text-gray-500">
          {isTextGuide ? '支持直接粘贴文本，也支持上传常见文本文件；推荐按“参数 / 步骤 / 测试样例”组织内容。多个流程时请按“流程:”分段。' : '填写可执行的页面流程 JSON，也可以先上传文件再继续编辑。'}
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">{isTextGuide ? '上传文本步骤文件' : '上传流程文件'}</div>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              {isTextGuide
                ? '支持 .txt / .md / .markdown / .text / .log，上传后会自动填入下方文本框，你还可以继续修改。'
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
            {uploadFileName || (isTextGuide ? '选择文本文件' : '选择流程文件')}
          </label>
        </div>
      </div>

      {isTextGuide && (
        <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">推荐示例格式</h4>
              <p className="mt-1 text-xs leading-5 text-gray-500">推荐把“参数”“步骤”“测试样例”拆开写。测试样例只用于初始化测试和字段校验，实际运行时会优先使用用户本次提交的表单数据。</p>
            </div>
            <a
              href={TEXT_GUIDE_TEMPLATE_DOWNLOAD_URL}
              download
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              <i className="fas fa-download" />
              下载多流程模板
            </a>
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {TEXT_GUIDE_EXAMPLES_V2.map((example) => (
              <div key={example.title} className="rounded-xl border border-white bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{example.title}</div>
                    <p className="mt-1 text-xs leading-5 text-gray-500">{example.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange((prev) => ({ ...prev, rpaFlowContent: example.content }))}
                    className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  >
                    填入示例
                  </button>
                </div>
                <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-950 px-3 py-3 font-mono text-xs leading-6 text-slate-100">{example.content}</pre>
              </div>
            ))}
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
      <p className="text-xs text-gray-500">默认会使用 OA 地址或步骤里的 URL 作为起点。需要覆盖入口、调整执行方式或配置票据跳转时，再到“高级设置”填写。</p>

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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState(createEmptyFormState());
  const [docInputTab, setDocInputTab] = useState<DocInputTab>('upload');
  const [uploadFileName, setUploadFileName] = useState('');
  const [flowUploadFileName, setFlowUploadFileName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [reactivateJob, setReactivateJob] = useState<BootstrapJob | null>(null);
  const [reactivateMode, setReactivateMode] = useState<ReactivateMode>('reuse');
  const [reactivateDoc, setReactivateDoc] = useState(createEmptyFormState());
  const [reactivateDocInputTab, setReactivateDocInputTab] = useState<DocInputTab>('upload');
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

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

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
    setDocInputTab('upload');
  };

  const closeReactivateModal = () => {
    setReactivateJob(null);
    setReactivateMode('reuse');
    setReactivateDoc(createEmptyFormState());
    setReactivateDocInputTab('upload');
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
    setReactivateDocInputTab(job.openApiUrl ? 'link' : 'upload');
    setReactivateDoc({
      ...createEmptyFormState(),
      accessMode: resolveAccessModeFromJob(job),
      oaUrl: job.oaUrl || '',
      apiDocUrl: job.openApiUrl || '',
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
            <p className="text-sm text-gray-600">按接口接入、链接直达接入、文字示教接入三种方式管理初始化任务。</p>
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
                const canDelete = ['FAILED', 'VALIDATION_FAILED', 'MANUAL_REVIEW', 'CONNECTOR_DELETED'].includes(status.code);
                return (
                  <tr key={job.id}>
                    <td className="px-4 py-3"><div className="text-sm font-medium text-gray-900">{job.name || `任务 #${job.id.substring(0, 8)}`}</div><div className="text-xs text-gray-500">{job.oaUrl || job.openApiUrl || '-'}</div></td>
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

        {showCreateModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-gray-200 px-8 py-5"><div><h2 className="text-xl font-bold text-gray-900">新建初始化任务</h2><p className="mt-0.5 text-sm text-gray-500">先选接入方式，再补对应的初始化材料。</p></div><button onClick={closeCreateModal} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"><i className="fas fa-times text-gray-500"></i></button></div><div className="flex-1 space-y-6 overflow-y-auto px-8 py-6">{createError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{createError}</div>}<ModeCards value={formData.accessMode} onChange={(accessMode) => setFormData((prev) => ({ ...prev, accessMode }))} /><BasicFields state={formData} onChange={setFormData} />{formData.accessMode === 'backend_api' ? <ApiDocFields state={formData} onChange={setFormData} docInputTab={docInputTab} onTabChange={setDocInputTab} uploadFileName={uploadFileName} onFileUpload={(event) => handleFileUpload(event, setFormData, 'apiDocContent', setUploadFileName)} /> : <FlowFields state={formData} onChange={setFormData} uploadFileName={flowUploadFileName} onFileUpload={(event) => handleFileUpload(event, setFormData, 'rpaFlowContent', setFlowUploadFileName)} />}<AdvancedFields state={formData} onChange={setFormData} showPlatformFields={formData.accessMode !== 'backend_api'} /></div><div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-8 py-5"><button onClick={closeCreateModal} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">取消</button><div className="flex-1">{createValidationMessage && <p className="text-xs text-amber-700">{createValidationMessage}</p>}</div><button onClick={createJob} disabled={creating || Boolean(createValidationMessage)} title={createValidationMessage || undefined} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{creating ? '创建中...' : '创建任务'}</button></div></div></div>}

        {reactivateJob && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b border-gray-200 px-8 py-5"><div><h2 className="text-xl font-bold text-gray-900">重新激活初始化任务</h2><p className="mt-0.5 text-sm text-gray-500">{reactivateJob.name || `任务 #${reactivateJob.id.substring(0, 8)}`}</p></div><button onClick={closeReactivateModal} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"><i className="fas fa-times text-gray-500"></i></button></div><div className="flex-1 space-y-6 overflow-y-auto px-8 py-6">{reactivateError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{reactivateError}</div>}<div className="space-y-3"><label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${reactivateMode === 'reuse' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`} onClick={() => setReactivateMode('reuse')}><input type="radio" checked={reactivateMode === 'reuse'} readOnly className="mt-0.5" /><div><p className="text-sm font-medium text-gray-900">复用历史材料</p><p className="mt-0.5 text-xs text-gray-500">沿用上次的初始化材料重新执行。</p></div></label><label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${reactivateMode === 'new' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`} onClick={() => setReactivateMode('new')}><input type="radio" checked={reactivateMode === 'new'} readOnly className="mt-0.5" /><div><p className="text-sm font-medium text-gray-900">换新材料</p><p className="mt-0.5 text-xs text-gray-500">切换接入方式或重新上传新的初始化内容。</p></div></label></div><ModeCards value={reactivateDoc.accessMode} onChange={(accessMode) => setReactivateDoc((prev) => ({ ...prev, accessMode }))} /><BasicFields state={reactivateDoc} onChange={setReactivateDoc} />{reactivateMode === 'new' && (reactivateDoc.accessMode === 'backend_api' ? <ApiDocFields state={reactivateDoc} onChange={setReactivateDoc} docInputTab={reactivateDocInputTab} onTabChange={setReactivateDocInputTab} uploadFileName={reactivateFileName} onFileUpload={(event) => handleFileUpload(event, setReactivateDoc, 'apiDocContent', setReactivateFileName)} /> : <FlowFields state={reactivateDoc} onChange={setReactivateDoc} uploadFileName={reactivateFlowFileName} onFileUpload={(event) => handleFileUpload(event, setReactivateDoc, 'rpaFlowContent', setReactivateFlowFileName)} />)}<AdvancedFields state={reactivateDoc} onChange={setReactivateDoc} showPlatformFields={reactivateDoc.accessMode !== 'backend_api'} /></div><div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-8 py-5"><button onClick={closeReactivateModal} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">取消</button><div className="flex-1">{reactivateValidationMessage && <p className="text-xs text-amber-700">{reactivateValidationMessage}</p>}</div><button onClick={handleReactivate} disabled={reactivating || (reactivateMode === 'new' && Boolean(reactivateValidationMessage))} title={reactivateValidationMessage || undefined} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{reactivating ? '处理中...' : '重新激活'}</button></div></div></div>}

        {deleteConfirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-sm rounded-2xl bg-white shadow-xl"><div className="px-6 py-5"><h3 className="text-base font-bold text-gray-900">删除初始化任务</h3><p className="mt-2 text-sm text-gray-600">这会永久删除当前任务及其相关产物。</p></div><div className="flex gap-3 border-t border-gray-200 px-6 py-4"><button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">取消</button><button onClick={async () => { if (!deleteConfirm) return; setDeleting(true); try { await apiClient.delete(`/bootstrap/jobs/${deleteConfirm.id}`); setDeleteConfirm(null); await loadJobs(); } catch { /* deletion failed — keep dialog open so user can retry */ } finally { setDeleting(false); } }} disabled={deleting} className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{deleting ? '删除中...' : '删除'}</button></div></div></div>}
      </div>
    </main>
  );
}
