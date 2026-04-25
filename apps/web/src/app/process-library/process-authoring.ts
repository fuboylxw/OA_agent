import { FLOW_TEXT_TEMPLATE_PLACEHOLDERS } from '../lib/flow-text-templates';

export type ProcessAuthoringAccessMode = 'rpa' | 'url' | 'api';
export type ProcessAuthoringInputMode = 'manual' | 'file';

export const PROCESS_ACCESS_MODE_META: Record<ProcessAuthoringAccessMode, {
  label: string;
  description: string;
  badge: string;
  helperTitle: string;
  helperText: string;
}> = {
  url: {
    label: '链接直达（URL）',
    description: '适合通过固定链接直接打开业务页面，再按页面规则提交。',
    badge: 'URL',
    helperTitle: '适合什么场景',
    helperText: '业务系统有稳定入口页、流程页或可拼接跳转链接时，用 URL 模式最清晰。',
  },
  rpa: {
    label: 'RPA 模拟操作',
    description: '适合必须逐步点击、填写、上传、切换页面的流程。',
    badge: 'RPA',
    helperTitle: '适合什么场景',
    helperText: '如果业务系统只能像人工一样点页面、填表单、传附件，就选 RPA。',
  },
  api: {
    label: '接口接入（API）',
    description: '适合通过接口直接提交或查询，无需模拟页面点击。',
    badge: 'API',
    helperTitle: '适合什么场景',
    helperText: '业务系统已经提供提交接口、查询接口或开放平台能力时，用 API 模式。',
  },
};

export const PROCESS_INPUT_MODE_META: Record<ProcessAuthoringInputMode, {
  label: string;
  description: string;
}> = {
  manual: {
    label: '粘贴 / 手动填写',
    description: '直接把流程说明粘贴到下面，或按模板手动填写。',
  },
  file: {
    label: '文件上传',
    description: '上传现成模板文件，系统会读入内容后继续按纯文字方式编辑。',
  },
};

export const PROCESS_FILE_ACCEPT: Record<ProcessAuthoringAccessMode, string> = {
  url: '.txt,.md,.markdown,.text,.log',
  rpa: '.txt,.md,.markdown,.text,.log',
  api: '.txt,.md,.markdown,.text,.log,.json,.yaml,.yml',
};

export const PROCESS_TEXT_TEMPLATE_PLACEHOLDERS: Record<ProcessAuthoringAccessMode, string> = FLOW_TEXT_TEMPLATE_PLACEHOLDERS;

function isDirectLinkDefinition(definition: Record<string, any> | null | undefined) {
  if (!definition || typeof definition !== 'object') {
    return false;
  }

  const metadata = definition.metadata && typeof definition.metadata === 'object'
    ? definition.metadata as Record<string, any>
    : {};
  const accessMode = String(definition.accessMode || metadata.accessMode || '').trim().toLowerCase();
  const sourceType = String(definition.sourceType || metadata.sourceType || '').trim().toLowerCase();
  const runtime = definition.runtime && typeof definition.runtime === 'object'
    ? definition.runtime as Record<string, any>
    : {};
  return accessMode === 'direct_link'
    || sourceType === 'direct_link'
    || hasNetworkRequest(runtime.networkSubmit)
    || hasNetworkRequest(runtime.networkStatus);
}

function isApiDefinition(input?: {
  uiHints?: Record<string, any> | null;
  definition?: Record<string, any> | null;
}) {
  const authoringMode = String(input?.uiHints?.authoring?.accessMode || '').trim().toLowerCase();
  if (authoringMode === 'api') {
    return true;
  }

  const definition = input?.definition;
  const metadata = definition?.metadata && typeof definition.metadata === 'object'
    ? definition.metadata as Record<string, any>
    : {};
  const definitionAccessMode = String(metadata.accessMode || definition?.accessMode || '').trim().toLowerCase();
  if (definitionAccessMode === 'api') {
    return true;
  }

  const executionModes = input?.uiHints?.executionModes && typeof input.uiHints.executionModes === 'object'
    ? input.uiHints.executionModes as Record<string, any>
    : {};
  return includesMode(executionModes.submit, 'api')
    || includesMode(executionModes.queryStatus, 'api')
    || Boolean(input?.uiHints?.apiMethod && input?.uiHints?.apiPath)
    || Array.isArray(input?.uiHints?.endpoints);
}

function includesMode(value: unknown, mode: string) {
  return Array.isArray(value) && value.some((item) => String(item || '').trim().toLowerCase() === mode);
}

function hasNetworkRequest(value: unknown) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, any>).url === 'string'
    && (value as Record<string, any>).url.trim(),
  );
}

function formatFieldLine(field: Record<string, any>) {
  const label = String(field?.label || field?.key || '').trim();
  if (!label) {
    return null;
  }

  const tokens = [label, field?.required === false ? '选填' : '必填'];
  const description = String(field?.description || '').trim();
  const example = String(field?.example || '').trim();
  const normalizedOptions = Array.isArray(field?.options)
    ? field.options
      .map((option: any) => String(option?.label || option?.value || option || '').trim())
      .filter(Boolean)
    : [];
  if (description) {
    tokens.push(`说明: ${description}`);
  }
  if (example) {
    tokens.push(`示例: ${example}`);
  }
  if (normalizedOptions.length > 0) {
    tokens.push(`可选值: ${Array.from(new Set(normalizedOptions)).join('、')}`);
  }
  if (field?.multiple) {
    tokens.push('可多选');
  } else if (normalizedOptions.length > 0) {
    tokens.push('只能选一个');
  }
  return `- ${tokens.join(' | ')}`;
}

function describeStep(step: Record<string, any>) {
  const type = String(step?.type || '').trim().toLowerCase();
  const targetLabel = String(step?.target?.label || step?.target?.value || step?.value || '').trim();
  if (type === 'goto') {
    const url = String(step?.value || '').trim();
    return url ? `- 访问 ${url}` : null;
  }
  if (type === 'wait') {
    const timeoutMs = Number(step?.timeoutMs || 0);
    return timeoutMs > 0 ? `- 等待 ${Number.isInteger(timeoutMs / 1000) ? timeoutMs / 1000 : timeoutMs} ${timeoutMs >= 1000 ? '秒' : '毫秒'}` : '- 等待';
  }
  if (type === 'input') {
    return targetLabel ? `- 填写 ${targetLabel}` : null;
  }
  if (type === 'select') {
    const value = String(step?.value || '').trim();
    return targetLabel ? `- 选择 ${targetLabel}${value ? ` 为 ${value}` : ''}` : null;
  }
  if (type === 'upload') {
    return targetLabel ? `- 上传 ${targetLabel}` : null;
  }
  if (type === 'click') {
    return targetLabel ? `- 点击 ${targetLabel}` : null;
  }
  return targetLabel ? `- ${targetLabel}` : null;
}

function extractDirectLinkTriggerLabel(definition: Record<string, any>) {
  const preflightSteps = Array.isArray(definition?.runtime?.preflight?.steps)
    ? definition.runtime.preflight.steps as Array<Record<string, any>>
    : [];
  const captureStep = [...preflightSteps]
    .reverse()
    .find((step) => String(step?.builtin || '').trim() === 'capture_form_submit');
  const triggerLabel = String(captureStep?.options?.trigger?.text || '').trim();
  return triggerLabel || null;
}

function buildDirectLinkStepLines(definition: Record<string, any>) {
  const preflightSteps = Array.isArray(definition?.runtime?.preflight?.steps)
    ? definition.runtime.preflight.steps as Array<Record<string, any>>
    : [];
  const lines = preflightSteps
    .filter((step) => String(step?.builtin || '').trim() !== 'capture_form_submit')
    .map(describeStep)
    .filter((line): line is string => Boolean(line));
  const triggerLabel = extractDirectLinkTriggerLabel(definition);
  if (triggerLabel) {
    lines.push(`- 点击 ${triggerLabel}`);
  }
  return lines;
}

function buildApiEndpointLine(label: string, endpoint?: Record<string, any> | null) {
  if (!endpoint) {
    return null;
  }

  const method = String(endpoint.method || endpoint.httpMethod || '').trim().toUpperCase();
  const path = String(endpoint.path || endpoint.apiEndpoint || '').trim();
  if (!path) {
    return null;
  }

  return `${label}: ${method ? `${method} ` : ''}${path}`.trim();
}

function buildApiTextTemplateFromUiHints(input: {
  uiHints?: Record<string, any> | null;
  definition?: Record<string, any> | null;
  processName?: string;
  processCode?: string;
}) {
  const uiHints = input.uiHints && typeof input.uiHints === 'object' ? input.uiHints : {};
  const definition = input.definition && typeof input.definition === 'object' ? input.definition : {};
  const lines: string[] = [];

  const processName = String(input.processName || definition.processName || '').trim();
  const description = String(definition.description || '').trim();
  const platform = definition.platform && typeof definition.platform === 'object'
    ? definition.platform as Record<string, any>
    : {};
  const fields = Array.isArray(definition.fields)
    ? definition.fields as Array<Record<string, any>>
    : [];
  const endpoints = Array.isArray(uiHints.endpoints) ? uiHints.endpoints as Array<Record<string, any>> : [];
  const submitEndpoint = endpoints.find((endpoint) => String(endpoint?.category || '').trim().toLowerCase() === 'submit')
    || (uiHints.apiPath ? { method: uiHints.apiMethod, path: uiHints.apiPath } : null);
  const queryEndpoint = endpoints.find((endpoint) => String(endpoint?.category || '').trim().toLowerCase() === 'query') || null;
  const successField = String(uiHints.submitSuccessField || '').trim();
  const statusField = String(uiHints.statusField || '').trim();

  lines.push('# 系统基本信息');
  if (processName) {
    lines.push(`系统名称: ${processName}`);
  }
  const baseUrl = String(platform.businessBaseUrl || platform.targetBaseUrl || '').trim();
  if (baseUrl) {
    lines.push(`系统网址: ${baseUrl}`);
  }
  lines.push('适用对象: 由连接器配置决定');
  lines.push('认证说明: 使用现有接口鉴权，不需要页面点击');
  if (successField || statusField) {
    lines.push(`办理完成标志: ${[
      successField ? `提交返回字段 ${successField}` : '',
      statusField ? `状态字段 ${statusField}` : '',
    ].filter(Boolean).join('；')}`);
  }
  lines.push('');

  if (processName) {
    lines.push(`## 流程: ${processName}`);
  }
  if (description) {
    lines.push(`描述: ${description}`);
  }
  const submitLine = buildApiEndpointLine('提交接口', submitEndpoint);
  if (submitLine) {
    lines.push(submitLine);
  }
  const queryLine = buildApiEndpointLine('查询接口', queryEndpoint);
  if (queryLine) {
    lines.push(queryLine);
  }

  const fillFields = fields.filter((field) => String(field?.type || '').trim().toLowerCase() !== 'file');
  const uploadFields = fields.filter((field) => String(field?.type || '').trim().toLowerCase() === 'file');

  if (fillFields.length > 0) {
    lines.push('');
    lines.push('用户办理时需要补充的信息:');
    fillFields
      .map(formatFieldLine)
      .filter((line): line is string => Boolean(line))
      .forEach((line) => lines.push(line));
  }

  if (uploadFields.length > 0 || fillFields.length === 0) {
    if (fillFields.length === 0) {
      lines.push('');
      lines.push('用户办理时需要补充的信息:');
    }
    uploadFields
      .map(formatFieldLine)
      .filter((line): line is string => Boolean(line))
      .forEach((line) => lines.push(line));
  }

  const exampleLines = fields
    .map((field) => {
      const label = String(field?.label || field?.key || '').trim();
      const example = String(field?.example || '').trim();
      return label && example ? `- ${label}: ${example}` : null;
    })
    .filter((line): line is string => Boolean(line));
  if (exampleLines.length > 0) {
    lines.push('');
    lines.push('测试样例:');
    exampleLines.forEach((line) => lines.push(line));
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function resolveProcessAuthoringAccessMode(input?: {
  uiHints?: Record<string, any> | null;
  definition?: Record<string, any> | null;
}) {
  const authoringMode = String(input?.uiHints?.authoring?.accessMode || '').trim().toLowerCase();
  if (authoringMode === 'url' || authoringMode === 'rpa' || authoringMode === 'api') {
    return authoringMode as ProcessAuthoringAccessMode;
  }

  if (isApiDefinition(input)) {
    return 'api';
  }

  return isDirectLinkDefinition(input?.definition || null) ? 'url' : 'rpa';
}

export function resolveProcessAuthoringInputMode(input?: {
  uiHints?: Record<string, any> | null;
}) {
  const inputMode = String(input?.uiHints?.authoring?.inputMethod || '').trim().toLowerCase();
  return inputMode === 'file' ? 'file' : 'manual';
}

export function resolveProcessAuthoringTextTemplate(input: {
  uiHints?: Record<string, any> | null;
  definition?: Record<string, any> | null;
  processName?: string;
  processCode?: string;
}) {
  const stored = String(input.uiHints?.authoring?.textTemplate || '').trim();
  if (stored) {
    return stored;
  }

  return buildProcessAuthoringTextTemplate({
    uiHints: input.uiHints,
    definition: input.definition || null,
    accessMode: resolveProcessAuthoringAccessMode(input),
    processName: input.processName,
    processCode: input.processCode,
  });
}

export function buildProcessAuthoringTextTemplate(input: {
  uiHints?: Record<string, any> | null;
  definition?: Record<string, any> | null;
  accessMode: ProcessAuthoringAccessMode;
  processName?: string;
  processCode?: string;
}) {
  const definition = input.definition && typeof input.definition === 'object' ? input.definition : null;
  if (!definition) {
    return input.accessMode === 'api'
      ? buildApiTextTemplateFromUiHints(input)
      : '';
  }

  if (input.accessMode === 'api') {
    return buildApiTextTemplateFromUiHints(input);
  }

  const lines: string[] = [];
  const processName = String(input.processName || definition.processName || '').trim();
  const description = String(definition.description || '').trim();
  const platform = definition.platform && typeof definition.platform === 'object'
    ? definition.platform as Record<string, any>
    : {};
  const fields = Array.isArray(definition.fields)
    ? definition.fields as Array<Record<string, any>>
    : [];

  const successText = String(definition?.actions?.submit?.successAssert?.value || '').trim();

  lines.push('# 系统基本信息');
  if (platform.entryUrl) {
    lines.push(`${input.accessMode === 'url' ? '认证入口' : '系统网址'}: ${platform.entryUrl}`);
  }
  if (input.accessMode === 'url' && platform.businessBaseUrl) {
    lines.push(`系统网址: ${platform.businessBaseUrl}`);
  }
  if (successText) {
    lines.push(`办理完成标志: 看到 ${successText} 就结束`);
  }
  lines.push('');

  if (processName) {
    lines.push(`## 流程: ${processName}`);
  }
  if (description) {
    lines.push(`描述: ${description}`);
  }

  if (input.accessMode === 'url') {
    const businessUrl = String(platform.jumpUrlTemplate || platform.targetBaseUrl || platform.businessBaseUrl || '').trim();
    if (businessUrl) {
      lines.push(`流程页面: ${businessUrl}`);
    }
  } else if (platform.entryUrl) {
    lines.push(`流程入口: ${platform.entryUrl}`);
  }

  if (fields.length > 0) {
    lines.push('');
    lines.push('用户办理时需要补充的信息:');
    fields
      .map(formatFieldLine)
      .filter((line): line is string => Boolean(line))
      .forEach((line) => lines.push(line));
  }

  lines.push('');
  lines.push('办理步骤:');

  if (input.accessMode === 'url') {
    const urlLines = buildDirectLinkStepLines(definition);
    if (urlLines.length > 0) {
      urlLines.forEach((line) => lines.push(line));
    } else if (platform.jumpUrlTemplate) {
      lines.push(`- 访问 ${platform.jumpUrlTemplate}`);
    }
  } else {
    const submitSteps = Array.isArray(definition?.actions?.submit?.steps)
      ? definition.actions.submit.steps as Array<Record<string, any>>
      : [];
    submitSteps
      .map(describeStep)
      .filter((line): line is string => Boolean(line))
      .forEach((line) => lines.push(line));
  }

  if (successText) {
    lines.push(`- 看到 ${successText} 就结束`);
  }

  const exampleLines = fields
    .map((field) => {
      const label = String(field?.label || field?.key || '').trim();
      const example = String(field?.example || '').trim();
      return label && example ? `- ${label}: ${example}` : null;
    })
    .filter((line): line is string => Boolean(line));
  if (exampleLines.length > 0) {
    lines.push('');
    lines.push('测试样例:');
    exampleLines.forEach((line) => lines.push(line));
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
