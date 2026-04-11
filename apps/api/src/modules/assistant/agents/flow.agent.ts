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
  needsClarification: boolean;
  clarificationQuestion?: string;
}

const FLOW_MATCH_SYSTEM_PROMPT = `你是一个 OA 办公系统的流程匹配助手。

## 任务
根据用户的自然语言消息，从可用流程列表中匹配最合适的流程。

## 规则
1. 理解用户意图的语义，不要只做关键词匹配
2. 用户可能用口语化、简略的方式表达，例如"请个假"="请假申请"，"报个账"="财务报销"，"申请项目"="项目申请"
3. 如果能明确匹配到一个流程，返回该流程
4. 如果用户表达模糊，可能匹配多个流程，返回 needsClarification=true 并给出澄清问题
5. 如果完全无法匹配任何流程，返回 needsClarification=true 并列出可用流程供用户选择

## 输出格式（JSON）
匹配成功：
{
  "matched": true,
  "processCode": "LEAVE_REQUEST",
  "processName": "请假申请",
  "confidence": 0.95
}

需要澄清：
{
  "matched": false,
  "clarificationQuestion": "您是想办理"请假申请"还是"财务报销"？"
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
      this.logger.warn(`LLM 流程匹配失败，回退到简单匹配: ${error.message}`);
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
      if (flow) {
        const displayProcessName = typeof result.processName === 'string' && result.processName.trim()
          ? result.processName.trim()
          : flow.processName;
        this.logger.log(`LLM 匹配流程: ${displayProcessName} (${flow.processCode}), 置信度: ${result.confidence}`);
        return {
          matchedFlow: {
            processCode: flow.processCode,
            processName: displayProcessName,
            confidence: result.confidence || 0.9,
          },
          needsClarification: false,
        };
      }
    }

    return {
      needsClarification: true,
      clarificationQuestion: result.clarificationQuestion
        || `请问您想办理哪个流程？\n${availableFlows.map((f, i) => `${i + 1}. ${f.processName}`).join('\n')}`,
    };
  }

  /**
   * LLM 不可用时的简单回退匹配
   */
  private matchFlowFallback(message: string, availableFlows: FlowInfo[]): FlowMatchResult {
    let bestMatch: { flow: FlowInfo; score: number } | null = null;

    for (const flow of availableFlows) {
      const name = flow.processName;
      // 消息包含完整流程名
      if (message.includes(name)) {
        return {
          matchedFlow: {
            processCode: flow.processCode,
            processName: flow.processName,
            confidence: 0.9,
          },
          needsClarification: false,
        };
      }

      // 检查流程名中的连续子串是否出现在消息中（从最长子串开始）
      if (name.length >= 2) {
        let longestOverlap = 0;
        for (let len = name.length - 1; len >= 2; len--) {
          for (let start = 0; start <= name.length - len; start++) {
            if (message.includes(name.substring(start, start + len))) {
              longestOverlap = Math.max(longestOverlap, len);
            }
          }
          if (longestOverlap > 0) break;
        }
        const overlapRatio = longestOverlap / name.length;
        if (overlapRatio >= 0.4) {
          const score = overlapRatio * name.length;
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { flow, score };
          }
        }
      }
    }

    if (bestMatch) {
      return {
        matchedFlow: {
          processCode: bestMatch.flow.processCode,
          processName: bestMatch.flow.processName,
          confidence: 0.6,
        },
        needsClarification: false,
      };
    }

    return {
      needsClarification: true,
      clarificationQuestion: `请问您想办理哪个流程？\n${availableFlows.map((f, i) => `${i + 1}. ${f.processName}`).join('\n')}`,
    };
  }
}
