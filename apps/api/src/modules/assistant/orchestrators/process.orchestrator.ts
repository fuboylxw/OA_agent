/**
 * 流程编排器
 * 实现流程定义和执行步骤管理
 */

import { Injectable } from '@nestjs/common';
import {
  ProcessDefinition,
  ProcessStep,
  StepAction,
  ProcessContext,
  ProcessStatus,
  Condition,
  Action,
} from '../types/context.types';
import { MCPExecutorService } from '../../mcp/mcp-executor.service';
import { PrismaService } from '../../common/prisma.service';

export interface ExecutionResult {
  success: boolean;
  status: ProcessStatus;
  result?: any;
  error?: string;
  nextStep?: string;
}

@Injectable()
export class ProcessOrchestrator {
  constructor(
    private readonly mcpExecutor: MCPExecutorService,
    private readonly prisma: PrismaService,
  )

  /**
   * 执行流程
   */
  async executeProcess(
    processDefinition: ProcessDefinition,
    processContext: ProcessContext,
    connectorId: string,
  ): Promise<ExecutionResult> {
    try {
      // 1. 检查前置条件
      const preConditionResult = await this.checkPreConditions(
        processDefinition.preConditions || [],
        processContext,
      );

      if (!preConditionResult.passed) {
        return {
          success: false,
          status: ProcessStatus.FAILED,
          error: preConditionResult.error,
        };
      }

      // 2. 执行步骤
      let currentStep = processDefinition.steps[0];
      let stepIndex = 0;

      while (currentStep && stepIndex < 100) { // 防止无限循环
        console.log(`[ProcessOrchestrator] Executing step: ${currentStep.stepId}`);

        const stepResult = await this.executeStep(
          currentStep,
          processContext,
          connectorId,
        );

        if (!stepResult.success) {
          // 步骤失败，检查是否有失败处理
          if (currentStep.onFailure) {
            currentStep = processDefinition.steps.find(s => s.stepId === currentStep.onFailure);
            stepIndex++;
            continue;
          }

          // 没有失败处理，执行回滚
          if (processDefinition.rollbackStrategy?.enabled) {
            await this.executeRollback(processDefinition, processContext);
          }

          return {
            success: false,
            status: ProcessStatus.FAILED,
            error: stepResult.error,
          };
        }

        // 步骤成功，检查下一步
        if (currentStep.onSuccess) {
          currentStep = processDefinition.steps.find(s => s.stepId === currentStep.onSuccess);
        } else {
          // 没有指定下一步，流程结束
          break;
        }

        stepIndex++;
      }

      // 3. 执行后置动作
      if (processDefinition.postActions) {
        await this.executePostActions(
          processDefinition.postActions,
          processContext,
        );
      }

      return {
        success: true,
        status: ProcessStatus.COMPLETED,
        result: processContext.parameters,
      };
    } catch (error: any) {
      console.error('[ProcessOrchestrator] Process execution error:', error.message);

      // 执行回滚
      if (processDefinition.rollbackStrategy?.enabled) {
        await this.executeRollback(processDefinition, processContext);
      }

      return {
        success: false,
        status: ProcessStatus.FAILED,
        error: error.message,
      };
    }
  }

  /**
   * 检查前置条件
   */
  private async checkPreConditions(
    conditions: Condition[],
    processContext: ProcessContext,
  ): Promise<{ passed: boolean; error?: string }> {
    for (const condition of conditions) {
      const result = await this.evaluateCondition(condition, processContext);
      if (!result) {
        return {
          passed: false,
          error: condition.errorMessage || `前置条件检查失败: ${condition.type}`,
        };
      }
    }

    return { passed: true };
  }

  /**
   * 评估条件
   */
  private async evaluateCondition(
    condition: Condition,
    processContext: ProcessContext,
  ): Promise<boolean> {
    try {
      // 简单的表达式评估
      // 实际项目中应该使用更安全的表达式引擎
      const params = processContext.parameters;

      // 支持简单的比较表达式
      // 例如: "amount > 0", "status === 'active'"
      const expression = condition.expression.replace(/\{(\w+)\}/g, (match, key) => {
        const value = params[key];
        return typeof value === 'string' ? `"${value}"` : String(value);
      });

      // 使用 Function 构造器评估表达式（注意：生产环境应使用更安全的方式）
      const result = new Function('params', `return ${expression}`)(params);
      return Boolean(result);
    } catch (error: any) {
      console.error('[ProcessOrchestrator] Condition evaluation error:', error.message);
      return false;
    }
  }

  /**
   * 执行步骤
   */
  private async executeStep(
    step: ProcessStep,
    processContext: ProcessContext,
    connectorId: string,
  ): Promise<{ success: boolean; error?: string; result?: any }> {
    const maxAttempts = step.retryPolicy?.maxAttempts || 1;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[ProcessOrchestrator] Step ${step.stepId} attempt ${attempt}/${maxAttempts}`);

        let result: any;

        switch (step.action) {
          case StepAction.VALIDATE:
            result = await this.executeValidateStep(step, processContext);
            break;

          case StepAction.TRANSFORM:
            result = await this.executeTransformStep(step, processContext);
            break;

          case StepAction.CALL_MCP:
            result = await this.executeCallMCPStep(step, processContext, connectorId);
            break;

          case StepAction.NOTIFY:
            result = await this.executeNotifyStep(step, processContext);
            break;

          case StepAction.WAIT:
            result = await this.executeWaitStep(step);
            break;

          case StepAction.BRANCH:
            result = await this.executeBranchStep(step, processContext);
            break;

          default:
            throw new Error(`Unknown step action: ${step.action}`);
        }

        return { success: true, result };
      } catch (error: any) {
        lastError = error.message;
        console.error(`[ProcessOrchestrator] Step ${step.stepId} attempt ${attempt} failed:`, lastError);

        // 如果还有重试机会，等待后重试
        if (attempt < maxAttempts && step.retryPolicy) {
          const backoffMs = step.retryPolicy.backoffMs * Math.pow(
            step.retryPolicy.backoffMultiplier || 1,
            attempt - 1,
          );
          await this.sleep(backoffMs);
        }
      }
    }

    return { success: false, error: lastError };
  }

  /**
   * 执行验证步骤
   */
  private async executeValidateStep(
    step: ProcessStep,
    processContext: ProcessContext,
  ): Promise<any> {
    const { rules } = step.config;
    const params = processContext.parameters;

    for (const rule of rules || []) {
      const result = await this.evaluateCondition(
        { type: rule.type, expression: rule.expression, errorMessage: rule.message },
        processContext,
      );

      if (!result) {
        throw new Error(rule.message || '验证失败');
      }
    }

    return { validated: true };
  }

  /**
   * 执行转换步骤
   */
  private async executeTransformStep(
    step: ProcessStep,
    processContext: ProcessContext,
  ): Promise<any> {
    const { transformations } = step.config;
    const params = processContext.parameters;

    for (const transform of transformations || []) {
      const { source, target, operation } = transform;

      switch (operation) {
        case 'copy':
          params[target] = params[source];
          break;

        case 'format':
          params[target] = this.formatValue(params[source], transform.format);
          break;

        case 'calculate':
          params[target] = this.calculateValue(params, transform.expression);
          break;

        default:
          console.warn(`Unknown transformation operation: ${operation}`);
      }
    }

    return { transformed: true };
  }

  /**
   * 执行MCP调用步骤
   */
  private async executeCallMCPStep(
    step: ProcessStep,
    processContext: ProcessContext,
    connectorId: string,
  ): Promise<any> {
    const { toolName, inputMapping } = step.config;

    // 映射输入参数
    const input = this.mapParameters(processContext.parameters, inputMapping);

    // 调用MCP工具
    const result = await this.mcpExecutor.executeTool(toolName, input, connectorId);

    // 保存结果到上下文
    if (step.config.outputMapping) {
      for (const [resultKey, contextKey] of Object.entries(step.config.outputMapping)) {
        processContext.parameters[contextKey as string] = result[resultKey];
      }
    }

    return result;
  }

  /**
   * 执行通知步骤
   */
  private async executeNotifyStep(
    step: ProcessStep,
    processContext: ProcessContext,
  ): Promise<any> {
    const { notificationType, recipients, template } = step.config;

    console.log(`[ProcessOrchestrator] Sending notification: ${notificationType}`);
    console.log(`Recipients:`, recipients);
    console.log(`Template:`, template);

    // 实际项目中应该调用通知服务
    // await this.notificationService.send(...)

    return { notified: true };
  }

  /**
   * 执行等待步骤
   */
  private async executeWaitStep(step: ProcessStep): Promise<any> {
    const { durationMs } = step.config;
    await this.sleep(durationMs);
    return { waited: true };
  }

  /**
   * 执行分支步骤
   */
  private async executeBranchStep(
    step: ProcessStep,
    processContext: ProcessContext,
  ): Promise<any> {
    const { conditions } = step.config;

    for (const condition of conditions || []) {
      const result = await this.evaluateCondition(condition, processContext);
      if (result) {
        return { branch: condition.target };
      }
    }

    return { branch: step.config.defaultBranch };
  }

  /**
   * 执行后置动作
   */
  private async executePostActions(
    actions: Action[],
    processContext: ProcessContext,
  ): Promise<void> {
    for (const action of actions) {
      try {
        console.log(`[ProcessOrchestrator] Executing post action: ${action.type}`);

        switch (action.type) {
          case 'log':
            console.log('[PostAction] Log:', action.config);
            break;

          case 'update_context':
            Object.assign(processContext.parameters, action.config.updates);
            break;

          case 'notify':
            // 发送通知
            break;

          default:
            console.warn(`Unknown post action type: ${action.type}`);
        }
      } catch (error: any) {
        console.error(`[ProcessOrchestrator] Post action error:`, error.message);
        // 后置动作失败不影响主流程
      }
    }
  }

  /**
   * 执行回滚
   */
  private async executeRollback(
    processDefinition: ProcessDefinition,
    processContext: ProcessContext,
  ): Promise<void> {
    if (!processDefinition.rollbackStrategy?.enabled) {
      return;
    }

    console.log('[ProcessOrchestrator] Executing rollback...');

    const rollbackSteps = processDefinition.rollbackStrategy.steps || [];

    for (const step of rollbackSteps) {
      try {
        console.log(`[ProcessOrchestrator] Rollback step: ${step.stepId}`);

        switch (step.action) {
          case 'delete_draft':
            // 删除草稿
            if (processContext.parameters.draftId) {
              await this.prisma.processDraft.delete({
                where: { id: processContext.parameters.draftId },
              });
            }
            break;

          case 'clear_context':
            // 清理上下文
            processContext.parameters = {};
            break;

          case 'notify_failure':
            // 通知失败
            console.log('[Rollback] Notifying failure...');
            break;

          default:
            console.warn(`Unknown rollback action: ${step.action}`);
        }
      } catch (error: any) {
        console.error(`[ProcessOrchestrator] Rollback step error:`, error.message);
        // 回滚失败不抛出异常
      }
    }

    console.log('[ProcessOrchestrator] Rollback completed');
  }

  /**
   * 映射参数
   */
  private mapParameters(
    params: Record<string, any>,
    mapping?: Record<string, string>,
  ): Record<string, any> {
    if (!mapping) {
      return params;
    }

    const mapped: Record<string, any> = {};

    for (const [targetKey, sourceKey] of Object.entries(mapping)) {
      mapped[targetKey] = params[sourceKey];
    }

    return mapped;
  }

  /**
   * 格式化值
   */
  private formatValue(value: any, format: string): any {
    switch (format) {
      case 'uppercase':
        return String(value).toUpperCase();

      case 'lowercase':
        return String(value).toLowerCase();

      case 'date':
        return new Date(value).toISOString().split('T')[0];

      case 'datetime':
        return new Date(value).toISOString();

      case 'currency':
        return Number(value).toFixed(2);

      default:
        return value;
    }
  }

  /**
   * 计算值
   */
  private calculateValue(params: Record<string, any>, expression: string): any {
    try {
      // 替换表达式中的变量
      const evaluableExpression = expression.replace(/\{(\w+)\}/g, (match, key) => {
        return String(params[key] || 0);
      });

      // 评估表达式
      return new Function('params', `return ${evaluableExpression}`)(params);
    } catch (error: any) {
      console.error('[ProcessOrchestrator] Calculate error:', error.message);
      return null;
    }
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
