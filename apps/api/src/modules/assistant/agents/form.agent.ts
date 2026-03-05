import { Injectable } from '@nestjs/common';

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

@Injectable()
export class FormAgent {
  async extractFields(
    processCode: string,
    processSchema: ProcessSchema,
    userMessage: string,
    currentFormData?: Record<string, any>,
  ): Promise<FormExtractionResult> {
    const extractedFields: Record<string, any> = {};
    const missingFields: Array<{ key: string; label: string; question: string }> = [];

    // Merge with existing form data
    const formData = { ...currentFormData };

    // Extract fields from message
    for (const field of processSchema.fields) {
      // Skip if already filled
      if (formData[field.key] !== undefined) {
        continue;
      }

      // Try to extract from message
      const value = this.extractFieldValue(field, userMessage);
      if (value !== null) {
        extractedFields[field.key] = value;
        formData[field.key] = value;
      }
    }

    // Check for missing required fields
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

  private extractFieldValue(field: ProcessField, message: string): any {
    switch (field.type) {
      case 'number':
        return this.extractNumber(message, field.key);
      case 'date':
        return this.extractDate(message);
      case 'text':
      case 'textarea':
        return this.extractText(message, field.key);
      case 'select':
      case 'radio':
        return this.extractOption(message, field.options || []);
      default:
        return null;
    }
  }

  private extractNumber(message: string, fieldKey: string): number | null {
    // Look for patterns like "金额1000", "1000元", "1000块"
    const patterns = [
      new RegExp(`${fieldKey}[：:是]?\\s*(\\d+(?:\\.\\d+)?)`),
      /(\d+(?:\.\d+)?)\s*(?:元|块|万)/,
      /金额[：:是]?\s*(\d+(?:\.\d+)?)/,
      /价格[：:是]?\s*(\d+(?:\.\d+)?)/,
      /数量[：:是]?\s*(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }

    return null;
  }

  private extractDate(message: string): string | null {
    // Match YYYY-MM-DD or YYYY/MM/DD
    const dateMatch = message.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
    if (dateMatch) {
      return dateMatch[1].replace(/\//g, '-');
    }

    // Match relative dates like "今天", "明天", "下周一"
    const today = new Date();
    if (message.includes('今天')) {
      return today.toISOString().split('T')[0];
    }
    if (message.includes('明天')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    }

    return null;
  }

  private extractText(message: string, fieldKey: string): string | null {
    // Look for patterns like "原因是XXX", "事由：XXX"
    const patterns = [
      new RegExp(`${fieldKey}[：:是]\\s*([^，。！？]+)`),
      /原因[：:是]\s*([^，。！？]+)/,
      /事由[：:是]\s*([^，。！？]+)/,
      /说明[：:是]\s*([^，。！？]+)/,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    // If no pattern matches, return the whole message as potential reason
    // (will be used if this is the only missing field)
    return null;
  }

  private extractOption(message: string, options: Array<{ label: string; value: string }>): string | null {
    for (const option of options) {
      if (message.includes(option.label)) {
        return option.value;
      }
    }
    return null;
  }

  private generateQuestion(field: ProcessField): string {
    const typeQuestions: Record<string, string> = {
      number: `请问${field.label}是多少？`,
      date: `请问${field.label}是哪天？（格式：YYYY-MM-DD）`,
      text: `请问${field.label}是什么？`,
      textarea: `请说明${field.label}。`,
      select: `请选择${field.label}：${field.options?.map(o => o.label).join('、')}`,
      radio: `请选择${field.label}：${field.options?.map(o => o.label).join('、')}`,
    };

    return typeQuestions[field.type] || `请提供${field.label}。`;
  }
}
