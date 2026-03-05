/**
 * 助手工具类单元测试
 */

import { AssistantUtils } from '../utils/assistant.utils';

describe('AssistantUtils', () => {
  describe('日期处理', () => {
    it('应该正确格式化日期', () => {
      const date = new Date('2026-03-05T10:30:00');
      const formatted = AssistantUtils.formatDate(date);
      expect(formatted).toBe('2026-03-05');
    });

    it('应该正确格式化日期时间', () => {
      const date = new Date('2026-03-05T10:30:45');
      const formatted = AssistantUtils.formatDateTime(date);
      expect(formatted).toBe('2026-03-05 10:30:45');
    });

    it('应该解析"今天"', () => {
      const date = AssistantUtils.parseRelativeDate('今天');
      expect(date).toBeInstanceOf(Date);
      expect(date?.getHours()).toBe(0);
      expect(date?.getMinutes()).toBe(0);
    });

    it('应该解析"明天"', () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const parsed = AssistantUtils.parseRelativeDate('明天');
      expect(parsed?.getTime()).toBe(tomorrow.getTime());
    });

    it('应该解析"下周一"', () => {
      const date = AssistantUtils.parseRelativeDate('下周一');
      expect(date).toBeInstanceOf(Date);
      expect(date?.getDay()).toBe(1); // 周一
    });

    it('应该计算日期差', () => {
      const diff = AssistantUtils.calculateDateDiff('2026-03-01', '2026-03-10');
      expect(diff).toBe(9);
    });

    it('应该验证日期范围', () => {
      const result = AssistantUtils.validateDateRange('2026-03-01', '2026-03-10');
      expect(result.valid).toBe(true);
    });

    it('应该检测无效的日期范围', () => {
      const result = AssistantUtils.validateDateRange('2026-03-10', '2026-03-01');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('金额处理', () => {
    it('应该正确格式化金额', () => {
      const formatted = AssistantUtils.formatAmount(1000);
      expect(formatted).toBe('¥1000.00');
    });

    it('应该解析"1000元"', () => {
      const amount = AssistantUtils.parseAmount('1000元');
      expect(amount).toBe(1000);
    });

    it('应该解析"5万"', () => {
      const amount = AssistantUtils.parseAmount('5万');
      expect(amount).toBe(50000);
    });

    it('应该解析"金额1000"', () => {
      const amount = AssistantUtils.parseAmount('金额1000');
      expect(amount).toBe(1000);
    });
  });

  describe('文本处理', () => {
    it('应该正确截断文本', () => {
      const text = '这是一段很长的文本内容';
      const truncated = AssistantUtils.truncate(text, 10);
      expect(truncated.length).toBeLessThanOrEqual(10);
      expect(truncated).toContain('...');
    });

    it('应该提取关键词', () => {
      const text = '我要报销差旅费1000元';
      const keywords = AssistantUtils.extractKeywords(text);
      expect(keywords).toContain('报销');
      expect(keywords).toContain('差旅费');
    });

    it('应该计算文本相似度', () => {
      const similarity = AssistantUtils.calculateSimilarity(
        '我要报销差旅费',
        '我要报销费用'
      );
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('应该清理文本', () => {
      const cleaned = AssistantUtils.cleanText('  这是   文本  ');
      expect(cleaned).toBe('这是 文本');
    });

    it('应该检测语言', () => {
      expect(AssistantUtils.detectLanguage('这是中文')).toBe('zh');
      expect(AssistantUtils.detectLanguage('This is English')).toBe('en');
    });

    it('应该生成摘要', () => {
      const text = '这是一段很长的文本内容，需要生成摘要。这是第二句话。这是第三句话。';
      const summary = AssistantUtils.generateSummary(text, 20);
      expect(summary.length).toBeLessThanOrEqual(20);
    });
  });

  describe('布尔值解析', () => {
    it('应该解析"是"为true', () => {
      expect(AssistantUtils.parseBoolean('是')).toBe(true);
      expect(AssistantUtils.parseBoolean('对')).toBe(true);
      expect(AssistantUtils.parseBoolean('好')).toBe(true);
      expect(AssistantUtils.parseBoolean('yes')).toBe(true);
    });

    it('应该解析"否"为false', () => {
      expect(AssistantUtils.parseBoolean('否')).toBe(false);
      expect(AssistantUtils.parseBoolean('不')).toBe(false);
      expect(AssistantUtils.parseBoolean('no')).toBe(false);
    });

    it('应该返回null对于未知输入', () => {
      expect(AssistantUtils.parseBoolean('可能')).toBe(null);
    });
  });

  describe('时间范围解析', () => {
    it('应该解析"从3月1日到3月10日"', () => {
      const range = AssistantUtils.parseTimeRange('从3月1日到3月10日');
      expect(range).toBeDefined();
      expect(range?.start).toBeInstanceOf(Date);
      expect(range?.end).toBeInstanceOf(Date);
    });

    it('应该解析"今天到明天"', () => {
      const range = AssistantUtils.parseTimeRange('今天到明天');
      expect(range).toBeDefined();
      expect(range?.start).toBeInstanceOf(Date);
      expect(range?.end).toBeInstanceOf(Date);
    });
  });

  describe('列表格式化', () => {
    it('应该格式化编号列表', () => {
      const items = ['项目1', '项目2', '项目3'];
      const formatted = AssistantUtils.formatList(items, true);
      expect(formatted).toContain('1. 项目1');
      expect(formatted).toContain('2. 项目2');
      expect(formatted).toContain('3. 项目3');
    });

    it('应该格式化无序列表', () => {
      const items = ['项目1', '项目2', '项目3'];
      const formatted = AssistantUtils.formatList(items, false);
      expect(formatted).toContain('• 项目1');
      expect(formatted).toContain('• 项目2');
      expect(formatted).toContain('• 项目3');
    });
  });

  describe('对象操作', () => {
    it('应该深度克隆对象', () => {
      const obj = { a: 1, b: { c: 2 } };
      const cloned = AssistantUtils.deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.b).not.toBe(obj.b);
    });

    it('应该深度合并对象', () => {
      const target = { a: 1, b: { c: 2, d: 3 } };
      const source = { b: { c: 4 }, e: 5 };
      const merged = AssistantUtils.deepMerge(target, source);
      expect(merged.a).toBe(1);
      expect(merged.b.c).toBe(4);
      expect(merged.b.d).toBe(3);
      expect(merged.e).toBe(5);
    });
  });

  describe('异步操作', () => {
    it('应该正确延迟执行', async () => {
      const start = Date.now();
      await AssistantUtils.sleep(100);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it('应该重试失败的操作', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed');
        }
        return 'Success';
      };

      const result = await AssistantUtils.retry(fn, {
        maxAttempts: 3,
        delayMs: 10,
      });

      expect(result).toBe('Success');
      expect(attempts).toBe(3);
    });

    it('应该在最大重试次数后抛出错误', async () => {
      const fn = async () => {
        throw new Error('Always fails');
      };

      await expect(
        AssistantUtils.retry(fn, {
          maxAttempts: 2,
          delayMs: 10,
        })
      ).rejects.toThrow('Always fails');
    });

    it('应该批量处理项目', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = async (item: number) => item * 2;

      const results = await AssistantUtils.batchProcess(items, processor, 2);

      expect(results).toEqual([2, 4, 6, 8, 10]);
    });
  });

  describe('相对时间格式化', () => {
    it('应该格式化"刚刚"', () => {
      const now = new Date();
      const formatted = AssistantUtils.formatRelativeTime(now);
      expect(formatted).toBe('刚刚');
    });

    it('应该格式化"X分钟前"', () => {
      const date = new Date();
      date.setMinutes(date.getMinutes() - 5);
      const formatted = AssistantUtils.formatRelativeTime(date);
      expect(formatted).toContain('分钟前');
    });

    it('应该格式化"X小时前"', () => {
      const date = new Date();
      date.setHours(date.getHours() - 2);
      const formatted = AssistantUtils.formatRelativeTime(date);
      expect(formatted).toContain('小时前');
    });

    it('应该格式化"X天前"', () => {
      const date = new Date();
      date.setDate(date.getDate() - 3);
      const formatted = AssistantUtils.formatRelativeTime(date);
      expect(formatted).toContain('天前');
    });
  });

  describe('表单数据格式化', () => {
    it('应该格式化表单数据为文本', () => {
      const formData = {
        amount: 1000,
        date: '2026-03-05',
        reason: '出差北京',
      };

      const fieldDefinitions = [
        { key: 'amount', label: '报销金额', type: 'number' },
        { key: 'date', label: '报销日期', type: 'date' },
        { key: 'reason', label: '报销事由', type: 'text' },
      ];

      const formatted = AssistantUtils.formatFormDataToText(formData, fieldDefinitions);

      expect(formatted).toContain('报销金额: ¥1000.00');
      expect(formatted).toContain('报销日期: 2026-03-05');
      expect(formatted).toContain('报销事由: 出差北京');
    });

    it('应该处理数组值', () => {
      const formData = {
        tags: ['标签1', '标签2', '标签3'],
      };

      const fieldDefinitions = [
        { key: 'tags', label: '标签', type: 'checkbox' },
      ];

      const formatted = AssistantUtils.formatFormDataToText(formData, fieldDefinitions);

      expect(formatted).toContain('标签: 标签1、标签2、标签3');
    });
  });
});
