import { Logger } from '@nestjs/common';
import { BaseAgent, AgentContext, AgentConfig, LLMClientFactory, BaseLLMClient } from '@uniflow/agent-kernel';
import { z } from 'zod';
import axios from 'axios';

// ============================================================
// Schema Definitions
// ============================================================

const EndpointSchema = z.object({
  name: z.string(),
  method: z.string(),
  path: z.string(),
  description: z.string(),
  parameters: z.array(z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean(),
    description: z.string(),
  })),
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
      "path": "完整API路径",
      "description": "操作描述",
      "parameters": [{ "name": "参数名", "type": "类型", "required": true, "description": "说明" }]
    }
  ]
}

重要规则：
1. 每个流程应包含 2-5 个最核心的端点，不要把所有端点都列出
2. processCode 使用英文 snake_case
3. 只返回 JSON 数组，不要其他内容
4. 如果某个模块没有办事流程接口，返回空数组 []`;

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

  /**
   * Split modules into batches for LLM processing
   */
  private createBatches(modules: any[], batchSize: number): any[][] {
    const batches: any[][] = [];
    for (let i = 0; i < modules.length; i += batchSize) {
      batches.push(modules.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Analyze a batch of O2OA modules with LLM
   */
  private async analyzeBatch(modules: any[], baseUrl?: string): Promise<BusinessProcess[]> {
    // Build a concise summary of each module for the LLM
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
- 每个流程选 2-5 个最核心的端点`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]);

      return this.parseProcessesFromLLM(response.content, modules);
    } catch (error: any) {
      this.logger.error(`LLM analysis failed for batch: ${error.message}`);
      return [];
    }
  }

  /**
   * Analyze OpenAPI document with LLM
   */
  private async analyzeOpenAPI(doc: any, baseUrl?: string): Promise<BusinessProcess[]> {
    // Build path summary
    const pathSummary: any[] = [];
    for (const [path, pathItem] of Object.entries(doc.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem as any)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        const op = operation as any;
        pathSummary.push({
          path,
          method: method.toUpperCase(),
          summary: op.summary || op.description || '',
          parameters: (op.parameters || []).map((p: any) => p.name),
        });
      }
    }

    // Process in chunks if too many paths
    const chunkSize = 50;
    const allProcesses: BusinessProcess[] = [];

    for (let i = 0; i < pathSummary.length; i += chunkSize) {
      const chunk = pathSummary.slice(i, i + chunkSize);
      const userPrompt = `请分析以下 API 端点，识别其中的办事流程接口：

${JSON.stringify(chunk, null, 2)}`;

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

  /**
   * Parse LLM response into BusinessProcess array
   */
  private parseProcessesFromLLM(llmContent: string, modules?: any[]): BusinessProcess[] {
    let jsonStr = llmContent.trim();

    // Remove markdown code blocks
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    // Try to extract JSON array
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      this.logger.warn(`No JSON array found in LLM response`);
      return [];
    }

    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed)) return [];

      // Validate and clean each process
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
            parameters: (ep.parameters || []).map((param: any) => ({
              name: param.name || '',
              type: param.type || 'string',
              required: param.required ?? false,
              description: param.description || '',
            })),
          })),
        }));
    } catch (error: any) {
      this.logger.error(`Failed to parse LLM JSON: ${error.message}`);
      return [];
    }
  }

  /**
   * Validate endpoint connectivity
   */
  async validateEndpoints(
    processes: BusinessProcess[],
    baseUrl: string,
    token?: string,
  ): Promise<Map<string, { reachable: boolean; statusCode?: number }>> {
    const results = new Map<string, { reachable: boolean; statusCode?: number }>();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['x-token'] = token;

    for (const process of processes) {
      for (const ep of process.endpoints) {
        const testPath = ep.path.replace(/\{[^}]+\}/g, 'test');
        const url = `${baseUrl}${testPath}`;
        const key = `${ep.method} ${ep.path}`;

        try {
          const response = await axios({
            method: 'HEAD',
            url,
            headers,
            timeout: 5000,
            validateStatus: () => true,
          });
          const reachable = response.status < 500;
          results.set(key, { reachable, statusCode: response.status });
          this.logger.log(`Validating: ${key}... ${reachable ? 'OK' : 'FAIL'} (${response.status})`);
        } catch {
          results.set(key, { reachable: false });
          this.logger.log(`Validating: ${key}... UNREACHABLE`);
        }
      }
    }

    return results;
  }
}
