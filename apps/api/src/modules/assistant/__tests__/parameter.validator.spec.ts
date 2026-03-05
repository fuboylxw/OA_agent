/**
 * 参数验证器单元测试
 */

import { ParameterValidator } from '../validators/parameter.validator';
import { ParameterDefinition, ValidationType } from '../types/context.types';

describe('ParameterValidator', () => {
  let validator: ParameterValidator;

  beforeEach(() => {
    validator = new ParameterValidator();
  });

  describe('必填验证', () => {
    it('应该验证必填参数', () => {
      const definition: ParameterDefinition = {
        name: 'amount',
        type: 'number',
        required: true,
        description: '金额',
      };

      const errors = validator.validate(definition, undefined);
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe('REQUIRED');
    });

    it('应该通过必填验证', () => {
      const definition: ParameterDefinition = {
        name: 'amount',
        type: 'number',
        required: true,
        description: '金额',
      };

      const errors = validator.validate(definition, 1000);
      expect(errors.length).toBe(0);
    });

    it('应该跳过非必填参数的验证', () => {
      const definition: ParameterDefinition = {
        name: 'note',
        type: 'text',
        required: false,
        description: '备注',
      };

      const errors = validator.validate(definition, undefined);
      expect(errors.length).toBe(0);
    });
  });

  describe('长度验证', () => {
    it('应该验证最小长度', () => {
      const definition: ParameterDefinition = {
        name: 'title',
        type: 'text',
        required: true,
        description: '标题',
        validation: [
          {
            type: ValidationType.MIN_LENGTH,
            params: { min: 5 },
            message: '标题至少5个字符',
          },
        ],
      };

      const errors = validator.validate(definition, '123');
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe('MIN_LENGTH');
    });

    it('应该验证最大长度', () => {
      const definition: ParameterDefinition = {
        name: 'title',
        type: 'text',
        required: true,
        description: '标题',
        validation: [
          {
            type: ValidationType.MAX_LENGTH,
            params: { max: 10 },
            message: '标题最多10个字符',
          },
        ],
      };

      const errors = validator.validate(definition, '这是一个很长的标题内容');
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe('MAX_LENGTH');
    });

    it('应该通过长度验证', () => {
      const definition: ParameterDefinition = {
        name: 'title',
        type: 'text',
        required: true,
        description: '标题',
        validation: [
          {
            type: ValidationType.MIN_LENGTH,
            params: { min: 5 },
          },
          {
            type: ValidationType.MAX_LENGTH,
            params: { max: 20 },
          },
        ],
      };

      const errors = validator.validate(definition, '合适的标题');
      expect(errors.length).toBe(0);
    });
  });

  describe('数值验证', () => {
    it('应该验证最小值', () => {
      const definition: ParameterDefinition = {
        name: 'amount',
        type: 'number',
        required: true,
        description: '金额',
        validation: [
          {
            type: ValidationType.MIN_VALUE,
            params: { min: 0 },
            message: '金额必须大于0',
          },
        ],
      };

      const errors = validator.validate(definition, -100);
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe('MIN_VALUE');
    });

    it('应该验证最大值', () => {
      const definition: ParameterDefinition = {
        name: 'amount',
        type: 'number',
        required: true,
        description: '金额',
        validation: [
          {
            type: ValidationType.MAX_VALUE,
            params: { max: 10000 },
            message: '金额不能超过10000',
          },
        ],
      };

      const errors = validator.validate(definition, 20000);
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe('MAX_VALUE');
    });

    it('应该通过数值验证', () => {
      const definition: ParameterDefinition = {
        name: 'amount',
        type: 'number',
        required: true,
        description: '金额',
        validation: [
          {
            type: ValidationType.MIN_VALUE,
            params: { min: 0 },
          },
          {
            type: ValidationType.MAX_VALUE,
            params: { max: 10000 },
          },
        ],
      };

      const errors = validator.validate(definition, 5000);
      expect(errors.length).toBe(0);
    });
  });

  describe('格式验证', () => {
    it('应该验证邮箱格式', () => {
      const definition: ParameterDefinition = {
        name: 'email',
        type: 'email',
        required: true,
        description: '邮箱',
        validation: [
          {
            type: ValidationType.EMAIL,
          },
        ],
      };

      const errors = validator.validate(definition, 'invalid-email');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.code === 'EMAIL')).toBe(true);
    });

    it('应该通过邮箱验证', () => {
      const definition: ParameterDefinition = {
        name: 'email',
        type: 'email',
        required: true,
        description: '邮箱',
        validation: [
          {
            type: ValidationType.EMAIL,
          },
        ],
      };

      const errors = validator.validate(definition, 'user@example.com');
      expect(errors.filter(e => e.code === 'EMAIL').length).toBe(0);
    });

    it('应该验证手机号格式', () => {
      const definition: ParameterDefinition = {
        name: 'phone',
        type: 'phone',
        required: true,
        description: '手机号',
        validation: [
          {
            type: ValidationType.PHONE,
          },
        ],
      };

      const errors = validator.validate(definition, '12345678901');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.code === 'PHONE')).toBe(true);
    });

    it('应该通过手机号验证', () => {
      const definition: ParameterDefinition = {
        name: 'phone',
        type: 'phone',
        required: true,
        description: '手机号',
        validation: [
          {
            type: ValidationType.PHONE,
          },
        ],
      };

      const errors = validator.validate(definition, '13800138000');
      expect(errors.filter(e => e.code === 'PHONE').length).toBe(0);
    });

    it('应该验证正则表达式', () => {
      const definition: ParameterDefinition = {
        name: 'code',
        type: 'text',
        required: true,
        description: '编码',
        validation: [
          {
            type: ValidationType.PATTERN,
            params: { pattern: '^[A-Z]{3}\\d{3}$' },
            message: '编码格式不正确',
          },
        ],
      };

      const errors = validator.validate(definition, 'ABC12');
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe('PATTERN');
    });

    it('应该通过正则验证', () => {
      const definition: ParameterDefinition = {
        name: 'code',
        type: 'text',
        required: true,
        description: '编码',
        validation: [
          {
            type: ValidationType.PATTERN,
            params: { pattern: '^[A-Z]{3}\\d{3}$' },
          },
        ],
      };

      const errors = validator.validate(definition, 'ABC123');
      expect(errors.length).toBe(0);
    });
  });

  describe('日期范围验证', () => {
    it('应该验证日期范围', () => {
      const definition: ParameterDefinition = {
        name: 'date',
        type: 'date',
        required: true,
        description: '日期',
        validation: [
          {
            type: ValidationType.DATE_RANGE,
            params: {
              min: '2026-01-01',
              max: '2026-12-31',
            },
            message: '日期必须在2026年内',
          },
        ],
      };

      const errors = validator.validate(definition, '2027-01-01');
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe('DATE_RANGE');
    });

    it('应该通过日期范围验证', () => {
      const definition: ParameterDefinition = {
        name: 'date',
        type: 'date',
        required: true,
        description: '日期',
        validation: [
          {
            type: ValidationType.DATE_RANGE,
            params: {
              min: '2026-01-01',
              max: '2026-12-31',
            },
          },
        ],
      };

      const errors = validator.validate(definition, '2026-06-15');
      expect(errors.length).toBe(0);
    });
  });

  describe('类型验证', () => {
    it('应该验证数字类型', () => {
      const definition: ParameterDefinition = {
        name: 'amount',
        type: 'number',
        required: true,
        description: '金额',
      };

      const errors = validator.validate(definition, 'not a number');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.code === 'TYPE_ERROR')).toBe(true);
    });

    it('应该验证文本类型', () => {
      const definition: ParameterDefinition = {
        name: 'title',
        type: 'text',
        required: true,
        description: '标题',
      };

      const errors = validator.validate(definition, 123);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.code === 'TYPE_ERROR')).toBe(true);
    });

    it('应该验证数组类型', () => {
      const definition: ParameterDefinition = {
        name: 'tags',
        type: 'checkbox',
        required: true,
        description: '标签',
      };

      const errors = validator.validate(definition, 'not an array');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.code === 'TYPE_ERROR')).toBe(true);
    });
  });

  describe('批量验证', () => {
    it('应该批量验证所有参数', () => {
      const definitions: ParameterDefinition[] = [
        {
          name: 'amount',
          type: 'number',
          required: true,
          description: '金额',
          validation: [
            {
              type: ValidationType.MIN_VALUE,
              params: { min: 0 },
            },
          ],
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          description: '标题',
          validation: [
            {
              type: ValidationType.MIN_LENGTH,
              params: { min: 5 },
            },
          ],
        },
      ];

      const parameters = {
        amount: -100,
        title: '123',
      };

      const errors = validator.validateAll(parameters, definitions);
      expect(errors.length).toBe(2);
    });

    it('应该通过批量验证', () => {
      const definitions: ParameterDefinition[] = [
        {
          name: 'amount',
          type: 'number',
          required: true,
          description: '金额',
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          description: '标题',
        },
      ];

      const parameters = {
        amount: 1000,
        title: '合适的标题',
      };

      const errors = validator.validateAll(parameters, definitions);
      expect(errors.length).toBe(0);
    });
  });

  describe('错误格式化', () => {
    it('应该格式化验证错误', () => {
      const errors = [
        { field: 'amount', message: '金额必须大于0', code: 'MIN_VALUE' },
        { field: 'title', message: '标题至少5个字符', code: 'MIN_LENGTH' },
      ];

      const formatted = validator.formatErrors(errors);
      expect(formatted).toContain('金额必须大于0');
      expect(formatted).toContain('标题至少5个字符');
    });

    it('应该按字段分组错误', () => {
      const errors = [
        { field: 'amount', message: '金额必须大于0', code: 'MIN_VALUE' },
        { field: 'amount', message: '金额不能超过10000', code: 'MAX_VALUE' },
        { field: 'title', message: '标题至少5个字符', code: 'MIN_LENGTH' },
      ];

      const grouped = validator.groupErrorsByField(errors);
      expect(grouped['amount'].length).toBe(2);
      expect(grouped['title'].length).toBe(1);
    });
  });

  describe('自定义验证', () => {
    it('应该验证选项值', () => {
      const definition: ParameterDefinition = {
        name: 'type',
        type: 'select',
        required: true,
        description: '类型',
        validation: [
          {
            type: ValidationType.CUSTOM,
            params: {
              options: [
                { label: '类型A', value: 'type_a' },
                { label: '类型B', value: 'type_b' },
              ],
            },
          },
        ],
      };

      const errors = validator.validate(definition, 'invalid_type');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.code === 'CUSTOM')).toBe(true);
    });

    it('应该通过选项验证', () => {
      const definition: ParameterDefinition = {
        name: 'type',
        type: 'select',
        required: true,
        description: '类型',
        validation: [
          {
            type: ValidationType.CUSTOM,
            params: {
              options: [
                { label: '类型A', value: 'type_a' },
                { label: '类型B', value: 'type_b' },
              ],
            },
          },
        ],
      };

      const errors = validator.validate(definition, 'type_a');
      expect(errors.filter(e => e.code === 'CUSTOM').length).toBe(0);
    });

    it('应该验证多选值', () => {
      const definition: ParameterDefinition = {
        name: 'tags',
        type: 'checkbox',
        required: true,
        description: '标签',
        validation: [
          {
            type: ValidationType.CUSTOM,
            params: {
              options: [
                { label: '标签1', value: 'tag1' },
                { label: '标签2', value: 'tag2' },
              ],
            },
          },
        ],
      };

      const errors = validator.validate(definition, ['tag1', 'invalid_tag']);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.code === 'CUSTOM')).toBe(true);
    });

    it('应该通过多选验证', () => {
      const definition: ParameterDefinition = {
        name: 'tags',
        type: 'checkbox',
        required: true,
        description: '标签',
        validation: [
          {
            type: ValidationType.CUSTOM,
            params: {
              options: [
                { label: '标签1', value: 'tag1' },
                { label: '标签2', value: 'tag2' },
              ],
            },
          },
        ],
      };

      const errors = validator.validate(definition, ['tag1', 'tag2']);
      expect(errors.filter(e => e.code === 'CUSTOM').length).toBe(0);
    });
  });
});
