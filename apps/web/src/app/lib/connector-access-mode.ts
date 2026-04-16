export type AccessModeKey = 'backend_api' | 'direct_link' | 'text_guide';
export type ResolvedAccessModeKey = AccessModeKey | 'hybrid' | 'unknown';

export const ACCESS_MODE_META = {
  backend_api: {
    label: '接口接入（API）',
    description: '手里有接口文档文件时，直接上传文件即可。',
    badge: '接口接入',
  },
  direct_link: {
    label: '链接直达接入（URL）',
    description: '有系统入口链接和页面流程定义时使用。',
    badge: '链接直达',
  },
  text_guide: {
    label: '文字示教接入（RPA）',
    description: '不会写流程也没关系，把平时怎么操作写下来就行。',
    badge: '文字示教',
  },
} as const;

export const RESOLVED_ACCESS_MODE_META = {
  backend_api: ACCESS_MODE_META.backend_api,
  direct_link: ACCESS_MODE_META.direct_link,
  text_guide: ACCESS_MODE_META.text_guide,
  hybrid: {
    label: '混合接入',
    description: '同时支持接口与页面/链接能力。',
    badge: '混合接入',
  },
  unknown: {
    label: '待识别',
    description: '暂未识别出明确接入方式。',
    badge: '待识别',
  },
} as const;

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

function normalizeAccessMode(value: unknown): AccessModeKey | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'backend_api' || normalized === 'direct_link' || normalized === 'text_guide') {
    return normalized;
  }
  return null;
}

function normalizeBootstrapMode(value: unknown): 'api_only' | 'rpa_only' | 'hybrid' | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'api_only' || normalized === 'rpa_only' || normalized === 'hybrid') {
    return normalized;
  }
  return null;
}

function normalizeSourceType(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeModeList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(new Set(
    value
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean),
  ));
}

function hasNetworkRequest(value: unknown) {
  const request = asRecord(value);
  return Boolean(
    String(request.url || '').trim()
    || String(request.path || '').trim()
    || String(request.endpoint || '').trim(),
  );
}

function hasUrlRuntimeHints(rpaDefinition: unknown) {
  const flow = asRecord(rpaDefinition);
  const platform = asRecord(flow.platform);
  const runtime = asRecord(flow.runtime);
  const portalSsoBridge = asRecord(platform.portalSsoBridge);

  return Boolean(
    String(platform.jumpUrlTemplate || '').trim()
    || String(platform.ticketBrokerUrl || '').trim()
    || String(portalSsoBridge.targetPathTemplate || '').trim(),
  ) || hasNetworkRequest(runtime.networkSubmit) || hasNetworkRequest(runtime.networkStatus);
}

export function readExecutionModes(uiHints: unknown) {
  const hints = asRecord(uiHints);
  const executionModes = asRecord(hints.executionModes);

  return {
    submit: normalizeModeList(executionModes.submit),
    queryStatus: normalizeModeList(executionModes.queryStatus),
  };
}

export function formatExecutionModes(uiHints: unknown) {
  const executionModes = readExecutionModes(uiHints);
  if (executionModes.submit.length === 0 && executionModes.queryStatus.length === 0) {
    return '-';
  }

  const submit = executionModes.submit.length > 0
    ? executionModes.submit.map(humanizeExecutionMode).join(' / ')
    : '-';
  const queryStatus = executionModes.queryStatus.length > 0
    ? executionModes.queryStatus.map(humanizeExecutionMode).join(' / ')
    : '-';

  return `提交：${submit}；状态：${queryStatus}`;
}

export function humanizeExecutionMode(mode: string) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'api') return 'API';
  if (normalized === 'url') return 'URL 直达';
  if (normalized === 'rpa') return '浏览器自动化';
  return normalized || '-';
}

export function resolveAccessModeFromAuthConfig(authConfig: unknown): AccessModeKey | null {
  const config = asRecord(authConfig);
  const explicit = normalizeAccessMode(config.accessMode);
  if (explicit) {
    return explicit;
  }

  const bootstrapMode = normalizeBootstrapMode(config.bootstrapMode);
  if (bootstrapMode === 'api_only') return 'backend_api';
  if (bootstrapMode === 'rpa_only') return 'direct_link';
  return null;
}

export function resolvePublishedAccessMode(input: {
  uiHints?: unknown;
  authConfig?: unknown;
}): ResolvedAccessModeKey {
  const uiHints = asRecord(input.uiHints);
  const authConfig = asRecord(input.authConfig);
  const rpaDefinition = asRecord(uiHints.rpaDefinition);
  const metadata = asRecord(rpaDefinition.metadata);

  const explicitAccessMode = normalizeAccessMode(
    uiHints.accessMode
    || rpaDefinition.accessMode,
  );
  if (explicitAccessMode) {
    return explicitAccessMode;
  }

  const sourceType = normalizeSourceType(
    uiHints.rpaSourceType
    || uiHints.sourceType
    || rpaDefinition.sourceType
    || metadata.sourceType,
  );
  if (sourceType === 'text_guide') return 'text_guide';
  if (sourceType === 'direct_link') return 'direct_link';

  const executionModes = readExecutionModes(uiHints);
  const allModes = new Set([...executionModes.submit, ...executionModes.queryStatus]);
  const hasUrl = allModes.has('url') || hasUrlRuntimeHints(rpaDefinition);
  const hasApi = allModes.has('api');

  if (hasUrl && hasApi) {
    return resolveAccessModeFromAuthConfig(authConfig) || 'hybrid';
  }
  if (hasUrl) return 'direct_link';
  if (hasApi) return 'backend_api';

  const fromAuthConfig = resolveAccessModeFromAuthConfig(authConfig);
  if (fromAuthConfig) {
    return fromAuthConfig;
  }

  const bootstrapMode = normalizeBootstrapMode(uiHints.bootstrapMode || authConfig.bootstrapMode);
  if (bootstrapMode === 'hybrid') return 'hybrid';
  if (bootstrapMode === 'api_only') return 'backend_api';
  if (bootstrapMode === 'rpa_only') return 'direct_link';

  return 'unknown';
}
