export type ProcessAuthoringAccessMode = 'rpa' | 'url' | 'api';
export type ProcessAuthoringInputMode = 'manual' | 'file';
export type ProcessAuthoringDraft = {
  connectorId?: string;
  processCode?: string;
  processName?: string;
  textTemplateContent?: string;
};

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

export const PROCESS_TEXT_TEMPLATE_PLACEHOLDERS: Record<ProcessAuthoringAccessMode, string> = {
  url: [
    '流程: 请假申请',
    '流程编码: leave_request',
    '描述: 教职工请假申请示例',
    '认证入口: https://auth.example.com/',
    '系统网址: https://oa.example.com/',
    '流程页面: https://oa.example.com/workflow/new?templateId=leave_request',
    '',
    '需要填写的信息:',
    '- 请假事由 | 说明: 填写本次请假的具体原因 | 示例: 家中有事，需要请假半天',
    '- 开始日期 | 示例: 2026-04-20',
    '- 结束日期 | 示例: 2026-04-20',
    '',
    '需要上传的材料:',
    '- 病假证明 | 说明: 病假时上传相关证明材料 | 示例: 诊断证明.pdf',
    '',
    '步骤:',
    '- 访问 https://auth.example.com/',
    '- 访问 https://oa.example.com/',
    '- 访问 https://oa.example.com/workflow/new?templateId=leave_request',
    '- 点击 保存待发',
    '- 看到 提交成功 就结束',
  ].join('\n'),
  rpa: [
    '流程: 用印申请',
    '流程编码: seal_apply',
    '描述: 公章或合同章申请示例',
    '入口链接: https://oa.example.com/workflow',
    '',
    '需要填写的信息:',
    '- 文件类型、名称及份数 | 说明: 填写需要盖章文件的类型、名称和份数 | 示例: 劳务合同 2份',
    '',
    '需要上传的材料:',
    '- 用印附件 | 说明: 上传需要盖章的文件 | 示例: 劳务合同.pdf',
    '',
    '步骤:',
    '- 访问 https://oa.example.com/workflow',
    '- 点击 用印申请',
    '- 填写 文件类型、名称及份数',
    '- 上传 用印附件',
    '- 点击 保存待发',
    '- 看到 提交成功 就结束',
  ].join('\n'),
  api: [
    '流程: 合同审批',
    '流程编码: contract_apply',
    '描述: 通过业务接口提交合同审批示例',
    '系统网址: https://oa.example.com/',
    '提交接口: POST /api/workflow/contract/submit',
    '查询接口: GET /api/workflow/contract/status/{submissionId}',
    '提交成功字段: success',
    '状态字段: data.status',
    '',
    '需要填写的信息:',
    '- 合同名称 | 说明: 申请人录入的合同标题 | 示例: 校企合作协议',
    '- 合同金额 | 示例: 12000',
    '- 申请事由 | 示例: 需要发起合同评审',
    '',
    '需要上传的材料:',
    '- 合同附件 | 说明: 上传合同扫描件或正文文件 | 示例: 合同正文.pdf | 多份',
  ].join('\n'),
};

export function getProcessAuthoringValidationMessage(input: ProcessAuthoringDraft) {
  const missing: string[] = [];

  if (!String(input.connectorId || '').trim()) {
    missing.push('所属连接器');
  }

  if (!String(input.processCode || '').trim()) {
    missing.push('流程编码');
  }

  if (!String(input.processName || '').trim()) {
    missing.push('流程名称');
  }

  if (!String(input.textTemplateContent || '').trim()) {
    missing.push('流程模板内容');
  }

  if (missing.length === 0) {
    return '';
  }

  return `还缺少：${missing.join('、')}。`;
}

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

  const tokens = [label];
  const description = String(field?.description || '').trim();
  const example = String(field?.example || '').trim();
  if (description) {
    tokens.push(`说明: ${description}`);
  }
  if (example) {
    tokens.push(`示例: ${example}`);
  }
  if (field?.required === false) {
    tokens.push('选填');
  }
  if (field?.multiple) {
    tokens.push('多份');
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
  const processCode = String(input.processCode || definition.processCode || '').trim();
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

  if (processName) {
    lines.push(`流程: ${processName}`);
  }
  if (processCode) {
    lines.push(`流程编码: ${processCode}`);
  }
  if (description) {
    lines.push(`描述: ${description}`);
  }

  const baseUrl = String(platform.businessBaseUrl || platform.targetBaseUrl || '').trim();
  if (baseUrl) {
    lines.push(`系统网址: ${baseUrl}`);
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
    lines.push('需要填写的信息:');
    fillFields
      .map(formatFieldLine)
      .filter((line): line is string => Boolean(line))
      .forEach((line) => lines.push(line));
  }

  if (uploadFields.length > 0) {
    lines.push('');
    lines.push('需要上传的材料:');
    uploadFields
      .map(formatFieldLine)
      .filter((line): line is string => Boolean(line))
      .forEach((line) => lines.push(line));
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
  const processCode = String(input.processCode || definition.processCode || '').trim();
  const description = String(definition.description || '').trim();
  const platform = definition.platform && typeof definition.platform === 'object'
    ? definition.platform as Record<string, any>
    : {};
  const fields = Array.isArray(definition.fields)
    ? definition.fields as Array<Record<string, any>>
    : [];

  if (processName) {
    lines.push(`流程: ${processName}`);
  }
  if (processCode) {
    lines.push(`流程编码: ${processCode}`);
  }
  if (description) {
    lines.push(`描述: ${description}`);
  }

  if (input.accessMode === 'url') {
    if (platform.entryUrl) {
      lines.push(`认证入口: ${platform.entryUrl}`);
    }
    const businessUrl = String(platform.jumpUrlTemplate || platform.targetBaseUrl || platform.businessBaseUrl || '').trim();
    if (platform.businessBaseUrl) {
      lines.push(`系统网址: ${platform.businessBaseUrl}`);
    }
    if (businessUrl && businessUrl !== String(platform.businessBaseUrl || '').trim()) {
      lines.push(`流程页面: ${businessUrl}`);
    }
  } else if (platform.entryUrl) {
    lines.push(`入口链接: ${platform.entryUrl}`);
  }

  const fillFields = fields.filter((field) => String(field?.type || '').trim().toLowerCase() !== 'file');
  const uploadFields = fields.filter((field) => String(field?.type || '').trim().toLowerCase() === 'file');

  if (fillFields.length > 0) {
    lines.push('');
    lines.push('需要填写的信息:');
    fillFields
      .map(formatFieldLine)
      .filter((line): line is string => Boolean(line))
      .forEach((line) => lines.push(line));
  }

  if (uploadFields.length > 0) {
    lines.push('');
    lines.push('需要上传的材料:');
    uploadFields
      .map(formatFieldLine)
      .filter((line): line is string => Boolean(line))
      .forEach((line) => lines.push(line));
  }

  lines.push('');
  lines.push('步骤:');

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

  const successText = String(definition?.actions?.submit?.successAssert?.value || '').trim();
  if (successText) {
    lines.push(`- 看到 ${successText} 就结束`);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
