import { Injectable, Logger } from '@nestjs/common';
import { LLMClientFactory, LLMMessage } from '@uniflow/agent-kernel';

interface ProcessField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: Array<{ label: string; value: string }>;
}

interface ProcessSchema {
  fields: ProcessField[];
}

interface FormExtractionResult {
  extractedFields: Record<string, any>;
  missingFields: Array<{ key: string; label: string; question: string }>;
  isComplete: boolean;
}

const FORM_EXTRACTION_SYSTEM_PROMPT = `你是一个智能表单填写助手，负责从用户的自然语言消息中提取表单字段值。

## 核心原则
1. 智能理解用户意图，不要求用户使用特定格式
2. 自动将用户输入转换为系统要求的标准格式
3. 能理解各种日期表达（"下周一"、"3月10号"、"后天"、"这周五"等）
4. 能理解各种数字表达（"一千五"、"两万"、"1.5k"等）
5. 能模糊匹配选项（用户说"事假"能匹配到对应选项）
6. 一次消息中可能包含多个字段的值，要全部提取

## 日期转换规则
- 今天的日期会在用户消息中提供
- "今天" → 当天日期
- "明天" → 当天+1
- "后天" → 当天+2
- "下周一" → 下一个周一的日期
- "这周五" → 本周五的日期
- "3月10号"、"3月10日" → 当年的3月10日
- "10号" → 当月10日
- 所有日期输出格式统一为 YYYY-MM-DD

## 数字转换规则
- "一千" → 1000
- "一千五" / "一千五百" → 1500
- "两万" → 20000
- "1.5k" → 1500
- "3天" → 3
- "半天" → 0.5

## 选项匹配规则
- 精确匹配优先
- 支持部分匹配（"事假" 匹配 "事假/个人事假"）
- 支持同义词（"年休" 匹配 "年假"）

## 输出格式
返回JSON：
{
  "extractedFields": {
    "field_key": "converted_value"
  },
  "reasoning": "简要说明提取逻辑"
}

只提取能从消息中明确识别的字段，不要猜测。如果无法确定某个字段的值，不要包含在结果中。`;

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
    const formData = { ...currentFormData };

    // 找出还需要填写的字段
    const pendingFields = processSchema.fields.filter(
      (f) => formData[f.key] === undefined,
    );

    // 如果没有待填字段，直接返回
    if (pendingFields.length === 0) {
      return {
        extractedFields: {},
        missingFields: [],
        isComplete: true,
      };
    }

    // 用 LLM 提取字段值
    let extractedFields: Record<string, any> = {};
    try {
      extractedFields = await this.extractWithLLM(
        pendingFields,
        userMessage,
        processCode,
      );
    } catch (error: any) {
      this.logger.warn(`LLM提取失败，跳过: ${error.message}`);
    }

    // 合并到 formData
    for (const [key, value] of Object.entries(extractedFields)) {
      formData[key] = value;
    }

    // 检查缺失的必填字段
    const missingFields: Array<{ key: string; label: string; question: string }> = [];
    for (const field of processSchema.fields) {
      if (field.required && formData[field.key] === undefined) {
        missingFields.push({
          key: field.key,
          label: field.label,
          question: this.generateQuestion(field),
        });
      }
    }

    return {
      extractedFields,
      missingFields,
      isComplete: missingFields.length === 0,
    };
  }

  private async extractWithLLM(
    pendingFields: ProcessField[],
    userMessage: string,
    processCode: string,
  ): Promise<Record<string, any>> {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][today.getDay()];

    // 构建字段描述
    const fieldDescriptions = pendingFields.map((f) => {
      let desc = `- ${f.key} (${f.label}): 类型=${f.type}, 必填=${f.required}`;
      if (f.options && f.options.length > 0) {
        desc += `, 可选值=[${f.options.map((o) => `"${o.label}"(值:${o.value})`).join(', ')}]`;
      }
      if (f.type === 'date') {
        desc += ', 输出格式=YYYY-MM-DD';
      }
      return desc;
    });

    const userPrompt = `今天是 ${todayStr}（星期${weekDay}）。
流程类型: ${processCode}

待提取的字段：
${fieldDescriptions.join('\n')}

用户消息: "${userMessage}"

请从用户消息中提取字段值，自动转换为标准格式。返回JSON。`;

    const messages: LLMMessage[] = [
      { role: 'system', content: FORM_EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.llmClient.chat(messages);

    // 解析 JSON 响应
    let jsonStr = response.content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const result = JSON.parse(jsonStr);
    const extracted = result.extractedFields || {};

    if (result.reasoning) {
      this.logger.log(`LLM提取逻辑: ${result.reasoning}`);
    }

    // 验证提取的字段确实在待填字段列表中
    const validFields: Record<string, any> = {};
    const pendingKeys = new Set(pendingFields.map((f) => f.key));

    for (const [key, value] of Object.entries(extracted)) {
      if (pendingKeys.has(key) && value !== null && value !== undefined && value !== '') {
        validFields[key] = value;
      }
    }

    this.logger.log(
      `从消息中提取了 ${Object.keys(validFields).length} 个字段: ${JSON.stringify(validFields)}`,
    );

    return validFields;
  }

  private generateQuestion(field: ProcessField): string {
    // 不再要求用户输入特定格式，用自然语言提问
    if (field.type === 'select' || field.type === 'radio') {
      const optionLabels = field.options?.map((o) => o.label).join('、') || '';
      return `请问${field.label}选哪个？可选：${optionLabels}`;
    }

    if (field.type === 'date') {
      return `请问${field.label}是哪天？`;
    }

    if (field.type === 'number') {
      return `请问${field.label}是多少？`;
    }

    if (field.type === 'textarea') {
      return `请说明${field.label}。`;
    }

    return `请问${field.label}是什么？`;
  }
}