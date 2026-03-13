import { Logger } from '@nestjs/common';
import { BaseAgent, AgentContext, AgentConfig, LLMClientFactory, BaseLLMClient } from '@uniflow/agent-kernel';
import { z } from 'zod';

// ============================================================
// Schema Definitions
// ============================================================

export const ParameterSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  description: z.string(),
  in: z.enum(['path', 'query', 'body']).default('body'),
  defaultValue: z.any().optional(),
});

export const EndpointSchema = z.object({
  name: z.string(),
  method: z.string(),
  path: z.string(),
  description: z.string(),
  category: z.enum([
    'submit', 'query', 'cancel', 'urge', 'approve',
    'list', 'get', 'status_query', 'reference_data', 'other',
  ]).default('other'),
  parameters: z.array(ParameterSchema),
  responseMapping: z.record(z.string()).optional(),
  bodyTemplate: z.any().optional(),
});

export const BusinessProcessSchema = z.object({
  processName: z.string(),
  processCode: z.string(),
  category: z.string(),
  description: z.string(),
  endpoints: z.array(EndpointSchema),
});

const ApiAnalyzerInputSchema = z.object({
  docContent: z.string(),
  oaUrl: z.string().optional(),
  baseUrl: z.string().optional(),
});

const ApiAnalyzerOutputSchema = z.object({
  processes: z.array(BusinessProcessSchema),
  totalEndpoints: z.number(),
  analyzedModules: z.number(),
});

export type Endpoint = z.infer<typeof EndpointSchema>;
export type BusinessProcess = z.infer<typeof BusinessProcessSchema>;
export type ApiAnalyzerInput = z.infer<typeof ApiAnalyzerInputSchema>;
export type ApiAnalyzerOutput = z.infer<typeof ApiAnalyzerOutputSchema>;

type EndpointParameter = z.infer<typeof ParameterSchema>;

interface EnrichedFormField {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: Array<{ label?: string; value?: string }>;
}

interface EnrichedForm {
  code?: string;
  formCode?: string;
  name?: string;
  category?: string;
  description?: string;
  fields?: EnrichedFormField[];
}

interface OperationSummary {
  path: string;
  method: string;
  summary: string;
  parameters: EndpointParameter[];
  requestBodySchema?: any;
  responseMapping: Record<string, string>;
}

// ============================================================
// LLM Prompt
// ============================================================

const SYSTEM_PROMPT = `你是 OA 系统 API 分析专家。你的任务是从 API 模块中识别出面向普通用户的"办事流程"接口。

办事流程的特征：
- 用户可以发起的业务操作（如请假、报销、发起审批、考勤打卡、预约会议）
- 用户可以查询的业务状态（如我的待办、我的已办、考勤记录、会议列表）
- 用户可以执行的业务动作（如审批通过、撤回申请、催办）

不属于办事流程的：
- 系统管理接口（缓存刷新、配置管理、权限管理）
- 设计器接口（流程设计、表单设计、门户设计）
- 底层数据接口（内部数据操作、底层存储路径操作）
- 监控统计接口（系统级统计、日志查询）
- 第三方集成接口（外部系统同步、消息推送）
- 健康检查接口
- 缓存操作接口
- 文件底层操作（非用户直接使用的文件上传下载）

请返回 JSON 数组，每个元素格式：
{
  "processName": "中文流程名称",
  "processCode": "英文代码（snake_case）",
  "category": "行政/人事/财务/协作",
  "description": "一句话描述该流程的用途",
  "endpoints": [
    {
      "name": "操作名称",
      "method": "POST/GET/PUT/DELETE",
      "path": "完整API路径（保留路径参数占位符如 {id}）",
      "description": "操作描述",
      "category": "端点用途分类",
      "parameters": [
        {
          "name": "参数名",
          "type": "类型（string/number/boolean/array/object）",
          "required": true,
          "description": "说明",
          "in": "参数位置（path/query/body）"
        }
      ],
      "responseMapping": {
        "说明": "从响应 JSON 中提取关键字段的路径映射"
      }
    }
  ]
}

端点 category 分类规则：
- "submit": 发起/提交申请的接口（POST 创建工作、提交表单）
- "query": 查询单个申请详情或状态的接口（GET 获取工作详情）
- "list": 查询列表的接口（GET 我的待办、已办列表）
- "cancel": 撤回/取消申请的接口（DELETE 或 POST 撤回）
- "urge": 催办接口
- "approve": 审批处理接口（PUT/POST 审批通过/驳回）
- "status_query": 查询审批状态/流转日志的接口
- "reference_data": 获取参考数据的接口（人员列表、部门列表、字典数据）
- "other": 其他

参数 in 分类规则：
- "path": 出现在 URL 路径中的参数，如 /api/work/{id} 中的 id
- "query": GET 请求的查询参数，如 ?page=1&size=10
- "body": POST/PUT/PATCH 请求体中的参数

responseMapping 规则：
- 用点号路径表示从响应 JSON 中提取字段
- 必须包含 "success" 字段映射（判断请求是否成功）
- 必须包含 "data" 字段映射（提取核心数据）
- submit 类端点还需要 "id" 映射（提取新创建的记录ID）
- 示例：{ "success": "success", "data": "data", "id": "data.id", "message": "message" }
- 如果响应格式为 { "type": "success", "data": {...} }，则映射为 { "success": "type", "data": "data", "id": "data.id" }
- 如果响应格式为 { "errcode": 0, "result": {...} }，则映射为 { "success": "errcode", "data": "result", "message": "errmsg" }

重要规则：
1. 每个流程应包含 2-5 个最核心的端点，不要把所有端点都列出
2. processCode 使用英文 snake_case
3. 只返回 JSON 数组，不要其他内容
4. 如果某个模块没有办事流程接口，返回空数组 []
5. 每个端点必须包含 category 和 responseMapping
6. 参数的 in 字段必须准确：URL 中 {xxx} 的参数是 path，GET 查询参数是 query，请求体参数是 body`;

// ============================================================
// API Analyzer Agent
// ============================================================

export class ApiAnalyzerAgent extends BaseAgent<ApiAnalyzerInput, ApiAnalyzerOutput> {
  private readonly logger = new Logger(ApiAnalyzerAgent.name);
  private llmClient: BaseLLMClient;

  constructor() {
    const config: AgentConfig = {
      name: 'api-analyzer',
      description: 'Analyze API documentation and identify business process endpoints using LLM',
      inputSchema: ApiAnalyzerInputSchema,
      outputSchema: ApiAnalyzerOutputSchema,
    };
    super(config);
    this.llmClient = LLMClientFactory.createFromEnv();
  }

  protected async run(input: ApiAnalyzerInput, context: AgentContext): Promise<ApiAnalyzerOutput> {
    // docContent 可能是纯 JSON，也可能是 JSON + enrichment 文本（由 enrichWithLiveFormData 追加）
    // 先尝试提取 JSON 部分
    const { jsonDoc, enrichmentText } = this.extractJsonAndText(input.docContent);
    const doc = jsonDoc;
    const allProcesses: BusinessProcess[] = [];

    if (doc.openapi || doc.swagger) {
      // 优先消费 bootstrap enrichment 中的表单模板，避免“统一提交接口 + formCode 区分流程”的 OA 被解析为 0 流程
      const enrichedProcesses = this.buildProcessesFromEnrichedForms(doc, enrichmentText);
      if (enrichedProcesses.length > 0) {
        this.logger.log(`Built ${enrichedProcesses.length} business processes from enriched form metadata`);
        allProcesses.push(...enrichedProcesses);
      } else {
        // 标准 OpenAPI/Swagger 格式：结构化提取参数后交给 LLM 分析
        const processes = await this.analyzeOpenAPI(doc, input.baseUrl, enrichmentText);
        allProcesses.push(...processes);
      }
    } else {
      // 非标准格式：将整个文档内容交给 LLM 分析
      const processes = await this.analyzeRawDoc(input.docContent, input.baseUrl);
      allProcesses.push(...processes);
    }

    const totalEndpoints = allProcesses.reduce((sum, p) => sum + p.endpoints.length, 0);
    this.logger.log(`Total: ${allProcesses.length} business processes, ${totalEndpoints} endpoints`);

    return {
      processes: allProcesses,
      totalEndpoints,
      analyzedModules: Object.keys(doc.paths || {}).length || 1,
    };
  }

  /**
   * 从 docContent 中提取 JSON 和附加的 enrichment 文本
   * enrichWithLiveFormData 会在 JSON 后面追加纯文本，需要分离
   */
  private extractJsonAndText(docContent: string): { jsonDoc: any; enrichmentText: string } {
    try {
      // 先尝试直接解析整个内容
      const doc = JSON.parse(docContent);
      return { jsonDoc: doc, enrichmentText: '' };
    } catch (e) {
      // 解析失败，说明后面有追加文本，找到 JSON 结束位置
      let depth = 0;
      let inString = false;
      let escape = false;
      let jsonEnd = -1;

      for (let i = 0; i < docContent.length; i++) {
        const char = docContent[i];

        if (escape) {
          escape = false;
          continue;
        }

        if (char === '\\') {
          escape = true;
          continue;
        }

        if (char === '"' && !escape) {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (char === '{' || char === '[') {
          depth++;
        } else if (char === '}' || char === ']') {
          depth--;
          if (depth === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }

      if (jsonEnd > 0) {
        const jsonPart = docContent.substring(0, jsonEnd);
        const textPart = docContent.substring(jsonEnd).trim();
        try {
          const doc = JSON.parse(jsonPart);
          return { jsonDoc: doc, enrichmentText: textPart };
        } catch (e2) {
          const parseMessage = e2 instanceof Error ? e2.message : String(e2);
          const extractMessage = e instanceof Error ? e.message : String(e);
          this.logger.error(`Failed to parse extracted JSON: ${parseMessage}`);
          throw new Error(`Invalid JSON in docContent: ${extractMessage}`);
        }
      }

      const extractMessage = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to extract JSON from docContent: ${extractMessage}`);
    }
  }

  /**
   * 非标准格式文档：截断后整体交给 LLM 分析
   */
  private async analyzeRawDoc(docContent: string, baseUrl?: string): Promise<BusinessProcess[]> {
    const maxLen = 40000;
    const truncated = docContent.length > maxLen
      ? docContent.substring(0, maxLen) + '\n... (truncated)'
      : docContent;

    const userPrompt = `请分析以下 API 文档内容，识别其中的办事流程接口：

${truncated}

注意：
- 只选择面向普通用户的办事流程操作
- 每个流程选 2-5 个最核心的端点
- 每个端点必须包含 category（submit/query/list/cancel/urge/approve/status_query/reference_data/other）
- 每个端点必须包含 responseMapping（从响应中提取字段的路径映射）
- 每个参数必须包含 in（path/query/body）`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ], {
        trace: {
          scope: 'worker.api_analyzer.raw_doc',
          metadata: {
            baseUrl: baseUrl || null,
            hasEnrichment: false,
          },
        },
      });

      return this.parseProcessesFromLLM(response.content || '');
    } catch (error: any) {
      this.logger.error(`LLM analysis failed for raw doc: ${error.message}`);
      return [];
    }
  }

  private async analyzeOpenAPI(doc: any, baseUrl?: string, enrichmentText?: string): Promise<BusinessProcess[]> {
    const pathSummary = this.collectOperationSummaries(doc).map((operation) => ({
      path: operation.path,
      method: operation.method,
      summary: operation.summary,
      parameters: operation.parameters,
      responseFields: Object.keys(operation.responseMapping).join(', '),
    }));

    const chunkSize = 50;
    const allProcesses: BusinessProcess[] = [];

    for (let i = 0; i < pathSummary.length; i += chunkSize) {
      const chunk = pathSummary.slice(i, i + chunkSize);
      const enrichmentPrompt = enrichmentText
        ? `\n补充的实时表单模板信息（优先参考）：\n${this.truncateText(enrichmentText, 12000)}\n`
        : '';
      const userPrompt = `请分析以下 API 端点，识别其中的办事流程接口：

${JSON.stringify(chunk, null, 2)}

${enrichmentPrompt}

注意：
- 每个端点必须包含 category（submit/query/list/cancel/urge/approve/status_query/reference_data/other）
- 每个端点必须包含 responseMapping（从响应中提取字段的路径映射）
- 每个参数必须包含 in（path/query/body），参考上面 parameters 中的 in 字段
- 如果提供了 responseFields，请据此推断 responseMapping`;

      try {
        const response = await this.llmClient.chat([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ], {
          trace: {
            scope: 'worker.api_analyzer.openapi_chunk',
            metadata: {
              chunkStart: i,
              chunkSize: chunk.length,
              baseUrl: baseUrl || null,
              hasEnrichment: Boolean(enrichmentText),
            },
          },
        });
        const processes = this.parseProcessesFromLLM(response.content || '');
        allProcesses.push(...processes);
      } catch (error: any) {
        this.logger.error(`LLM analysis failed for OpenAPI chunk: ${error.message}`);
      }
    }

    return allProcesses;
  }

  private buildProcessesFromEnrichedForms(doc: any, enrichmentText: string): BusinessProcess[] {
    const forms = this.extractEnrichedForms(enrichmentText);
    if (forms.length === 0) {
      return [];
    }

    const operations = this.collectOperationSummaries(doc);
    const submitOperation = operations.find((operation) => this.isGenericFormSubmit(operation));
    if (!submitOperation) {
      this.logger.warn('Enriched forms detected, but no generic submit endpoint was found in OpenAPI');
      return [];
    }

    const detailOperation = operations.find((operation) => this.isDetailOperation(operation));
    const listOperation = operations.find((operation) => this.isListOperation(operation));
    const cancelOperation = operations.find((operation) => this.isCancelOperation(operation));
    const approvalOperations = operations
      .filter((operation) => this.isApprovalOperation(operation))
      .slice(0, 2);

    return forms
      .map((form) => this.createProcessFromForm(
        form,
        submitOperation,
        detailOperation,
        listOperation,
        cancelOperation,
        approvalOperations,
      ))
      .filter((process): process is BusinessProcess => !!process);
  }

  private createProcessFromForm(
    form: EnrichedForm,
    submitOperation: OperationSummary,
    detailOperation?: OperationSummary,
    listOperation?: OperationSummary,
    cancelOperation?: OperationSummary,
    approvalOperations: OperationSummary[] = [],
  ): BusinessProcess | null {
    const formCode = (form.code || form.formCode || '').trim();
    const processName = (form.name || formCode).trim();
    if (!formCode || !processName) {
      return null;
    }

    const endpoints: Endpoint[] = [];
    const submitParameters = this.buildSubmitParameters(form, submitOperation);
    endpoints.push({
      name: `提交${processName}`,
      method: submitOperation.method,
      path: submitOperation.path,
      description: submitOperation.summary || `提交${processName}`,
      category: 'submit',
      parameters: submitParameters,
      responseMapping: submitOperation.responseMapping,
      bodyTemplate: this.buildSubmitBodyTemplate(form, submitOperation),
    });

    if (detailOperation) {
      endpoints.push({
        name: `查询${processName}详情`,
        method: detailOperation.method,
        path: detailOperation.path,
        description: detailOperation.summary || `查询${processName}详情`,
        category: 'query',
        parameters: detailOperation.parameters,
        responseMapping: detailOperation.responseMapping,
      });
    }

    if (listOperation) {
      endpoints.push({
        name: `查看${processName}列表`,
        method: listOperation.method,
        path: listOperation.path,
        description: listOperation.summary || `查看${processName}列表`,
        category: 'list',
        parameters: listOperation.parameters,
        responseMapping: listOperation.responseMapping,
      });
    }

    if (cancelOperation) {
      endpoints.push({
        name: `撤回${processName}`,
        method: cancelOperation.method,
        path: cancelOperation.path,
        description: cancelOperation.summary || `撤回${processName}`,
        category: 'cancel',
        parameters: cancelOperation.parameters,
        responseMapping: cancelOperation.responseMapping,
      });
    }

    for (const approvalOperation of approvalOperations) {
      endpoints.push({
        name: `${processName}${approvalOperation.summary || '审批处理'}`,
        method: approvalOperation.method,
        path: approvalOperation.path,
        description: approvalOperation.summary || `${processName}审批处理`,
        category: 'approve',
        parameters: approvalOperation.parameters,
        responseMapping: approvalOperation.responseMapping,
      });
    }

    return {
      processName,
      processCode: this.toSnakeCase(formCode),
      category: form.category || '行政',
      description: form.description || `${processName}流程`,
      endpoints,
    };
  }

  private buildSubmitParameters(form: EnrichedForm, submitOperation: OperationSummary): EndpointParameter[] {
    const formFields: EndpointParameter[] = (form.fields || []).map((field) => {
      const optionValues = (field.options || [])
        .map((option) => option?.value)
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      const optionDescription = optionValues.length > 0 ? ` 可选值: ${optionValues.join(', ')}` : '';

      return {
        name: field.key,
        type: this.mapFormFieldType(field.type),
        required: !!field.required,
        description: `${field.label || field.key}${optionDescription}`.trim(),
        in: 'body' as const,
        defaultValue: optionValues[0],
      };
    });

    const existingNames = new Set(formFields.map((field) => field.name));
    const requestBodyProps = submitOperation.requestBodySchema?.properties || {};
    for (const extraName of ['ccUserIds', 'attachments']) {
      if (!requestBodyProps[extraName] || existingNames.has(extraName)) {
        continue;
      }
      const resolved = this.resolveRef(requestBodyProps[extraName], submitOperation.requestBodySchema) as any;
      formFields.push({
        name: extraName,
        type: resolved?.type || 'array',
        required: false,
        description: extraName === 'ccUserIds' ? '抄送对象 ID 列表' : '附件列表',
        in: 'body',
      });
    }

    return formFields;
  }

  private buildSubmitBodyTemplate(form: EnrichedForm, submitOperation: OperationSummary): Record<string, any> {
    const dataTemplate: Record<string, string> = {};
    for (const field of form.fields || []) {
      dataTemplate[field.key] = `{{${field.key}}}`;
    }

    const template: Record<string, any> = {
      formCode: form.code || form.formCode,
      data: dataTemplate,
    };

    const requestBodyProps = submitOperation.requestBodySchema?.properties || {};
    if (requestBodyProps.ccUserIds) {
      template.ccUserIds = '{{ccUserIds}}';
    }
    if (requestBodyProps.attachments) {
      template.attachments = '{{attachments}}';
    }

    return template;
  }

  private collectOperationSummaries(doc: any): OperationSummary[] {
    const summaries: OperationSummary[] = [];

    for (const [path, pathItem] of Object.entries(doc.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem as any)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const op = operation as any;

        const parameters: EndpointParameter[] = (op.parameters || []).map((parameter: any) => ({
          name: parameter.name,
          in: parameter.in || 'query',
          type: parameter.schema?.type || parameter.type || 'string',
          required: parameter.required || false,
          description: parameter.description || '',
        }));

        let requestBodySchema = op.requestBody?.content?.['application/json']?.schema;
        if (!requestBodySchema && op.requestBody?.content?.['application/json']) {
          requestBodySchema = op.requestBody.content['application/json'];
        }
        requestBodySchema = this.resolveRef(requestBodySchema, doc);

        const bodyProps = requestBodySchema?.properties;
        const bodyRequired = requestBodySchema?.required || [];
        if (bodyProps) {
          for (const [name, prop] of Object.entries(bodyProps)) {
            const resolved = this.resolveRef(prop, doc) as any;
            parameters.push({
              name,
              in: 'body',
              type: resolved?.type || 'string',
              required: bodyRequired.includes(name),
              description: resolved?.description || '',
            });
          }
        }

        const responseSchema = this.extractSuccessResponseSchema(op.responses, doc);

        summaries.push({
          path,
          method: method.toUpperCase(),
          summary: op.summary || op.description || `${method.toUpperCase()} ${path}`,
          parameters,
          requestBodySchema,
          responseMapping: this.inferResponseMapping(responseSchema, method.toUpperCase() === 'POST' ? 'submit' : undefined),
        });
      }
    }

    return summaries;
  }

  private extractEnrichedForms(enrichmentText: string): EnrichedForm[] {
    if (!enrichmentText) {
      return [];
    }

    const arrayJson = this.extractFirstJsonArray(enrichmentText);
    if (!arrayJson) {
      return [];
    }

    try {
      const parsed = JSON.parse(arrayJson);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => item as EnrichedForm)
        .filter((item) => !!(item.code || item.formCode) && !!item.name);
    } catch (error: any) {
      this.logger.warn(`Failed to parse enriched forms: ${error.message}`);
      return [];
    }
  }

  private extractFirstJsonArray(text: string): string | null {
    const start = text.indexOf('[');
    if (start < 0) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          return text.substring(start, i + 1);
        }
      }
    }

    return null;
  }

  private extractSuccessResponseSchema(responses: any, doc: any): any {
    for (const status of ['200', '201', '202']) {
      const schema = responses?.[status]?.content?.['application/json']?.schema;
      if (schema) {
        return this.resolveRef(schema, doc);
      }
    }
    return undefined;
  }

  private inferResponseMapping(
    responseSchema: any,
    category?: Endpoint['category'],
  ): Record<string, string> {
    const properties = responseSchema?.properties || {};
    const propertyKeys = Object.keys(properties);
    if (propertyKeys.length === 0) {
      return { success: 'success', data: 'data', message: 'message' };
    }

    const successKey = ['success', 'ok', 'status', 'code', 'message']
      .find((key) => propertyKeys.includes(key));
    const dataKey = ['data', 'application', 'applications', 'result', 'items']
      .find((key) => propertyKeys.includes(key))
      || propertyKeys.find((key) => !['success', 'ok', 'status', 'code', 'message', 'error'].includes(key));

    const mapping: Record<string, string> = {};
    if (successKey) mapping.success = successKey;
    if (dataKey) mapping.data = dataKey;
    if (propertyKeys.includes('message')) mapping.message = 'message';
    if (category === 'submit' && dataKey) mapping.id = `${dataKey}.id`;

    return Object.keys(mapping).length > 0
      ? mapping
      : { success: 'success', data: 'data', message: 'message' };
  }

  private isGenericFormSubmit(operation: OperationSummary): boolean {
    if (operation.method !== 'POST') {
      return false;
    }

    const bodyProps = operation.requestBodySchema?.properties || {};
    const hasSelector = !!(bodyProps.formCode || bodyProps.processCode || bodyProps.templateId);
    const hasNestedData = !!(bodyProps.data || bodyProps.formData || bodyProps.payload);
    if (hasSelector && hasNestedData) {
      return true;
    }

    return /(创建|提交|申请|submit|create)/i.test(`${operation.path} ${operation.summary}`);
  }

  private isDetailOperation(operation: OperationSummary): boolean {
    return operation.method === 'GET'
      && /\/\{[^/]+\}$/.test(operation.path)
      && this.containsBusinessResource(operation.path);
  }

  private isListOperation(operation: OperationSummary): boolean {
    return operation.method === 'GET'
      && !operation.path.includes('{')
      && this.containsBusinessResource(operation.path);
  }

  private isCancelOperation(operation: OperationSummary): boolean {
    return ['POST', 'DELETE'].includes(operation.method)
      && /(recall|cancel|withdraw|revoke|撤回|取消)/i.test(`${operation.path} ${operation.summary}`);
  }

  private isApprovalOperation(operation: OperationSummary): boolean {
    return operation.method === 'POST'
      && /(approve|reject|review|audit|pass|驳回|审批|批准)/i.test(`${operation.path} ${operation.summary}`);
  }

  private containsBusinessResource(path: string): boolean {
    return /(application|request|submission|workflow|process)/i.test(path);
  }

  private mapFormFieldType(rawType?: string): string {
    const type = (rawType || '').toLowerCase();
    if (['number', 'integer'].includes(type)) return 'number';
    if (['date', 'datetime'].includes(type)) return type;
    if (['checkbox', 'boolean', 'switch'].includes(type)) return 'boolean';
    if (['multi-select', 'multiselect', 'array'].includes(type)) return 'array';
    if (['file', 'upload'].includes(type)) return 'file';
    return 'string';
  }

  private toSnakeCase(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
  }

  private truncateText(value: string, maxLen: number): string {
    return value.length > maxLen ? `${value.slice(0, maxLen)}\n... (truncated)` : value;
  }

  private parseProcessesFromLLM(llmContent: string): BusinessProcess[] {
    let jsonStr = llmContent.trim();

    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      this.logger.warn(`No JSON array found in LLM response`);
      return [];
    }

    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed)) return [];

      const defaultResponseMapping = { success: 'success', data: 'data', message: 'message' };

      return parsed
        .filter((p: any) => p.processName && p.processCode && p.endpoints?.length > 0)
        .map((p: any) => ({
          processName: p.processName,
          processCode: p.processCode,
          category: p.category || '行政',
          description: p.description || '',
          endpoints: (p.endpoints || []).map((ep: any) => ({
            name: ep.name || '',
            method: (ep.method || 'GET').toUpperCase(),
            path: ep.path || '',
            description: ep.description || '',
            category: this.normalizeCategory(ep.category),
            parameters: (ep.parameters || []).map((param: any) => ({
              name: param.name || '',
              type: param.type || 'string',
              required: param.required ?? false,
              description: param.description || '',
              in: this.inferParamLocation(param, ep),
            })),
            responseMapping: ep.responseMapping || defaultResponseMapping,
          })),
        }));
    } catch (error: any) {
      this.logger.error(`Failed to parse LLM JSON: ${error.message}`);
      return [];
    }
  }

  /**
   * 解引用 $ref，支持 #/components/schemas/XXX 格式
   */
  private resolveRef(schema: any, doc: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    if (!schema.$ref || typeof schema.$ref !== 'string') return schema;

    const refPath = schema.$ref.replace(/^#\//, '').split('/');
    let resolved: any = doc;
    for (const segment of refPath) {
      resolved = resolved?.[segment];
      if (resolved === undefined) return schema;
    }
    return resolved;
  }

  /**
   * 标准化端点 category，确保是合法值
   */
  private normalizeCategory(raw: string | undefined): Endpoint['category'] {
    const valid = new Set([
      'submit', 'query', 'cancel', 'urge', 'approve',
      'list', 'get', 'status_query', 'reference_data', 'other',
    ]);
    const lower = (raw || '').toLowerCase();
    if (valid.has(lower)) return lower as Endpoint['category'];
    // 兼容中文分类
    if (lower.includes('提交') || lower.includes('发起')) return 'submit';
    if (lower.includes('查询') || lower.includes('详情')) return 'query';
    if (lower.includes('列表') || lower.includes('待办')) return 'list';
    if (lower.includes('撤回') || lower.includes('取消')) return 'cancel';
    if (lower.includes('催办')) return 'urge';
    if (lower.includes('审批')) return 'approve';
    return 'other';
  }

  /**
   * 推断参数位置：如果 LLM 没有返回 in 字段，根据上下文推断
   */
  private inferParamLocation(
    param: any,
    endpoint: any,
  ): 'path' | 'query' | 'body' {
    // LLM 已返回有效值
    if (param.in === 'path' || param.in === 'query' || param.in === 'body') {
      return param.in;
    }
    // 参数名出现在路径占位符中 → path
    const pathStr = endpoint.path || '';
    if (pathStr.includes(`{${param.name}}`)) {
      return 'path';
    }
    // GET/DELETE 请求默认 query，其他默认 body
    const method = (endpoint.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'DELETE') {
      return 'query';
    }
    return 'body';
  }
}
