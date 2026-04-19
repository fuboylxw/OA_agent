import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { parseRpaFlowDefinitions } from '@uniflow/shared-types';
import {
  buildAuthCredentialPlaceholder,
  detectAuthCredentialFieldKind,
  isAuthCredentialField,
} from '../common/auth-field.util';

export type ProcessLibraryAccessMode = 'rpa' | 'url' | 'api';
export type ProcessLibraryAuthoringMode = 'text' | 'json';
export type ProcessLibraryInputMethod = 'manual' | 'file';

export type ProcessLibraryApiToolDefinition = {
  toolName: string;
  toolDescription: string;
  apiEndpoint: string;
  httpMethod: string;
  headers?: Record<string, string>;
  bodyTemplate?: Record<string, any> | null;
  paramMapping: Record<string, any>;
  responseMapping: Record<string, any>;
  category: 'submit' | 'query';
  flowCode: string;
  testInput?: Record<string, any>;
};

const VALID_RPA_STEP_TYPES = new Set([
  'goto',
  'wait',
  'input',
  'click',
  'select',
  'upload',
  'extract',
  'evaluate',
  'download',
  'screenshot',
]);

export function buildProcessLibraryFlowDefinitions(input: {
  content: string;
  accessMode: ProcessLibraryAccessMode;
  authoringMode?: ProcessLibraryAuthoringMode;
  connectorBaseUrl?: string | null;
  processName?: string;
  processCode?: string;
}) {
  const content = String(input.content || '').trim();
  if (!content) {
    throw new BadRequestException('流程定义不能为空');
  }

  const parsedDefinitions = parseRpaFlowDefinitions(content);
  if (parsedDefinitions.length > 0) {
    if (input.accessMode === 'api') {
      const bundle = {
        flows: parsedDefinitions.map((definition) => JSON.parse(JSON.stringify(definition))),
        apiTools: parsedDefinitions.flatMap((definition) => extractApiToolsFromDefinition(definition as Record<string, any>)),
      };

      validateGeneratedApiBundle(bundle, input.connectorBaseUrl);

      return {
        definitions: bundle.flows || [],
        normalizedAuthoringMode: 'json' as const,
        apiTools: bundle.apiTools,
      };
    }

    if (input.accessMode === 'rpa' && parsedDefinitions.some((definition) => isDirectLinkDefinition(definition))) {
      throw new BadRequestException('当前选择的是 RPA 办理方式，请不要提交链接直达（URL）定义');
    }

    const bundle = input.accessMode === 'url'
      ? applyGuideAccessMode(
          {
            flows: parsedDefinitions.map((definition) => JSON.parse(JSON.stringify(definition))),
          },
          {
            accessMode: 'url',
            connectorBaseUrl: input.connectorBaseUrl,
          },
        )
      : {
          flows: parsedDefinitions.map((definition) => JSON.parse(JSON.stringify(definition))),
        };

    validateGeneratedFlowBundle(bundle, {
      accessMode: input.accessMode,
      connectorBaseUrl: input.connectorBaseUrl,
    });

    return {
      definitions: bundle.flows || [],
      normalizedAuthoringMode: 'json' as const,
    };
  }

  if (input.accessMode === 'api') {
    const generatedApiBundle = buildApiGuideFlowBundleFromDescription(content, {
      connectorBaseUrl: input.connectorBaseUrl,
      processName: input.processName,
      processCode: input.processCode,
    });

    validateGeneratedApiBundle(generatedApiBundle, input.connectorBaseUrl);

    return {
      definitions: generatedApiBundle.flows || [],
      normalizedAuthoringMode: 'text' as const,
      authoringText: content,
      apiTools: generatedApiBundle.apiTools || [],
    };
  }

  if (input.authoringMode === 'json' || /^[{\[]/.test(content)) {
    throw new BadRequestException('流程定义内容无法解析，请检查 JSON 格式');
  }

  const generatedBundle = buildTextGuideFlowBundleFromDescription(content, {
    connectorBaseUrl: input.connectorBaseUrl,
    processName: input.processName,
    processCode: input.processCode,
  });
  const finalizedBundle = input.accessMode === 'url'
    ? applyGuideAccessMode(generatedBundle, {
        accessMode: input.accessMode,
        connectorBaseUrl: input.connectorBaseUrl,
      })
    : generatedBundle;

  validateGeneratedFlowBundle(finalizedBundle, {
    accessMode: input.accessMode,
    connectorBaseUrl: input.connectorBaseUrl,
  });

  return {
    definitions: finalizedBundle.flows || [],
    normalizedAuthoringMode: 'text' as const,
    authoringText: content,
  };
}

function buildTextGuideFlowBundleFromDescription(
  guideText: string,
  input: {
    connectorBaseUrl?: string | null;
    processName?: string;
    processCode?: string;
  },
) {
  const parsedDocument = parseStructuredTextGuideDocument(guideText);
  if (!parsedDocument) {
    return {
      flows: [buildTextGuideFlowFromStepLines({
        processName: (input.processName || '流程').trim() || '流程',
        processCode: normalizeProcessCode(input.processCode),
        stepSource: guideText,
        connectorBaseUrl: input.connectorBaseUrl,
      })],
    };
  }

  const defaultProcessName = (input.processName || '流程').trim() || '流程';
  const basePlatformConfig = {
    businessBaseUrl: input.connectorBaseUrl,
    targetBaseUrl: input.connectorBaseUrl,
    ...(parsedDocument.platformConfig || {}),
  };

  return {
    flows: parsedDocument.flows.map((flow, index) => buildTextGuideFlowFromStepLines({
      processName: flow.processName || `${defaultProcessName}_${index + 1}`,
      processCode: normalizeProcessCode(flow.processCode) || normalizeProcessCode(input.processCode),
      description: flow.description,
      stepSource: [...parsedDocument.sharedSteps, ...flow.steps],
      fieldDefinitions: flow.fields,
      testData: flow.testData,
      connectorBaseUrl: input.connectorBaseUrl,
      platformConfig: {
        ...basePlatformConfig,
        ...(flow.platformConfig || {}),
      },
    })),
  };
}

function buildApiGuideFlowBundleFromDescription(
  guideText: string,
  input: {
    connectorBaseUrl?: string | null;
    processName?: string;
    processCode?: string;
  },
) {
  const parsedDocument = parseStructuredTextGuideDocument(guideText);
  const defaultProcessName = (input.processName || '流程').trim() || '流程';
  const flowDocument = parsedDocument?.flows?.[0] || null;
  const fields: Array<Record<string, any>> = [];
  const fieldKeyByLabel = new Map<string, string>();
  const normalizedTestData = hydrateGuideFieldDefinitions({
    fields,
    fieldKeyByLabel,
    fieldDefinitions: flowDocument?.fields,
    testData: flowDocument?.testData,
  });

  const apiConfig = parseApiGuideConfig(guideText, {
    connectorBaseUrl: input.connectorBaseUrl,
    fallbackProcessName: flowDocument?.processName || defaultProcessName,
    fallbackProcessCode: flowDocument?.processCode || input.processCode,
  });

  const processName = apiConfig.processName
    || flowDocument?.processName
    || defaultProcessName;
  const processCode = normalizeProcessCode(
    apiConfig.processCode
    || flowDocument?.processCode
    || input.processCode,
  ) || toProcessCode(processName);
  const description = apiConfig.description
    || flowDocument?.description
    || '根据流程库 API 模板自动生成的接口流程';

  for (const field of fields) {
    if (field.type === 'file' && field.multiple === undefined) {
      field.multiple = true;
    }
  }

  const apiTools = buildManualApiTools({
    processCode,
    processName,
    fields,
    apiConfig,
    sampleData: normalizedTestData,
  });

  return {
    flows: [{
      processCode,
      processName,
      description,
      fields,
      platform: {
        ...(apiConfig.baseUrl ? {
          businessBaseUrl: apiConfig.baseUrl,
          targetBaseUrl: apiConfig.baseUrl,
        } : {}),
      },
      metadata: {
        accessMode: 'api',
        sourceType: 'api_manual',
        ...(Object.keys(normalizedTestData).length > 0
          ? {
              textTemplate: {
                sampleData: normalizedTestData,
              },
            }
          : {}),
        manualApi: {
          baseUrl: apiConfig.baseUrl || undefined,
          tools: apiTools.map((tool) => ({
            category: tool.category,
            toolName: tool.toolName,
            apiEndpoint: tool.apiEndpoint,
            httpMethod: tool.httpMethod,
            headers: tool.headers || {},
            bodyTemplate: tool.bodyTemplate || null,
            paramMapping: tool.paramMapping,
            responseMapping: tool.responseMapping,
          })),
        },
      },
    }],
    apiTools,
  };
}

function validateGeneratedApiBundle(
  bundle: {
    flows?: Array<Record<string, any>>;
    apiTools?: ProcessLibraryApiToolDefinition[];
  },
  connectorBaseUrl?: string | null,
) {
  const definitions = parseRpaFlowDefinitions(bundle);
  if (definitions.length === 0 || !Array.isArray(bundle.flows) || bundle.flows.length === 0) {
    throw new BadRequestException('未识别出可执行的 API 流程定义');
  }

  const apiTools = Array.isArray(bundle.apiTools) ? bundle.apiTools : [];
  const submitTool = apiTools.find((tool) => tool.category === 'submit');
  if (!submitTool) {
    throw new BadRequestException('API 流程至少需要提供一个提交接口');
  }

  for (const tool of apiTools) {
    if (!tool.apiEndpoint || !/^https?:\/\//i.test(tool.apiEndpoint)) {
      throw new BadRequestException('API 接口地址必须是完整可访问的 URL');
    }
  }

  const flow = bundle.flows[0];
  const platformBaseUrl = String(
    flow?.platform?.businessBaseUrl
    || flow?.platform?.targetBaseUrl
    || connectorBaseUrl
    || '',
  ).trim();
  if (!platformBaseUrl) {
    throw new BadRequestException('API 流程需要填写系统网址，或所属连接器本身具备系统网址');
  }
}

function parseApiGuideConfig(
  guideText: string,
  input: {
    connectorBaseUrl?: string | null;
    fallbackProcessName?: string;
    fallbackProcessCode?: string;
  },
) {
  const lines = guideText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result: {
    processName?: string;
    processCode?: string;
    description?: string;
    baseUrl?: string;
    submitEndpoint?: { method: string; url: string };
    queryEndpoint?: { method: string; url: string };
    submitSuccessPath?: string;
    queryStatusPath?: string;
  } = {
    processName: input.fallbackProcessName,
    processCode: input.fallbackProcessCode,
    baseUrl: input.connectorBaseUrl || undefined,
  };

  for (const line of lines) {
    const flowHeader = parseGuideFlowHeader(line);
    if (flowHeader) {
      result.processName = flowHeader.processName;
      continue;
    }

    const explicitProcessCode = parseGuideProcessCodeLine(line);
    if (explicitProcessCode) {
      result.processCode = explicitProcessCode;
      continue;
    }

    const description = parseGuideDescriptionLine(line);
    if (description) {
      result.description = description;
      continue;
    }

    const submitEndpoint = parseGuideNamedApiEndpoint(line, [
      '提交接口',
      '提交地址',
      '提交 API',
      '提交API',
      '提交端点',
      '发送接口',
      '发送地址',
      '申请接口',
      '申请地址',
    ], 'POST', result.baseUrl);
    if (submitEndpoint) {
      result.submitEndpoint = submitEndpoint;
      continue;
    }

    const queryEndpoint = parseGuideNamedApiEndpoint(line, [
      '查询接口',
      '查询地址',
      '查询 API',
      '查询API',
      '状态接口',
      '状态查询接口',
      '状态地址',
      '结果查询接口',
    ], 'GET', result.baseUrl);
    if (queryEndpoint) {
      result.queryEndpoint = queryEndpoint;
      continue;
    }

    const baseUrl = parseGuideApiBaseUrl(line);
    if (baseUrl) {
      result.baseUrl = baseUrl;
      continue;
    }

    const submitSuccessPath = parseGuideNamedPathValue(line, [
      '提交成功字段',
      '成功字段',
      '提交结果字段',
      '提交成功标志',
    ]);
    if (submitSuccessPath) {
      result.submitSuccessPath = submitSuccessPath;
      continue;
    }

    const queryStatusPath = parseGuideNamedPathValue(line, [
      '状态字段',
      '查询状态字段',
      '审批状态字段',
      '结果状态字段',
    ]);
    if (queryStatusPath) {
      result.queryStatusPath = queryStatusPath;
    }
  }

  if (result.baseUrl && result.submitEndpoint && !/^https?:\/\//i.test(result.submitEndpoint.url)) {
    result.submitEndpoint.url = resolveApiUrl(result.baseUrl, result.submitEndpoint.url);
  }

  if (result.baseUrl && result.queryEndpoint && !/^https?:\/\//i.test(result.queryEndpoint.url)) {
    result.queryEndpoint.url = resolveApiUrl(result.baseUrl, result.queryEndpoint.url);
  }

  return result;
}

function buildManualApiTools(input: {
  processCode: string;
  processName: string;
  fields: Array<Record<string, any>>;
  apiConfig: ReturnType<typeof parseApiGuideConfig>;
  sampleData?: Record<string, string>;
}): ProcessLibraryApiToolDefinition[] {
  const tools: ProcessLibraryApiToolDefinition[] = [];
  const submitEndpoint = input.apiConfig.submitEndpoint;
  if (submitEndpoint) {
    tools.push({
      toolName: buildManualApiToolName(input.processCode, 'submit'),
      toolDescription: `${input.processName} 提交接口`,
      apiEndpoint: submitEndpoint.url,
      httpMethod: submitEndpoint.method,
      headers: {},
      bodyTemplate: buildManualApiBodyTemplate(input.fields, submitEndpoint.method),
      paramMapping: {},
      responseMapping: {
        success: input.apiConfig.submitSuccessPath || 'success',
        data: 'data',
        message: 'message',
        id: 'id',
        submissionId: 'submissionId',
      },
      category: 'submit',
      flowCode: input.processCode,
      testInput: buildManualApiTestInput(input.fields, input.sampleData),
    });
  }

  const queryEndpoint = input.apiConfig.queryEndpoint;
  if (queryEndpoint) {
    tools.push({
      toolName: buildManualApiToolName(input.processCode, 'query'),
      toolDescription: `${input.processName} 状态查询接口`,
      apiEndpoint: queryEndpoint.url,
      httpMethod: queryEndpoint.method,
      headers: {},
      bodyTemplate: ['POST', 'PUT', 'PATCH'].includes(queryEndpoint.method.toUpperCase())
        ? {
            submissionId: '{{submissionId}}',
          }
        : null,
      paramMapping: {},
      responseMapping: {
        status: input.apiConfig.queryStatusPath || 'status',
        data: 'data',
        message: 'message',
      },
      category: 'query',
      flowCode: input.processCode,
      testInput: {
        submissionId: 'OA-DEMO-001',
      },
    });
  }

  return tools;
}

function extractApiToolsFromDefinition(definition: Record<string, any>) {
  const rawTools = Array.isArray(definition?.metadata?.manualApi?.tools)
    ? definition.metadata.manualApi.tools as Array<Record<string, any>>
    : [];

  return rawTools
    .map((tool, index) => {
      const category = String(tool?.category || '').trim().toLowerCase();
      if (category !== 'submit' && category !== 'query') {
        return null;
      }

      const apiEndpoint = String(tool?.apiEndpoint || tool?.url || '').trim();
      const httpMethod = String(tool?.httpMethod || tool?.method || (category === 'submit' ? 'POST' : 'GET')).trim().toUpperCase();
      if (!apiEndpoint) {
        return null;
      }

      const processCode = normalizeProcessCode(definition.processCode) || toProcessCode(String(definition.processName || 'api_process'));
      return {
        toolName: String(tool?.toolName || buildManualApiToolName(processCode, category)),
        toolDescription: String(
          tool?.toolDescription
          || `${definition.processName || processCode} ${category === 'submit' ? '提交接口' : '状态查询接口'}`,
        ),
        apiEndpoint,
        httpMethod,
        headers: tool?.headers && typeof tool.headers === 'object' ? tool.headers as Record<string, string> : {},
        bodyTemplate: tool?.bodyTemplate && typeof tool.bodyTemplate === 'object' ? tool.bodyTemplate as Record<string, any> : null,
        paramMapping: tool?.paramMapping && typeof tool.paramMapping === 'object' ? tool.paramMapping as Record<string, any> : {},
        responseMapping: tool?.responseMapping && typeof tool.responseMapping === 'object' ? tool.responseMapping as Record<string, any> : {},
        category,
        flowCode: processCode,
      } satisfies ProcessLibraryApiToolDefinition;
    })
    .filter(Boolean) as ProcessLibraryApiToolDefinition[];
}

function buildManualApiToolName(processCode: string, category: 'submit' | 'query') {
  return `manual_${processCode}_${category}`;
}

function buildManualApiBodyTemplate(fields: Array<Record<string, any>>, method: string) {
  if (!['POST', 'PUT', 'PATCH'].includes(String(method || '').toUpperCase())) {
    return null;
  }

  if (!Array.isArray(fields) || fields.length === 0) {
    return null;
  }

  const body: Record<string, any> = {};
  for (const field of fields) {
    const key = String(field?.key || '').trim();
    if (!key) {
      continue;
    }

    body[key] = String(field?.type || '').trim().toLowerCase() === 'file'
      ? '{{attachments}}'
      : `{{${key}}}`;
  }
  return Object.keys(body).length > 0 ? body : null;
}

function buildManualApiTestInput(
  fields: Array<Record<string, any>>,
  sampleData?: Record<string, string>,
) {
  const result: Record<string, any> = {};

  for (const field of fields) {
    const key = String(field?.key || '').trim();
    if (!key) {
      continue;
    }

    const example = String(sampleData?.[key] || field?.example || '').trim();
    if (example) {
      result[key] = example;
      continue;
    }

    const type = String(field?.type || '').trim().toLowerCase();
    if (type === 'file') {
      result[key] = [{
        fileName: 'demo.pdf',
        content: '<base64>',
      }];
      continue;
    }

    if (type === 'date') {
      result[key] = '2026-04-19';
      continue;
    }

    result[key] = `示例${field?.label || key}`;
  }

  return result;
}

function validateGeneratedFlowBundle(
  bundle: { flows?: Array<Record<string, any>> },
  input?: {
    accessMode?: ProcessLibraryAccessMode;
    connectorBaseUrl?: string | null;
  },
) {
  const definitions = parseRpaFlowDefinitions(bundle);
  if (definitions.length === 0 || !Array.isArray(bundle.flows) || bundle.flows.length === 0) {
    throw new BadRequestException('未识别出可执行的流程定义');
  }

  for (const flow of bundle.flows) {
    const submitSteps = flow?.actions?.submit?.steps;
    const preflightSteps = flow?.runtime?.preflight?.steps;
    const hasUrlRuntime = input?.accessMode === 'url'
      && Array.isArray(preflightSteps)
      && preflightSteps.length > 0
      && typeof flow?.runtime?.networkSubmit?.url === 'string'
      && flow.runtime.networkSubmit.url.trim();

    if ((!Array.isArray(submitSteps) || submitSteps.length === 0) && !hasUrlRuntime) {
      throw new BadRequestException(
        input?.accessMode === 'url'
          ? '链接直达流程定义必须包含网络提交定义'
          : '流程定义必须包含可执行的提交步骤',
      );
    }

    const stepsToValidate = Array.isArray(submitSteps) && submitSteps.length > 0
      ? submitSteps
      : preflightSteps;
    const invalidStep = Array.isArray(stepsToValidate)
      ? stepsToValidate.find((step) => !VALID_RPA_STEP_TYPES.has(String(step?.type || '').trim().toLowerCase()))
      : null;
    if (invalidStep) {
      throw new BadRequestException('流程中包含当前不支持的步骤类型');
    }

    if (input?.accessMode === 'url' && !hasDirectLinkNavigationContext(flow, input.connectorBaseUrl)) {
      throw new BadRequestException('链接直达（URL）模板必须至少包含一个可访问链接（如系统网址、流程页面或步骤中的 URL）');
    }
  }
}

function hasDirectLinkNavigationContext(
  flow: Record<string, any>,
  connectorBaseUrl?: string | null,
) {
  const platform = flow?.platform && typeof flow.platform === 'object'
    ? flow.platform as Record<string, any>
    : {};
  const portalSsoBridge = platform.portalSsoBridge && typeof platform.portalSsoBridge === 'object'
    ? platform.portalSsoBridge as Record<string, any>
    : {};

  const hasPlatformUrl = [
    platform.entryUrl,
    platform.jumpUrlTemplate,
    platform.businessBaseUrl,
    platform.targetBaseUrl,
    portalSsoBridge.portalUrl,
    connectorBaseUrl,
  ].some((value) => /^https?:\/\//i.test(String(value || '').trim()));
  if (hasPlatformUrl) {
    return true;
  }

  const actions = flow?.actions && typeof flow.actions === 'object'
    ? flow.actions as Record<string, any>
    : {};
  const runtime = flow?.runtime && typeof flow.runtime === 'object'
    ? flow.runtime as Record<string, any>
    : {};
  const stepGroups = [actions.submit?.steps, actions.queryStatus?.steps, runtime.preflight?.steps]
    .filter(Array.isArray)
    .flat() as Array<Record<string, any>>;

  return stepGroups.some((step) =>
    String(step?.type || '').trim().toLowerCase() === 'goto'
    && /^https?:\/\//i.test(String(step?.value || '').trim()),
  );
}

function buildTextGuideFlowFromStepLines(input: {
  processName: string;
  processCode?: string;
  description?: string;
  stepSource: string | string[];
  fieldDefinitions?: Array<{
    label?: string;
    fieldKey?: string;
    type?: string;
    required?: boolean;
    description?: string;
    example?: string;
    multiple?: boolean;
    selector?: string;
    id?: string;
    name?: string;
    placeholder?: string;
    requestFieldName?: string;
    requestPatches?: Array<Record<string, any>>;
    options?: Array<{ label?: string; value?: string } | string>;
    uiHints?: Record<string, any>;
  }>;
  testData?: Record<string, any>;
  connectorBaseUrl?: string | null;
  platformConfig?: Record<string, any>;
}) {
  const lines = normalizeGuideStepLines(input.stepSource);
  if (lines.length === 0) {
    throw new BadRequestException('请先填写流程文字模板');
  }

  const entryUrl = resolveGuideEntryUrl({
    platformConfig: input.platformConfig,
    connectorBaseUrl: input.connectorBaseUrl,
  });
  const processName = input.processName.trim() || '流程';
  const processCode = normalizeProcessCode(input.processCode) || toProcessCode(processName);
  const steps: Array<Record<string, any>> = [];
  const fields: Array<Record<string, any>> = [];
  const fieldKeyByLabel = new Map<string, string>();
  let successText: string | undefined;
  const normalizedTestData = hydrateGuideFieldDefinitions({
    fields,
    fieldKeyByLabel,
    fieldDefinitions: input.fieldDefinitions,
    testData: input.testData,
  });

  if (entryUrl) {
    steps.push({
      type: 'goto',
      value: entryUrl,
      description: '打开入口页面',
    });
  }

  for (const line of lines) {
    const urlMatch = line.match(/https?:\/\/\S+/i);
    if (urlMatch) {
      steps.push({
        type: 'goto',
        value: urlMatch[0],
        description: line,
      });
      continue;
    }

    const waitMatch = line.match(/^(?:等待|停留)\s*(\d+)\s*(秒|毫秒|ms)?$/u);
    if (waitMatch) {
      const amount = Number(waitMatch[1]);
      const unit = (waitMatch[2] || '秒').toLowerCase();
      steps.push({
        type: 'wait',
        timeoutMs: unit === '毫秒' || unit === 'ms' ? amount : amount * 1000,
        description: line,
      });
      continue;
    }

    const inputMatch = parseGuideInstruction(line, ['输入', '填写', '填入', '录入']);
    if (inputMatch) {
      const authKind = detectAuthCredentialFieldKind({ label: inputMatch.label })
        || (/^(用户名|用户账号|登录账号|登录用户名|登录工号|username|login name|login id)$/i.test(inputMatch.label)
          ? 'username'
          : null);
      const fieldKey = authKind
        ? undefined
        : ensureGuideField(
            fields,
            fieldKeyByLabel,
            inputMatch.label,
            inferFieldType(inputMatch.label, inputMatch.value),
          );
      const field = fieldKey ? fields.find((item) => item.key === fieldKey) : null;
      if (field && inputMatch.description && !field.description) {
        field.description = inputMatch.description;
      }
      if (field && inputMatch.example && !field.example) {
        field.example = inputMatch.example;
      }
      steps.push({
        type: 'input',
        fieldKey,
        value: authKind ? buildAuthCredentialPlaceholder(authKind) : inputMatch.value,
        target: {
          kind: 'text',
          value: inputMatch.label,
          label: inputMatch.label,
        },
        description: line,
      });
      continue;
    }

    const selectMatch = parseGuideInstruction(line, ['选择', '选中']);
    if (selectMatch) {
      if (!selectMatch.value) {
        steps.push({
          type: 'click',
          target: {
            kind: 'text',
            value: selectMatch.label,
            label: selectMatch.label,
          },
          description: line,
        });
        continue;
      }

      const fieldKey = ensureGuideField(fields, fieldKeyByLabel, selectMatch.label, 'select');
      const field = fields.find((item) => item.key === fieldKey);
      if (field && selectMatch.description && !field.description) {
        field.description = selectMatch.description;
      }
      if (field && selectMatch.example && !field.example) {
        field.example = selectMatch.example;
      }
      steps.push({
        type: 'select',
        fieldKey,
        value: selectMatch.value,
        target: {
          kind: 'text',
          value: selectMatch.label,
          label: selectMatch.label,
        },
        description: line,
      });
      continue;
    }

    const uploadMatch = parseGuideInstruction(line, ['上传', '附加', '添加附件']);
    if (uploadMatch) {
      const fieldKey = ensureGuideField(fields, fieldKeyByLabel, uploadMatch.label, 'file');
      const field = fields.find((item) => item.key === fieldKey);
      if (field && uploadMatch.description && !field.description) {
        field.description = uploadMatch.description;
      }
      if (field && uploadMatch.example && !field.example) {
        field.example = uploadMatch.example;
      }
      steps.push({
        type: 'upload',
        fieldKey,
        target: {
          kind: 'text',
          value: uploadMatch.label,
          label: uploadMatch.label,
        },
        description: line,
      });
      continue;
    }

    const successMatch = line.match(/^(?:看到|出现|显示)\s+["“]?(.+?)["”]?(?:\s*(?:就|即|则)?(?:结束|成功|完成))?$/u);
    if (successMatch) {
      successText = successMatch[1]?.trim() || successText;
      continue;
    }

    const clickTarget = parseGuideClickInstruction(line);
    if (clickTarget) {
      steps.push({
        type: 'click',
        target: {
          kind: 'text',
          value: clickTarget,
          label: clickTarget,
        },
        description: line,
      });
      continue;
    }

    const label = normalizeGuideLabel(line);
    steps.push({
      type: 'click',
      target: {
        kind: 'text',
        value: label,
        label,
      },
      description: line,
    });
  }

  if (steps.length === 0) {
    throw new BadRequestException('未从文字模板中识别出可执行动作');
  }

  return {
    processCode,
    processName,
    description: input.description?.trim() || '根据流程库文字模板自动生成的页面流程',
    fields,
    ...(Object.keys(normalizedTestData).length > 0
      ? {
          metadata: {
            textTemplate: {
              sampleData: normalizedTestData,
            },
          },
        }
      : {}),
    actions: {
      submit: {
        steps,
        ...(successText
          ? {
              successAssert: {
                type: 'text',
                value: successText,
              },
            }
          : {}),
      },
    },
    platform: {
      ...(entryUrl ? { entryUrl } : {}),
      ...(input.platformConfig?.businessBaseUrl ? { businessBaseUrl: input.platformConfig.businessBaseUrl } : {}),
      ...(input.platformConfig?.targetBaseUrl ? { targetBaseUrl: input.platformConfig.targetBaseUrl } : {}),
      ...(input.platformConfig?.targetSystem ? { targetSystem: input.platformConfig.targetSystem } : {}),
      ...(input.platformConfig?.jumpUrlTemplate ? { jumpUrlTemplate: input.platformConfig.jumpUrlTemplate } : {}),
      ...(input.platformConfig?.ticketBrokerUrl ? { ticketBrokerUrl: input.platformConfig.ticketBrokerUrl } : {}),
    },
    runtime: {
      executorMode: normalizeExecutorModeValue(input.platformConfig?.executorMode) || 'browser',
      browserProvider: 'playwright',
      headless: false,
      snapshotMode: 'structured-text',
    },
  };
}

function applyGuideAccessMode(
  bundle: { flows?: Array<Record<string, any>> },
  input: {
    accessMode: ProcessLibraryAccessMode;
    connectorBaseUrl?: string | null;
  },
) {
  if (!Array.isArray(bundle.flows) || bundle.flows.length === 0 || input.accessMode !== 'url') {
    return bundle;
  }

  return {
    ...bundle,
    flows: bundle.flows.map((flow) => {
      const metadata = flow?.metadata && typeof flow.metadata === 'object'
        ? { ...(flow.metadata as Record<string, any>) }
        : {};
      const platform = flow?.platform && typeof flow.platform === 'object'
        ? { ...(flow.platform as Record<string, any>) }
        : {};

      if (!platform.businessBaseUrl && input.connectorBaseUrl) {
        platform.businessBaseUrl = input.connectorBaseUrl;
      }
      if (!platform.targetBaseUrl && input.connectorBaseUrl) {
        platform.targetBaseUrl = input.connectorBaseUrl;
      }

      return {
        ...buildDirectLinkRuntimeFlow({
          ...flow,
          platform,
        }),
        accessMode: 'direct_link',
        sourceType: 'direct_link',
        description: flow?.description || '根据流程库 URL 模板自动生成的页面流程',
        metadata: {
          ...metadata,
          accessMode: 'direct_link',
          sourceType: 'direct_link',
        },
      };
    }),
  };
}

function buildDirectLinkRuntimeFlow(flow: Record<string, any>) {
  const platform = flow?.platform && typeof flow.platform === 'object'
    ? { ...(flow.platform as Record<string, any>) }
    : {};
  const runtime = flow?.runtime && typeof flow.runtime === 'object'
    ? { ...(flow.runtime as Record<string, any>) }
    : {};
  const existingNetworkSubmit = runtime.networkSubmit && typeof runtime.networkSubmit === 'object'
    ? { ...(runtime.networkSubmit as Record<string, any>) }
    : {};
  const existingPreflightSteps = Array.isArray(runtime.preflight?.steps)
    ? (runtime.preflight.steps as Array<Record<string, any>>).map((step) => ({ ...step }))
    : [];
  const submitSteps = Array.isArray(flow?.actions?.submit?.steps)
    ? flow.actions.submit.steps as Array<Record<string, any>>
    : [];
  const preflightSteps = existingPreflightSteps.length > 0
    ? existingPreflightSteps
    : buildDirectLinkPreflightSteps(flow, submitSteps);
  const queryStatus = flow?.actions?.queryStatus;
  const inferredJumpUrlTemplate = inferDirectLinkJumpUrlTemplate({
    platform,
    submitSteps,
    preflightSteps,
  });

  return {
    ...flow,
    platform: {
      ...platform,
      ...(!platform.jumpUrlTemplate && inferredJumpUrlTemplate
        ? { jumpUrlTemplate: inferredJumpUrlTemplate }
        : {}),
    },
    ...(queryStatus
      ? {
          actions: {
            queryStatus,
          },
        }
      : {
          actions: undefined,
        }),
    runtime: {
      ...runtime,
      executorMode: 'http',
      browserProvider: runtime.browserProvider || 'playwright',
      headless: false,
      snapshotMode: runtime.snapshotMode || 'structured-text',
      preflight: {
        steps: preflightSteps,
      },
      networkSubmit: {
        url: existingNetworkSubmit.url || '{{preflight.submitCapture.action}}',
        method: existingNetworkSubmit.method || '{{preflight.submitCapture.method}}',
        bodyMode: existingNetworkSubmit.bodyMode || '{{preflight.submitBodyMode}}',
        successMode: existingNetworkSubmit.successMode || 'http2xx',
        completionKind: existingNetworkSubmit.completionKind || inferDirectLinkCompletionKind(submitSteps, preflightSteps),
        headers: {
          Origin: '{{preflight.submitOrigin}}',
          Referer: '{{jumpUrl}}',
          ...((existingNetworkSubmit.headers as Record<string, any> | undefined) || {}),
        },
        body: existingNetworkSubmit.body || {
          source: 'preflight.submitFields',
        },
        responseMapping: existingNetworkSubmit.responseMapping,
      },
    },
  };
}

function buildDirectLinkPreflightSteps(
  flow: Record<string, any>,
  submitSteps: Array<Record<string, any>>,
) {
  const triggerIndex = findDirectLinkSubmitTriggerIndex(submitSteps);
  const preparationSteps = (triggerIndex >= 0 ? submitSteps.slice(0, triggerIndex) : submitSteps)
    .filter((step) => !['input', 'select'].includes(String(step?.type || '').trim().toLowerCase()))
    .map((step) => ({ ...step }));
  return [
    ...preparationSteps,
    buildDirectLinkCaptureStep(flow, submitSteps[triggerIndex]),
  ];
}

function findDirectLinkSubmitTriggerIndex(steps: Array<Record<string, any>>) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (String(steps[index]?.type || '').trim().toLowerCase() === 'click') {
      return index;
    }
  }

  return -1;
}

function buildDirectLinkCaptureStep(
  flow: Record<string, any>,
  triggerStep?: Record<string, any>,
) {
  const fields = Array.isArray(flow?.fields) ? flow.fields as Array<Record<string, any>> : [];
  const triggerLabel = String(
    triggerStep?.target?.label
    || triggerStep?.target?.value
    || triggerStep?.value
    || inferLastDirectLinkTriggerLabel(flow)
    || '提交',
  ).trim() || '提交';

  return {
    type: 'evaluate',
    builtin: 'capture_form_submit',
    description: `捕获“${triggerLabel}”对应的网络提交请求`,
    options: {
      fieldMappings: fields
        .filter((field) => String(field?.type || '').trim().toLowerCase() !== 'file')
        .map((field) => ({
          fieldKey: field.key,
          fieldType: field.type,
          sources: [field.key, field.label].filter(Boolean),
          ...(Array.isArray(field?.options) && field.options.length > 0
            ? {
                options: field.options.map((option) => ({
                  label: String(option?.label || option?.value || '').trim(),
                  value: String(option?.value || option?.label || '').trim(),
                })).filter((option) => option.label && option.value),
              }
            : {}),
          target: {
            label: field.label,
            ...(typeof field?.selector === 'string' && field.selector.trim()
              ? { selector: field.selector.trim() }
              : {}),
            ...(typeof field?.id === 'string' && field.id.trim()
              ? { id: field.id.trim() }
              : {}),
            ...(typeof field?.type === 'string' && field.type.trim().toLowerCase() === 'file' && typeof field?.id === 'string' && field.id.trim()
              ? { selector: `#${field.id.trim()} .cap4-attach__picker, #${field.id.trim()} .cap4-attach__cnt, #${field.id.trim()}` }
              : {}),
            ...(typeof field?.name === 'string' && field.name.trim()
              ? { name: field.name.trim() }
              : {}),
            ...(typeof field?.placeholder === 'string' && field.placeholder.trim()
              ? { placeholder: field.placeholder.trim() }
              : {}),
          },
        })),
      fileMappings: fields
        .filter((field) => String(field?.type || '').trim().toLowerCase() === 'file')
        .map((field) => ({
          fieldKey: field.key,
          target: {
            label: field.label,
            ...(typeof field?.selector === 'string' && field.selector.trim()
              ? { selector: field.selector.trim() }
              : {}),
            ...(typeof field?.id === 'string' && field.id.trim()
              ? { id: field.id.trim() }
              : {}),
            ...(typeof field?.name === 'string' && field.name.trim()
              ? { name: field.name.trim() }
              : {}),
            ...(typeof field?.requestFieldName === 'string' && field.requestFieldName.trim()
              ? { name: field.requestFieldName.trim() }
              : {}),
            ...(typeof field?.placeholder === 'string' && field.placeholder.trim()
              ? { placeholder: field.placeholder.trim() }
              : {}),
          },
        })),
      trigger: {
        text: triggerLabel,
        exact: true,
      },
      output: {
        captureKey: 'submitCapture',
        fieldsKey: 'submitFields',
        csrfKey: 'csrfToken',
        filledFieldsKey: 'filledFields',
        captureEventCountKey: 'captureEventCount',
        bodyModeKey: 'submitBodyMode',
        originKey: 'submitOrigin',
        attachmentFieldMapKey: 'attachmentFieldMap',
        headersKey: 'submitRequestHeaders',
        rawBodyKey: 'submitRawBody',
      },
    },
  };
}

function inferLastDirectLinkTriggerLabel(flow: Record<string, any>) {
  const preflightSteps = Array.isArray(flow?.runtime?.preflight?.steps)
    ? flow.runtime.preflight.steps as Array<Record<string, any>>
    : [];
  const captureStep = [...preflightSteps].reverse().find((step) => String(step?.builtin || '').trim() === 'capture_form_submit');
  return String(captureStep?.options?.trigger?.text || '').trim() || undefined;
}

function inferDirectLinkJumpUrlTemplate(input: {
  platform: Record<string, any>;
  submitSteps: Array<Record<string, any>>;
  preflightSteps: Array<Record<string, any>>;
}) {
  const businessOrigin = tryGetUrlOrigin(
    input.platform.businessBaseUrl,
    input.platform.targetBaseUrl,
    input.platform.targetSystem,
  );
  const entryUrl = String(input.platform.entryUrl || '').trim();
  const stepUrls = collectDirectLinkStepUrls([
    ...input.submitSteps,
    ...input.preflightSteps,
  ]);

  if (stepUrls.length === 0) {
    return undefined;
  }

  if (businessOrigin) {
    const matchedBusinessUrl = [...stepUrls]
      .reverse()
      .find((value) => safeSameOrigin(value, businessOrigin));
    if (matchedBusinessUrl) {
      return matchedBusinessUrl;
    }
  }

  const matchedBusinessPath = [...stepUrls]
    .reverse()
    .find((value) => {
      const normalized = normalizeDirectLinkStepUrl(value);
      if (!normalized) {
        return false;
      }
      if (entryUrl && normalized === entryUrl) {
        return false;
      }
      return !safeSameOrigin(normalized, entryUrl);
    });
  if (matchedBusinessPath) {
    return matchedBusinessPath;
  }

  return stepUrls[stepUrls.length - 1];
}

function collectDirectLinkStepUrls(steps: Array<Record<string, any>>) {
  return steps
    .filter((step) => String(step?.type || '').trim().toLowerCase() === 'goto')
    .map((step) => normalizeDirectLinkStepUrl(step?.value))
    .filter((value): value is string => Boolean(value));
}

function normalizeDirectLinkStepUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) {
    return undefined;
  }
  return raw;
}

function tryGetUrlOrigin(...values: unknown[]) {
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) {
      continue;
    }
    try {
      return new URL(raw).origin;
    } catch {
      continue;
    }
  }
  return undefined;
}

function safeSameOrigin(left: string, right: string) {
  if (!left || !right) {
    return false;
  }
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return left === right;
  }
}

function inferDirectLinkCompletionKind(
  submitSteps: Array<Record<string, any>>,
  preflightSteps: Array<Record<string, any>>,
) {
  const clickLabels = [...submitSteps, ...preflightSteps]
    .filter((step) => String(step?.type || '').trim().toLowerCase() === 'click')
    .map((step) => String(step?.target?.label || step?.target?.value || step?.value || '').trim())
    .filter(Boolean);
  const triggerLabel = clickLabels[clickLabels.length - 1] || inferLastDirectLinkTriggerLabel({ runtime: { preflight: { steps: preflightSteps } } }) || '';
  return /保存|草稿|待发/u.test(triggerLabel) ? 'draft' : 'submitted';
}

function parseStructuredTextGuideDocument(guideText: string) {
  const rawLines = guideText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const hasFlowHeader = rawLines.some((line) => Boolean(parseGuideFlowHeader(line)));
  if (!hasFlowHeader) {
    return null;
  }

  const sharedSteps: string[] = [];
  const platformConfig: Record<string, any> = {};
  const flows: Array<{
    processName: string;
    processCode?: string;
    description?: string;
    steps: string[];
    fields: Array<{
      label: string;
      fieldKey?: string;
      type?: string;
      required?: boolean;
      description?: string;
      example?: string;
      multiple?: boolean;
    }>;
    testData: Record<string, string>;
    platformConfig: Record<string, any>;
  }> = [];

  let currentSection:
    | 'preamble'
    | 'global'
    | 'shared'
    | 'flow_steps'
    | 'flow_fields'
    | 'flow_fill_fields'
    | 'flow_upload_fields'
    | 'flow_examples' = 'preamble';
  let currentFlow: {
    processName: string;
    processCode?: string;
    description?: string;
    steps: string[];
    fields: Array<{
      label: string;
      fieldKey?: string;
      type?: string;
      required?: boolean;
      description?: string;
      example?: string;
      multiple?: boolean;
    }>;
    testData: Record<string, string>;
    platformConfig: Record<string, any>;
  } | null = null;

  const flushCurrentFlow = () => {
    if (!currentFlow) {
      return;
    }
    flows.push(currentFlow);
    currentFlow = null;
  };

  for (const line of rawLines) {
    if (isGuideGlobalSectionHeader(line)) {
      flushCurrentFlow();
      currentSection = 'global';
      continue;
    }

    if (isGuideSharedStepsSectionHeader(line)) {
      flushCurrentFlow();
      currentSection = 'shared';
      continue;
    }

    const flowHeader = parseGuideFlowHeader(line);
    if (flowHeader) {
      flushCurrentFlow();
      currentSection = 'flow_steps';
      currentFlow = {
        processName: flowHeader.processName,
        steps: [],
        fields: [],
        testData: {},
        platformConfig: {},
      };
      continue;
    }

    if (/^(?:步骤|步骤列表|办理步骤)\s*[:：]?$/u.test(line)) {
      if (currentFlow) {
        currentSection = 'flow_steps';
      }
      continue;
    }

    if (isGuideFillFieldSectionHeader(line)) {
      if (currentFlow) {
        currentSection = 'flow_fill_fields';
      }
      continue;
    }

    if (isGuideUploadFieldSectionHeader(line)) {
      if (currentFlow) {
        currentSection = 'flow_upload_fields';
      }
      continue;
    }

    if (isGuideFieldSectionHeader(line)) {
      if (currentFlow) {
        currentSection = 'flow_fields';
      }
      continue;
    }

    if (isGuideTestDataSectionHeader(line)) {
      if (currentFlow) {
        currentSection = 'flow_examples';
      }
      continue;
    }

    if (
      (currentSection === 'flow_steps'
        || currentSection === 'flow_fields'
        || currentSection === 'flow_fill_fields'
        || currentSection === 'flow_upload_fields'
        || currentSection === 'flow_examples')
      && currentFlow
    ) {
      const explicitProcessCode = parseGuideProcessCodeLine(line);
      if (explicitProcessCode) {
        currentFlow.processCode = explicitProcessCode;
        continue;
      }

      const description = parseGuideDescriptionLine(line);
      if (description) {
        currentFlow.description = description;
        continue;
      }

      if (tryAssignGuidePlatformConfig(currentFlow.platformConfig, line)) {
        continue;
      }

      if (
        currentSection === 'flow_fields'
        || currentSection === 'flow_fill_fields'
        || currentSection === 'flow_upload_fields'
      ) {
        const fieldDefinition = parseGuideFieldDefinitionLine(
          line,
          currentSection === 'flow_fill_fields'
            ? 'text'
            : (currentSection === 'flow_upload_fields' ? 'file' : undefined),
        );
        if (fieldDefinition) {
          currentFlow.fields.push(fieldDefinition);
        }
        continue;
      }

      if (currentSection === 'flow_examples') {
        const testDataEntry = parseGuideTestDataLine(line);
        if (testDataEntry) {
          currentFlow.testData[testDataEntry.label] = testDataEntry.value;
        }
        continue;
      }

      currentFlow.steps.push(line);
      continue;
    }

    if (tryAssignGuidePlatformConfig(platformConfig, line)) {
      continue;
    }

    sharedSteps.push(line);
  }

  flushCurrentFlow();

  if (flows.length === 0) {
    return null;
  }

  return {
    sharedSteps,
    platformConfig,
    flows,
  };
}

function isGuideFieldSectionHeader(line: string) {
  return /^(?:#{1,6}\s*)?(?:参数|字段)(?:定义)?\s*[:：]?$/u.test(line);
}

function isGuideFillFieldSectionHeader(line: string) {
  return /^(?:#{1,6}\s*)?(?:需要填写的信息|待填写信息|填写信息|需要补充的信息)\s*[:：]?$/u.test(line);
}

function isGuideUploadFieldSectionHeader(line: string) {
  return /^(?:#{1,6}\s*)?(?:需要上传的材料|需要上传的信息|需要上传的文件|上传材料|上传文件|附件材料|附件信息)\s*[:：]?$/u.test(line);
}

function isGuideTestDataSectionHeader(line: string) {
  return /^(?:#{1,6}\s*)?(?:测试样例|测试数据|样例|示例数据)\s*[:：]?$/u.test(line);
}

function isGuideGlobalSectionHeader(line: string) {
  return /^(?:#{1,6}\s*)?全局(?:配置)?\s*[:：]?$/u.test(line);
}

function isGuideSharedStepsSectionHeader(line: string) {
  return /^(?:#{1,6}\s*)?(?:共享步骤|公共步骤|通用步骤)\s*[:：]?$/u.test(line);
}

function parseGuideFlowHeader(line: string) {
  const match = line.match(/^(?:#{1,6}\s*)?流程\s*(?:[:：]\s*|\s+)(.+)$/u);
  if (!match) {
    return null;
  }

  const normalizedName = match[1]
    .replace(/["“”'‘’]/gu, '')
    .trim();

  if (!normalizedName) {
    return null;
  }

  return {
    processName: normalizedName,
  };
}

function parseGuideProcessCodeLine(line: string) {
  const match = line.match(/^(?:流程编码|processCode)\s*[:：]\s*(.+)$/iu);
  if (!match) {
    return null;
  }

  return normalizeProcessCode(match[1]) || null;
}

function parseGuideDescriptionLine(line: string) {
  const match = line.match(/^(?:描述|说明|简介|流程描述|description)\s*[:：]\s*(.+)$/iu);
  if (!match) {
    return null;
  }

  const description = match[1]
    ?.trim()
    ?.replace(/["“”'‘’]/gu, '');
  return description || null;
}

function parseGuideNamedApiEndpoint(
  line: string,
  labels: string[],
  defaultMethod: string,
  baseUrl?: string,
) {
  const match = line.match(new RegExp(`^(?:${labels.map(escapeGuideRegex).join('|')})\\s*[:：]\\s*(.+)$`, 'iu'));
  if (!match) {
    return null;
  }

  const parsed = parseGuideApiEndpointValue(match[1], defaultMethod);
  if (!parsed) {
    return null;
  }

  return {
    method: parsed.method,
    url: baseUrl ? resolveApiUrl(baseUrl, parsed.url) : parsed.url,
  };
}

function parseGuideApiEndpointValue(rawValue: string, defaultMethod: string) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return null;
  }

  const methodMatch = value.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)$/iu);
  if (methodMatch) {
    return {
      method: methodMatch[1].toUpperCase(),
      url: methodMatch[2].trim(),
    };
  }

  const bracketMatch = value.match(/^(\S+)\s*\((GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\)$/iu);
  if (bracketMatch) {
    return {
      method: bracketMatch[2].toUpperCase(),
      url: bracketMatch[1].trim(),
    };
  }

  return {
    method: defaultMethod.toUpperCase(),
    url: value,
  };
}

function parseGuideApiBaseUrl(line: string) {
  const match = line.match(/^(?:系统网址|系统地址|接口域名|接口地址|接口根地址|服务地址|服务根地址|BaseURL|BaseUrl|baseUrl|API域名|API地址|API根地址)\s*[:：]\s*(.+)$/iu);
  if (!match) {
    return null;
  }

  const value = match[1]?.trim();
  return value || null;
}

function parseGuideNamedPathValue(line: string, labels: string[]) {
  const match = line.match(new RegExp(`^(?:${labels.map(escapeGuideRegex).join('|')})\\s*[:：]\\s*(.+)$`, 'iu'));
  if (!match) {
    return null;
  }

  const value = match[1]?.trim();
  return value || null;
}

function resolveApiUrl(baseUrl: string, value: string) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return normalizedValue;
  }
  if (/^https?:\/\//i.test(normalizedValue)) {
    return normalizedValue;
  }
  return new URL(normalizedValue, `${String(baseUrl || '').replace(/\/+$/, '')}/`).toString();
}

function parseGuideFieldDefinitionLine(line: string, forcedType?: string) {
  const normalizedLine = normalizeGuideStructuredLine(line);
  if (!normalizedLine) {
    return null;
  }

  const pipeSegments = normalizedLine
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (normalizedLine.includes('|')) {
    const label = normalizeGuideLabel(pipeSegments[0]);
    if (!label) {
      return null;
    }

    const type = forcedType || pipeSegments
      .map((segment) => normalizeGuideFieldTypeValue(segment))
      .find(Boolean);
    const required = parseGuideRequiredFlag(pipeSegments);
    const description = extractGuideFieldDescription(pipeSegments.slice(1));
    const example = extractGuideFieldExample(pipeSegments.slice(1));

    return {
      label,
      ...(type ? { type } : {}),
      ...(required !== undefined ? { required } : {}),
      ...(description ? { description } : {}),
      ...(example ? { example } : {}),
    };
  }

  const assignmentMatch = normalizedLine.match(/^(.+?)(?:\s*[:：]\s*)(.+)$/u);
  if (assignmentMatch) {
    const label = normalizeGuideLabel(assignmentMatch[1]);
    const tokens = assignmentMatch[2]
      .split(/[|,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!label) {
      return null;
    }

    const type = forcedType || tokens
      .map((token) => normalizeGuideFieldTypeValue(token))
      .find(Boolean);
    const required = parseGuideRequiredFlag(tokens);
    const description = extractGuideFieldDescription(tokens);
    const example = extractGuideFieldExample(tokens);

    return {
      label,
      ...(type ? { type } : {}),
      ...(required !== undefined ? { required } : {}),
      ...(description ? { description } : {}),
      ...(example ? { example } : {}),
    };
  }

  const label = normalizeGuideLabel(normalizedLine);
  if (!label) {
    return null;
  }

  return {
    label,
    ...(forcedType ? { type: forcedType } : {}),
  };
}

function parseGuideTestDataLine(line: string) {
  const normalizedLine = normalizeGuideStructuredLine(line);
  if (!normalizedLine) {
    return null;
  }

  const assignmentMatch = normalizedLine.match(/^(.+?)(?:\s*(?:为|[:：=])\s*)(.+)$/u);
  if (!assignmentMatch) {
    return null;
  }

  const label = normalizeGuideLabel(assignmentMatch[1]);
  const value = assignmentMatch[2]
    ?.trim()
    ?.replace(/["“”'‘’]/gu, '');

  if (!label || !value) {
    return null;
  }

  return { label, value };
}

function extractGuideFieldDescription(tokens: string[]) {
  for (const token of tokens) {
    const match = String(token || '').trim().match(/^(?:说明|解释|描述|含义|用途|description|desc)\s*[:：=]\s*(.+)$/iu);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function extractGuideFieldExample(tokens: string[]) {
  for (const token of tokens) {
    const match = String(token || '').trim().match(/^(?:示例|样例|例子|参考值|example|sample)\s*[:：=]\s*(.+)$/iu);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function normalizeGuideStructuredLine(line: string) {
  return String(line || '')
    .trim()
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[.)、]\s*/, '')
    .trim();
}

function escapeGuideRegex(value: string) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseGuideRequiredFlag(tokens: string[]) {
  const normalizedTokens = tokens.map((token) => token.trim().toLowerCase());
  if (normalizedTokens.some((token) => token === '必填' || token === 'required')) {
    return true;
  }

  if (normalizedTokens.some((token) => token === '选填' || token === 'optional' || token === '可选')) {
    return false;
  }

  return undefined;
}

function normalizeGuideFieldTypeValue(value?: string) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (['text', '文本', '字符串', '单行文本'].includes(normalized)) return 'text';
  if (['textarea', '多行文本', '备注', '说明'].includes(normalized)) return 'textarea';
  if (['date', '日期', '时间', 'datetime'].includes(normalized)) return 'date';
  if (['select', '下拉', '枚举', '选项'].includes(normalized)) return 'select';
  if (['file', '附件', 'upload'].includes(normalized)) return 'file';
  if (['number', '数字', '金额', '整数', '小数'].includes(normalized)) return 'number';
  return undefined;
}

function hydrateGuideFieldDefinitions(input: {
  fields: Array<Record<string, any>>;
  fieldKeyByLabel: Map<string, string>;
  fieldDefinitions?: Array<{
    label?: string;
    fieldKey?: string;
    type?: string;
    required?: boolean;
    description?: string;
    example?: string;
    multiple?: boolean;
    selector?: string;
    id?: string;
    name?: string;
    placeholder?: string;
    requestFieldName?: string;
    requestPatches?: Array<Record<string, any>>;
    options?: Array<{ label?: string; value?: string } | string>;
    uiHints?: Record<string, any>;
  }>;
  testData?: Record<string, any>;
}) {
  const normalizedTestData: Record<string, string> = {};
  const fieldDefinitions = Array.isArray(input.fieldDefinitions) ? input.fieldDefinitions : [];
  const rawTestData = input.testData && typeof input.testData === 'object' ? input.testData : {};

  for (const definition of fieldDefinitions) {
    const label = normalizeGuideLabel(definition.label);
    if (!label) {
      continue;
    }
    if (isAuthCredentialField({ label, key: definition.fieldKey })) {
      continue;
    }

    const sampleValue = rawTestData[label] === undefined ? undefined : String(rawTestData[label]);
    const fieldKey = ensureGuideField(
      input.fields,
      input.fieldKeyByLabel,
      label,
      normalizeGuideFieldTypeValue(definition.type) || inferFieldType(label, sampleValue),
    );
    const field = input.fields.find((item) => item.key === fieldKey);
    if (field && definition.required !== undefined) {
      field.required = definition.required;
    }
    if (field && definition.description) {
      field.description = String(definition.description).trim();
    }
    if (field && definition.example) {
      field.example = String(definition.example).trim();
    }
    if (field && definition.multiple !== undefined) {
      field.multiple = Boolean(definition.multiple);
    }
    if (field && typeof definition.selector === 'string' && definition.selector.trim()) {
      field.selector = definition.selector.trim();
    }
    if (field && typeof definition.id === 'string' && definition.id.trim()) {
      field.id = definition.id.trim();
    }
    if (field && typeof definition.name === 'string' && definition.name.trim()) {
      field.name = definition.name.trim();
    }
    if (field && typeof definition.placeholder === 'string' && definition.placeholder.trim()) {
      field.placeholder = definition.placeholder.trim();
    }
    if (field && typeof definition.requestFieldName === 'string' && definition.requestFieldName.trim()) {
      field.requestFieldName = definition.requestFieldName.trim();
    }
    if (field && Array.isArray(definition.requestPatches) && definition.requestPatches.length > 0) {
      field.requestPatches = definition.requestPatches
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({ ...item }));
    }
    if (field && Array.isArray(definition.options) && definition.options.length > 0) {
      field.options = definition.options
        .map((option) => {
          if (typeof option === 'string') {
            const normalized = option.trim();
            return normalized
              ? {
                  label: normalized,
                  value: normalized,
                }
              : null;
          }
          const labelValue = String(option?.label || option?.value || '').trim();
          const optionValue = String(option?.value || option?.label || '').trim();
          return labelValue && optionValue
            ? {
                label: labelValue,
                value: optionValue,
              }
            : null;
        })
        .filter((option): option is { label: string; value: string } => Boolean(option));
    }
    if (field && definition.uiHints && typeof definition.uiHints === 'object' && !Array.isArray(definition.uiHints)) {
      field.uiHints = {
        ...(field.uiHints && typeof field.uiHints === 'object' && !Array.isArray(field.uiHints) ? field.uiHints : {}),
        ...definition.uiHints,
      };
    }
  }

  for (const [rawLabel, rawValue] of Object.entries(rawTestData)) {
    const label = normalizeGuideLabel(rawLabel);
    const value = String(rawValue ?? '').trim();
    if (!label || !value) {
      continue;
    }
    if (isAuthCredentialField({ label })) {
      continue;
    }

    const fieldKey = ensureGuideField(
      input.fields,
      input.fieldKeyByLabel,
      label,
      inferFieldType(label, value),
    );
    const field = input.fields.find((item) => item.key === fieldKey);
    if (field && !field.example) {
      field.example = value;
    }
    normalizedTestData[fieldKey] = value;
  }

  return normalizedTestData;
}

function tryAssignGuidePlatformConfig(target: Record<string, any>, line: string) {
  const match = line.match(/^(入口链接|入口地址|入口URL|入口Url|入口url|打开地址|OA地址|OA 地址|认证入口|登录入口|门户地址|门户首页|系统网址|系统地址|业务系统网址|业务系统地址|流程页面|页面链接|流程链接|目标页面|跳转页面|执行方式|目标系统|跳转链接模板|票据服务地址)\s*[:：]\s*(.+)$/u);
  if (!match) {
    return false;
  }

  const rawKey = match[1].replace(/\s+/g, '');
  const value = match[2]?.trim();
  if (!value) {
    return true;
  }

  if (['入口链接', '入口地址', '入口URL', '入口Url', '入口url', '打开地址', 'OA地址', '认证入口', '登录入口', '门户地址', '门户首页'].includes(rawKey)) {
    target.entryUrl = value;
    return true;
  }

  if (['系统网址', '系统地址', '业务系统网址', '业务系统地址'].includes(rawKey)) {
    target.businessBaseUrl = value;
    target.targetBaseUrl = value;
    return true;
  }

  if (['流程页面', '页面链接', '流程链接', '目标页面', '跳转页面'].includes(rawKey)) {
    target.jumpUrlTemplate = value;
    return true;
  }

  if (rawKey === '执行方式') {
    target.executorMode = normalizeExecutorModeValue(value) || value;
    return true;
  }

  if (rawKey === '目标系统') {
    target.targetSystem = value;
    return true;
  }

  if (rawKey === '跳转链接模板') {
    target.jumpUrlTemplate = value;
    return true;
  }

  if (rawKey === '票据服务地址') {
    target.ticketBrokerUrl = value;
    return true;
  }

  return false;
}

function ensureGuideField(
  fields: Array<Record<string, any>>,
  fieldKeyByLabel: Map<string, string>,
  label: string,
  type: string,
) {
  const existingFieldKey = fieldKeyByLabel.get(label);
  if (existingFieldKey) {
    return existingFieldKey;
  }

  const baseFieldKey = toFieldKey(label, fields.length + 1);
  let fieldKey = baseFieldKey;
  let suffix = 2;

  while (fields.some((field) => field.key === fieldKey)) {
    fieldKey = `${baseFieldKey}_${suffix}`;
    suffix += 1;
  }

  fields.push({
    key: fieldKey,
    label,
    type,
    required: true,
    multiple: type === 'file' ? false : undefined,
  });
  fieldKeyByLabel.set(label, fieldKey);
  return fieldKey;
}

function normalizeGuideStepLines(stepSource: string | string[]) {
  const sourceLines = Array.isArray(stepSource) ? stepSource : stepSource.split(/\r?\n+/);
  return sourceLines
    .flatMap((line) => String(line || '').split(/[；;]+/))
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*•]\s*/, ''))
    .map((line) => line.replace(/^\d+[.)、]\s*/, ''))
    .map((line) => stripGuideLeadWords(line))
    .filter(Boolean);
}

function resolveGuideEntryUrl(input: {
  platformConfig?: Record<string, any>;
  connectorBaseUrl?: string | null;
}) {
  return String(
    input.platformConfig?.entryUrl
    || input.platformConfig?.jumpUrlTemplate
    || input.platformConfig?.targetBaseUrl
    || input.platformConfig?.businessBaseUrl
    || input.connectorBaseUrl
    || '',
  ).trim();
}

function stripGuideLeadWords(value: string) {
  let normalized = value.trim();

  while (/^(先|然后|再|接着|接下来|随后|最后|之后)\s*/u.test(normalized)) {
    normalized = normalized.replace(/^(先|然后|再|接着|接下来|随后|最后|之后)\s*/u, '').trim();
  }

  return normalized;
}

function parseGuideInstruction(line: string, commands: string[]) {
  const command = commands.find((item) => line.startsWith(item));
  if (!command) {
    return null;
  }

  const rest = line.slice(command.length).trim();
  if (!rest) {
    return null;
  }

  const pipeSegments = rest.split('|').map((segment) => segment.trim()).filter(Boolean);
  const primarySegment = pipeSegments[0] || rest;
  const assignmentMatch = primarySegment.match(/^(.+?)(?:\s*(?:为|填为|输入为|写为|[:：=])\s*)(.+)$/u);
  const label = normalizeGuideLabel(assignmentMatch ? assignmentMatch[1] : primarySegment);
  const value = assignmentMatch?.[2]?.trim() || undefined;
  const description = extractGuideFieldDescription(pipeSegments.slice(1));
  const example = extractGuideFieldExample(pipeSegments.slice(1));

  if (!label) {
    return null;
  }

  return { label, value, description, example };
}

function parseGuideClickInstruction(line: string) {
  const commands = ['点击', '单击', '打开', '进入', '提交', '确认'];
  const command = commands.find((item) => line.startsWith(item));
  if (!command) {
    return null;
  }

  const rest = line.slice(command.length).trim();
  const label = normalizeGuideLabel(rest || command);
  return label || command;
}

function normalizeGuideLabel(value?: string | null) {
  return String(value || '')
    .replace(/["“”'‘’]/gu, '')
    .replace(/^(?:请先|请)\s+/u, '')
    .replace(/(按钮|菜单|链接|页面|页签|输入框|字段)$/u, '')
    .trim();
}

function inferFieldType(label: string, sampleValue?: string) {
  const text = `${label} ${sampleValue || ''}`.toLowerCase();
  if (text.includes('日期') || text.includes('时间') || /\d{4}-\d{1,2}-\d{1,2}/.test(text)) return 'date';
  if (looksLikeAttachmentField(text)) return 'file';
  if (looksLikeNumericField(text)) return 'number';
  if (text.includes('原因') || text.includes('说明') || text.includes('备注') || text.includes('内容') || text.includes('事由')) return 'textarea';
  return 'text';
}

function looksLikeAttachmentField(text: string) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(附件|证明|材料|文件|扫描件|图片|照片|pdf|doc|docx|zip|rar|upload|file)/.test(normalized);
}

function looksLikeNumericField(text: string) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(金额|数量|份数|次数|天数|学分|price|amount|count|number|qty)/.test(normalized);
}

function toFieldKey(label: string, index: number) {
  const ascii = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ascii || `field_${index}`;
}

function toProcessCode(name: string) {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (ascii) {
    return ascii;
  }

  const stableSuffix = createHash('sha1')
    .update(String(name || '').trim() || 'process_library_flow')
    .digest('hex')
    .slice(0, 8);
  return `flow_${stableSuffix}`;
}

function normalizeProcessCode(value?: string) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || undefined;
}

function normalizeExecutorModeValue(value?: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['browser', 'local', 'http', 'stub'].includes(normalized)) {
    return normalized;
  }
  return undefined;
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

  return accessMode === 'direct_link'
    || sourceType === 'direct_link'
    || hasNetworkRequest(definition.runtime?.networkSubmit)
    || hasNetworkRequest(definition.runtime?.networkStatus);
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
