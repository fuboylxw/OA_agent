import { RuleService } from './rule.service';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('RuleService', () => {
  let service: RuleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuleService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: AuditService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<RuleService>(RuleService);
  });

  it('should validate simple comparison rule', async () => {
    const result = await service.checkRules(
      {
        processCode: 'test',
        formData: { amount: 1000 },
        rules: [
          {
            type: 'validation',
            expression: 'amount > 0',
            errorLevel: 'error',
            errorMessage: '金额必须大于0',
          },
        ],
      },
      'test-trace',
    );

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('should fail validation when rule not met', async () => {
    const result = await service.checkRules(
      {
        processCode: 'test',
        formData: { amount: -100 },
        rules: [
          {
            type: 'validation',
            expression: 'amount > 0',
            errorLevel: 'error',
            errorMessage: '金额必须大于0',
          },
        ],
      },
      'test-trace',
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('金额');
  });

  it('should handle calculation rules', async () => {
    const formData = { quantity: 10, unitPrice: 100 };
    const result = await service.checkRules(
      {
        processCode: 'test',
        formData,
        rules: [
          {
            type: 'calculation',
            expression: 'totalAmount = quantity * unitPrice',
            errorLevel: 'error',
          },
        ],
      },
      'test-trace',
    );

    expect(result.valid).toBe(true);
    expect(formData).toHaveProperty('totalAmount');
  });

  it('should handle conditional rules', async () => {
    const result = await service.checkRules(
      {
        processCode: 'test',
        formData: { amount: 2000 },
        rules: [
          {
            type: 'conditional',
            expression: 'if amount > 1000 then approver required',
            errorLevel: 'error',
            errorMessage: '金额超过1000需要审批人',
          },
        ],
      },
      'test-trace',
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('审批人');
  });

  it('should allow warnings without failing validation', async () => {
    const result = await service.checkRules(
      {
        processCode: 'test',
        formData: { amount: 500 },
        rules: [
          {
            type: 'validation',
            expression: 'amount > 1000',
            errorLevel: 'warn',
            errorMessage: '建议金额大于1000',
          },
        ],
      },
      'test-trace',
    );

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].level).toBe('warn');
  });
});
