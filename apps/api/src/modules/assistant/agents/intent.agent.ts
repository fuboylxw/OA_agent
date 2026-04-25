import { Injectable, Logger } from '@nestjs/common';
import { ChatIntent } from '@uniflow/shared-types';
import { LLMClientFactory, LLMMessage } from '@uniflow/agent-kernel';

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

const ZH = {
  createSubmissionA: '\u6211\u8981\u53d1\u8d77\u4e00\u4e2a\u7533\u8bf7',
  createSubmissionB: '\u5e2e\u6211\u529e\u7406\u4e00\u4e2a\u6d41\u7a0b',
  createSubmissionC: '\u6211\u8981\u63d0\u4ea4\u8868\u5355',
  queryWhere: '\u6211\u7684\u7533\u8bf7\u5230\u54ea\u4e86',
  queryProgress: '\u67e5\u8be2\u8fdb\u5ea6',
  queryApproval: '\u5ba1\u6279\u5230\u54ea\u4e00\u6b65\u4e86',
  cancel: '\u64a4\u56de\u7533\u8bf7',
  cancelShort: '\u53d6\u6d88',
  cancelGiveUp: '\u4e0d\u8981\u4e86',
  urge: '\u50ac\u529e',
  urgeShort: '\u50ac\u4e00\u4e0b',
  urgeFast: '\u52a0\u6025',
  supplement: '\u8865\u4ef6',
  supplementMaterials: '\u8865\u5145\u6750\u6599',
  supplementAttachment: '\u8ffd\u52a0\u9644\u4ef6',
  delegate: '\u8f6c\u529e',
  delegateEntrust: '\u59d4\u6258',
  delegateTransfer: '\u8f6c\u4ea4',
  serviceList: '\u6709\u4ec0\u4e48\u6d41\u7a0b',
  serviceCanDo: '\u53ef\u4ee5\u529e\u4ec0\u4e48',
  serviceHelp: '\u5e2e\u52a9',
  amountExample: '1000\u5143',
  amountExample2: '500\u5757',
  dateTomorrow: '\u660e\u5929',
  dateNextMonday: '\u4e0b\u5468\u4e00',
  genericFlowCode: 'process_alpha',
  genericFlowName: '\u67d0\u4e2a\u529e\u4e8b\u6d41\u7a0b',
  reasonExample: '\u56e0\u4e1a\u52a1\u9700\u8981\u529e\u7406',
} as const;

const INTENT_SYSTEM_PROMPT = `You are an intent classification assistant for an office automation system.

Your task is to analyze the user's whole utterance, infer what they are trying to get done right now, and classify it into one of the following intents:

1. create_submission - User wants to create a new application/submission (e.g., "${ZH.createSubmissionA}", "${ZH.createSubmissionB}", "${ZH.createSubmissionC}")
2. query_status - User wants to check the status of their application (e.g., "${ZH.queryWhere}", "${ZH.queryProgress}", "${ZH.queryApproval}")
3. cancel_submission - User wants to cancel/withdraw their application (e.g., "${ZH.cancel}", "${ZH.cancelShort}", "${ZH.cancelGiveUp}")
4. urge - User wants to urge/expedite their application (e.g., "${ZH.urge}", "${ZH.urgeShort}", "${ZH.urgeFast}")
5. supplement - User wants to add supplementary materials (e.g., "${ZH.supplement}", "${ZH.supplementMaterials}", "${ZH.supplementAttachment}")
6. delegate - User wants to delegate their application to someone else (e.g., "${ZH.delegate}", "${ZH.delegateEntrust}", "${ZH.delegateTransfer}")
7. service_request - User wants to browse available services (e.g., "${ZH.serviceList}", "${ZH.serviceCanDo}", "${ZH.serviceHelp}")
8. unknown - Cannot determine the intent

Interpretation guidance:
- Users may mix process intent and form details in one sentence.
- When a user is clearly trying to start a workflow and also provides dates, reasons, places, people, or quantities, that is usually still "create_submission".
- Do not downgrade to "unknown" just because the message is conversational, short, or lacks formal wording.
- Prefer the user's immediate operational goal over surface wording.

IMPORTANT: Intent values must be lowercase with underscores (e.g., "create_submission", NOT "CREATE_SUBMISSION").

Also extract optional entities only when they are explicitly stated and you are highly confident:
- amount: monetary amounts (e.g., "${ZH.amountExample}", "${ZH.amountExample2}")
- date: dates (e.g., "2026-03-01", "${ZH.dateTomorrow}", "${ZH.dateNextMonday}")
- flowCode: only if the user explicitly mentions an exact process code
- flowName: only if the user explicitly mentions a concrete process/service name
- reason: reason or description text that is directly stated by the user

Respond in JSON format:
{
  "intent": "create_submission",
  "confidence": 0.95,
  "entities": {
    "amount": 1000,
    "date": "2026-03-01",
    "flowCode": "${ZH.genericFlowCode}",
    "flowName": "${ZH.genericFlowName}",
    "reason": "${ZH.reasonExample}"
  }
}`;

@Injectable()
export class IntentAgent {
  private readonly logger = new Logger(IntentAgent.name);
  private readonly llmClient = LLMClientFactory.createFromEnv();
  private readonly useLLM = process.env.USE_LLM_FOR_INTENT !== 'false';

  async detectIntent(message: string, context: IntentContext): Promise<IntentResult> {
    if (this.useLLM) {
      try {
        const llmResult = await this.detectIntentWithLLM(message, context);
        if (llmResult.intent !== ChatIntent.UNKNOWN) {
          return llmResult;
        }
      } catch (error: any) {
        this.logger.warn(`LLM intent detection failed, using conservative fallback: ${error.message}`);
      }
    }

    return this.detectIntentConservatively(message);
  }

  private async detectIntentWithLLM(message: string, context: IntentContext): Promise<IntentResult> {
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

    let jsonStr = response.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const result = JSON.parse(jsonStr);
    const normalizedIntent = this.normalizeIntent(result.intent);

    return {
      intent: normalizedIntent,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.8,
      extractedEntities: this.normalizeEntities(result.entities),
    };
  }

  private detectIntentConservatively(message: string): IntentResult {
    return {
      intent: ChatIntent.UNKNOWN,
      confidence: 0.1,
      extractedEntities: {},
    };
  }

  private normalizeIntent(value: unknown): ChatIntent {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.values(ChatIntent).includes(normalized as ChatIntent)
      ? normalized as ChatIntent
      : ChatIntent.UNKNOWN;
  }

  private normalizeEntities(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const source = value as Record<string, any>;
    const normalized: Record<string, any> = {};

    const flowCode = typeof source.flowCode === 'string'
      ? source.flowCode.trim()
      : (typeof source.processCode === 'string' ? source.processCode.trim() : '');
    if (flowCode) {
      normalized.flowCode = flowCode;
    }

    if (typeof source.flowName === 'string' && source.flowName.trim()) {
      normalized.flowName = source.flowName.trim();
    }

    if (typeof source.amount === 'number' && Number.isFinite(source.amount)) {
      normalized.amount = source.amount;
    }

    if (typeof source.date === 'string' && source.date.trim()) {
      normalized.date = source.date.trim();
    }

    if (typeof source.reason === 'string' && source.reason.trim()) {
      normalized.reason = source.reason.trim();
    }

    return normalized;
  }
}
