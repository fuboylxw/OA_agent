import { Injectable, Logger } from '@nestjs/common';
import { ChatIntent } from '@uniflow/shared-types';
import { LLMClientFactory, LLMMessage, buildSystemPrompt } from '@uniflow/agent-kernel';

interface IntentContext {
  userId: string;
  tenantId: string;
  sessionId: string;
}

interface IntentResult {
  intent: ChatIntent;
  confidence: number;
  extractedEntities?: Record<string, any>;
}

// System prompt for intent detection
const INTENT_SYSTEM_PROMPT = `You are an intent classification assistant for an office automation system.

Your task is to analyze user messages and classify them into one of the following intents:

1. create_submission - User wants to create a new application/submission (e.g., "我要报销", "申请请假", "发起采购")
2. query_status - User wants to check the status of their application (e.g., "我的申请到哪了", "查询进度", "审批到哪一步了")
3. cancel_submission - User wants to cancel/withdraw their application (e.g., "撤回申请", "取消", "不要了")
4. urge - User wants to urge/expedite their application (e.g., "催办", "催一下", "加急")
5. supplement - User wants to add supplementary materials (e.g., "补件", "补充材料", "追加附件")
6. delegate - User wants to delegate their application to someone else (e.g., "转办", "委托", "转交")
7. service_request - User wants to browse available services (e.g., "有什么流程", "可以办什么", "帮助")
8. unknown - Cannot determine the intent

IMPORTANT: Intent values must be lowercase with underscores (e.g., "create_submission", NOT "CREATE_SUBMISSION").

Also extract any relevant entities from the message:
- amount: monetary amounts (e.g., "1000元", "五百块")
- date: dates (e.g., "2026-03-01", "明天", "下周一")
- flowType: process type keywords (e.g., "差旅", "请假", "采购")
- reason: reason or description text

Respond in JSON format:
{
  "intent": "create_submission",
  "confidence": 0.95,
  "entities": {
    "amount": 1000,
    "date": "2026-03-01",
    "flowType": "travel_expense",
    "reason": "出差北京"
  }
}`;

@Injectable()
export class IntentAgent {
  private readonly logger = new Logger(IntentAgent.name);
  private llmClient = LLMClientFactory.createFromEnv();
  private useLLM = process.env.USE_LLM_FOR_INTENT !== 'false'; // Default to true

  async detectIntent(message: string, context: IntentContext): Promise<IntentResult> {
    if (this.useLLM) {
      return this.detectIntentWithLLM(message, context);
    } else {
      return this.detectIntentWithRules(message, context);
    }
  }

  private async detectIntentWithLLM(message: string, context: IntentContext): Promise<IntentResult> {
    try {
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: INTENT_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: `Classify this message: "${message}"`,
        },
      ];

      const response = await this.llmClient.chat(messages, {
        trace: {
          scope: 'assistant.intent.detect',
          tenantId: context.tenantId,
          userId: context.userId,
          metadata: {
            sessionId: context.sessionId,
          },
        },
      });

      // Parse JSON response - handle markdown code blocks
      let jsonStr = response.content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const result = JSON.parse(jsonStr);

      // Normalize intent to lowercase (enum values are lowercase)
      const normalizedIntent = (result.intent || 'unknown').toLowerCase();

      return {
        intent: normalizedIntent as ChatIntent,
        confidence: result.confidence || 0.8,
        extractedEntities: result.entities || {},
      };
    } catch (error: any) {
      this.logger.warn(`LLM intent detection failed, falling back to rules: ${error.message}`);
      return this.detectIntentWithRules(message, context);
    }
  }

  private async detectIntentWithRules(message: string, context: IntentContext): Promise<IntentResult> {
    const scores = new Map<ChatIntent, number>();

    // Intent patterns
    const patterns: Array<{ intent: ChatIntent; keywords: string[]; weight: number }> = [
      {
        intent: ChatIntent.CREATE_SUBMISSION,
        keywords: ['报销', '申请', '发起', '提交', '办理', '请假', '采购', '出差', '预约', '我要', '帮我'],
        weight: 1.0,
      },
      {
        intent: ChatIntent.QUERY_STATUS,
        keywords: ['进度', '状态', '到哪了', '审批', '查询', '查看', '我的申请', '怎么样了'],
        weight: 0.9,
      },
      {
        intent: ChatIntent.CANCEL_SUBMISSION,
        keywords: ['撤回', '取消', '撤销', '不要了', '作废'],
        weight: 0.95,
      },
      {
        intent: ChatIntent.URGE,
        keywords: ['催办', '催一下', '加急', '催促', '提醒'],
        weight: 0.9,
      },
      {
        intent: ChatIntent.SUPPLEMENT,
        keywords: ['补件', '补充', '补材料', '追加', '附件'],
        weight: 0.9,
      },
      {
        intent: ChatIntent.DELEGATE,
        keywords: ['转办', '转交', '委托', '代办'],
        weight: 0.9,
      },
      {
        intent: ChatIntent.SERVICE_REQUEST,
        keywords: ['有什么', '流程', '列表', '可以办', '怎么办', '帮助', '导航'],
        weight: 0.8,
      },
    ];

    for (const pattern of patterns) {
      let matchCount = 0;
      for (const keyword of pattern.keywords) {
        if (message.includes(keyword)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const score = (matchCount / pattern.keywords.length) * pattern.weight;
        const existing = scores.get(pattern.intent) || 0;
        scores.set(pattern.intent, Math.max(existing, score));
      }
    }

    // Find best match
    let bestIntent = ChatIntent.UNKNOWN;
    let bestScore = 0;

    for (const [intent, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    // Extract entities
    const entities = this.extractEntities(message);

    return {
      intent: bestIntent,
      confidence: bestScore > 0 ? Math.min(bestScore + 0.3, 1.0) : 0.1,
      extractedEntities: entities,
    };
  }

  private extractEntities(message: string): Record<string, any> {
    const entities: Record<string, any> = {};

    // Extract amount patterns
    const amountMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:元|块|万)/);
    if (amountMatch) {
      entities.amount = parseFloat(amountMatch[1]);
    }

    // Extract date patterns
    const dateMatch = message.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
    if (dateMatch) {
      entities.date = dateMatch[1];
    }

    // Extract common flow types
    const flowTypes: Record<string, string> = {
      '差旅': 'travel_expense',
      '报销': 'travel_expense',
      '请假': 'leave_request',
      '采购': 'purchase_request',
      '会议室': 'meeting_room',
      '出差': 'business_trip',
    };

    for (const [keyword, code] of Object.entries(flowTypes)) {
      if (message.includes(keyword)) {
        entities.flowCode = code;
        entities.flowKeyword = keyword;
        break;
      }
    }

    return entities;
  }
}
