/**
 * 助手工具类
 * 提供常用的辅助功能
 */

export class AssistantUtils {
  /**
   * 格式化日期
   */
  static formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 格式化日期时间
   */
  static formatDateTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const dateStr = this.formatDate(d);
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    const second = String(d.getSeconds()).padStart(2, '0');
    return `${dateStr} ${hour}:${minute}:${second}`;
  }

  /**
   * 解析相对日期
   */
  static parseRelativeDate(input: string): Date | null {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 今天
    if (input.includes('今天') || input.includes('今日')) {
      return today;
    }

    // 明天
    if (input.includes('明天')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }

    // 后天
    if (input.includes('后天')) {
      const dayAfterTomorrow = new Date(today);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      return dayAfterTomorrow;
    }

    // 昨天
    if (input.includes('昨天')) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday;
    }

    // 下周X
    const nextWeekMatch = input.match(/下周([一二三四五六日天])/);
    if (nextWeekMatch) {
      const weekdayMap: Record<string, number> = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0,
      };
      const targetWeekday = weekdayMap[nextWeekMatch[1]];
      const daysToAdd = (7 - today.getDay() + targetWeekday) % 7 + 7;
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + daysToAdd);
      return nextWeek;
    }

    // 本周X
    const thisWeekMatch = input.match(/本周([一二三四五六日天])/);
    if (thisWeekMatch) {
      const weekdayMap: Record<string, number> = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0,
      };
      const targetWeekday = weekdayMap[thisWeekMatch[1]];
      const daysToAdd = (targetWeekday - today.getDay() + 7) % 7;
      const thisWeek = new Date(today);
      thisWeek.setDate(today.getDate() + daysToAdd);
      return thisWeek;
    }

    // N天后
    const daysLaterMatch = input.match(/(\d+)天后/);
    if (daysLaterMatch) {
      const days = parseInt(daysLaterMatch[1]);
      const future = new Date(today);
      future.setDate(today.getDate() + days);
      return future;
    }

    // N天前
    const daysAgoMatch = input.match(/(\d+)天前/);
    if (daysAgoMatch) {
      const days = parseInt(daysAgoMatch[1]);
      const past = new Date(today);
      past.setDate(today.getDate() - days);
      return past;
    }

    return null;
  }

  /**
   * 计算日期差（天数）
   */
  static calculateDateDiff(startDate: Date | string, endDate: Date | string): number {
    const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
    const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  }

  /**
   * 格式化金额
   */
  static formatAmount(amount: number, currency: string = '¥'): string {
    return `${currency}${amount.toFixed(2)}`;
  }

  /**
   * 解析金额
   */
  static parseAmount(input: string): number | null {
    const patterns = [
      /(\d+(?:\.\d+)?)\s*(?:元|块)/,
      /(\d+(?:\.\d+)?)\s*万/,
      /金额[：:是]?\s*(\d+(?:\.\d+)?)/,
      /价格[：:是]?\s*(\d+(?:\.\d+)?)/,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) {
        let amount = parseFloat(match[1]);
        // 如果是"万"，乘以10000
        if (input.includes('万')) {
          amount *= 10000;
        }
        return amount;
      }
    }

    return null;
  }

  /**
   * 生成唯一ID
   */
  static generateId(prefix: string = ''): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
  }

  /**
   * 截断文本
   */
  static truncate(text: string, maxLength: number, suffix: string = '...'): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * 高亮关键词
   */
  static highlightKeywords(text: string, keywords: string[]): string {
    let result = text;
    for (const keyword of keywords) {
      const regex = new RegExp(keyword, 'gi');
      result = result.replace(regex, `**${keyword}**`);
    }
    return result;
  }

  /**
   * 提取关键词
   */
  static extractKeywords(text: string, stopWords: string[] = []): string[] {
    // 简单的关键词提取（实际项目中应使用更复杂的算法）
    const words = text
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.includes(w));

    // 去重并按频率排序
    const wordCount = words.reduce((acc, word) => {
      acc[word] = (acc[word] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(wordCount)
      .sort(([, a], [, b]) => b - a)
      .map(([word]) => word)
      .slice(0, 10);
  }

  /**
   * 计算文本相似度（简单版本）
   */
  static calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * 格式化表单数据为可读文本
   */
  static formatFormDataToText(
    formData: Record<string, any>,
    fieldDefinitions?: Array<{ key: string; label: string; type: string }>,
  ): string {
    const lines: string[] = [];

    for (const [key, value] of Object.entries(formData)) {
      if (value === undefined || value === null) {
        continue;
      }

      const field = fieldDefinitions?.find(f => f.key === key);
      const label = field?.label || key;

      let formattedValue: string;

      if (Array.isArray(value)) {
        formattedValue = value.join('、');
      } else if (typeof value === 'object' && value instanceof Date) {
        formattedValue = this.formatDate(value);
      } else if (typeof value === 'number') {
        formattedValue = field?.type === 'number' && key.includes('amount')
          ? this.formatAmount(value)
          : String(value);
      } else {
        formattedValue = String(value);
      }

      lines.push(`  ${label}: ${formattedValue}`);
    }

    return lines.join('\n');
  }

  /**
   * 解析时间范围
   */
  static parseTimeRange(input: string): { start: Date; end: Date } | null {
    // 匹配 "从X到Y" 或 "X到Y" 或 "X至Y"
    const rangeMatch = input.match(/(?:从)?(.+?)(?:到|至)(.+)/);
    if (!rangeMatch) {
      return null;
    }

    const startStr = rangeMatch[1].trim();
    const endStr = rangeMatch[2].trim();

    // 尝试解析日期
    let startDate = this.parseRelativeDate(startStr);
    let endDate = this.parseRelativeDate(endStr);

    // 如果相对日期解析失败，尝试绝对日期
    if (!startDate) {
      const startMatch = startStr.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
      if (startMatch) {
        startDate = new Date(startMatch[1].replace(/\//g, '-'));
      }
    }

    if (!endDate) {
      const endMatch = endStr.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
      if (endMatch) {
        endDate = new Date(endMatch[1].replace(/\//g, '-'));
      }
    }

    if (startDate && endDate) {
      return { start: startDate, end: endDate };
    }

    return null;
  }

  /**
   * 验证日期范围
   */
  static validateDateRange(startDate: Date | string, endDate: Date | string): {
    valid: boolean;
    error?: string;
  } {
    const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
    const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

    if (isNaN(start.getTime())) {
      return { valid: false, error: '开始日期格式不正确' };
    }

    if (isNaN(end.getTime())) {
      return { valid: false, error: '结束日期格式不正确' };
    }

    if (start > end) {
      return { valid: false, error: '开始日期不能晚于结束日期' };
    }

    return { valid: true };
  }

  /**
   * 生成友好的时间描述
   */
  static formatRelativeTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return '刚刚';
    } else if (diffMinutes < 60) {
      return `${diffMinutes}分钟前`;
    } else if (diffHours < 24) {
      return `${diffHours}小时前`;
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks}周前`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months}个月前`;
    } else {
      const years = Math.floor(diffDays / 365);
      return `${years}年前`;
    }
  }

  /**
   * 清理文本
   */
  static cleanText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s.,!?;:()（），。！？；：]/g, '');
  }

  /**
   * 检测语言
   */
  static detectLanguage(text: string): 'zh' | 'en' | 'unknown' {
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
    const englishChars = text.match(/[a-zA-Z]/g);

    const chineseCount = chineseChars ? chineseChars.length : 0;
    const englishCount = englishChars ? englishChars.length : 0;

    if (chineseCount > englishCount) {
      return 'zh';
    } else if (englishCount > chineseCount) {
      return 'en';
    } else {
      return 'unknown';
    }
  }

  /**
   * 生成摘要
   */
  static generateSummary(text: string, maxLength: number = 100): string {
    const cleaned = this.cleanText(text);

    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    // 尝试在句子边界截断
    const sentences = cleaned.split(/[。！？.!?]/);
    let summary = '';

    for (const sentence of sentences) {
      if (summary.length + sentence.length <= maxLength) {
        summary += sentence + '。';
      } else {
        break;
      }
    }

    if (summary.length === 0) {
      summary = this.truncate(cleaned, maxLength);
    }

    return summary;
  }

  /**
   * 解析布尔值
   */
  static parseBoolean(input: string): boolean | null {
    const trueValues = ['是', '对', '好', '确认', '同意', 'yes', 'true', 'ok', 'y'];
    const falseValues = ['否', '不', '不是', '取消', '拒绝', 'no', 'false', 'n'];

    const normalized = input.toLowerCase().trim();

    if (trueValues.includes(normalized)) {
      return true;
    } else if (falseValues.includes(normalized)) {
      return false;
    }

    return null;
  }

  /**
   * 格式化列表
   */
  static formatList(items: string[], numbered: boolean = true): string {
    return items
      .map((item, index) => {
        const prefix = numbered ? `${index + 1}. ` : '• ';
        return `${prefix}${item}`;
      })
      .join('\n');
  }

  /**
   * 深度克隆对象
   */
  static deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * 合并对象（深度合并）
   */
  static deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        const sourceValue = source[key];
        const targetValue = result[key];

        if (
          sourceValue &&
          typeof sourceValue === 'object' &&
          !Array.isArray(sourceValue) &&
          targetValue &&
          typeof targetValue === 'object' &&
          !Array.isArray(targetValue)
        ) {
          result[key] = this.deepMerge(targetValue, sourceValue);
        } else {
          result[key] = sourceValue as any;
        }
      }
    }

    return result;
  }

  /**
   * 延迟执行
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 重试函数
   */
  static async retry<T>(
    fn: () => Promise<T>,
    options: {
      maxAttempts?: number;
      delayMs?: number;
      backoffMultiplier?: number;
    } = {},
  ): Promise<T> {
    const maxAttempts = options.maxAttempts || 3;
    const delayMs = options.delayMs || 1000;
    const backoffMultiplier = options.backoffMultiplier || 2;

    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        console.error(`Attempt ${attempt}/${maxAttempts} failed:`, error.message);

        if (attempt < maxAttempts) {
          const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * 批处理
   */
  static async batchProcess<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize: number = 10,
  ): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(processor));
      results.push(...batchResults);
    }

    return results;
  }
}
