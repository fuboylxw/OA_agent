import { Logger } from '@nestjs/common';
import { BaseAgent, AgentContext, AgentConfig, LLMClientFactory, BaseLLMClient } from '@uniflow/agent-kernel';
import { z } from 'zod';

// ============================================================
// Schema Definitions
// ============================================================

const ParameterSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
  description: z.string(),
  in: z.enum(['path', 'query', 'body']).default('body'),
});

const EndpointSchema = z.object({
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
});

const BusinessProcessSchema = z.object({
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
- 底层数据接口（数据路径操作如 /data/work/{id}/{path0}/{path1}/...）
- 监控统计接口（系统级统计、日志查询）
- 第三方集成接口（钉钉同步、企业微信同步）
- Echo/健康检查接口
- 缓存操作接口（CacheAction）
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
    const doc = JSON.parse(input.docContent);
    const allProcesses: BusinessProcess[] = [];

    if (doc.modules && Array.isArray(doc.modules)) {
      // O2OA custom format: process in batches
      const batches = this.createBatches(doc.modules, 5);
      this.logger.log(`Processing ${doc.modules.length} modules in ${batches.length} batches`);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const moduleNames = batch.map((m: any) => m.title || m.name).join(', ');
        this.logger.log(`Analyzing batch ${i + 1}/${batches.length}: ${moduleNames}`);

        const batchProcesses = await this.analyzeBatch(batch, input.baseUrl);
        allProcesses.push(...batchProcesses);

        for (const bp of batchProcesses) {
          this.logger.log(`Identified: ${bp.processName} (${bp.processCode}) - ${bp.endpoints.length} endpoints`);
        }
      }
    } else if (doc.openapi || doc.swagger) {
      // OpenAPI format
      const processes = await this.analyzeOpenAPI(doc, input.baseUrl);
      allProcesses.push(...processes);
    }

    const totalEndpoints = allProcesses.reduce((sum, p) => sum + p.endpoints.length, 0);
    this.logger.log(`Total: ${allProcesses.length} business processes, ${totalEndpoints} endpoints`);

    return {
      processes: allProcesses,
      totalEndpoints,
      analyzedModules: doc.modules?.length || Object.keys(doc.paths || {}).length,
    };
  }

  private createBatches(modules: any[], batchSize: number): any[][] {
    const batches: any[][] = [];
    for (let i = 0; i < modules.length; i += batchSize) {
      batches.push(modules.slice(i, i + batchSize));
    }
    return batches;
  }

  private async analyzeBatch(modules: any[], baseUrl?: string): Promise<BusinessProcess[]> {
    const moduleSummaries = modules.map((module: any) => {
      const actions = (module.actions || []).map((action: any) => {
        const methods = (action.methods || []).map((m: any) => ({
          name: m.name,
          method: m.method || 'GET',
          uri: m.uri,
          hasBody: m.enctype === 'application/json',
        }));
        return { name: action.name, methods };
      });

      return {
        name: module.name,
        title: module.title || module.name,
        baseUrl: module.baseUrl || '',
        actions,
        totalMethods: actions.reduce((s: number, a: any) => s + a.methods.length, 0),
      };
    });

    const userPrompt = `请分析以下 ${moduleSummaries.length} 个 API 模块，识别其中的办事流程接口：

${JSON.stringify(moduleSummaries, null, 2)}

注意：
- baseUrl 是模块的基础路径，完整 API 路径 = baseUrl + "/jaxrs/" + uri
- 只选择面向普通用户的办事流程操作
- 每个流程选 2-5 个最核心的端点
- 每个端点必须包含 category（submit/query/list/cancel/urge/approve/status_query/reference_data/other）
- 每个端点必须包含 responseMapping（从响应中提取字段的路径映射）
- 每个参数必须包含 in（path/query/body）`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]);

      return this.parseProcessesFromLLM(response.content);
    } catch (error: any) {
      this.logger.error(`LLM analysis failed for batch: ${error.message}`);
      return [];
    }
  }

  private async analyzeOpenAPI(doc: any, baseUrl?: string): Promise<BusinessProcess[]> {
    const pathSummary: any[] = [];
    for (const [path, pathItem] of Object.entries(doc.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem as any)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const op = operation as any;

        // 提取参数及其位置信息
        const params = (op.parameters || []).map((p: any) => ({
          name: p.name,
          in: p.in || 'query',
          type: p.schema?.type || p.type || 'string',
          required: p.required || false,
        }));

        // 提取 requestBody 字段
        const bodyProps = op.requestBody?.content?.['application/json']?.schema?.properties;
        const bodyRequired = op.requestBody?.content?.['application/json']?.schema?.required || [];
        if (bodyProps) {
          for (const [name, prop] of Object.entries(bodyProps)) {
            const p = prop as any;
            params.push({
              name,
              in: 'body',
              type: p.type || 'string',
              required: bodyRequired.includes(name),
            });
          }
        }

        // 提取响应结构提示
        const responseSchema = op.responses?.['200']?.content?.['application/json']?.schema;
        const responseHint = responseSchema?.properties
          ? Object.keys(responseSchema.properties).join(', ')
          : '';

        pathSummary.push({
          path,
          method: method.toUpperCase(),
          summary: op.summary || op.description || '',
          parameters: params,
          responseFields: responseHint,
        });
      }
    }

    const chunkSize = 50;
    const allProcesses: BusinessProcess[] = [];

    for (let i = 0; i < pathSummary.length; i += chunkSize) {
      const chunk = pathSummary.slice(i, i + chunkSize);
      const userPrompt = `请分析以下 API 端点，识别其中的办事流程接口：

${JSON.stringify(chunk, null, 2)}

注意：
- 每个端点必须包含 category（submit/query/list/cancel/urge/approve/status_query/reference_data/other）
- 每个端点必须包含 responseMapping（从响应中提取字段的路径映射）
- 每个参数必须包含 in（path/query/body），参考上面 parameters 中的 in 字段
- 如果提供了 responseFields，请据此推断 responseMapping`;

      try {
        const response = await this.llmClient.chat([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ]);
        const processes = this.parseProcessesFromLLM(response.content);
        allProcesses.push(...processes);
      } catch (error: any) {
        this.logger.error(`LLM analysis failed for OpenAPI chunk: ${error.message}`);
      }
    }

    return allProcesses;
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
