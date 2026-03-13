import { Injectable, Logger } from '@nestjs/common';
import { LLMClientFactory, BaseLLMClient } from '@uniflow/agent-kernel';
import {
  NormalizedEndpoint,
  IdentifiedWorkflow,
  IdentifyResult,
  DetectedSyncCapabilities,
  WorkflowEndpoint,
  EndpointRole,
} from './types';

const EXCLUDE_PATTERNS = [
  /\/auth\//i,
  /\/login$/i,
  /\/logout$/i,
  /\/token$/i,
  /\/refresh-token/i,
  /\/admin\//i,
  /\/system\//i,
  /\/config\//i,
  /\/settings\//i,
  /\/health$/i,
  /\/ping$/i,
  /\/metrics/i,
  /\/swagger/i,
  /\/api-docs/i,
  /\/openapi/i,
  /\/favicon/i,
  /\/static\//i,
  /\/assets\//i,
];

const SYSTEM_PROMPT = `你是一个 OA 系统 API 分析专家。你的任务是从 API 端点列表中识别出面向普通用户的"办事流程"接口，并识别系统级辅助接口。

## 办事流程接口特征
- 用户可以发起的业务操作（请假、报销、发起审批、考勤打卡、预约会议、采购申请、出差申请等）
- 用户可以查询的业务状态（我的待办、我的已办、考勤记录、申请状态等）
- 用户可以执行的业务动作（审批通过、撤回申请、催办等）

## 特别注意：通用申请接口
有些 OA 系统用一个通用接口处理所有类型的申请（如 POST /api/applications），通过参数（如 formType、templateId、processKey）区分不同流程。
如果你发现这种模式：
- 仍然将其识别为一个 workflow（processCode 为 "generic_application"）
- 同时务必识别出"流程列表接口"（返回所有可用流程类型的接口），标记 role 为 "flow_list"
- 流程列表接口通常是 GET 请求，返回表单模板列表、流程类型列表、应用列表等

## 不属于办事流程的
- 系统管理接口（缓存、配置、权限管理、角色管理）
- 设计器接口（流程设计、表单设计）
- 底层数据接口
- 监控统计接口
- 第三方集成接口
- 健康检查接口

## 同时请识别以下系统级辅助接口（如果存在）
1. 流程列表接口 — 返回所有可用的流程/表单类型，标记 role 为 "flow_list"。请推断响应中列表字段路径（responseListPath）和每项的编码/名称字段（fieldMapping）
2. 状态查询接口 — 用于查询单条工单状态，标记 role 为 "status_query"
3. 批量查询接口 — 用于批量查询多条工单状态，标记 role 为 "batch_query"
4. Webhook/回调注册接口 — 用于注册状态变更通知，标记 role 为 "webhook_register"
5. 参考数据接口 — 部门列表、人员列表、字典数据等，标记 role 为 "reference_data"

如果文档中没有这些接口，不要编造。

## 输出格式（JSON）
{
  "workflows": [
    {
      "processCode": "leave_request",
      "processName": "请假申请",
      "category": "人事",
      "description": "员工请假申请流程",
      "confidence": 0.95,
      "endpoints": [
        { "role": "submit", "path": "/api/leave/submit", "method": "POST" },
        { "role": "query", "path": "/api/leave/{id}", "method": "GET" }
      ]
    }
  ],
  "systemEndpoints": [
    {
      "role": "flow_list",
      "path": "/api/forms/templates",
      "method": "GET",
      "description": "获取所有可用的表单/流程模板列表",
      "responseListPath": "data.items",
      "fieldMapping": {
        "code": "templateId",
        "name": "title",
        "category": "category"
      }
    },
    {
      "role": "status_query",
      "path": "/api/submissions/{id}/status",
      "method": "GET",
      "description": "查询工单状态"
    }
  ]
}

## 规则
1. processCode 使用英文 snake_case
2. 每个流程包含 2-5 个最核心的端点
3. endpoint role 可选值：submit, query, cancel, urge, approve, list
4. 只返回 JSON，不要其他内容`;

@Injectable()
export class WorkflowIdentifierAgent {
  private readonly logger = new Logger(WorkflowIdentifierAgent.name);
  private llmClient: BaseLLMClient;

  constructor() {
    this.llmClient = LLMClientFactory.createFromEnv();
  }

  /**
   * 从标准化端点列表中识别业务流程和同步能力
   */
  async identify(endpoints: NormalizedEndpoint[]): Promise<IdentifyResult> {
    // 1. 规则预过滤
    const { candidates, filteredCount } = this.ruleBasedFilter(endpoints);
    this.logger.log(
      `Rule filter: ${endpoints.length} → ${candidates.length} candidates (${filteredCount} filtered)`,
    );

    if (candidates.length === 0) {
      return {
        workflows: [],
        syncCapabilities: { singleQueryEndpoints: [] },
        filteredCount,
      };
    }

    // 2. 分批 LLM 识别
    const batchSize = 50;
    const batches: NormalizedEndpoint[][] = [];
    for (let i = 0; i < candidates.length; i += batchSize) {
      batches.push(candidates.slice(i, i + batchSize));
    }

    const allWorkflows: IdentifiedWorkflow[] = [];
    let syncCapabilities: DetectedSyncCapabilities = { singleQueryEndpoints: [] };

    for (let i = 0; i < batches.length; i++) {
      this.logger.log(`Analyzing batch ${i + 1}/${batches.length} (${batches[i].length} endpoints)`);
      const result = await this.identifyBatch(batches[i], candidates);
      allWorkflows.push(...result.workflows);
      // 合并 sync capabilities
      if (result.syncCapabilities.webhookEndpoint) {
        syncCapabilities.webhookEndpoint = result.syncCapabilities.webhookEndpoint;
      }
      if (result.syncCapabilities.batchQueryEndpoint) {
        syncCapabilities.batchQueryEndpoint = result.syncCapabilities.batchQueryEndpoint;
      }
      syncCapabilities.singleQueryEndpoints.push(
        ...result.syncCapabilities.singleQueryEndpoints,
      );
    }

    // 3. 去重
    const deduped = this.deduplicateWorkflows(allWorkflows);
    this.logger.log(`Identified ${deduped.length} workflows`);

    return {
      workflows: deduped,
      syncCapabilities,
      filteredCount,
    };
  }

  /**
   * 规则预过滤：排除明显的非业务端点
   */
  private ruleBasedFilter(endpoints: NormalizedEndpoint[]): {
    candidates: NormalizedEndpoint[];
    filteredCount: number;
  } {
    const candidates = endpoints.filter(ep => {
      for (const pattern of EXCLUDE_PATTERNS) {
        if (pattern.test(ep.path)) return false;
      }
      return true;
    });

    return {
      candidates,
      filteredCount: endpoints.length - candidates.length,
    };
  }

  /**
   * 单批 LLM 识别
   */
  private async identifyBatch(
    batch: NormalizedEndpoint[],
    allEndpoints: NormalizedEndpoint[],
  ): Promise<{ workflows: IdentifiedWorkflow[]; syncCapabilities: DetectedSyncCapabilities }> {
    // 只传 path + method + summary，控制 token 量
    const endpointSummary = batch.map(ep => ({
      path: ep.path,
      method: ep.method,
      summary: ep.summary,
      tags: ep.tags,
      hasRequestBody: !!ep.requestBody,
      paramCount: ep.parameters.length,
    }));

    const userPrompt = `请分析以下 ${endpointSummary.length} 个 API 端点，识别其中的办事流程接口和系统级辅助接口：

${JSON.stringify(endpointSummary, null, 2)}`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ], {
        trace: {
          scope: 'api_parse.workflow_identifier.identify',
          metadata: {
            endpointCount: endpointSummary.length,
          },
        },
      });

      return this.parseLLMResponse(response.content, allEndpoints);
    } catch (error: any) {
      this.logger.error(`LLM identification failed: ${error.message}`);
      return {
        workflows: [],
        syncCapabilities: { singleQueryEndpoints: [] },
      };
    }
  }

  /**
   * 解析 LLM 返回的 JSON
   */
  private parseLLMResponse(
    llmContent: string,
    allEndpoints: NormalizedEndpoint[],
  ): { workflows: IdentifiedWorkflow[]; syncCapabilities: DetectedSyncCapabilities } {
    let jsonStr = llmContent.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.warn('No JSON object found in LLM response');
      return { workflows: [], syncCapabilities: { singleQueryEndpoints: [] } };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      // 解析 workflows
      const workflows: IdentifiedWorkflow[] = (parsed.workflows || [])
        .filter((w: any) => w.processCode && w.endpoints?.length > 0)
        .map((w: any) => ({
          processCode: w.processCode,
          processName: w.processName || w.processCode,
          category: w.category || '其他',
          description: w.description || '',
          confidence: w.confidence || 0.8,
          endpoints: (w.endpoints || []).map((ep: any) => {
            // 从 allEndpoints 中找到完整的端点信息
            const full = allEndpoints.find(
              e => e.path === ep.path && e.method === (ep.method || '').toUpperCase(),
            );
            return {
              role: ep.role || 'other',
              endpoint: full || {
                path: ep.path,
                method: (ep.method || 'GET').toUpperCase(),
                summary: ep.description || '',
                tags: [],
                parameters: [],
              },
            } as WorkflowEndpoint;
          }),
        }));

      // 解析 sync capabilities
      const syncCapabilities: DetectedSyncCapabilities = {
        singleQueryEndpoints: [],
      };

      for (const sep of parsed.systemEndpoints || []) {
        const role = sep.role as EndpointRole;
        if (role === 'webhook_register') {
          syncCapabilities.webhookEndpoint = {
            path: sep.path,
            method: (sep.method || 'POST').toUpperCase(),
            description: sep.description || '',
          };
        } else if (role === 'batch_query') {
          syncCapabilities.batchQueryEndpoint = {
            path: sep.path,
            method: (sep.method || 'GET').toUpperCase(),
            description: sep.description || '',
          };
        } else if (role === 'status_query') {
          syncCapabilities.singleQueryEndpoints.push({
            processCode: sep.processCode || '_global',
            path: sep.path,
            method: (sep.method || 'GET').toUpperCase(),
          });
        } else if (role === 'flow_list') {
          syncCapabilities.flowListEndpoint = {
            path: sep.path,
            method: (sep.method || 'GET').toUpperCase(),
            description: sep.description || '',
            responseListPath: sep.responseListPath,
            fieldMapping: sep.fieldMapping,
          };
        }
      }

      return { workflows, syncCapabilities };
    } catch (error: any) {
      this.logger.error(`Failed to parse LLM JSON: ${error.message}`);
      return { workflows: [], syncCapabilities: { singleQueryEndpoints: [] } };
    }
  }

  /**
   * 去重：相同 processCode 只保留 confidence 最高的
   */
  private deduplicateWorkflows(workflows: IdentifiedWorkflow[]): IdentifiedWorkflow[] {
    const map = new Map<string, IdentifiedWorkflow>();
    for (const w of workflows) {
      const existing = map.get(w.processCode);
      if (!existing || w.confidence > existing.confidence) {
        map.set(w.processCode, w);
      }
    }
    return [...map.values()];
  }
}
