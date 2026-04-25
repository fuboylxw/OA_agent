import { Injectable, Logger } from '@nestjs/common';
import { LLMClientFactory, LLMMessage } from '@uniflow/agent-kernel';

interface FlowInfo {
  processCode: string;
  processName: string;
  processCategory: string;
}

interface FlowMatchResult {
  matchedFlow?: {
    processCode: string;
    processName: string;
    confidence: number;
  };
  candidateFlows?: Array<{
    processCode: string;
    processName: string;
  }>;
  needsClarification: boolean;
  clarificationQuestion?: string;
}

const FLOW_MATCH_SYSTEM_PROMPT = `你是一个 OA 办公系统的流程匹配助手。

## 任务
根据用户的自然语言消息，从可用流程列表中匹配最合适的流程。

## 规则
1. 先理解用户整句话的真实办事目标，不要只做关键词匹配
2. 用户可能一次说出流程意图和大量字段信息，例如时间、地点、类型、原因；这些细节通常是为了办理某个流程，不是噪声
3. 用户可能用口语化、简略的方式表达，应结合可用流程列表理解其真实目标，不要要求用户使用正式流程名称
4. 只有在用户话语已经提供了足够证据、可以把候选流程明确区分开时，才直接返回该流程
5. 如果多个流程都合理，但用户话语不足以区分它们，必须返回 needsClarification=true，不能为了减少追问而猜一个
6. 澄清问题应尽量短，只问最关键的区别，不要重复让用户描述已经说过的信息
7. 如果完全无法匹配任何流程，返回 needsClarification=true 并列出可用流程供用户选择
8. 如果两个或多个流程名称相近、都属于同一类业务，而用户只表达了大类意图（例如“我要请假”），通常应先澄清适用对象、类型或关键区别，而不是直接选一个

## 输出格式（JSON）
匹配成功：
{
  "matched": true,
  "processCode": "PROCESS_CODE",
  "processName": "流程名称",
  "confidence": 0.95
}

需要澄清：
{
  "matched": false,
  "candidateProcessCodes": ["PROCESS_A", "PROCESS_B"],
  "clarificationQuestion": "您是想办理“流程A”还是“流程B”？"
}`;

@Injectable()
export class FlowAgent {
  private readonly logger = new Logger(FlowAgent.name);
  private llmClient = LLMClientFactory.createFromEnv();

  async matchFlow(
    intent: string,
    message: string,
    availableFlows: FlowInfo[],
  ): Promise<FlowMatchResult> {
    if (availableFlows.length === 0) {
      return {
        needsClarification: true,
        clarificationQuestion: '当前没有可用的流程模板，请先通过初始化中心导入OA系统。',
      };
    }

    try {
      return await this.matchFlowWithLLM(message, availableFlows, intent);
    } catch (error: any) {
      this.logger.warn(`LLM 流程匹配失败，回退到保守解析: ${error.message}`);
      return this.matchFlowFallback(message, availableFlows);
    }
  }

  private async matchFlowWithLLM(
    message: string,
    availableFlows: FlowInfo[],
    intent?: string,
  ): Promise<FlowMatchResult> {
    const flowList = availableFlows
      .map(f => `- ${f.processCode} | ${f.processName} | 分类: ${f.processCategory}`)
      .join('\n');

    const userPrompt = `可用流程列表：
${flowList}

用户消息："${message}"

请判断用户想办理哪个流程，返回 JSON。`;

    const messages: LLMMessage[] = [
      { role: 'system', content: FLOW_MATCH_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.llmClient.chat(messages, {
      trace: {
        scope: 'assistant.flow.match',
        metadata: {
          intent: intent || null,
          availableFlowCount: availableFlows.length,
        },
      },
    });

    let jsonStr = response.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const result = JSON.parse(jsonStr);

    if (result.matched && result.processCode) {
      const flow = availableFlows.find(f => f.processCode === result.processCode);
      const confidence = typeof result.confidence === 'number' ? result.confidence : 0;
      if (flow && confidence >= 0.9) {
        const displayProcessName = typeof result.processName === 'string' && result.processName.trim()
          ? result.processName.trim()
          : flow.processName;
        this.logger.log(`LLM 匹配流程: ${displayProcessName} (${flow.processCode}), 置信度: ${result.confidence}`);
        return {
          matchedFlow: {
            processCode: flow.processCode,
            processName: displayProcessName,
            confidence,
          },
          needsClarification: false,
        };
      }
    }

    const candidateFlows = Array.isArray(result.candidateProcessCodes)
      ? result.candidateProcessCodes
          .map((processCode: unknown) => String(processCode || '').trim())
          .filter(Boolean)
          .map((processCode: string) => availableFlows.find((flow) => flow.processCode === processCode))
          .filter((flow): flow is FlowInfo => Boolean(flow))
          .map((flow) => ({
            processCode: flow.processCode,
            processName: flow.processName,
          }))
      : [];

    return {
      candidateFlows,
      needsClarification: true,
      clarificationQuestion: result.clarificationQuestion
        || `请问您想办理哪个流程？\n${availableFlows.map((f, i) => `${i + 1}. ${f.processName}`).join('\n')}`,
    };
  }

  /**
   * LLM 不可用时只做保守兜底，不再通过工程规则猜流程
   */
  private matchFlowFallback(message: string, availableFlows: FlowInfo[]): FlowMatchResult {
    const normalizedMessage = this.normalizeText(message);
    if (!normalizedMessage) {
      return this.buildClarificationResult(availableFlows);
    }

    if (availableFlows.length === 1) {
      return this.buildMatchedFlowResult(availableFlows[0], 0.82);
    }

    const candidates = availableFlows.filter((flow) => this.messageExplicitlyReferencesFlow(normalizedMessage, flow));

    if (candidates.length === 1) {
      return this.buildMatchedFlowResult(candidates[0], 0.88);
    }

    if (candidates.length > 1) {
      return this.buildClarificationResult(candidates);
    }

    return this.buildClarificationResult(availableFlows);
  }

  private messageExplicitlyReferencesFlow(message: string, flow: FlowInfo): boolean {
    const processCode = this.normalizeText(flow.processCode);
    const processName = this.normalizeText(flow.processName);

    if (processCode && this.hasStandaloneCodeReference(message, processCode)) {
      return true;
    }

    if (!processName) {
      return false;
    }

    const compactProcessName = this.compactText(processName);
    if (!compactProcessName) {
      return false;
    }

    return this.extractQuotedPhrases(message).some((phrase) => this.compactText(phrase) === compactProcessName);
  }

  private hasStandaloneCodeReference(message: string, processCode: string): boolean {
    const escaped = processCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9_\\-])${escaped}([^a-z0-9_\\-]|$)`, 'i').test(message);
  }

  private extractQuotedPhrases(message: string): string[] {
    const matches = message.match(/[“"「『](.+?)[”"」』]/g) || [];
    return matches
      .map((value) => value.slice(1, -1).trim())
      .filter(Boolean);
  }

  private compactText(value: string): string {
    return this.normalizeText(value).toLowerCase().replace(/[\s_\-./\\,，。;；:：'"“”‘’()（）【】\[\]]+/g, '');
  }

  private normalizeText(value: string): string {
    return String(value || '').trim();
  }

  private buildMatchedFlowResult(flow: FlowInfo, confidence: number): FlowMatchResult {
    return {
      candidateFlows: [
        {
          processCode: flow.processCode,
          processName: flow.processName,
        },
      ],
      matchedFlow: {
        processCode: flow.processCode,
        processName: flow.processName,
        confidence,
      },
      needsClarification: false,
    };
  }

  private buildClarificationResult(flows: FlowInfo[]): FlowMatchResult {
    return {
      candidateFlows: flows.map((flow) => ({
        processCode: flow.processCode,
        processName: flow.processName,
      })),
      needsClarification: true,
      clarificationQuestion: `请问您想办理哪个流程？\n${flows.map((f, i) => `${i + 1}. ${f.processName}`).join('\n')}`,
    };
  }
}
