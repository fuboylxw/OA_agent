import { Injectable } from '@nestjs/common';
import {
  BaseLLMClient,
  LLMClientFactory,
  LLMToolCall,
  LLMToolDef,
} from '@uniflow/agent-kernel';
import { z } from 'zod';

const TEXT_GUIDE_PARSE_TOOL_NAME = 'submit_text_guide_document';

const TextGuidePlatformConfigSchema = z.object({
  entryUrl: z.string().trim().min(1).optional(),
  executorMode: z.enum(['browser', 'local', 'http', 'stub']).optional(),
  targetSystem: z.string().trim().min(1).optional(),
  jumpUrlTemplate: z.string().trim().min(1).optional(),
  ticketBrokerUrl: z.string().trim().min(1).optional(),
});

const TextGuideFieldSchema = z.object({
  label: z.string().trim().min(1),
  fieldKey: z.string().trim().min(1).optional(),
  type: z.enum(['text', 'number', 'date', 'select', 'file', 'textarea']).optional(),
  required: z.boolean().optional(),
  description: z.string().trim().min(1).optional(),
  example: z.string().trim().min(1).optional(),
  multiple: z.boolean().optional(),
  options: z.array(z.string().trim().min(1)).optional(),
});

const TextGuideFlowSchema = z.object({
  processName: z.string().trim().min(1),
  processCode: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  fields: z.array(TextGuideFieldSchema).default([]),
  testData: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  steps: z.array(z.string().trim().min(1)).min(1),
  platformConfig: TextGuidePlatformConfigSchema.optional().default({}),
});

const TextGuideStructuredDocumentSchema = z.object({
  platformConfig: TextGuidePlatformConfigSchema.optional().default({}),
  sharedSteps: z.array(z.string().trim().min(1)).default([]),
  flows: z.array(TextGuideFlowSchema).min(1),
});

const TEXT_GUIDE_PARSE_TOOL: LLMToolDef = {
  type: 'function',
  function: {
    name: TEXT_GUIDE_PARSE_TOOL_NAME,
    description: 'Return the normalized OA text-guide document as structured JSON.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['flows'],
      properties: {
        platformConfig: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entryUrl: { type: 'string' },
            executorMode: {
              type: 'string',
              enum: ['browser', 'local', 'http', 'stub'],
            },
            targetSystem: { type: 'string' },
            jumpUrlTemplate: { type: 'string' },
            ticketBrokerUrl: { type: 'string' },
          },
        },
        sharedSteps: {
          type: 'array',
          items: { type: 'string' },
        },
        flows: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['processName', 'steps'],
            properties: {
              processName: { type: 'string' },
              processCode: { type: 'string' },
              description: { type: 'string' },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['label'],
                  properties: {
                    label: { type: 'string' },
                    fieldKey: { type: 'string' },
                    type: {
                      type: 'string',
                      enum: ['text', 'number', 'date', 'select', 'file', 'textarea'],
                    },
                    required: { type: 'boolean' },
                    description: { type: 'string' },
                    example: { type: 'string' },
                    multiple: { type: 'boolean' },
                    options: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
              testData: {
                type: 'object',
                additionalProperties: {
                  anyOf: [
                    { type: 'string' },
                    { type: 'number' },
                    { type: 'boolean' },
                  ],
                },
              },
              steps: {
                type: 'array',
                minItems: 1,
                items: { type: 'string' },
              },
              platformConfig: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  entryUrl: { type: 'string' },
                  executorMode: {
                    type: 'string',
                    enum: ['browser', 'local', 'http', 'stub'],
                  },
                  targetSystem: { type: 'string' },
                  jumpUrlTemplate: { type: 'string' },
                  ticketBrokerUrl: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = [
  'You are an OA / RPA text-guide parser.',
  'Parse plain text, bullet lists, numbered lists, mixed Chinese-English text, and paragraph descriptions into a normalized structured document.',
  'Preserve the user intent and wording as much as possible in each step so downstream rule parsers can still understand the steps.',
  'Support both single-flow and multi-flow guides.',
  'If the guide contains parameter definitions or test samples, preserve them separately as fields and testData.',
  'For each declared parameter, preserve its explanation and sample value when present.',
  'If a parameter lists selectable choices, preserve them in field.options. If it says the field supports multiple selections or multiple files, preserve that in field.multiple.',
  'If the input contains explicit fields, placeholders, or a sample form that shows how many values the user needs to provide, the returned field count must match that source exactly. Do not add guessed fields and do not drop declared fields.',
  'When multiple flows clearly share login or navigation steps, put those reusable steps into sharedSteps.',
  'Do not invent APIs, selectors, credentials, hidden branches, or field keys.',
  'Do not inject test sample values into the executable steps unless the user explicitly wrote them as part of a step.',
  'If a process code is missing, you may omit processCode.',
  'Normalize executorMode only when it is clearly stated. Valid values are browser, local, http, stub.',
  `Return the result by calling the tool ${TEXT_GUIDE_PARSE_TOOL_NAME}.`,
].join('\n');

export type TextGuideStructuredDocument = z.infer<typeof TextGuideStructuredDocumentSchema>;

export interface TextGuideLlmParseInput {
  guideText: string;
  connectorName?: string;
  oaUrl?: string;
  platformConfig?: Record<string, any>;
}

@Injectable()
export class TextGuideLlmParserService {
  private llmClient?: BaseLLMClient;

  async parse(input: TextGuideLlmParseInput): Promise<TextGuideStructuredDocument | null> {
    const guideText = String(input.guideText || '').trim();
    if (!guideText || !this.isConfigured()) {
      return null;
    }

    const response = await this.getClient().chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: this.buildUserPrompt(input, guideText) },
      ],
      {
        tools: [TEXT_GUIDE_PARSE_TOOL],
        ...(this.resolveToolChoice()
          ? { toolChoice: this.resolveToolChoice() }
          : {}),
        trace: {
          scope: 'api.bootstrap.text_guide.parse',
          metadata: {
            connectorName: input.connectorName || null,
            hasOaUrl: Boolean(input.oaUrl),
            guideLength: guideText.length,
          },
        },
      },
    );

    const payload = this.extractPayload(response.content || '', response.toolCalls);
    const parsedDocument = TextGuideStructuredDocumentSchema.parse(payload);
    return this.normalizeDocument(parsedDocument, input);
  }

  private getClient() {
    if (!this.llmClient) {
      this.llmClient = LLMClientFactory.createFromEnv();
    }

    return this.llmClient;
  }

  private buildUserPrompt(input: TextGuideLlmParseInput, guideText: string) {
    return [
      'Parse the following user-provided OA operation guide into a normalized structured document.',
      'Important requirements:',
      '- The input may contain common sections such as "# 全局", "# 系统基本信息", "# 共享步骤", "## 流程: ...", "参数:", "用户办理时需要补充的信息:", "步骤:", "办理步骤:", "测试样例:", "特殊说明:", but it may also be free-form text.',
      '- Keep each step short and executable.',
      '- If the guide only describes one process, return exactly one flow.',
      '- If a step is clearly shared by multiple flows, place it in sharedSteps.',
      '- If parameter definitions are present, store them in fields.',
      '- Preserve parameter explanations, usage notes, and sample values in each field when the input provides them.',
      '- If parameter definitions include selectable values, preserve them in field.options. If they say the field is multi-select or supports multiple files, preserve that in field.multiple.',
      '- If the guide contains explicit fields, placeholders, or an example form showing how many values need to be filled, the number of returned fields must match that source exactly.',
      '- If test/sample values are present, store them in testData instead of hard-coding them into executable steps.',
      '',
      `Connector hint: ${input.connectorName || '(none)'}`,
      `OA URL hint: ${input.oaUrl || '(none)'}`,
      `Platform hint: ${JSON.stringify(this.normalizePlatformConfig(input.platformConfig))}`,
      '',
      'User text guide:',
      this.truncateText(guideText, 24000),
    ].join('\n');
  }

  private extractPayload(content: string, toolCalls?: LLMToolCall[]) {
    const toolCall = toolCalls?.find(
      (call) => call.function?.name === TEXT_GUIDE_PARSE_TOOL_NAME,
    );
    if (toolCall?.function?.arguments) {
      return JSON.parse(toolCall.function.arguments);
    }

    return this.parseJson(content);
  }

  private parseJson(content: string): unknown {
    let jsonText = content.trim();

    const fencedMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch) {
      jsonText = fencedMatch[1].trim();
    }

    const firstBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }

    return JSON.parse(jsonText);
  }

  private normalizeDocument(
    parsedDocument: TextGuideStructuredDocument,
    input: TextGuideLlmParseInput,
  ): TextGuideStructuredDocument {
    const fallbackProcessName = (input.connectorName || 'Text Guided Flow').trim() || 'Text Guided Flow';
    const documentPlatformConfig = this.normalizePlatformConfig({
      ...(input.platformConfig || {}),
      ...(parsedDocument.platformConfig || {}),
      ...((parsedDocument.platformConfig?.entryUrl || input.oaUrl)
        ? { entryUrl: parsedDocument.platformConfig?.entryUrl || input.oaUrl }
        : {}),
    });

    const flows = parsedDocument.flows
      .map((flow, index) => ({
        processName: flow.processName || `${fallbackProcessName}_${index + 1}`,
        ...(this.normalizeProcessCode(flow.processCode)
          ? { processCode: this.normalizeProcessCode(flow.processCode) }
          : {}),
        fields: this.normalizeFields(flow.fields),
        testData: this.normalizeTestData(flow.testData),
        steps: this.normalizeStepLines(flow.steps),
        platformConfig: this.normalizePlatformConfig(flow.platformConfig),
      }))
      .filter((flow) => flow.steps.length > 0);

    if (flows.length === 0) {
      throw new Error('LLM text-guide parser returned no executable steps');
    }

    return {
      platformConfig: documentPlatformConfig,
      sharedSteps: this.normalizeStepLines(parsedDocument.sharedSteps),
      flows,
    };
  }

  private normalizePlatformConfig(platformConfig?: Record<string, any>) {
    const normalized: Record<string, any> = {};
    if (!platformConfig || typeof platformConfig !== 'object' || Array.isArray(platformConfig)) {
      return normalized;
    }

    const entryUrl = String(platformConfig.entryUrl || '').trim();
    if (entryUrl) {
      normalized.entryUrl = entryUrl;
    }

    const targetSystem = String(platformConfig.targetSystem || '').trim();
    if (targetSystem) {
      normalized.targetSystem = targetSystem;
    }

    const jumpUrlTemplate = String(platformConfig.jumpUrlTemplate || '').trim();
    if (jumpUrlTemplate) {
      normalized.jumpUrlTemplate = jumpUrlTemplate;
    }

    const ticketBrokerUrl = String(platformConfig.ticketBrokerUrl || '').trim();
    if (ticketBrokerUrl) {
      normalized.ticketBrokerUrl = ticketBrokerUrl;
    }

    const executorMode = this.normalizeExecutorModeValue(platformConfig.executorMode);
    if (executorMode) {
      normalized.executorMode = executorMode;
    }

    return normalized;
  }

  private normalizeStepLines(lines: string[]) {
    return lines
      .map((line) => String(line || '').trim())
      .map((line) => line.replace(/^[-*]\s*/, ''))
      .map((line) => line.replace(/^\d+[.)]\s*/, ''))
      .filter(Boolean);
  }

  private normalizeFields(fields: Array<z.infer<typeof TextGuideFieldSchema>>) {
    return (fields || [])
      .map((field) => ({
        label: String(field.label || '').trim(),
        ...(this.normalizeProcessCode(field.fieldKey)
          ? { fieldKey: this.normalizeProcessCode(field.fieldKey) }
          : {}),
        ...(field.type ? { type: field.type } : {}),
        ...(field.required !== undefined ? { required: field.required } : {}),
        ...(field.description ? { description: String(field.description).trim() } : {}),
        ...(field.example ? { example: String(field.example).trim() } : {}),
        ...(field.multiple !== undefined ? { multiple: field.multiple } : {}),
        ...(Array.isArray(field.options) && field.options.length > 0
          ? {
              options: Array.from(
                new Set(
                  field.options
                    .map((option) => String(option || '').trim())
                    .filter(Boolean),
                ),
              ),
            }
          : {}),
      }))
      .filter((field) => field.label);
  }

  private normalizeTestData(testData: Record<string, string | number | boolean>) {
    return Object.fromEntries(
      Object.entries(testData || {})
        .map(([key, value]) => [String(key || '').trim(), String(value ?? '').trim()])
        .filter(([key, value]) => Boolean(key) && Boolean(value)),
    );
  }

  private normalizeProcessCode(value?: string) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized || undefined;
  }

  private normalizeExecutorModeValue(value: unknown) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'browser' || normalized === '浏览器') return 'browser';
    if (normalized === 'local' || normalized === '本地') return 'local';
    if (normalized === 'http' || normalized === '接口') return 'http';
    if (normalized === 'stub' || normalized === '模拟') return 'stub';
    return undefined;
  }

  private resolveToolChoice() {
    const provider = this.getProvider();
    if (provider === 'anthropic') {
      return {
        type: 'tool',
        name: TEXT_GUIDE_PARSE_TOOL_NAME,
      };
    }

    if (provider === 'openai' || provider === 'azure-openai' || provider === 'custom') {
      return {
        type: 'function',
        function: {
          name: TEXT_GUIDE_PARSE_TOOL_NAME,
        },
      };
    }

    return undefined;
  }

  private getProvider() {
    return String(process.env.LLM_PROVIDER || 'openai').trim().toLowerCase();
  }

  private isConfigured() {
    const enabled = String(process.env.TEXT_GUIDE_LLM_PARSER_ENABLED || '').trim().toLowerCase();
    if (enabled === 'false') {
      return false;
    }

    const provider = this.getProvider();
    const apiKey = String(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    const baseURL = String(process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || '').trim();

    if (provider === 'ollama') {
      return true;
    }

    if (provider === 'custom') {
      return Boolean(baseURL);
    }

    return Boolean(apiKey);
  }

  private truncateText(text: string, maxLength: number) {
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength)}\n... [truncated]`;
  }
}
