import { Injectable, Logger } from '@nestjs/common';
import { LLMClientFactory, LLMMessage } from '@uniflow/agent-kernel';
import {
  AssistantFieldSemanticKind,
  isProbablyRawFieldLabel,
  resolveAssistantFieldPresentation,
} from '@uniflow/shared-types';
import { isAuthCredentialField } from '../../common/auth-field.util';

interface ProcessField {
  key: string;
  label: string;
  rawLabel: string;
  type: string;
  required: boolean;
  options?: Array<{ label: string; value: string }>;
  aliases: string[];
  semanticKind: AssistantFieldSemanticKind;
}

interface RawProcessField {
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string } | string>;
  fieldCode?: string;
  fieldName?: string;
  fieldType?: string;
}

interface ProcessSchema {
  fields: RawProcessField[];
}

interface FormExtractionResult {
  extractedFields: Record<string, any>;
  fieldOrigins: Record<string, 'user' | 'derived'>;
  missingFields: Array<{ key: string; label: string; question: string; type?: string }>;
  isComplete: boolean;
}

interface FormModificationResult {
  modifiedFields: Record<string, any>;
  fieldOrigins: Record<string, 'user' | 'derived'>;
}

interface LLMExtractionPayload {
  extractedFields: Record<string, any>;
  missingFieldQuestions: Record<string, string>;
}

const FORM_EXTRACTION_SYSTEM_PROMPT = `你是一个面向员工的智能表单填写助手。

你的任务是从用户自然语言里提取表单字段值，并补充用户视角的追问。

要求：
1. 优先理解用户整句话的真实办事内容，不要求用户使用固定格式。
2. 用户可能一次性给出多个字段信息，也可能把信息混在一句口语里；请尽可能完整吸收本轮已经说清楚的内容。
3. 只提取能够明确确认的信息，不要猜测，不要为了求全而编造。
4. 可以识别相对日期，如“明天”“后天”“下周一”。
5. 可以理解时长表达，如“三天”“半天”。
6. 目标是尽量一次性补齐用户这轮消息中已经表达清楚的信息，减少追问。
7. 可以结合当前已收集表单内容、字段语义、业务上下文做高置信度理解，但不要编造用户没有表达的信息。
8. 如果某项信息仍缺失，请为该字段生成一句面向用户的追问。
9. 追问绝对不能暴露字段代码或原始 API 名称，例如不能出现 leave_type、start_time 这类词。
10. 追问应最小化，优先只问真正缺失且提交前必需的信息，不要重复确认用户已经明确表达过的内容。

返回 JSON：
{
  "extractedFields": {
    "field_key": "value"
  },
  "missingFieldQuestions": {
    "field_key": "面向用户的自然提问"
  },
  "reasoning": "简要说明"
}`;

const FORM_MODIFICATION_SYSTEM_PROMPT = `你是一个面向员工的智能表单修改助手。

你的任务是基于当前表单内容，识别用户这轮消息里想修改的字段，并返回修改后的值。

要求：
1. 只返回用户明确想修改的字段，不要把未提及的字段带回。
2. 用户说“理由不变”“其他不变”时，不要返回这些字段。
3. 可以识别相对日期、时长和基于当前表单的相对修改，例如“提前一天”“延后两天”。
4. 如果用户的表达足以推出结果值，可以直接给出最终字段值。
5. 默认按用户视角理解修改意图，避免机械地要求其复述字段原名。
6. 不要输出额外说明，只返回 JSON。

返回 JSON：
{
  "modifiedFields": {
    "field_key": "new_value"
  },
  "reasoning": "简要说明"
}`;

@Injectable()
export class FormAgent {
  private readonly logger = new Logger(FormAgent.name);
  private llmClient = LLMClientFactory.createFromEnv();

  async extractFields(
    processCode: string,
    processSchema: ProcessSchema,
    userMessage: string,
    currentFormData?: Record<string, any>,
  ): Promise<FormExtractionResult> {
    const formData = { ...(currentFormData || {}) };
    const normalizedFields = this.normalizeFields(processSchema.fields || [], processCode);
    const pendingFields = normalizedFields.filter((field) => formData[field.key] === undefined);

    if (pendingFields.length === 0) {
      return {
        extractedFields: {},
        fieldOrigins: {},
        missingFields: [],
        isComplete: true,
      };
    }

    let llmPayload: LLMExtractionPayload = {
      extractedFields: {},
      missingFieldQuestions: {},
    };

    const nonFileFields = pendingFields.filter((field) => field.type !== 'file');
    if (nonFileFields.length > 0) {
      try {
        llmPayload = await this.extractWithLLM(
          nonFileFields,
          userMessage,
          processCode,
          formData,
        );
      } catch (error: any) {
        this.logger.warn(`LLM field extraction failed, falling back to rules: ${error.message}`);
      }
    }

    const extractedFields = this.normalizeExtractedFields(
      nonFileFields,
      llmPayload.extractedFields,
    );
    const fieldOrigins: Record<string, 'user' | 'derived'> = Object.fromEntries(
      Object.keys(extractedFields).map((key) => [key, 'user' as const]),
    );
    const mergedWithLLM = { ...formData, ...extractedFields };
    const fallbackFields = this.extractDeterministicComplements(
      nonFileFields.filter((field) => mergedWithLLM[field.key] === undefined),
      userMessage,
      mergedWithLLM,
      Object.keys(extractedFields).length === 0,
      fieldOrigins,
    );

    for (const [key, value] of Object.entries(fallbackFields)) {
      if (extractedFields[key] === undefined) {
        extractedFields[key] = value;
      }
    }

    for (const [key, value] of Object.entries(extractedFields)) {
      formData[key] = value;
    }

    const missingFields: Array<{ key: string; label: string; question: string; type?: string }> = [];
    for (const field of normalizedFields) {
      if (!field.required || formData[field.key] !== undefined) {
        continue;
      }

      missingFields.push({
        key: field.key,
        label: field.label,
        question: this.sanitizeQuestion(
          llmPayload.missingFieldQuestions[field.key],
          field,
        ),
        type: field.type,
      });
    }

    return {
      extractedFields,
      fieldOrigins,
      missingFields,
      isComplete: missingFields.length === 0,
    };
  }

  async extractModifications(
    processCode: string,
    processSchema: ProcessSchema,
    userMessage: string,
    currentFormData: Record<string, any>,
  ): Promise<FormModificationResult> {
    const normalizedFields = this.normalizeFields(processSchema.fields || [], processCode);

    let llmModifiedFields: Record<string, any> = {};
    try {
      llmModifiedFields = await this.extractModificationsWithLLM(
        normalizedFields.filter((field) => field.type !== 'file'),
        userMessage,
        processCode,
        currentFormData,
      );
    } catch (error: any) {
      this.logger.warn(`LLM modification extraction failed, falling back to rules: ${error.message}`);
    }

    const modifiedFields = this.normalizeExtractedFields(normalizedFields, llmModifiedFields);
    const fieldOrigins: Record<string, 'user' | 'derived'> = Object.fromEntries(
      Object.keys(modifiedFields).map((key) => [key, 'user' as const]),
    );

    const fallbackFields = this.extractModifiedFieldsWithRules(
      normalizedFields,
      userMessage,
      currentFormData,
      fieldOrigins,
      Object.keys(modifiedFields).length === 0,
    );

    for (const [key, value] of Object.entries(fallbackFields)) {
      if (modifiedFields[key] === undefined) {
        modifiedFields[key] = value;
      }
    }

    this.applyDerivedModificationInference(
      normalizedFields,
      userMessage,
      currentFormData,
      modifiedFields,
      fieldOrigins,
    );

    return {
      modifiedFields,
      fieldOrigins,
    };
  }

  private normalizeFields(fields: RawProcessField[], processCode: string): ProcessField[] {
    return fields
      .map((field) => {
        const key = String(field.key || field.fieldCode || '').trim();
        const rawLabel = String(field.label || field.fieldName || key).trim();
        const normalizedOptions = this.normalizeOptions(field.options);
        const presentation = resolveAssistantFieldPresentation({
          key,
          label: rawLabel,
          type: field.type || field.fieldType,
          options: normalizedOptions,
          processCode,
        });

        return {
          key,
          label: presentation.label,
          rawLabel: presentation.rawLabel || rawLabel,
          type: presentation.type,
          required: field.required ?? false,
          options: normalizedOptions,
          aliases: presentation.aliases,
          semanticKind: presentation.semanticKind,
        };
      })
      .filter((field) => !isAuthCredentialField({
        key: field.key,
        label: field.rawLabel || field.label,
      }));
  }

  private normalizeOptions(
    options?: Array<{ label: string; value: string } | string>,
  ): Array<{ label: string; value: string }> | undefined {
    if (!Array.isArray(options) || options.length === 0) {
      return undefined;
    }

    return options
      .map((option) => {
        if (typeof option === 'string') {
          const trimmed = option.trim();
          return trimmed ? { label: trimmed, value: trimmed } : null;
        }

        const label = String(option?.label || option?.value || '').trim();
        const value = String(option?.value || option?.label || '').trim();
        if (!label || !value) {
          return null;
        }

        return { label, value };
      })
      .filter((option): option is { label: string; value: string } => Boolean(option));
  }

  private async extractWithLLM(
    pendingFields: ProcessField[],
    userMessage: string,
    processCode: string,
    currentFormData: Record<string, any>,
  ): Promise<LLMExtractionPayload> {
    const today = new Date();
    const todayStr = this.formatDate(today);
    const fieldDescriptions = this.buildFieldDescriptions(pendingFields);

    const currentData = Object.keys(currentFormData).length > 0
      ? JSON.stringify(currentFormData, null, 2)
      : '{}';

    const messages: LLMMessage[] = [
      { role: 'system', content: FORM_EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `今天是 ${todayStr}。
流程编码：${processCode}

已收集到的表单内容：
${currentData}

待识别字段：
${fieldDescriptions.join('\n')}

用户原话：
"${userMessage}"

请返回 JSON。`,
      },
    ];

    const response = await this.llmClient.chat(messages, {
      trace: {
        scope: 'assistant.form.extract',
        metadata: {
          processCode,
          pendingFieldCount: pendingFields.length,
        },
      },
    });

    let jsonStr = response.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const result = JSON.parse(jsonStr);
    const pendingFieldMap = new Map(pendingFields.map((field) => [field.key, field]));
    const extractedFields: Record<string, any> = {};
    const missingFieldQuestions: Record<string, string> = {};

    if (result.reasoning) {
      this.logger.log(`LLM extraction reasoning: ${result.reasoning}`);
    }

    for (const [key, value] of Object.entries(result.extractedFields || {})) {
      if (!pendingFieldMap.has(key) || value === null || value === undefined || value === '') {
        continue;
      }
      extractedFields[key] = value;
    }

    for (const [key, value] of Object.entries(result.missingFieldQuestions || {})) {
      const field = pendingFieldMap.get(key);
      if (!field || typeof value !== 'string' || value.trim().length === 0) {
        continue;
      }
      missingFieldQuestions[key] = this.sanitizeQuestion(value, field);
    }

    this.logger.log(`Extracted ${Object.keys(extractedFields).length} fields from user message`);

    return { extractedFields, missingFieldQuestions };
  }

  private async extractModificationsWithLLM(
    fields: ProcessField[],
    userMessage: string,
    processCode: string,
    currentFormData: Record<string, any>,
  ): Promise<Record<string, any>> {
    if (fields.length === 0) {
      return {};
    }

    const today = new Date();
    const todayStr = this.formatDate(today);
    const fieldDescriptions = this.buildFieldDescriptions(fields);
    const currentData = Object.keys(currentFormData).length > 0
      ? JSON.stringify(currentFormData, null, 2)
      : '{}';

    const messages: LLMMessage[] = [
      { role: 'system', content: FORM_MODIFICATION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `今天是 ${todayStr}。
流程编码：${processCode}

当前表单内容：
${currentData}

可修改字段：
${fieldDescriptions.join('\n')}

用户原话：
"${userMessage}"

请返回 JSON。`,
      },
    ];

    const response = await this.llmClient.chat(messages, {
      trace: {
        scope: 'assistant.form.modify',
        metadata: {
          processCode,
          fieldCount: fields.length,
        },
      },
    });

    let jsonStr = response.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const result = JSON.parse(jsonStr);
    if (result.reasoning) {
      this.logger.log(`LLM modification reasoning: ${result.reasoning}`);
    }

    const fieldMap = new Map(fields.map((field) => [field.key, field]));
    const modifiedFields: Record<string, any> = {};

    for (const [key, value] of Object.entries(result.modifiedFields || {})) {
      if (!fieldMap.has(key) || value === null || value === undefined || value === '') {
        continue;
      }
      modifiedFields[key] = value;
    }

    return modifiedFields;
  }

  private buildFieldDescriptions(fields: ProcessField[]) {
    return fields.map((field) => {
      const aliases = field.aliases.filter((alias) => alias !== field.key).slice(0, 6);
      const optionLabels = (field.options || []).map((option) => option.label);
      const descriptionParts = [
        `- key=${field.key}`,
        `用户名称=${field.label}`,
        `类型=${field.type}`,
        `必填=${field.required}`,
      ];

      if (field.rawLabel && field.rawLabel !== field.label) {
        descriptionParts.push(`原始字段名=${field.rawLabel}`);
      }
      if (aliases.length > 0) {
        descriptionParts.push(`可参考叫法=${aliases.join(' / ')}`);
      }
      if (optionLabels.length > 0) {
        descriptionParts.push(`可选值=${optionLabels.join(' / ')}`);
      }

      return descriptionParts.join('，');
    });
  }

  private extractWithRules(
    pendingFields: ProcessField[],
    userMessage: string,
    knownFormData: Record<string, any>,
    fieldOrigins?: Record<string, 'user' | 'derived'>,
  ): Record<string, any> {
    const extracted: Record<string, any> = {};

    for (const field of pendingFields) {
      const value = this.extractFieldWithRules(field, userMessage);
      if (value !== undefined) {
        extracted[field.key] = value;
        if (fieldOrigins) {
          fieldOrigins[field.key] = 'user';
        }
      }
    }

    this.applyDerivedFieldInference(
      pendingFields,
      userMessage,
      { ...knownFormData, ...extracted },
      extracted,
      fieldOrigins,
    );

    return extracted;
  }

  private extractDeterministicComplements(
    pendingFields: ProcessField[],
    userMessage: string,
    knownFormData: Record<string, any>,
    allowGenericFallback: boolean,
    fieldOrigins: Record<string, 'user' | 'derived'>,
  ): Record<string, any> {
    const supplementCandidates = pendingFields.filter((field) =>
      allowGenericFallback || this.isHighPrecisionRuleField(field),
    );

    return this.extractWithRules(supplementCandidates, userMessage, knownFormData, fieldOrigins);
  }

  private extractModifiedFieldsWithRules(
    fields: ProcessField[],
    userMessage: string,
    currentFormData: Record<string, any>,
    fieldOrigins: Record<string, 'user' | 'derived'>,
    _allowFallback: boolean,
  ): Record<string, any> {
    const extracted: Record<string, any> = {};

    for (const field of fields) {
      const value = this.extractModifiedFieldWithRules(
        field,
        userMessage,
        currentFormData[field.key],
      );
      if (value !== undefined) {
        extracted[field.key] = value;
        fieldOrigins[field.key] = 'user';
      }
    }

    return extracted;
  }

  private extractModifiedFieldWithRules(
    field: ProcessField,
    userMessage: string,
    currentValue: any,
  ): any {
    if (field.type === 'file') {
      return undefined;
    }

    if (this.isFieldMarkedUnchanged(field, userMessage)) {
      return undefined;
    }

    const explicitFieldPattern = this.buildExplicitFieldPattern(field);
    if (!explicitFieldPattern) {
      return undefined;
    }

    if (field.semanticKind === 'start_time' || field.semanticKind === 'end_time' || field.type === 'date') {
      return this.extractModifiedDateField(userMessage, currentValue, explicitFieldPattern);
    }

    if (field.semanticKind === 'amount' || field.type === 'number') {
      return this.extractModifiedNumberField(userMessage, explicitFieldPattern);
    }

    if (field.semanticKind === 'leave_type' || field.type === 'select' || field.type === 'radio') {
      return this.extractModifiedOptionField(field, userMessage, explicitFieldPattern);
    }

    if (field.semanticKind === 'reason') {
      return this.extractModifiedTextField(userMessage, explicitFieldPattern);
    }

    return undefined;
  }

  private isHighPrecisionRuleField(field: ProcessField): boolean {
    return (
      field.semanticKind === 'leave_type'
      || field.semanticKind === 'reason'
      || field.semanticKind === 'start_time'
      || field.semanticKind === 'end_time'
      || field.semanticKind === 'amount'
      || field.type === 'date'
      || field.type === 'number'
      || field.type === 'select'
      || field.type === 'radio'
    );
  }

  private normalizeExtractedFields(
    fields: ProcessField[],
    rawValues: Record<string, any>,
  ): Record<string, any> {
    const fieldMap = new Map(fields.map((field) => [field.key, field]));
    const normalized: Record<string, any> = {};

    for (const [key, rawValue] of Object.entries(rawValues || {})) {
      const field = fieldMap.get(key);
      if (!field) {
        continue;
      }

      const normalizedValue = this.normalizeFieldValue(field, rawValue);
      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue;
      }
    }

    return normalized;
  }

  private normalizeFieldValue(field: ProcessField, rawValue: any): any {
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      return undefined;
    }

    if (field.semanticKind === 'start_time' || field.semanticKind === 'end_time' || field.type === 'date') {
      return this.normalizeDateValue(rawValue);
    }

    if (field.semanticKind === 'leave_type' || field.type === 'select' || field.type === 'radio') {
      return this.normalizeOptionValue(field, rawValue);
    }

    if (field.semanticKind === 'amount' || field.type === 'number') {
      return this.normalizeNumberValue(rawValue);
    }

    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      return trimmed || undefined;
    }

    return rawValue;
  }

  private normalizeDateValue(rawValue: any): string | undefined {
    if (typeof rawValue !== 'string') {
      return undefined;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return undefined;
    }

    return this.parseDateExpression(trimmed)
      || (() => {
        const parsed = this.parseDateString(trimmed);
        return parsed ? this.formatDate(parsed) : undefined;
      })()
      || this.tryNormalizeDateFromText(trimmed);
  }

  private tryNormalizeDateFromText(value: string): string | undefined {
    const expressions = this.extractDateExpressions(value);
    if (expressions.length === 0) {
      return undefined;
    }

    return this.parseDateExpression(expressions[0]);
  }

  private normalizeOptionValue(field: ProcessField, rawValue: any): string | undefined {
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
      return undefined;
    }

    const text = String(rawValue).trim();
    if (!text) {
      return undefined;
    }

    if (!field.options || field.options.length === 0) {
      return text;
    }

    return this.mapValueToOption(text, field.options);
  }

  private normalizeNumberValue(rawValue: any): number | undefined {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue;
    }

    if (typeof rawValue !== 'string') {
      return undefined;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return undefined;
    }

    const explicitMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(万|千|k|K)?/);
    if (explicitMatch) {
      return this.parseNumericValue(explicitMatch[1], explicitMatch[2]);
    }

    return undefined;
  }

  private extractFieldWithRules(field: ProcessField, userMessage: string): any {
    if (field.type === 'file') {
      return undefined;
    }

    if (field.semanticKind === 'leave_type') {
      return this.extractLeaveTypeField(field, userMessage);
    }

    if (field.semanticKind === 'reason') {
      return this.extractReasonField(field, userMessage);
    }

    if (field.semanticKind === 'start_time' || field.semanticKind === 'end_time' || field.type === 'date') {
      return this.extractDateField(field, userMessage);
    }

    if (field.semanticKind === 'amount' || field.type === 'number') {
      return this.extractNumberField(field, userMessage);
    }

    if (field.type === 'select' || field.type === 'radio') {
      return this.extractOptionField(field, userMessage);
    }

    return this.extractTextField(field, userMessage);
  }

  private extractLeaveTypeField(field: ProcessField, userMessage: string): string | undefined {
    const optionValue = this.extractOptionField(field, userMessage);
    if (optionValue !== undefined) {
      return optionValue;
    }

    const candidates = [
      { value: '年假', keywords: ['年假', '年休假', 'annual leave', 'annual'] },
      { value: '事假', keywords: ['事假', 'personal leave', 'personal'] },
      { value: '病假', keywords: ['病假', 'sick leave', 'sick'] },
      { value: '调休', keywords: ['调休', '补休', 'compensatory'] },
      { value: '婚假', keywords: ['婚假'] },
      { value: '产假', keywords: ['产假', '产检假'] },
      { value: '陪产假', keywords: ['陪产假', '陪护假'] },
      { value: '丧假', keywords: ['丧假'] },
    ];

    const normalizedMessage = userMessage.toLowerCase();
    for (const candidate of candidates) {
      if (candidate.keywords.some((keyword) => normalizedMessage.includes(keyword))) {
        return this.mapValueToOption(candidate.value, field.options) || candidate.value;
      }
    }

    return undefined;
  }

  private extractNumberField(field: ProcessField, userMessage: string): number | undefined {
    const fieldPatterns = this.buildFieldPatterns(field);
    for (const pattern of fieldPatterns) {
      const regex = new RegExp(`${pattern}\\s*(?:是|为|[:：])?\\s*(\\d+(?:\\.\\d+)?)\\s*(万|千|k|K)?`);
      const match = userMessage.match(regex);
      if (match) {
        return this.parseNumericValue(match[1], match[2]);
      }
    }

    const generalMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*(万|千|k|K)/);
    if (generalMatch) {
      return this.parseNumericValue(generalMatch[1], generalMatch[2]);
    }

    return undefined;
  }

  private extractDateField(field: ProcessField, userMessage: string): string | undefined {
    const taggedExpression = this.extractTaggedDateExpression(field, userMessage);
    if (taggedExpression) {
      return this.parseDateExpression(taggedExpression);
    }

    const expressions = this.extractDateExpressions(userMessage);
    if (expressions.length === 0) {
      return undefined;
    }

    if (field.semanticKind === 'start_time') {
      return this.parseDateExpression(expressions[0]);
    }
    if (field.semanticKind === 'end_time') {
      if (expressions.length > 1) {
        return this.parseDateExpression(expressions[expressions.length - 1]);
      }
      return undefined;
    }
    if (expressions.length === 1) {
      return this.parseDateExpression(expressions[0]);
    }

    return undefined;
  }

  private extractModifiedDateField(
    userMessage: string,
    currentValue: any,
    explicitFieldPattern: string,
  ): string | undefined {
    const directExpression = this.extractExplicitDateReplacement(userMessage, explicitFieldPattern);
    if (directExpression) {
      return this.parseDateExpression(directExpression);
    }

    const shifted = this.extractShiftedDateValue(userMessage, explicitFieldPattern, currentValue);
    if (shifted) {
      return shifted;
    }

    return undefined;
  }

  private extractModifiedNumberField(
    userMessage: string,
    explicitFieldPattern: string,
  ): number | undefined {
    const match = userMessage.match(
      new RegExp(`(?:把|将)?${explicitFieldPattern}(?:[^，。；;\\n]{0,12})?(?:改成|改为|调整为|换成|设为|设成|写成)?\\s*(\\d+(?:\\.\\d+)?)\\s*(万|千|k|K)?`, 'i'),
    );
    if (!match) {
      return undefined;
    }

    return this.parseNumericValue(match[1], match[2]);
  }

  private extractModifiedOptionField(
    field: ProcessField,
    userMessage: string,
    explicitFieldPattern: string,
  ): string | undefined {
    const explicitRegex = new RegExp(`(?:把|将)?${explicitFieldPattern}(?:[^，。；;\\n]{0,12})?(?:改成|改为|调整为|换成|设为|设成|写成)?`, 'i');
    if (!explicitRegex.test(userMessage)) {
      return undefined;
    }

    const optionValue = this.extractOptionField(field, userMessage);
    if (optionValue !== undefined) {
      return optionValue;
    }

    return undefined;
  }

  private extractModifiedTextField(
    userMessage: string,
    explicitFieldPattern: string,
  ): string | undefined {
    const match = userMessage.match(
      new RegExp(`(?:把|将)?${explicitFieldPattern}(?:[^，。；;\\n]{0,12})?(?:改成|改为|调整为|换成|设为|设成|写成|更新为)?\\s*([^,，。；;\\n]+)`, 'i'),
    );
    if (match?.[1]) {
      return match[1].trim();
    }

    return undefined;
  }

  private extractOptionField(field: ProcessField, userMessage: string): string | undefined {
    const normalizedMessage = userMessage.toLowerCase();
    for (const option of field.options || []) {
      if (
        normalizedMessage.includes(String(option.label).toLowerCase())
        || normalizedMessage.includes(String(option.value).toLowerCase())
      ) {
        return option.value;
      }
    }

    return undefined;
  }

  private extractReasonField(field: ProcessField, userMessage: string): string | undefined {
    const match = userMessage.match(
      /(?:原因|事由|理由|说明)\s*(?:是|为|[:：])?\s*([^,，。；;]+)/,
    );
    if (match?.[1]) {
      return match[1].trim();
    }

    const explicitText = this.extractTextField(field, userMessage);
    if (explicitText) {
      return explicitText;
    }

    return this.extractFreeTextReasonCandidate(userMessage);
  }

  private extractTextField(field: ProcessField, userMessage: string): string | undefined {
    const fieldPatterns = this.buildFieldPatterns(field);
    for (const pattern of fieldPatterns) {
      const regex = new RegExp(`${pattern}\\s*(?:是|为|[:：])\\s*([^,，。；;]+)`, 'i');
      const match = userMessage.match(regex);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  private extractFreeTextReasonCandidate(userMessage: string): string | undefined {
    const segments = userMessage
      .split(/[，,。；;、\n]/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length <= 1) {
      return undefined;
    }

    const candidates = segments
      .map((segment) => this.normalizeReasonCandidateSegment(segment))
      .filter((segment): segment is string => Boolean(segment));

    if (candidates.length === 0) {
      return undefined;
    }

    candidates.sort((left, right) => right.length - left.length);
    return candidates[0];
  }

  private normalizeReasonCandidateSegment(segment: string): string | undefined {
    const trimmed = segment.trim();
    if (!trimmed) {
      return undefined;
    }

    if (this.isLikelyContactSegment(trimmed)) {
      return undefined;
    }

    if (this.isLikelyDateOrScheduleSegment(trimmed)) {
      return undefined;
    }

    if (this.isLikelyGenericRequestSegment(trimmed)) {
      return undefined;
    }

    if (trimmed.length < 2) {
      return undefined;
    }

    return trimmed;
  }

  private isLikelyContactSegment(segment: string): boolean {
    return (
      /(联系(?:电话|方式)?|电话|手机号|手机|微信|邮箱|email|mail)/i.test(segment)
      || /\d{7,}/.test(segment)
    );
  }

  private isLikelyDateOrScheduleSegment(segment: string): boolean {
    if (/(半天|全天|上午|下午|晚上|几点|点到点|请假时间)/.test(segment)) {
      return true;
    }

    if (/([零一二两三四五六七八九十百\d.]+)\s*(?:个)?(?:工作)?天/.test(segment)) {
      return true;
    }

    const dateMatches = this.extractDateExpressions(segment);
    if (dateMatches.length === 0) {
      return false;
    }

    const stripped = segment
      .replace(new RegExp(this.getDateExpressionPattern(), 'g'), '')
      .replace(/(?:开始|结束|起始|截止|从|到|至|请假|日期|时间)/g, '')
      .replace(/\s+/g, '')
      .trim();

    return stripped.length === 0;
  }

  private isLikelyGenericRequestSegment(segment: string): boolean {
    const stripped = segment
      .replace(/^(我要|我想|想要|需要|帮我|请帮我|麻烦|请)\s*/, '')
      .replace(/^(申请|发起|办理|提交)\s*/, '')
      .replace(/\s+/g, '')
      .trim();

    if (!stripped) {
      return true;
    }

    return stripped.length <= 2;
  }

  private applyDerivedFieldInference(
    fields: ProcessField[],
    userMessage: string,
    mergedFormData: Record<string, any>,
    extracted: Record<string, any>,
    fieldOrigins?: Record<string, 'user' | 'derived'>,
  ) {
    const startField = fields.find((field) => field.semanticKind === 'start_time');
    const endField = fields.find((field) => field.semanticKind === 'end_time');

    if (!startField || !endField || mergedFormData[endField.key] !== undefined) {
      return;
    }

    const durationDays = this.extractDurationDays(userMessage);
    const startValue = mergedFormData[startField.key];

    if (durationDays === undefined || typeof startValue !== 'string') {
      return;
    }

    const endValue = this.deriveEndDateFromDuration(startValue, durationDays);
    if (endValue) {
      extracted[endField.key] = endValue;
      if (fieldOrigins) {
        fieldOrigins[endField.key] = 'derived';
      }
    }
  }

  private applyDerivedModificationInference(
    fields: ProcessField[],
    userMessage: string,
    currentFormData: Record<string, any>,
    modifiedFields: Record<string, any>,
    fieldOrigins?: Record<string, 'user' | 'derived'>,
  ) {
    const startField = fields.find((field) => field.semanticKind === 'start_time');
    const endField = fields.find((field) => field.semanticKind === 'end_time');
    if (!startField || !endField || modifiedFields[endField.key] !== undefined) {
      return;
    }

    const durationDays = this.extractDurationDays(userMessage);
    if (durationDays === undefined) {
      return;
    }

    const startValue = modifiedFields[startField.key] ?? currentFormData[startField.key];
    if (typeof startValue !== 'string') {
      return;
    }

    const endValue = this.deriveEndDateFromDuration(startValue, durationDays);
    if (endValue) {
      modifiedFields[endField.key] = endValue;
      if (fieldOrigins) {
        fieldOrigins[endField.key] = 'derived';
      }
    }
  }

  private extractDurationDays(userMessage: string): number | undefined {
    if (/半天/.test(userMessage)) {
      return 0.5;
    }

    const matches = Array.from(userMessage.matchAll(/([零一二两三四五六七八九十百\d.]+)\s*(?:个)?(?:工作)?天/g));
    const match = matches.length > 0 ? matches[matches.length - 1] : null;
    if (!match?.[1]) {
      return undefined;
    }

    return this.parseChineseNumber(match[1]);
  }

  private deriveEndDateFromDuration(startValue: string, durationDays: number): string | undefined {
    const startDate = this.parseDateString(startValue);
    if (!startDate) {
      return undefined;
    }

    const inclusiveOffset = Math.max(Math.ceil(durationDays) - 1, 0);
    return this.formatDate(this.addDays(startDate, inclusiveOffset));
  }

  private extractTaggedDateExpression(field: ProcessField, userMessage: string): string | undefined {
    const expression = this.getDateExpressionPattern();
    const patterns = field.semanticKind === 'end_time'
      ? [
        new RegExp(`(?:到|至|结束(?:时间|日期)?|截止(?:时间|日期)?)\\s*(${expression})`),
        new RegExp(`(${expression})\\s*(?:结束|截止)`),
      ]
      : [
        new RegExp(`(${expression})\\s*(?:开始|起)`),
        new RegExp(`(?:从|自|开始(?:时间|日期)?|起始(?:时间|日期)?)\\s*(${expression})`),
      ];

    for (const pattern of patterns) {
      const match = userMessage.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  private extractDateExpressions(userMessage: string): string[] {
    const pattern = new RegExp(this.getDateExpressionPattern(), 'g');
    return Array.from(userMessage.matchAll(pattern)).map((match) => match[0]).filter(Boolean);
  }

  private getDateExpressionPattern(): string {
    return [
      '\\d{4}[-/年]\\d{1,2}[-/月]\\d{1,2}(?:日|号)?',
      '\\d{1,2}[月/-]\\d{1,2}(?:日|号)?',
      '今天',
      '明天',
      '后天',
      '大后天',
      '下周[一二三四五六日天]',
      '这周[一二三四五六日天]',
      '本周[一二三四五六日天]',
      '周[一二三四五六日天]',
    ].join('|');
  }

  private parseDateExpression(value: string): string | undefined {
    const text = value.trim();
    const today = new Date();

    if (text === '今天') return this.formatDate(today);
    if (text === '明天') return this.formatDate(this.addDays(today, 1));
    if (text === '后天') return this.formatDate(this.addDays(today, 2));
    if (text === '大后天') return this.formatDate(this.addDays(today, 3));

    const yearMonthDay = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日|号)?/);
    if (yearMonthDay) {
      const year = Number(yearMonthDay[1]);
      const month = Number(yearMonthDay[2]);
      const day = Number(yearMonthDay[3]);
      return this.formatDate(new Date(year, month - 1, day));
    }

    const monthDay = text.match(/(\d{1,2})[月/-](\d{1,2})(?:日|号)?/);
    if (monthDay) {
      const month = Number(monthDay[1]);
      const day = Number(monthDay[2]);
      return this.formatDate(new Date(today.getFullYear(), month - 1, day));
    }

    const weekMatch = text.match(/(下周|这周|本周|周)([一二三四五六日天])/);
    if (weekMatch) {
      const prefix = weekMatch[1];
      const targetDay = this.getWeekday(weekMatch[2]);
      const currentDay = today.getDay();

      if (targetDay === undefined) {
        return undefined;
      }

      let offset = 0;
      if (prefix === '下周') {
        offset = ((7 - currentDay + targetDay) % 7) + 7;
      } else if (prefix === '这周' || prefix === '本周') {
        offset = (7 - currentDay + targetDay) % 7;
      } else {
        offset = (7 - currentDay + targetDay) % 7;
        if (offset === 0) offset = 7;
      }

      return this.formatDate(this.addDays(today, offset));
    }

    return undefined;
  }

  private parseDateString(value: string): Date | undefined {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return undefined;
    }

    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  private getWeekday(value: string): number | undefined {
    const mapping: Record<string, number> = {
      日: 0,
      天: 0,
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
    };

    return mapping[value];
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private buildFieldPatterns(field: ProcessField): string[] {
    return Array.from(new Set(field.aliases))
      .filter((alias) => alias && !isProbablyRawFieldLabel(alias))
      .sort((left, right) => right.length - left.length)
      .map((alias) => this.escapeRegex(alias));
  }

  private buildExplicitFieldPattern(field: ProcessField): string {
    const patterns = this.buildFieldPatterns(field);
    return patterns.length > 0 ? `(?:${patterns.join('|')})` : '';
  }

  private isFieldMarkedUnchanged(field: ProcessField, userMessage: string): boolean {
    const explicitFieldPattern = this.buildExplicitFieldPattern(field);
    if (!explicitFieldPattern) {
      return false;
    }

    return new RegExp(`${explicitFieldPattern}(?:[^，。；;\\n]{0,8})?(?:不变|保持不变|不用改|无需修改)`, 'i').test(userMessage);
  }

  private extractExplicitDateReplacement(userMessage: string, explicitFieldPattern: string): string | undefined {
    const expression = this.getDateExpressionPattern();
    const patterns = [
      new RegExp(`(?:把|将)?${explicitFieldPattern}(?:[^，。；;\\n]{0,12})?(?:改成|改为|调整为|换成|设为|设成|改到|换到)\\s*(${expression})`, 'i'),
      new RegExp(`(?:把|将)?${explicitFieldPattern}(?:[^，。；;\\n]{0,4})?(?:定在|放在)\\s*(${expression})`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = userMessage.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  private extractShiftedDateValue(
    userMessage: string,
    explicitFieldPattern: string,
    currentValue: any,
  ): string | undefined {
    if (typeof currentValue !== 'string') {
      return undefined;
    }

    const currentDate = this.parseDateString(currentValue);
    if (!currentDate) {
      return undefined;
    }

    const match = userMessage.match(
      new RegExp(`(?:把|将)?${explicitFieldPattern}(?:[^，。；;\\n]{0,8})?(提前|往前|延后|往后|推迟|顺延)\\s*([零一二两三四五六七八九十百\\d.]+)\\s*天`, 'i'),
    );
    if (!match?.[1] || !match[2]) {
      return undefined;
    }

    const days = this.parseChineseNumber(match[2]);
    if (days === undefined) {
      return undefined;
    }

    const direction = /提前|往前/.test(match[1]) ? -1 : 1;
    return this.formatDate(this.addDays(currentDate, direction * days));
  }

  private mapValueToOption(value: string, options?: Array<{ label: string; value: string }>): string | undefined {
    if (!options || options.length === 0) {
      return undefined;
    }

    const exact = options.find((option) => option.label === value || option.value === value);
    if (exact) {
      return exact.value;
    }

    const fuzzy = options.find((option) => value.includes(option.label) || option.label.includes(value));
    return fuzzy?.value;
  }

  private parseNumericValue(rawValue: string, rawUnit?: string): number {
    let value = Number.parseFloat(rawValue);
    const unit = String(rawUnit || '').toLowerCase();

    if (unit === '万') {
      value *= 10000;
    } else if (unit === '千' || unit === 'k') {
      value *= 1000;
    }

    return value;
  }

  private parseChineseNumber(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      return Number.parseFloat(trimmed);
    }

    if (trimmed === '半') {
      return 0.5;
    }

    const normalized = trimmed.replace(/两/g, '二');
    const digitMap: Record<string, number> = {
      零: 0,
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };

    if (normalized === '十') {
      return 10;
    }

    if (normalized.includes('十')) {
      const [left, right] = normalized.split('十');
      const tens = left ? digitMap[left] : 1;
      const ones = right ? digitMap[right] : 0;
      if (tens === undefined || ones === undefined) {
        return undefined;
      }
      return tens * 10 + ones;
    }

    return digitMap[normalized];
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private sanitizeQuestion(question: string | undefined, field: ProcessField): string {
    if (!question || question.trim().length === 0) {
      return this.generateQuestion(field);
    }

    let sanitized = question.trim();
    for (const candidate of [field.key, field.rawLabel]) {
      if (!candidate || candidate === field.label) {
        continue;
      }
      const pattern = new RegExp(this.escapeRegex(candidate), 'gi');
      sanitized = sanitized.replace(pattern, field.label);
    }

    if (
      sanitized.toLowerCase().includes(field.key.toLowerCase())
      || (field.rawLabel && isProbablyRawFieldLabel(field.rawLabel) && sanitized.includes(field.rawLabel))
    ) {
      return this.generateQuestion(field);
    }

    if (!/[。？！!?]$/.test(sanitized)) {
      sanitized += '。';
    }

    return sanitized;
  }

  private generateQuestion(field: ProcessField): string {
    if (field.type === 'file' || field.semanticKind === 'attachment') {
      return `还需要上传${field.label}。`;
    }

    if (field.semanticKind === 'leave_type') {
      return `请告诉我${field.label}，例如年假、事假或病假。`;
    }

    if (field.semanticKind === 'start_time') {
      return `请告诉我${field.label}，比如明天、下周一或 3月28日。`;
    }

    if (field.semanticKind === 'end_time') {
      return `请告诉我${field.label}，比如 3月28日。`;
    }

    if (field.semanticKind === 'reason') {
      return `请告诉我${field.label}。`;
    }

    if (field.type === 'select' || field.type === 'radio') {
      const options = (field.options || []).map((option) => option.label).join('、');
      return options
        ? `请告诉我${field.label}。可选项有：${options}。`
        : `请告诉我${field.label}。`;
    }

    if (field.type === 'date') {
      return `请告诉我${field.label}，比如明天、下周一或 3月28日。`;
    }

    if (field.type === 'number') {
      return `请告诉我${field.label}。`;
    }

    if (field.label === '相关信息') {
      return '还需要补充一项信息，请再具体说明。';
    }

    return `请告诉我${field.label}。`;
  }
}
