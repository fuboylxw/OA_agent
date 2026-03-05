/**
 * 参数收集器
 * 实现智能参数收集和验证
 */

import { Injectable } from '@nestjs/common';
import {
  ParameterDefinition,
  ProcessContext,
  SharedContext,
  ValidationError,
  ValidationType,
} from '../types/context.types';

export interface ParameterCollectionResult {
  isComplete: boolean;
  collectedParams: Record<string, any>;
  missingParams: ParameterDefinition[];
  validationErrors: ValidationError[];
  nextQuestion?: string;
  progress: number; // 0-1
}

@Injectable()
export class ParameterCollector {
  /**
   * 收集参数
   */
  async collectParameters(
    userInput: string,
    processContext: ProcessContext,
    parameterDefinitions: ParameterDefinition[],
    sharedContext: SharedContext,
  ): Promise<ParameterCollectionResult> {
    const collectedParams = { ...processContext.parameters };
    const validationErrors: ValidationError[] = [];

    // 1. 从用户输入提取参数
    const extractedParams = this.extractFromInput(userInput, parameterDefinitions);
    Object.assign(collectedParams, extractedParams);

    // 2. 从共享上下文预填充
    this.prefillFromSharedContext(collectedParams, parameterDefinitions, sharedContext);

    // 3. 验证已收集的参数
    for (const [key, value] of Object.entries(collectedParams)) {
      const paramDef = parameterDefinitions.find(p => p.name === key);
      if (paramDef) {
        const errors = this.validateParameter(paramDef, value);
        validationErrors.push(...errors);
      }
    }

    // 4. 识别缺失的必填参数
    const missingParams = parameterDefinitions.filter(
      p => p.required && collectedParams[p.name] === undefined,
    );

    // 5. 计算进度
    const totalRequired = parameterDefinitions.filter(p => p.required).length;
    const collected = totalRequired - missingParams.length;
    const progress = totalRequired > 0 ? collected / totalRequired : 1;

    // 6. 生成下一个问题
    const nextQuestion = missingParams.length > 0
      ? this.generateQuestion(missingParams[0], collectedParams)
      : undefined;

    return {
      isComplete: missingParams.length === 0 && validationErrors.length === 0,
      collectedParams,
      missingParams,
      validationErrors,
      nextQuestion,
      progress,
    };
  }

  /**
   * 从用户输入提取参数
   */
  private extractFromInput(
    input: string,
    definitions: ParameterDefinition[],
  ): Record<string, any> {
    const extracted: Record<string, any> = {};

    for (const def of definitions) {
      const value = this.extractValue(input, def);
      if (value !== null) {
        extracted[def.name] = value;
      }
    }

    return extracted;
  }

  /**
   * 提取单个参数值
   */
  private extractValue(input: string, def: ParameterDefinition): any {
    switch (def.type) {
      case 'number':
        return this.extractNumber(input, def.name);
      case 'date':
        return this.extractDate(input);
      case 'datetime':
        return this.extractDateTime(input);
      case 'email':
        return this.extractEmail(input);
      case 'phone':
        return this.extractPhone(input);
      case 'select':
      case 'radio':
        return this.extractOption(input, def);
      case 'checkbox':
        return this.extractMultipleOptions(input, def);
      case 'text':
      case 'textarea':
        return this.extractText(input, def.name);
      default:
        return null;
    }
  }

  /**
   * 提取数字
   */
  private extractNumber(input: string, fieldName: string): number | null {
    const patterns = [
      new RegExp(`${fieldName}[：:是]?\\s*(\\d+(?:\\.\\d+)?)`),
      /(\d+(?:\.\d+)?)\s*(?:元|块|万|个|件|天|小时)/,
      /金额[：:是]?\s*(\d+(?:\.\d+)?)/,
      /价格[：:是]?\s*(\d+(?:\.\d+)?)/,
      /数量[：:是]?\s*(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }

    return null;
  }

  /**
   * 提取日期
   */
  private extractDate(input: string): string | null {
    // YYYY-MM-DD or YYYY/MM/DD
    const dateMatch = input.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
    if (dateMatch) {
      return dateMatch[1].replace(/\//g, '-');
    }

    // 相对日期
    const today = new Date();
    if (input.includes('今天') || input.includes('今日')) {
      return this.formatDate(today);
    }
    if (input.includes('明天')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return this.formatDate(tomorrow);
    }
    if (input.includes('后天')) {
      const dayAfterTomorrow = new Date(today);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      return this.formatDate(dayAfterTomorrow);
    }

    // 下周X
    const weekdayMatch = input.match(/下周([一二三四五六日天])/);
    if (weekdayMatch) {
      const weekdayMap: Record<string, number> = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0,
      };
      const targetWeekday = weekdayMap[weekdayMatch[1]];
      const nextWeek = new Date(today);
      const daysToAdd = (7 - today.getDay() + targetWeekday) % 7 + 7;
      nextWeek.setDate(today.getDate() + daysToAdd);
      return this.formatDate(nextWeek);
    }

    return null;
  }

  /**
   * 提取日期时间
   */
  private extractDateTime(input: string): string | null {
    const date = this.extractDate(input);
    if (!date) return null;

    // 提取时间
    const timeMatch = input.match(/(\d{1,2})[：:点](\d{1,2})?/);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, '0');
      const minute = (timeMatch[2] || '00').padStart(2, '0');
      return `${date}T${hour}:${minute}:00`;
    }

    return `${date}T00:00:00`;
  }

  /**
   * 提取邮箱
   */
  private extractEmail(input: string): string | null {
    const emailMatch = input.match(/[\w.-]+@[\w.-]+\.\w+/);
    return emailMatch ? emailMatch[0] : null;
  }

  /**
   * 提取电话
   */
  private extractPhone(input: string): string | null {
    const phoneMatch = input.match(/1[3-9]\d{9}/);
    return phoneMatch ? phoneMatch[0] : null;
  }

  /**
   * 提取选项
   */
  private extractOption(input: string, def: ParameterDefinition): string | null {
    if (!def.validation) return null;

    const optionsRule = def.validation.find(r => r.type === ValidationType.CUSTOM && r.params?.options);
    if (!optionsRule?.params?.options) return null;

    const options = optionsRule.params.options as Array<{ label: string; value: string }>;
    for (const option of options) {
      if (input.includes(option.label)) {
        return option.value;
      }
    }

    return null;
  }

  /**
   * 提取多选项
   */
  private extractMultipleOptions(input: string, def: ParameterDefinition): string[] | null {
    if (!def.validation) return null;

    const optionsRule = def.validation.find(r => r.type === ValidationType.CUSTOM && r.params?.options);
    if (!optionsRule?.params?.options) return null;

    const options = optionsRule.params.options as Array<{ label: string; value: string }>;
    const selected: string[] = [];

    for (const option of options) {
      if (input.includes(option.label)) {
        selected.push(option.value);
      }
    }

    return selected.length > 0 ? selected : null;
  }

  /**
   * 提取文本
   */
  private extractText(input: string, fieldName: string): string | null {
    const patterns = [
      new RegExp(`${fieldName}[：:是]\\s*([^，。！？]+)`),
      /原因[：:是]\s*([^，。！？]+)/,
      /事由[：:是]\s*([^，。！？]+)/,
      /说明[：:是]\s*([^，。！？]+)/,
      /备注[：:是]\s*([^，。！？]+)/,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * 从共享上下文预填充
   */
  private prefillFromSharedContext(
    params: Record<string, any>,
    definitions: ParameterDefinition[],
    sharedContext: SharedContext,
  ): void {
    for (const def of definitions) {
      // 跳过已有值的参数
      if (params[def.name] !== undefined) {
        continue;
      }

      // 根据参数名称从共享上下文填充
      const value = this.getFromSharedContext(def.name, sharedContext);
      if (value !== undefined) {
        params[def.name] = value;
      }
    }
  }

  /**
   * 从共享上下文获取值
   */
  private getFromSharedContext(paramName: string, context: SharedContext): any {
    const mapping: Record<string, any> = {
      employeeId: context.profile.employeeId,
      applicantId: context.profile.employeeId,
      applicantName: context.profile.name,
      name: context.profile.name,
      department: context.profile.department,
      position: context.profile.position,
      email: context.profile.email,
      phone: context.profile.phone,
      approver: context.preferences.defaultApprover,
      approverId: context.preferences.defaultApprover,
      cc: context.preferences.defaultCC,
      ccList: context.preferences.defaultCC,
    };

    return mapping[paramName];
  }

  /**
   * 验证参数
   */
  private validateParameter(def: ParameterDefinition, value: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!def.validation) return errors;

    for (const rule of def.validation) {
      const error = this.validateRule(def, value, rule);
      if (error) {
        errors.push(error);
      }
    }

    return errors;
  }

  /**
   * 验证单个规则
   */
  private validateRule(
    def: ParameterDefinition,
    value: any,
    rule: any,
  ): ValidationError | null {
    switch (rule.type) {
      case ValidationType.REQUIRED:
        if (value === undefined || value === null || value === '') {
          return {
            field: def.name,
            message: rule.message || `${def.description}不能为空`,
            code: 'REQUIRED',
          };
        }
        break;

      case ValidationType.MIN_LENGTH:
        if (typeof value === 'string' && value.length < rule.params.min) {
          return {
            field: def.name,
            message: rule.message || `${def.description}长度不能少于${rule.params.min}个字符`,
            code: 'MIN_LENGTH',
          };
        }
        break;

      case ValidationType.MAX_LENGTH:
        if (typeof value === 'string' && value.length > rule.params.max) {
          return {
            field: def.name,
            message: rule.message || `${def.description}长度不能超过${rule.params.max}个字符`,
            code: 'MAX_LENGTH',
          };
        }
        break;

      case ValidationType.MIN_VALUE:
        if (typeof value === 'number' && value < rule.params.min) {
          return {
            field: def.name,
            message: rule.message || `${def.description}不能小于${rule.params.min}`,
            code: 'MIN_VALUE',
          };
        }
        break;

      case ValidationType.MAX_VALUE:
        if (typeof value === 'number' && value > rule.params.max) {
          return {
            field: def.name,
            message: rule.message || `${def.description}不能大于${rule.params.max}`,
            code: 'MAX_VALUE',
          };
        }
        break;

      case ValidationType.PATTERN:
        if (typeof value === 'string' && !new RegExp(rule.params.pattern).test(value)) {
          return {
            field: def.name,
            message: rule.message || `${def.description}格式不正确`,
            code: 'PATTERN',
          };
        }
        break;

      case ValidationType.EMAIL:
        if (typeof value === 'string' && !/^[\w.-]+@[\w.-]+\.\w+$/.test(value)) {
          return {
            field: def.name,
            message: rule.message || '邮箱格式不正确',
            code: 'EMAIL',
          };
        }
        break;

      case ValidationType.PHONE:
        if (typeof value === 'string' && !/^1[3-9]\d{9}$/.test(value)) {
          return {
            field: def.name,
            message: rule.message || '手机号格式不正确',
            code: 'PHONE',
          };
        }
        break;
    }

    return null;
  }

  /**
   * 生成问题
   */
  private generateQuestion(def: ParameterDefinition, collectedParams: Record<string, any>): string {
    // 如果有自定义提示语，使用它
    if (def.prompt) {
      return this.interpolatePrompt(def.prompt, collectedParams);
    }

    // 根据类型生成默认问题
    const typeQuestions: Record<string, string> = {
      number: `请问${def.description}是多少？`,
      date: `请问${def.description}是哪天？（格式：YYYY-MM-DD）`,
      datetime: `请问${def.description}是什么时候？（格式：YYYY-MM-DD HH:mm）`,
      text: `请问${def.description}是什么？`,
      textarea: `请说明${def.description}。`,
      email: `请提供${def.description}（邮箱格式）。`,
      phone: `请提供${def.description}（手机号格式）。`,
      select: this.generateSelectQuestion(def),
      radio: this.generateSelectQuestion(def),
      checkbox: this.generateCheckboxQuestion(def),
    };

    return typeQuestions[def.type] || `请提供${def.description}。`;
  }

  /**
   * 生成选择题问题
   */
  private generateSelectQuestion(def: ParameterDefinition): string {
    const optionsRule = def.validation?.find(r => r.type === ValidationType.CUSTOM && r.params?.options);
    if (!optionsRule?.params?.options) {
      return `请选择${def.description}。`;
    }

    const options = optionsRule.params.options as Array<{ label: string; value: string }>;
    const optionLabels = options.map(o => o.label).join('、');
    return `请选择${def.description}：${optionLabels}`;
  }

  /**
   * 生成多选题问题
   */
  private generateCheckboxQuestion(def: ParameterDefinition): string {
    const optionsRule = def.validation?.find(r => r.type === ValidationType.CUSTOM && r.params?.options);
    if (!optionsRule?.params?.options) {
      return `请选择${def.description}（可多选）。`;
    }

    const options = optionsRule.params.options as Array<{ label: string; value: string }>;
    const optionLabels = options.map(o => o.label).join('、');
    return `请选择${def.description}（可多选）：${optionLabels}`;
  }

  /**
   * 插值提示语
   */
  private interpolatePrompt(prompt: string, params: Record<string, any>): string {
    return prompt.replace(/\{(\w+)\}/g, (match, key) => {
      return params[key] !== undefined ? String(params[key]) : match;
    });
  }

  /**
   * 格式化日期
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
