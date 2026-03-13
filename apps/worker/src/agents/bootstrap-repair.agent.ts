import { Logger } from '@nestjs/common';
import {
  AgentConfig,
  AgentContext,
  BaseAgent,
  BaseLLMClient,
  LLMClientFactory,
} from '@uniflow/agent-kernel';
import { z } from 'zod';
import { BusinessProcessSchema } from './api-analyzer.agent';

const BootstrapRepairInputSchema = z.object({
  docContent: z.string().nullable().optional(),
  baseUrl: z.string().optional(),
  failureType: z.string(),
  process: BusinessProcessSchema,
  validationResult: z.record(z.any()),
});

const BootstrapRepairOutputSchema = z.object({
  repairable: z.boolean(),
  summary: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  updatedProcess: BusinessProcessSchema.optional(),
});

export type BootstrapRepairInput = z.infer<typeof BootstrapRepairInputSchema>;
export type BootstrapRepairOutput = z.infer<typeof BootstrapRepairOutputSchema>;

const SYSTEM_PROMPT = `你是 OA API 修复专家。你的任务是在“初始化主链路”的失败流程中，做有限、保守、可验证的结构化修复建议。

只允许修复这些内容：
- 流程的 submit/query/cancel 等 endpoint 选择错误
- endpoint path 缺少/多了 base path
- endpoint category 标记错误
- bodyTemplate 不完整
- parameters 的 in/required/defaultValue 不准确
- responseMapping 不准确

禁止做这些事情：
- 猜测用户名、密码、token、cookie、header 凭证
- 发明文档中不存在的业务流程
- 输出任意代码
- 修改 processCode 为其他流程
- 把明显的网络/认证问题伪装成路径问题

如果无法安全修复，必须返回 repairable=false。

只返回 JSON 对象，不要返回解释性文字。`;

export class BootstrapRepairAgent extends BaseAgent<
  BootstrapRepairInput,
  BootstrapRepairOutput
> {
  private readonly logger = new Logger(BootstrapRepairAgent.name);
  private readonly llmClient: BaseLLMClient;

  constructor() {
    const config: AgentConfig = {
      name: 'bootstrap-repair',
      description: 'Repair failed bootstrap processes with bounded LLM suggestions',
      inputSchema: BootstrapRepairInputSchema,
      outputSchema: BootstrapRepairOutputSchema,
    };
    super(config);
    this.llmClient = LLMClientFactory.createFromEnv();
  }

  protected async run(input: BootstrapRepairInput, _context: AgentContext): Promise<BootstrapRepairOutput> {
    const docExcerpt = this.truncateText(input.docContent || '', 18000);
    const userPrompt = `当前失败类型: ${input.failureType}
Base URL: ${input.baseUrl || 'unknown'}

当前流程:
${JSON.stringify(input.process, null, 2)}

当前验证结果:
${JSON.stringify(input.validationResult, null, 2)}

API 文档摘录:
${docExcerpt || '(无文档内容)'}

请返回严格 JSON：
{
  "repairable": true,
  "summary": "一句话说明修复内容",
  "confidence": 0.0,
  "updatedProcess": {
    "processName": "...",
    "processCode": "${input.process.processCode}",
    "category": "...",
    "description": "...",
    "endpoints": [...]
  }
}

如果无法安全修复，请返回：
{
  "repairable": false,
  "summary": "原因",
  "confidence": 0.0
}`;

    const response = await this.llmClient.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ], {
      trace: {
        scope: 'worker.bootstrap_repair.repair',
        metadata: {
          failureType: input.failureType,
          processCode: input.process.processCode,
        },
      },
    });

    return this.parseJson(response.content || '');
  }

  private parseJson(content: string): BootstrapRepairOutput {
    let jsonStr = content.trim();

    const fencedMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      jsonStr = fencedMatch[1].trim();
    }

    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(jsonStr) as BootstrapRepairOutput;
    } catch (error: any) {
      this.logger.error(`Failed to parse repair JSON: ${error.message}`);
      throw error;
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}\n... [truncated]`;
  }
}
