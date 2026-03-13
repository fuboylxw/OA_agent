import { Injectable, Logger } from '@nestjs/common';
import { BaseAgent, AgentContext, AgentConfig, LLMClientFactory } from '@uniflow/agent-kernel';
import { z } from 'zod';

const WorkflowApiIdentifierInputSchema = z.object({
  endpoints: z.array(
    z.object({
      path: z.string(),
      method: z.string(),
      description: z.string(),
      parameters: z.array(z.any()),
      requestBody: z.any().optional(),
      responses: z.any().optional(),
    }),
  ),
});

const WorkflowApiIdentifierOutputSchema = z.object({
  workflowApis: z.array(
    z.object({
      path: z.string(),
      method: z.string(),
      description: z.string(),
      workflowType: z.string(), // leave_request, expense_claim, attendance_query, etc.
      workflowCategory: z.string(), // 请假, 报销, 考勤, etc.
      confidence: z.number().min(0).max(1),
      reason: z.string(),
      parameters: z.array(z.any()),
      requestBody: z.any().optional(),
      responses: z.any().optional(),
    }),
  ),
  nonWorkflowApis: z.array(
    z.object({
      path: z.string(),
      method: z.string(),
      reason: z.string(),
    }),
  ),
});

type WorkflowApiIdentifierInput = z.infer<typeof WorkflowApiIdentifierInputSchema>;
type WorkflowApiIdentifierOutput = z.infer<typeof WorkflowApiIdentifierOutputSchema>;

/**
 * 智能体：识别办事流程接口
 *
 * 功能：
 * 1. 从API列表中识别哪些是办事流程接口（请假、报销、考勤等）
 * 2. 过滤掉非办事流程接口（系统管理、用户管理等）
 * 3. 对每个办事流程接口进行分类和置信度评分
 */
@Injectable()
export class WorkflowApiIdentifierAgent extends BaseAgent<
  WorkflowApiIdentifierInput,
  WorkflowApiIdentifierOutput
> {
  private readonly logger = new Logger(WorkflowApiIdentifierAgent.name);
  private llmClient = LLMClientFactory.createFromEnv();

  constructor() {
    const config: AgentConfig = {
      name: 'workflow-api-identifier',
      description: 'Identify workflow/business process APIs from API list',
      inputSchema: WorkflowApiIdentifierInputSchema,
      outputSchema: WorkflowApiIdentifierOutputSchema,
    };
    super(config);
  }

  protected async run(
    input: WorkflowApiIdentifierInput,
    context: AgentContext,
  ): Promise<WorkflowApiIdentifierOutput> {
    this.logger.log(`Analyzing ${input.endpoints.length} endpoints`);

    // 先用规则过滤明显的非办事流程接口
    const candidates = this.ruleBasedFilter(input.endpoints);
    this.logger.log(`${candidates.length} candidates after rule-based filtering`);

    // 使用LLM进行智能识别
    const result = await this.identifyWithLLM(candidates, context);

    this.logger.log(`Identified ${result.workflowApis.length} workflow APIs`);

    return result;
  }

  /**
   * 基于规则的初步过滤
   */
  private ruleBasedFilter(endpoints: any[]): any[] {
    const excludePatterns = [
      /\/auth\//i,
      /\/login/i,
      /\/logout/i,
      /\/user\/profile/i,
      /\/system\//i,
      /\/admin\//i,
      /\/config\//i,
      /\/health/i,
      /\/metrics/i,
      /\/swagger/i,
      /\/api-docs/i,
    ];

    return endpoints.filter(endpoint => {
      // 排除明显的系统接口
      for (const pattern of excludePatterns) {
        if (pattern.test(endpoint.path)) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * 使用LLM进行智能识别
   */
  private async identifyWithLLM(
    endpoints: any[],
    context?: AgentContext,
  ): Promise<WorkflowApiIdentifierOutput> {
    const prompt = `
你是一个OA系统API分析专家。请分析以下API端点列表，识别哪些是办事流程接口。

办事流程接口的特征：
1. 用于处理业务流程，如：请假申请、报销申请、考勤查询、出差申请、加班申请、采购申请等
2. 通常包含提交、查询、审批等操作
3. 与员工日常办公业务相关

非办事流程接口的特征：
1. 系统管理接口（用户管理、权限管理、系统配置等）
2. 基础数据接口（部门列表、员工列表等）
3. 认证授权接口（登录、登出、token刷新等）

API端点列表：
${JSON.stringify(endpoints, null, 2)}

请以JSON格式返回分析结果：
{
  "workflowApis": [
    {
      "path": "API路径",
      "method": "HTTP方法",
      "description": "端点描述",
      "workflowType": "流程类型英文标识（如leave_request, expense_claim, attendance_query）",
      "workflowCategory": "流程分类中文（如请假, 报销, 考勤）",
      "confidence": 0.95,
      "reason": "识别为办事流程的原因",
      "parameters": [...],
      "requestBody": {...},
      "responses": {...}
    }
  ],
  "nonWorkflowApis": [
    {
      "path": "API路径",
      "method": "HTTP方法",
      "reason": "不是办事流程的原因"
    }
  ]
}

只返回JSON，不要其他内容。
`;

    try {
      const messages = [{ role: 'user' as const, content: prompt }];
      const response = await this.llmClient.chat(messages, {
        trace: {
          scope: 'mcp.workflow_api_identifier.identify',
          traceId: context?.traceId,
          tenantId: context?.tenantId,
          userId: context?.userId,
          metadata: {
            endpointCount: endpoints.length,
          },
        },
      });
      let jsonStr = response.content.trim();

      // Remove markdown code blocks
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonStr);

      // Validate and ensure all required fields are present
      const workflowApis = parsed.workflowApis.map((api: any) => ({
        ...api,
        confidence: api.confidence || 0.8,
        parameters: api.parameters || [],
        requestBody: api.requestBody || null,
        responses: api.responses || null,
      }));

      return {
        workflowApis,
        nonWorkflowApis: parsed.nonWorkflowApis || [],
      };
    } catch (error: any) {
      this.logger.error(`LLM identification failed: ${error.message}`);

      // Fallback: return empty result
      return {
        workflowApis: [],
        nonWorkflowApis: endpoints.map(e => ({
          path: e.path,
          method: e.method,
          reason: 'LLM identification failed',
        })),
      };
    }
  }
}
