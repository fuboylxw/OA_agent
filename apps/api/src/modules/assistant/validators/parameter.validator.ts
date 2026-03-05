/**
 * 参数验证器
 * 提供统一的参数验证功能
 */

import { Injectable } from '@nestjs/common';
import {
  ParameterDefinition,
  ValidationRule,
  ValidationType,
  ValidationError,
} from '../types/context.types';

@Injectable()
export class ParameterValidator {
  /**
   * 验证所有参数
   */
  validateAll(
    parameters: Record<string, any>,
    definitions: ParameterDefinition[],
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const def of definitions) {
      const value = parameters[def.name];
      const fieldErrors = this.validate(def, value);
      errors.push(...fieldErrors);
    }

    return errors;
  }

  /**
   * 验证单个参数
   */
  validate(definition: ParameterDefinition, value: any): ValidationError[] {
    const errors: ValidationError[] = [];

    // 必填验证
    if (definition.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: definition.name,
        message: `${definition.description}不能为空`,
        code: 'REQUIRED',
      });
      return errors; // 必填验证失败，不继续其他验证
    }

    // 如果值为空且非必填，跳过其他验证
    if (value === undefined || value === null || value === '') {
      return errors;
    }

    // 执行其他验证规则
    if (definition.validation) {
      for (const rule of definition.validation) {
        const error = this.validateRule(definition, value, rule);
        if (error) {
          errors.push(error);
        }
      }
    }

    // 类型验证
    const typeError = this.validateType(definition, value);
    if (typeError) {
      errors.push(typeError);
    }

    return errors;
  }

  /**
   * 验证规则
   */
  private validateRule(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    switch (rule.type) {
      case ValidationType.MIN_LENGTH:
        return this.validateMinLength(definition, value, rule);

      case ValidationType.MAX_LENGTH:
        return this.validateMaxLength(definition, value, rule);

      case ValidationType.MIN_VALUE:
        return this.validateMinValue(definition, value, rule);

      case ValidationType.MAX_VALUE:
        return this.validateMaxValue(definition, value, rule);

      case ValidationType.PATTERN:
        return this.validatePattern(definition, value, rule);

      case ValidationType.EMAIL:
        return this.validateEmail(definition, value, rule);

      case ValidationType.PHONE:
        return this.validatePhone(definition, value, rule);

      case ValidationType.DATE_RANGE:
        return this.validateDateRange(definition, value, rule);

      case ValidationType.CUSTOM:
        return this.validateCustom(definition, value, rule);

      default:
        console.warn(`Unknown validation type: ${rule.type}`);
        return null;
    }
  }

  /**
   * 验证最小长度
   */
  private validateMinLength(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    if (typeof value !== 'string') {
      return null;
    }

    const minLength = rule.params?.min || 0;
    if (value.length < minLength) {
      return {
        field: definition.name,
        message: rule.message || `${definition.description}长度不能少于${minLength}个字符`,
        code: 'MIN_LENGTH',
      };
    }

    return null;
  }

  /**
   * 验证最大长度
   */
  private validateMaxLength(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    if (typeof value !== 'string') {
      return null;
    }

    const maxLength = rule.params?.max || Infinity;
    if (value.length > maxLength) {
      return {
        field: definition.name,
        message: rule.message || `${definition.description}长度不能超过${maxLength}个字符`,
        code: 'MAX_LENGTH',
      };
    }

    return null;
  }

  /**
   * 验证最小值
   */
  private validateMinValue(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    if (typeof value !== 'number') {
      return null;
    }

    const minValue = rule.params?.min;
    if (minValue !== undefined && value < minValue) {
      return {
        field: definition.name,
        message: rule.message || `${definition.description}不能小于${minValue}`,
        code: 'MIN_VALUE',
      };
    }

    return null;
  }

  /**
   * 验证最大值
   */
  private validateMaxValue(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    if (typeof value !== 'number') {
      return null;
    }

    const maxValue = rule.params?.max;
    if (maxValue !== undefined && value > maxValue) {
      return {
        field: definition.name,
        message: rule.message || `${definition.description}不能大于${maxValue}`,
        code: 'MAX_VALUE',
      };
    }

    return null;
  }

  /**
   * 验证正则表达式
   */
  private validatePattern(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    if (typeof value !== 'string') {
      return null;
    }

    const pattern = rule.params?.pattern;
    if (pattern && !new RegExp(pattern).test(value)) {
      return {
        field: definition.name,
        message: rule.message || `${definition.description}格式不正确`,
        code: 'PATTERN',
      };
    }

    return null;
  }

  /**
   * 验证邮箱
   */
  private validateEmail(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    if (typeof value !== 'string') {
      return null;
    }

    const emailPattern = /^[\w.-]+@[\w.-]+\.\w+$/;
    if (!emailPattern.test(value)) {
      return {
        field: definition.name,
        message: rule.message || '邮箱格式不正确',
        code: 'EMAIL',
      };
    }

    return null;
  }

  /**
   * 验证手机号
   */
  private validatePhone(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    if (typeof value !== 'string') {
      return null;
    }

    const phonePattern = /^1[3-9]\d{9}$/;
    if (!phonePattern.test(value)) {
      return {
        field: definition.name,
        message: rule.message || '手机号格式不正确',
        code: 'PHONE',
      };
    }

    return null;
  }

  /**
   * 验证日期范围
   */
  private validateDateRange(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return {
        field: definition.name,
        message: '日期格式不正确',
        code: 'DATE_RANGE',
      };
    }

    const minDate = rule.params?.min ? new Date(rule.params.min) : null;
    const maxDate = rule.params?.max ? new Date(rule.params.max) : null;

    if (minDate && date < minDate) {
      return {
        field: definition.name,
        message: rule.message || `${definition.description}不能早于${minDate.toLocaleDateString()}`,
        code: 'DATE_RANGE',
      };
    }

    if (maxDate && date > maxDate) {
      return {
        field: definition.name,
        message: rule.message || `${definition.description}不能晚于${maxDate.toLocaleDateString()}`,
        code: 'DATE_RANGE',
      };
    }

    return null;
  }

  /**
   * 自定义验证
   */
  private validateCustom(
    definition: ParameterDefinition,
    value: any,
    rule: ValidationRule,
  ): ValidationError | null {
    // 自定义验证逻辑可以在这里扩展
    // 例如：选项验证、依赖字段验证等

    // 选项验证
    if (rule.params?.options) {
      const options = rule.params.options as Array<{ label: string; value: string }>;
      const validValues = options.map(o => o.value);

      if (Array.isArray(value)) {
        // 多选验证
        const invalidValues = value.filter(v => !validValues.includes(v));
        if (invalidValues.length > 0) {
          return {
            field: definition.name,
            message: rule.message || `${definition.description}包含无效选项`,
            code: 'CUSTOM',
          };
        }
      } else {
        // 单选验证
        if (!validValues.includes(value)) {
          return {
            field: definition.name,
            message: rule.message || `${definition.description}选项无效`,
            code: 'CUSTOM',
          };
        }
      }
    }

    return null;
  }

  /**
   * 验证类型
   */
  private validateType(
    definition: ParameterDefinition,
    value: any,
  ): ValidationError | null {
    const actualType = typeof value;

    switch (definition.type) {
      case 'number':
        if (actualType !== 'number' || isNaN(value)) {
          return {
            field: definition.name,
            message: `${definition.description}必须是数字`,
            code: 'TYPE_ERROR',
          };
        }
        break;

      case 'text':
      case 'textarea':
      case 'email':
      case 'phone':
      case 'url':
        if (actualType !== 'string') {
          return {
            field: definition.name,
            message: `${definition.description}必须是文本`,
            code: 'TYPE_ERROR',
          };
        }
        break;

      case 'date':
      case 'datetime':
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          return {
            field: definition.name,
            message: `${definition.description}日期格式不正确`,
            code: 'TYPE_ERROR',
          };
        }
        break;

      case 'checkbox':
        if (!Array.isArray(value)) {
          return {
            field: definition.name,
            message: `${definition.description}必须是数组`,
            code: 'TYPE_ERROR',
          };
        }
        break;
    }

    return null;
  }

  /**
   * 格式化验证错误消息
   */
  formatErrors(errors: ValidationError[]): string {
    if (errors.length === 0) {
      return '';
    }

    return errors.map(e => `• ${e.message}`).join('\n');
  }

  /**
   * 检查是否有错误
   */
  hasErrors(errors: ValidationError[]): boolean {
    return errors.length > 0;
  }

  /**
   * 按字段分组错误
   */
  groupErrorsByField(errors: ValidationError[]): Record<string, ValidationError[]> {
    return errors.reduce((acc, error) => {
      if (!acc[error.field]) {
        acc[error.field] = [];
      }
      acc[error.field].push(error);
      return acc;
    }, {} as Record<string, ValidationError[]>);
  }
}
