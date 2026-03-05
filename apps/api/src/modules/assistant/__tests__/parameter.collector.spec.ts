/**
 * 助手模块单元测试示例
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ParameterCollector } from '../collectors/parameter.collector';
import { ParameterDefinition, ProcessContext, SharedContext, ProcessStatus } from '../types/context.types';

describe('ParameterCollector', () => {
  let collector: ParameterCollector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ParameterCollector],
    }).compile();

    collector = module.get<ParameterCollector>(ParameterCollector);
  });

  describe('collectParameters', () => {
    it('应该从用户输入中提取金额', async () => {
      const userInput = '我要报销1000元';
      const processContext: ProcessContext = {
        processId: 'test-process',
        processType: 'submission',
        processCode: 'reimbursement',
        status: ProcessStatus.PARAMETER_COLLECTION,
        parameters: {},
        collectedParams: new Set(),
        validationErrors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const parameterDefinitions: ParameterDefinition[] = [
        {
          name: 'amount',
          type: 'number',
          required: true,
          description: '报销金额',
        },
      ];

      const sharedContext: SharedContext = {
        userId: 'test-user',
        profile: {
          employeeId: 'emp-001',
          name: '测试用户',
        },
        preferences: {
          language: 'zh-CN',
        },
        history: {
          recentRequests: [],
          frequentTypes: [],
          totalSubmissions: 0,
        },
      };

      const result = await collector.collectParameters(
        userInput,
        processContext,
        parameterDefinitions,
        sharedContext,
      );

      expect(result.collectedParams.amount).toBe(1000);
      expect(result.isComplete).toBe(true);
      expect(result.progress).toBe(1);
    });

    it('应该从用户输入中提取日期', async () => {
      const userInput = '明天';
      const processContext: ProcessContext = {
        processId: 'test-process',
        processType: 'submission',
        processCode: 'leave',
        status: ProcessStatus.PARAMETER_COLLECTION,
        parameters: {},
        collectedParams: new Set(),
        validationErrors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const parameterDefinitions: ParameterDefinition[] = [
        {
          name: 'date',
          type: 'date',
          required: true,
          description: '日期',
        },
      ];

      const sharedContext: SharedContext = {
        userId: 'test-user',
        profile: {
          employeeId: 'emp-001',
          name: '测试用户',
        },
        preferences: {
          language: 'zh-CN',
        },
        history: {
          recentRequests: [],
          frequentTypes: [],
          totalSubmissions: 0,
        },
      };

      const result = await collector.collectParameters(
        userInput,
        processContext,
        parameterDefinitions,
        sharedContext,
      );

      expect(result.collectedParams.date).toBeDefined();
      expect(result.isComplete).toBe(true);
    });

    it('应该从共享上下文预填充employeeId', async () => {
      const userInput = '我要请假';
      const processContext: ProcessContext = {
        processId: 'test-process',
        processType: 'submission',
        processCode: 'leave',
        status: ProcessStatus.PARAMETER_COLLECTION,
        parameters: {},
        collectedParams: new Set(),
        validationErrors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const parameterDefinitions: ParameterDefinition[] = [
        {
          name: 'employeeId',
          type: 'text',
          required: true,
          description: '员工ID',
        },
      ];

      const sharedContext: SharedContext = {
        userId: 'test-user',
        profile: {
          employeeId: 'emp-001',
          name: '测试用户',
        },
        preferences: {
          language: 'zh-CN',
        },
        history: {
          recentRequests: [],
          frequentTypes: [],
          totalSubmissions: 0,
        },
      };

      const result = await collector.collectParameters(
        userInput,
        processContext,
        parameterDefinitions,
        sharedContext,
      );

      expect(result.collectedParams.employeeId).toBe('emp-001');
      expect(result.isComplete).toBe(true);
    });

    it('应该识别缺失的必填参数', async () => {
      const userInput = '我要报销';
      const processContext: ProcessContext = {
        processId: 'test-process',
        processType: 'submission',
        processCode: 'reimbursement',
        status: ProcessStatus.PARAMETER_COLLECTION,
        parameters: {},
        collectedParams: new Set(),
        validationErrors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const parameterDefinitions: ParameterDefinition[] = [
        {
          name: 'amount',
          type: 'number',
          required: true,
          description: '报销金额',
        },
        {
          name: 'date',
          type: 'date',
          required: true,
          description: '报销日期',
        },
      ];

      const sharedContext: SharedContext = {
        userId: 'test-user',
        profile: {
          employeeId: 'emp-001',
          name: '测试用户',
        },
        preferences: {
          language: 'zh-CN',
        },
        history: {
          recentRequests: [],
          frequentTypes: [],
          totalSubmissions: 0,
        },
      };

      const result = await collector.collectParameters(
        userInput,
        processContext,
        parameterDefinitions,
        sharedContext,
      );

      expect(result.isComplete).toBe(false);
      expect(result.missingParams.length).toBe(2);
      expect(result.nextQuestion).toBeDefined();
      expect(result.progress).toBe(0);
    });

    it('应该验证参数并返回错误', async () => {
      const userInput = '报销-100元';
      const processContext: ProcessContext = {
        processId: 'test-process',
        processType: 'submission',
        processCode: 'reimbursement',
        status: ProcessStatus.PARAMETER_COLLECTION,
        parameters: {},
        collectedParams: new Set(),
        validationErrors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const parameterDefinitions: ParameterDefinition[] = [
        {
          name: 'amount',
          type: 'number',
          required: true,
          description: '报销金额',
          validation: [
            {
              type: 'min_value',
              params: { min: 0 },
              message: '金额必须大于0',
            },
          ],
        },
      ];

      const sharedContext: SharedContext = {
        userId: 'test-user',
        profile: {
          employeeId: 'emp-001',
          name: '测试用户',
        },
        preferences: {
          language: 'zh-CN',
        },
        history: {
          recentRequests: [],
          frequentTypes: [],
          totalSubmissions: 0,
        },
      };

      const result = await collector.collectParameters(
        userInput,
        processContext,
        parameterDefinitions,
        sharedContext,
      );

      expect(result.validationErrors.length).toBeGreaterThan(0);
      expect(result.isComplete).toBe(false);
    });

    it('应该计算正确的收集进度', async () => {
      const userInput = '报销1000元';
      const processContext: ProcessContext = {
        processId: 'test-process',
        processType: 'submission',
        processCode: 'reimbursement',
        status: ProcessStatus.PARAMETER_COLLECTION,
        parameters: {},
        collectedParams: new Set(),
        validationErrors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const parameterDefinitions: ParameterDefinition[] = [
        {
          name: 'amount',
          type: 'number',
          required: true,
          description: '报销金额',
        },
        {
          name: 'date',
          type: 'date',
          required: true,
          description: '报销日期',
        },
        {
          name: 'reason',
          type: 'text',
          required: true,
          description: '报销事由',
        },
      ];

      const sharedContext: SharedContext = {
        userId: 'test-user',
        profile: {
          employeeId: 'emp-001',
          name: '测试用户',
        },
        preferences: {
          language: 'zh-CN',
        },
        history: {
          recentRequests: [],
          frequentTypes: [],
          totalSubmissions: 0,
        },
      };

      const result = await collector.collectParameters(
        userInput,
        processContext,
        parameterDefinitions,
        sharedContext,
      );

      // 3个必填参数，收集了1个，进度应该是1/3
      expect(result.progress).toBeCloseTo(1 / 3, 2);
      expect(result.isComplete).toBe(false);
      expect(result.missingParams.length).toBe(2);
    });
  });
});
