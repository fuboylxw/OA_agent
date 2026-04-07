import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';

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
    private readonly adapterRuntimeService: AdapterRuntimeService,
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

    // If no policies defined, allow by default (permissions are opt-in)
    if (policies.length === 0) {
      return { passed: true, reason: '未配置权限策略，默认允许' };
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

      const userRoles = Array.isArray(user.roles) ? user.roles : (() => { try { return JSON.parse(user.roles as string); } catch { return []; } })();
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
    const template = await this.prisma.processTemplate.findFirst({
      where: {
        tenantId: input.tenantId,
        processCode: input.processCode,
        status: 'published',
      },
      orderBy: { version: 'desc' },
      include: {
        connector: {
          include: {
            capability: true,
            secretRef: true,
          },
        },
      },
    });

    if (!template?.connector) {
      return { passed: true, reason: 'OA实时权限校验已跳过：未找到流程连接器' };
    }

    const connector = template.connector;
    const capability = connector.capability;
    const authConfig = ((connector.authConfig as Record<string, any> | null) || {});
    const permissionCheck = (authConfig.oaPermissionCheck as Record<string, any> | undefined) || {};
    const requireRealtimePermission = process.env.REQUIRE_OA_PERMISSION_CHECK === 'true';
    const connectorClaimsRealtimePerm = Boolean(capability?.supportsRealtimePerm);

    if (!permissionCheck.enabled) {
      if (requireRealtimePermission && connectorClaimsRealtimePerm) {
        return { passed: false, reason: '连接器已声明支持 OA 实时权限，但未配置权限校验接口' };
      }

      return {
        passed: true,
        reason: connectorClaimsRealtimePerm
          ? 'OA实时权限校验未配置，已跳过'
          : '连接器未启用 OA 实时权限校验',
      };
    }

    if (!permissionCheck.endpoint) {
      return { passed: false, reason: 'OA实时权限校验已启用，但未配置 endpoint' };
    }

    const onError = permissionCheck.onError === 'allow' ? 'allow' : 'deny';
    try {
      const resolvedAuthConfig = await this.adapterRuntimeService.resolveAuthConfig(connector);
      const requestPayload = this.renderTemplate(
        permissionCheck.requestTemplate || {
          userId: '{{userId}}',
          processCode: '{{processCode}}',
          action: '{{action}}',
          tenantId: '{{tenantId}}',
          context: '{{context}}',
        },
        input,
      );
      const url = this.resolveUrl(connector.baseUrl, String(permissionCheck.endpoint));
      const method = String(permissionCheck.method || 'POST').toUpperCase();
      const headers = {
        ...this.buildAuthHeaders(connector.authType, resolvedAuthConfig),
        ...this.renderTemplate((permissionCheck.headers as Record<string, any> | undefined) || {}, input),
      } as Record<string, string>;

      const response = await axios({
        method,
        url,
        headers,
        params: method === 'GET' ? requestPayload : undefined,
        data: method === 'GET' ? undefined : requestPayload,
        timeout: Number(permissionCheck.timeoutMs || 10000),
      });

      const allowedPath = String(permissionCheck.allowedPath || 'allowed');
      const reasonPath = permissionCheck.reasonPath ? String(permissionCheck.reasonPath) : 'reason';
      const allowedValue = permissionCheck.allowedValue !== undefined ? permissionCheck.allowedValue : true;

      const allowed = this.getNestedValue(response.data, allowedPath);
      const reason = this.getNestedValue(response.data, reasonPath);
      if (allowed === allowedValue) {
        return { passed: true, reason: typeof reason === 'string' ? reason : 'OA实时权限校验通过' };
      }

      if (allowed === undefined) {
        return {
          passed: onError === 'allow',
          reason: onError === 'allow'
            ? 'OA权限接口未返回明确允许结果，按配置放行'
            : 'OA权限接口未返回明确允许结果',
        };
      }

      return {
        passed: false,
        reason: typeof reason === 'string' ? reason : 'OA实时权限校验拒绝',
      };
    } catch (error: any) {
      if (onError === 'allow') {
        return { passed: true, reason: `OA权限校验失败，按配置放行: ${error.message}` };
      }
      return { passed: false, reason: `OA权限校验失败: ${error.message}` };
    }
  }

  private buildAuthHeaders(authType: string, authConfig: Record<string, any>): Record<string, string> {
    const headers: Record<string, string> = {};

    if (authType === 'apikey') {
      const headerName = authConfig.headerName || 'x-token';
      const token = authConfig.token || authConfig.apiKey;
      if (token) {
        headers[headerName] = String(token);
      }
    } else if (authType === 'basic') {
      if (authConfig.username && authConfig.password) {
        headers.Authorization = `Basic ${Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')}`;
      }
    } else if (authType === 'oauth2' || authType === 'bearer') {
      const accessToken = authConfig.accessToken || authConfig.token;
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
    } else if (authType === 'cookie') {
      const cookie = authConfig.cookie || authConfig.sessionCookie;
      if (cookie) {
        headers.Cookie = String(cookie);
      }
    }

    return headers;
  }

  private renderTemplate(value: any, input: PermissionCheckInput): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.renderTemplate(item, input));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, this.renderTemplate(nested, input)]),
      );
    }

    if (typeof value !== 'string') {
      return value;
    }

    const exactMatch = value.match(/^\{\{([^}]+)\}\}$/);
    if (exactMatch) {
      return this.resolveTemplateValue(exactMatch[1], input);
    }

    return value.replace(/\{\{([^}]+)\}\}/g, (_, expression) => {
      const resolved = this.resolveTemplateValue(expression, input);
      return resolved === undefined || resolved === null ? '' : String(resolved);
    });
  }

  private resolveTemplateValue(expression: string, input: PermissionCheckInput): any {
    const normalized = expression.trim();
    if (normalized === 'userId') return input.userId;
    if (normalized === 'tenantId') return input.tenantId;
    if (normalized === 'processCode') return input.processCode;
    if (normalized === 'action') return input.action;
    if (normalized === 'traceId') return input.traceId;
    if (normalized === 'context') return input.context || {};
    if (normalized.startsWith('context.')) {
      return this.getNestedValue(input.context || {}, normalized.replace('context.', ''));
    }
    return undefined;
  }

  private resolveUrl(baseUrl: string, endpoint: string): string {
    if (/^https?:\/\//i.test(endpoint)) {
      return endpoint;
    }
    return new URL(endpoint, `${baseUrl.replace(/\/+$/, '')}/`).toString();
  }

  private getNestedValue(value: any, path: string): any {
    return String(path)
      .split('.')
      .filter(Boolean)
      .reduce((current, segment) => current?.[segment], value);
  }
}
