import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface PermissionCheckInput {
  tenantId: string;
  userId: string;
  processCode: string;
  action: 'view' | 'submit' | 'cancel' | 'urge' | 'delegate' | 'supplement';
  context?: Record<string, any>;
  traceId: string;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  platformCheck: { passed: boolean; reason: string };
  oaCheck: { passed: boolean; reason: string };
}

@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async check(input: PermissionCheckInput): Promise<PermissionCheckResult> {
    // Step 1: Platform permission check (RBAC + ABAC)
    const platformResult = await this.checkPlatformPermission(input);

    // Step 2: OA real-time permission check (if platform passes)
    let oaResult = { passed: true, reason: 'OA check skipped (platform denied)' };
    if (platformResult.passed) {
      oaResult = await this.checkOAPermission(input);
    }

    const allowed = platformResult.passed && oaResult.passed;
    const reason = !platformResult.passed
      ? platformResult.reason
      : !oaResult.passed
        ? oaResult.reason
        : '权限校验通过';

    // Log the decision
    await this.auditService.createLog({
      tenantId: input.tenantId,
      traceId: input.traceId,
      userId: input.userId,
      action: 'permission_check',
      resource: `${input.processCode}:${input.action}`,
      result: allowed ? 'success' : 'denied',
      details: {
        processCode: input.processCode,
        requestedAction: input.action,
        platformCheck: platformResult,
        oaCheck: oaResult,
      },
    });

    return {
      allowed,
      reason,
      platformCheck: platformResult,
      oaCheck: oaResult,
    };
  }

  private async checkPlatformPermission(
    input: PermissionCheckInput,
  ): Promise<{ passed: boolean; reason: string }> {
    // Get user
    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, tenantId: input.tenantId },
    });

    if (!user) {
      return { passed: false, reason: '用户不存在' };
    }

    if (user.status !== 'active') {
      return { passed: false, reason: '用户已被禁用' };
    }

    // Get permission policies for this process
    const policies = await this.prisma.permissionPolicy.findMany({
      where: {
        tenantId: input.tenantId,
        processCode: input.processCode,
        enabled: true,
      },
      orderBy: { priority: 'desc' },
    });

    // If no policies, allow by default for basic actions
    if (policies.length === 0) {
      if (input.action === 'view') {
        return { passed: true, reason: '无策略限制，默认允许查看' };
      }
      // For submit and other actions, check basic role
      const userRoles = Array.isArray(user.roles) ? user.roles : JSON.parse(user.roles as string);
      if (userRoles.includes('admin') || userRoles.includes('flow_manager')) {
        return { passed: true, reason: '管理员角色，默认允许' };
      }
      if (userRoles.includes('user') && ['submit', 'cancel'].includes(input.action)) {
        return { passed: true, reason: '普通用户，允许提交和撤回' };
      }
      return { passed: false, reason: '无匹配的权限策略' };
    }

    // Evaluate policies
    for (const policy of policies) {
      const result = this.evaluatePolicy(policy, user, input);
      if (result !== null) {
        return result;
      }
    }

    return { passed: false, reason: '所有策略评估后未匹配' };
  }

  private evaluatePolicy(
    policy: any,
    user: any,
    input: PermissionCheckInput,
  ): { passed: boolean; reason: string } | null {
    const rule = policy.policyRule as Record<string, any>;

    if (policy.policyType === 'rbac') {
      // Role-based check
      const allowedRoles = rule.roles as string[];
      const allowedActions = rule.actions as string[];

      if (allowedActions && !allowedActions.includes(input.action)) {
        return null; // This policy doesn't apply to this action
      }

      const userRoles = Array.isArray(user.roles) ? user.roles : JSON.parse(user.roles as string);
      if (allowedRoles && userRoles.some((r: string) => allowedRoles.includes(r))) {
        return { passed: true, reason: `角色 ${userRoles.join(',')} 匹配策略 ${policy.id}` };
      }

      return null;
    }

    if (policy.policyType === 'abac') {
      // Attribute-based check
      const conditions = rule.conditions as Array<{
        attribute: string;
        operator: string;
        value: any;
      }>;

      if (!conditions) return null;

      const allMatch = conditions.every(cond => {
        const attrValue = this.getAttributeValue(cond.attribute, user, input);
        return this.evaluateCondition(attrValue, cond.operator, cond.value);
      });

      if (allMatch) {
        return { passed: true, reason: `属性条件匹配策略 ${policy.id}` };
      }

      return null;
    }

    return null;
  }

  private getAttributeValue(attribute: string, user: any, input: PermissionCheckInput): any {
    if (attribute.startsWith('user.')) {
      const field = attribute.replace('user.', '');
      return user[field];
    }
    if (attribute.startsWith('context.')) {
      const field = attribute.replace('context.', '');
      return input.context?.[field];
    }
    return undefined;
  }

  private evaluateCondition(value: any, operator: string, expected: any): boolean {
    switch (operator) {
      case 'eq': return value === expected;
      case 'ne': return value !== expected;
      case 'in': return Array.isArray(expected) && expected.includes(value);
      case 'contains': return Array.isArray(value) && value.includes(expected);
      case 'gt': return value > expected;
      case 'gte': return value >= expected;
      case 'lt': return value < expected;
      case 'lte': return value <= expected;
      default: return false;
    }
  }

  private async checkOAPermission(
    input: PermissionCheckInput,
  ): Promise<{ passed: boolean; reason: string }> {
    // In production, this would call the OA system's permission API
    // For now, mock implementation that always passes
    return { passed: true, reason: 'OA实时权限校验通过（Mock）' };
  }
}
