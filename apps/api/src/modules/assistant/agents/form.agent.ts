import { Injectable, Logger } from '@nestjs/common';
import { LLMClientFactory, LLMMessage } from '@uniflow/agent-kernel';
import {
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
  description?: string;
  example?: string;
  multiple?: boolean;
  options?: Array<{ label: string; value: string }>;
  aliases: string[];
}

interface RawProcessField {
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  description?: string;
  example?: string;
  multiple?: boolean;
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
  missingFields: Array<{
    key: string;
    label: string;
    question: string;
    type?: string;
    description?: string;
    example?: string;
    multiple?: boolean;
    options?: Array<{ label: string; value: string }>;
  }>;
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
8. 字段解释(description)和字段示例(example)是理解字段真实含义的重要依据；当字段名称较抽象、较通用、或存在多个相似字段时，优先结合解释和示例判断用户信息属于哪个字段。
9. 如果流程本身只定义了固定数量的待填字段，就只在这些字段中做匹配，不要把一句用户话术拆成额外字段。
10. 如果某项信息仍缺失，请为该字段生成一句面向用户的追问。
11. 追问绝对不能暴露字段代码或原始 API 名称，例如不能出现 field_key、raw_field_name 这类词。
12. 追问应最小化，优先只问真正缺失且提交前必需的信息，不要重复确认用户已经明确表达过的内容。
13. 如果同一段用户表达明确同时满足多个字段，请把这段信息分别写入这些字段，不要只填写其中一个。
14. 严禁根据流程名称、业务名称、系统名称、常见办理场景或领域常识去猜测字段值。只有当用户本轮原话、当前已收集表单内容、或字段说明/示例明确支持时，才能填写该字段。
15. 如果用户只是说“我要办理XX流程”或只提到了流程名称本身，这不等于给出了任何字段值。

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
        this.logger.warn(`LLM field extraction failed, returning no inferred field values: ${error.message}`);
      }
    }

    const extractedFields = this.normalizeExtractedFields(
      nonFileFields,
      llmPayload.extractedFields,
    );
    const fieldOrigins: Record<string, 'user' | 'derived'> = Object.fromEntries(
      Object.keys(extractedFields).map((key) => [key, 'user' as const]),
    );

    for (const [key, value] of Object.entries(extractedFields)) {
      formData[key] = value;
    }

    const missingFields: Array<{
      key: string;
      label: string;
      question: string;
      type?: string;
      description?: string;
      example?: string;
      multiple?: boolean;
      options?: Array<{ label: string; value: string }>;
    }> = [];
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
        description: field.description,
        example: field.example,
        multiple: field.multiple,
        options: field.options,
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
      this.logger.warn(`LLM modification extraction failed, returning no inferred modifications: ${error.message}`);
    }

    const modifiedFields = this.normalizeExtractedFields(normalizedFields, llmModifiedFields);
    const fieldOrigins: Record<string, 'user' | 'derived'> = Object.fromEntries(
      Object.keys(modifiedFields).map((key) => [key, 'user' as const]),
    );

    return {
      modifiedFields,
      fieldOrigins,
    };
  }

  normalizeDirectFieldValue(
    processCode: string,
    processSchema: ProcessSchema,
    fieldKey: string,
    rawValue: any,
  ) {
    const normalizedFields = this.normalizeFields(processSchema.fields || [], processCode);
    const field = normalizedFields.find((item) => item.key === fieldKey);
    if (!field) {
      return undefined;
    }

    return this.normalizeFieldValue(field, rawValue);
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
          description: typeof field.description === 'string' ? field.description.trim() : undefined,
          example: typeof field.example === 'string' ? field.example.trim() : undefined,
          multiple: field.multiple === true,
          options: normalizedOptions,
          aliases: presentation.aliases,
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
      if (field.multiple) {
        descriptionParts.push(`支持多值=${field.type === 'file' ? '是' : '可多选'}`);
      }
      if (field.description) {
        descriptionParts.push(`填写说明=${field.description}`);
      }
      if (field.example) {
        descriptionParts.push(`示例=${field.example}`);
      }
      if (field.type === 'file') {
        descriptionParts.push(`上传方式=${field.multiple ? '支持多份文件' : '单份文件'}`);
      }

      return descriptionParts.join('，');
    });
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

    if (field.type === 'date') {
      return this.normalizeDateValue(rawValue);
    }

    if (this.isOptionLikeField(field)) {
      return this.normalizeOptionValue(field, rawValue);
    }

    if (field.type === 'number') {
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

  private normalizeOptionValue(field: ProcessField, rawValue: any): string | string[] | undefined {
    if (field.type === 'checkbox' || field.multiple === true) {
      const rawList = Array.isArray(rawValue)
        ? rawValue
        : [rawValue];
      const normalized = rawList
        .flatMap((value) => typeof value === 'string'
          ? value.split(/[、,，;；]/)
          : [value])
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .map((value) => {
          if (!field.options || field.options.length === 0) {
            return value;
          }
          return this.mapValueToOption(value, field.options);
        })
        .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);

      return normalized.length > 0 ? normalized : undefined;
    }

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

  private mapValueToOption(value: string, options?: Array<{ label: string; value: string }>): string | undefined {
    if (!options || options.length === 0) {
      return undefined;
    }

    const exact = options.find((option) => option.label === value || option.value === value);
    if (exact) {
      return exact.value;
    }

    const compactValue = value.toLowerCase().replace(/[\s_\-./\\,，。;；:：'"“”‘’()（）【】\[\]]+/g, '');
    const normalized = options.find((option) => {
      const compactLabel = option.label.toLowerCase().replace(/[\s_\-./\\,，。;；:：'"“”‘’()（）【】\[\]]+/g, '');
      const compactOptionValue = option.value.toLowerCase().replace(/[\s_\-./\\,，。;；:：'"“”‘’()（）【】\[\]]+/g, '');
      return compactLabel === compactValue || compactOptionValue === compactValue;
    });
    return normalized?.value;
  }

  private isOptionLikeField(field: ProcessField) {
    return field.type === 'select'
      || field.type === 'radio'
      || field.type === 'checkbox';
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

    if (this.isOptionLikeField(field)) {
      return this.appendOptionChoices(sanitized, field);
    }

    return sanitized;
  }

  private generateQuestion(field: ProcessField): string {
    if (field.type === 'file') {
      const uploadHint = field.multiple ? '支持上传多份文件。' : '';
      return `还需要上传${field.label}。${uploadHint}`;
    }

    if (this.isOptionLikeField(field)) {
      const multipleHint = field.multiple ? '可多选。' : '';
      return this.appendOptionChoices(`请告诉我${field.label}。${multipleHint}`, field);
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

  private appendOptionChoices(question: string, field: ProcessField): string {
    if (!this.isOptionLikeField(field) || !Array.isArray(field.options) || field.options.length === 0) {
      return question;
    }

    if (question.includes('可选项有：')) {
      return question;
    }

    const optionsText = field.options.map((option) => option.label).join('、');
    if (!optionsText) {
      return question;
    }

    const suffix = `可选项有：${optionsText}。`;
    const normalizedQuestion = question.trim();
    return /[。？！!?]$/.test(normalizedQuestion)
      ? `${normalizedQuestion}${suffix}`
      : `${normalizedQuestion}。${suffix}`;
  }
}
