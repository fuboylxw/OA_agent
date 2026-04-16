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

interface IntentPattern {
  intent: ChatIntent;
  strongKeywords: string[];
  weakKeywords?: string[];
  weight: number;
}

const ZH = {
  createReimbursement: '\u6211\u8981\u62a5\u9500',
  createLeave: '\u7533\u8bf7\u8bf7\u5047',
  createPurchase: '\u53d1\u8d77\u91c7\u8d2d',
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
  amountExample2: '\u4e94\u767e\u5757',
  dateTomorrow: '\u660e\u5929',
  dateNextMonday: '\u4e0b\u5468\u4e00',
  flowTrip: '\u5dee\u65c5',
  flowLeave: '\u8bf7\u5047',
  flowPurchase: '\u91c7\u8d2d',
  reasonExample: '\u51fa\u5dee\u5317\u4eac',
  reimbursement: '\u62a5\u9500',
  launch: '\u53d1\u8d77',
  submit: '\u63d0\u4ea4',
  leave: '\u8bf7\u5047',
  purchase: '\u91c7\u8d2d',
  businessTrip: '\u51fa\u5dee',
  booking: '\u9884\u7ea6',
  travel: '\u5dee\u65c5',
  requestForm: '\u7533\u8bf7\u5355',
  request: '\u7533\u8bf7',
  handle: '\u529e\u7406',
  create: '\u521b\u5efa',
  newOne: '\u65b0\u5efa',
  fillForm: '\u586b\u5355',
  workflow: '\u6d41\u7a0b',
  progress: '\u8fdb\u5ea6',
  status: '\u72b6\u6001',
  where: '\u5230\u54ea\u4e86',
  approval: '\u5ba1\u6279',
  query: '\u67e5\u8be2',
  view: '\u67e5\u770b',
  myRequest: '\u6211\u7684\u7533\u8bf7',
  howGoing: '\u600e\u4e48\u6837\u4e86',
  withdraw: '\u64a4\u56de',
  cancelAction: '\u53d6\u6d88',
  revoke: '\u64a4\u9500',
  giveUp: '\u4e0d\u8981\u4e86',
  voidIt: '\u4f5c\u5e9f',
  urgeAction: '\u50ac\u529e',
  urgeOnce: '\u50ac\u4e00\u4e0b',
  expedite: '\u52a0\u6025',
  urgeAgain: '\u50ac\u4fc3',
  remind: '\u63d0\u9192',
  supplementAction: '\u8865\u4ef6',
  supplementMore: '\u8865\u5145',
  supplementDocs: '\u8865\u6750\u6599',
  append: '\u8ffd\u52a0',
  attachment: '\u9644\u4ef6',
  delegateAction: '\u8f6c\u529e',
  transfer: '\u8f6c\u4ea4',
  entrust: '\u59d4\u6258',
  agent: '\u4ee3\u529e',
  whatAvailable: '\u6709\u4ec0\u4e48',
  list: '\u5217\u8868',
  canHandle: '\u53ef\u4ee5\u529e',
  howHandle: '\u600e\u4e48\u529e',
  help: '\u5e2e\u52a9',
  navigation: '\u5bfc\u822a',
  meetingRoom: '\u4f1a\u8bae\u5ba4',
  yuan: '\u5143',
  kuai: '\u5757',
  wan: '\u4e07',
  qian: '\u5343',
} as const;

const INTENT_SYSTEM_PROMPT = `You are an intent classification assistant for an office automation system.

Your task is to analyze the user's whole utterance, infer what they are trying to get done right now, and classify it into one of the following intents:

1. create_submission - User wants to create a new application/submission (e.g., "${ZH.createReimbursement}", "${ZH.createLeave}", "${ZH.createPurchase}")
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

Also extract any relevant entities from the message:
- amount: monetary amounts (e.g., "${ZH.amountExample}", "${ZH.amountExample2}")
- date: dates (e.g., "2026-03-01", "${ZH.dateTomorrow}", "${ZH.dateNextMonday}")
- flowType: process type keywords (e.g., "${ZH.flowTrip}", "${ZH.flowLeave}", "${ZH.flowPurchase}")
- reason: reason or description text

Respond in JSON format:
{
  "intent": "create_submission",
  "confidence": 0.95,
  "entities": {
    "amount": 1000,
    "date": "2026-03-01",
    "flowType": "travel_expense",
    "reason": "${ZH.reasonExample}"
  }
}`;

const RULE_FIRST_CONFIDENCE_THRESHOLD = 0.55;
const QUERY_FLOW_COMPOUND_BONUS = 0.25;

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: ChatIntent.CREATE_SUBMISSION,
    strongKeywords: [
      ZH.reimbursement,
      ZH.launch,
      ZH.submit,
      ZH.leave,
      ZH.purchase,
      ZH.businessTrip,
      ZH.booking,
      ZH.travel,
      ZH.requestForm,
      'expense',
      'reimburse',
      'reimbursement',
      'leave',
      'vacation',
      'purchase',
      'procurement',
      'submit',
      'apply',
      'application',
    ],
    weakKeywords: [ZH.request, ZH.handle, ZH.create, ZH.newOne, ZH.fillForm, ZH.workflow, 'workflow', 'form'],
    weight: 1.0,
  },
  {
    intent: ChatIntent.QUERY_STATUS,
    strongKeywords: [
      ZH.progress,
      ZH.status,
      ZH.where,
      ZH.approval,
      ZH.query,
      ZH.view,
      ZH.myRequest,
      ZH.howGoing,
      'status',
      'progress',
      'track',
      'where is',
    ],
    weight: 0.9,
  },
  {
    intent: ChatIntent.CANCEL_SUBMISSION,
    strongKeywords: [ZH.withdraw, ZH.cancelAction, ZH.revoke, ZH.giveUp, ZH.voidIt, 'cancel', 'withdraw', 'revoke'],
    weight: 0.95,
  },
  {
    intent: ChatIntent.URGE,
    strongKeywords: [ZH.urgeAction, ZH.urgeOnce, ZH.expedite, ZH.urgeAgain, ZH.remind, 'urge', 'expedite', 'follow up'],
    weight: 0.9,
  },
  {
    intent: ChatIntent.SUPPLEMENT,
    strongKeywords: [ZH.supplementAction, ZH.supplementMore, ZH.supplementDocs, ZH.append, ZH.attachment, 'supplement', 'attachment', 'upload'],
    weight: 0.9,
  },
  {
    intent: ChatIntent.DELEGATE,
    strongKeywords: [ZH.delegateAction, ZH.transfer, ZH.entrust, ZH.agent, 'delegate', 'assign', 'transfer'],
    weight: 0.9,
  },
  {
    intent: ChatIntent.SERVICE_REQUEST,
    strongKeywords: [ZH.whatAvailable, ZH.workflow, ZH.list, ZH.canHandle, ZH.howHandle, ZH.help, ZH.navigation, 'help', 'service', 'list'],
    weight: 0.8,
  },
];

const FLOW_TYPE_KEYWORDS: Record<string, string> = {
  [ZH.travel]: 'travel_expense',
  [ZH.reimbursement]: 'travel_expense',
  [ZH.leave]: 'leave_request',
  [ZH.purchase]: 'purchase_request',
  [ZH.meetingRoom]: 'meeting_room',
  [ZH.businessTrip]: 'business_trip',
  expense: 'travel_expense',
  reimburse: 'travel_expense',
  leave: 'leave_request',
  purchase: 'purchase_request',
  procurement: 'purchase_request',
  meeting: 'meeting_room',
  trip: 'business_trip',
};

const QUERY_HINT_KEYWORDS = [
  ZH.progress,
  ZH.status,
  ZH.where,
  ZH.approval,
  ZH.query,
  ZH.view,
  ZH.myRequest,
  ZH.howGoing,
  'status',
  'progress',
  'track',
  'where is',
];

@Injectable()
export class IntentAgent {
  private readonly logger = new Logger(IntentAgent.name);
  private readonly llmClient = LLMClientFactory.createFromEnv();
  private readonly useLLM = process.env.USE_LLM_FOR_INTENT !== 'false';

  async detectIntent(message: string, context: IntentContext): Promise<IntentResult> {
    const ruleResult = this.detectIntentWithRules(message);

    if (!this.useLLM || this.shouldPreferRules(ruleResult)) {
      return ruleResult;
    }

    try {
      const llmResult = await this.detectIntentWithLLM(message, context);
      return this.mergeIntentResults(ruleResult, llmResult);
    } catch (error: any) {
      this.logger.warn(`LLM intent detection failed, using rules: ${error.message}`);
      return ruleResult;
    }
  }

  private shouldPreferRules(ruleResult: IntentResult) {
    return ruleResult.intent !== ChatIntent.UNKNOWN && ruleResult.confidence >= RULE_FIRST_CONFIDENCE_THRESHOLD;
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

  private detectIntentWithRules(message: string): IntentResult {
    const scores = new Map<ChatIntent, number>();
    const normalizedMessage = message.trim().toLowerCase();

    for (const pattern of INTENT_PATTERNS) {
      const strongMatches = pattern.strongKeywords.filter((keyword) => normalizedMessage.includes(keyword.toLowerCase())).length;
      const weakMatches = (pattern.weakKeywords || []).filter((keyword) => normalizedMessage.includes(keyword.toLowerCase())).length;

      if (strongMatches > 0 || weakMatches > 0) {
        const score = this.computeRuleScore(strongMatches, weakMatches, pattern.weight);
        const existing = scores.get(pattern.intent) || 0;
        scores.set(pattern.intent, Math.max(existing, score));
      }
    }

    this.applyCompoundIntentHeuristics(scores, normalizedMessage);

    let bestIntent = ChatIntent.UNKNOWN;
    let bestScore = 0;

    for (const [intent, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    return {
      intent: bestIntent,
      confidence: bestScore > 0 ? Math.min(bestScore + 0.2, 0.95) : 0.1,
      extractedEntities: this.extractEntities(message),
    };
  }

  private applyCompoundIntentHeuristics(
    scores: Map<ChatIntent, number>,
    normalizedMessage: string,
  ) {
    const hasFlowKeyword = Object.keys(FLOW_TYPE_KEYWORDS).some((keyword) =>
      normalizedMessage.includes(keyword.toLowerCase()),
    );
    const hasQueryHint = QUERY_HINT_KEYWORDS.some((keyword) =>
      normalizedMessage.includes(keyword.toLowerCase()),
    );
    const mentionsExistingRequest = normalizedMessage.includes(ZH.request)
      || normalizedMessage.includes('application');

    if (hasQueryHint && (hasFlowKeyword || mentionsExistingRequest)) {
      this.bumpScore(scores, ChatIntent.QUERY_STATUS, QUERY_FLOW_COMPOUND_BONUS);
    }
  }

  private mergeIntentResults(ruleResult: IntentResult, llmResult: IntentResult): IntentResult {
    if (llmResult.intent === ChatIntent.UNKNOWN && ruleResult.intent !== ChatIntent.UNKNOWN) {
      return ruleResult;
    }

    if (llmResult.intent === ruleResult.intent && ruleResult.intent !== ChatIntent.UNKNOWN) {
      return {
        intent: llmResult.intent,
        confidence: Math.max(ruleResult.confidence, llmResult.confidence),
        extractedEntities: {
          ...(ruleResult.extractedEntities || {}),
          ...(llmResult.extractedEntities || {}),
        },
      };
    }

    if (llmResult.confidence >= ruleResult.confidence) {
      return {
        ...llmResult,
        extractedEntities: {
          ...(ruleResult.extractedEntities || {}),
          ...(llmResult.extractedEntities || {}),
        },
      };
    }

    return ruleResult;
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
    return value as Record<string, any>;
  }

  private computeRuleScore(strongMatches: number, weakMatches: number, weight: number): number {
    const evidenceScore = Math.min(1, strongMatches * 0.35 + weakMatches * 0.1);
    return evidenceScore * weight;
  }

  private bumpScore(scores: Map<ChatIntent, number>, intent: ChatIntent, delta: number) {
    const current = scores.get(intent) || 0;
    scores.set(intent, Math.min(1, current + delta));
  }

  private extractEntities(message: string): Record<string, any> {
    const entities: Record<string, any> = {};

    const amountMatch = message.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${ZH.wan}|${ZH.qian}|k|K|${ZH.yuan}|${ZH.kuai})`));
    if (amountMatch) {
      let amount = parseFloat(amountMatch[1]);
      const unit = amountMatch[2];
      if (unit === ZH.wan) {
        amount *= 10000;
      } else if (unit === ZH.qian || unit.toLowerCase() === 'k') {
        amount *= 1000;
      }
      entities.amount = amount;
    }

    const dateMatch = message.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
    if (dateMatch) {
      entities.date = dateMatch[1].replace(/\//g, '-');
    }

    const normalizedMessage = message.toLowerCase();
    for (const [keyword, code] of Object.entries(FLOW_TYPE_KEYWORDS)) {
      if (normalizedMessage.includes(keyword.toLowerCase())) {
        entities.flowCode = code;
        entities.flowKeyword = keyword;
        break;
      }
    }

    return entities;
  }
}
