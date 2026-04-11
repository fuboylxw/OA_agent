import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { v4 as uuidv4 } from 'uuid';

interface RuleCheckInput {
  processCode: string;
  formData: Record<string, any>;
  rules: Array<{
    type: string;
    expression: string;
    errorLevel: 'error' | 'warn';
    errorMessage?: string;
  }>;
}

interface RuleCheckResult {
  valid: boolean;
  errors: Array<{
    field?: string;
    message: string;
    level: 'error' | 'warn';
  }>;
}

@Injectable()
export class RuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async checkRules(input: RuleCheckInput, traceId: string): Promise<RuleCheckResult> {
    const errors: Array<{ field?: string; message: string; level: 'error' | 'warn' }> = [];

    for (const rule of input.rules) {
      const result = this.evaluateRule(rule, input.formData);
      if (!result.passed) {
        errors.push({
          field: result.field,
          message: rule.errorMessage || result.message || '规则校验失败',
          level: rule.errorLevel,
        });
      }
    }

    const hasErrors = errors.some(e => e.level === 'error');

    return {
      valid: !hasErrors,
      errors,
    };
  }

  private evaluateRule(
    rule: { type: string; expression: string; errorLevel: string },
    formData: Record<string, any>,
  ): { passed: boolean; field?: string; message?: string } {
    try {
      switch (rule.type) {
        case 'validation':
          return this.evaluateValidationRule(rule.expression, formData);
        case 'calculation':
          return this.evaluateCalculationRule(rule.expression, formData);
        case 'conditional':
          return this.evaluateConditionalRule(rule.expression, formData);
        default:
          return { passed: true };
      }
    } catch (error: any) {
      return { passed: false, message: `规则执行错误: ${error.message}` };
    }
  }

  private evaluateValidationRule(
    expression: string,
    formData: Record<string, any>,
  ): { passed: boolean; field?: string; message?: string } {
    // Parse simple validation expressions like "amount > 0", "date >= today"
    const match = expression.match(/^(\w+)\s*(>|>=|<|<=|==|!=)\s*(.+)$/);
    if (!match) {
      return { passed: true };
    }

    const [, field, operator, valueStr] = match;
    const fieldValue = formData[field];

    if (fieldValue === undefined || fieldValue === null) {
      return { passed: false, field, message: `字段 ${field} 未填写` };
    }

    const expectedValue = this.parseValue(valueStr, formData);
    const passed = this.compareValues(fieldValue, operator, expectedValue);

    return {
      passed,
      field,
      message: passed ? undefined : `${field} 不满足条件 ${expression}`,
    };
  }

  private evaluateCalculationRule(
    expression: string,
    formData: Record<string, any>,
  ): { passed: boolean; field?: string; message?: string } {
    // Parse calculation rules like "totalAmount = quantity * unitPrice"
    const match = expression.match(/^(\w+)\s*=\s*(.+)$/);
    if (!match) {
      return { passed: true };
    }

    const [, targetField, calcExpression] = match;
    const calculatedValue = this.calculateExpression(calcExpression, formData);
    const actualValue = formData[targetField];

    if (actualValue === undefined) {
      // Auto-fill calculated value
      formData[targetField] = calculatedValue;
      return { passed: true };
    }

    const passed = Math.abs(actualValue - calculatedValue) < 0.01;
    return {
      passed,
      field: targetField,
      message: passed ? undefined : `${targetField} 计算值不正确，应为 ${calculatedValue}`,
    };
  }

  private evaluateConditionalRule(
    expression: string,
    formData: Record<string, any>,
  ): { passed: boolean; field?: string; message?: string } {
    // Parse conditional rules like "if amount > 1000 then approver required"
    const match = expression.match(/^if\s+(.+)\s+then\s+(.+)$/);
    if (!match) {
      return { passed: true };
    }

    const [, condition, requirement] = match;
    const conditionMet = this.evaluateCondition(condition, formData);

    if (!conditionMet) {
      return { passed: true }; // Condition not met, rule doesn't apply
    }

    // Check requirement
    const reqMatch = requirement.match(/^(\w+)\s+required$/);
    if (reqMatch) {
      const requiredField = reqMatch[1];
      const passed = formData[requiredField] !== undefined && formData[requiredField] !== null;
      return {
        passed,
        field: requiredField,
        message: passed ? undefined : `当 ${condition} 时，${requiredField} 为必填项`,
      };
    }

    return { passed: true };
  }

  private evaluateCondition(condition: string, formData: Record<string, any>): boolean {
    const match = condition.match(/^(\w+)\s*(>|>=|<|<=|==|!=)\s*(.+)$/);
    if (!match) return false;

    const [, field, operator, valueStr] = match;
    const fieldValue = formData[field];
    const expectedValue = this.parseValue(valueStr, formData);

    return this.compareValues(fieldValue, operator, expectedValue);
  }

  private parseValue(valueStr: string, formData: Record<string, any>): any {
    valueStr = valueStr.trim();

    // Check if it's a field reference
    if (formData[valueStr] !== undefined) {
      return formData[valueStr];
    }

    // Check if it's a number
    if (!isNaN(Number(valueStr))) {
      return Number(valueStr);
    }

    // Check if it's a date keyword
    if (valueStr === 'today') {
      return new Date().toISOString().split('T')[0];
    }

    // Return as string
    return valueStr.replace(/['"]/g, '');
  }

  private compareValues(value: any, operator: string, expected: any): boolean {
    switch (operator) {
      case '>': return value > expected;
      case '>=': return value >= expected;
      case '<': return value < expected;
      case '<=': return value <= expected;
      case '==': return value === expected;
      case '!=': return value !== expected;
      default: return false;
    }
  }

  private calculateExpression(expression: string, formData: Record<string, any>): number {
    // Safe arithmetic evaluator — only allows numbers and basic operators (+, -, *, /, parentheses)
    let expr = expression;
    for (const [key, value] of Object.entries(formData)) {
      if (typeof value === 'number') {
        expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(value));
      }
    }

    // Strip whitespace and validate: only digits, dots, operators, parens allowed
    const sanitized = expr.replace(/\s+/g, '');
    if (!/^[\d.+\-*/()]+$/.test(sanitized)) {
      return 0;
    }

    try {
      // Use indirect eval-free arithmetic: parse tokens and compute
      return this.safeEvalArithmetic(sanitized);
    } catch {
      return 0;
    }
  }

  private safeEvalArithmetic(expr: string): number {
    let pos = 0;

    const parseNumber = (): number => {
      let numStr = '';
      if (expr[pos] === '-') { numStr += expr[pos++]; }
      while (pos < expr.length && (expr[pos] >= '0' && expr[pos] <= '9' || expr[pos] === '.')) {
        numStr += expr[pos++];
      }
      if (!numStr || numStr === '-') throw new Error('Expected number');
      return parseFloat(numStr);
    };

    const parseFactor = (): number => {
      if (expr[pos] === '(') {
        pos++; // skip '('
        const result = parseExpr();
        if (expr[pos] === ')') pos++; // skip ')'
        return result;
      }
      return parseNumber();
    };

    const parseTerm = (): number => {
      let result = parseFactor();
      while (pos < expr.length && (expr[pos] === '*' || expr[pos] === '/')) {
        const op = expr[pos++];
        const right = parseFactor();
        result = op === '*' ? result * right : result / right;
      }
      return result;
    };

    const parseExpr = (): number => {
      let result = parseTerm();
      while (pos < expr.length && (expr[pos] === '+' || expr[pos] === '-')) {
        const op = expr[pos++];
        const right = parseTerm();
        result = op === '+' ? result + right : result - right;
      }
      return result;
    };

    const result = parseExpr();
    if (!isFinite(result)) return 0;
    return result;
  }
}
