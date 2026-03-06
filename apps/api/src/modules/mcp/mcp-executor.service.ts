import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import axios, { AxiosRequestConfig } from 'axios';

const ALLOWED_TRANSFORMS = new Set([
  'toString', 'toNumber', 'toBoolean',
  'toUpperCase', 'toLowerCase', 'toDate', 'toArray',
]);

@Injectable()
export class MCPExecutorService {
  private readonly logger = new Logger(MCPExecutorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Execute an MCP tool
   */
  async executeTool(
    toolName: string,
    params: Record<string, any>,
    connectorId: string,
  ): Promise<any> {
    // 1. Query MCP tool definition
    const tool = await this.prisma.mCPTool.findFirst({
      where: { toolName, connectorId },
      include: { connector: true },
    });

    if (!tool) {
      throw new Error(`MCP tool ${toolName} not found`);
    }

    if (!tool.enabled) {
      throw new Error(`MCP tool ${toolName} is disabled`);
    }

    this.logger.log(`Executing tool: ${toolName}`);

    // Check if Mock mode is enabled
    if (process.env.MOCK_MCP === 'true') {
      this.logger.log(`Mock mode enabled for tool: ${toolName}`);
      return this.getMockResponse(toolName, params, tool);
    }

    // 2. Apply parameter mapping
    const mappedParams = this.applyParamMapping(
      params,
      tool.paramMapping as any,
    );

    // 3. Build HTTP request
    const request = this.buildRequest(tool, mappedParams);

    this.logger.debug(`HTTP ${request.method} ${request.url}`);

    // 4. Execute HTTP request
    try {
      const response = await axios(request);

      this.logger.debug(`Response status: ${response.status}`);

      // 5. Apply response mapping
      const mappedResponse = this.applyResponseMapping(
        response.data,
        tool.responseMapping as any,
      );

      return mappedResponse;
    } catch (error: any) {
      this.logger.error(`Tool ${toolName} execution failed: ${error.message}`);
      throw new Error(`MCP tool execution failed: ${error.message}`);
    }
  }

  /**
   * Apply parameter mapping
   */
  private applyParamMapping(
    params: Record<string, any>,
    mapping: Record<string, any>,
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [targetKey, rule] of Object.entries(mapping)) {
      if (typeof rule === 'string') {
        // Simple mapping: target = source
        result[targetKey] = this.getNestedValue(params, rule);
      } else if (typeof rule === 'object' && rule !== null) {
        // Complex mapping with transformation
        const { source, transform, default: defaultValue } = rule as any;

        let value = source ? this.getNestedValue(params, source) : undefined;

        // Apply default if value is undefined
        if (value === undefined && defaultValue !== undefined) {
          value = defaultValue;
        }

        // Apply transformation
        if (transform && value !== undefined) {
          value = this.applyTransform(value, transform);
        }

        result[targetKey] = value;
      }
    }

    return result;
  }

  /**
   * Apply response mapping
   */
  private applyResponseMapping(
    response: any,
    mapping: Record<string, any>,
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [targetKey, sourcePath] of Object.entries(mapping)) {
      if (typeof sourcePath === 'string') {
        result[targetKey] = this.getNestedValue(response, sourcePath);
      }
    }

    return result;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Apply transformation to value
   */
  private applyTransform(value: any, transform: string): any {
    if (!ALLOWED_TRANSFORMS.has(transform)) {
      this.logger.warn(`Unknown transform "${transform}" ignored`);
      return value;
    }

    switch (transform) {
      case 'toString':
        return String(value);
      case 'toNumber':
        return Number(value);
      case 'toBoolean':
        return Boolean(value);
      case 'toUpperCase':
        return String(value).toUpperCase();
      case 'toLowerCase':
        return String(value).toLowerCase();
      case 'toDate':
        return new Date(value).toISOString();
      case 'toArray':
        return Array.isArray(value) ? value : [value];
      default:
        return value;
    }
  }

  /**
   * Build HTTP request configuration
   */
  private buildRequest(tool: any, mappedParams: Record<string, any>): AxiosRequestConfig {
    const { connector, apiEndpoint, httpMethod, headers, bodyTemplate } = tool;

    const config: AxiosRequestConfig = {
      method: httpMethod.toLowerCase(),
      url: `${connector.baseUrl}${apiEndpoint}`,
      headers: this.buildHeaders(headers, connector),
      timeout: 30000,
    };

    // Build request body
    if (['post', 'put', 'patch'].includes(config.method!)) {
      config.data = this.buildRequestBody(mappedParams, bodyTemplate);
    } else if (config.method === 'get') {
      config.params = mappedParams;
    }

    return config;
  }

  /**
   * Build request headers
   */
  private buildHeaders(
    headerTemplate: any,
    connector: any,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add template headers
    if (headerTemplate) {
      Object.assign(headers, headerTemplate);
    }

    // Add authentication header
    const authConfig = connector.authConfig as any;
    if (connector.authType === 'apikey') {
      if (authConfig.headerName && authConfig.token) {
        headers[authConfig.headerName] = authConfig.token;
      } else if (authConfig.token) {
        headers['x-token'] = authConfig.token;
      }
    } else if (connector.authType === 'basic') {
      const credentials = Buffer.from(
        `${authConfig.username}:${authConfig.password}`,
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    } else if (connector.authType === 'oauth2') {
      if (authConfig.accessToken) {
        headers['Authorization'] = `Bearer ${authConfig.accessToken}`;
      }
    }

    return headers;
  }

  /**
   * Build request body from template
   */
  private buildRequestBody(
    params: Record<string, any>,
    template: any,
  ): any {
    if (!template) {
      return params;
    }

    // If template is a string, replace placeholders
    if (typeof template === 'string') {
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] || '');
    }

    // If template is an object, recursively replace values
    if (typeof template === 'object' && template !== null) {
      const result: any = Array.isArray(template) ? [] : {};

      for (const [key, value] of Object.entries(template)) {
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          const paramKey = value.slice(2, -2);
          result[key] = params[paramKey];
        } else if (typeof value === 'object' && value !== null) {
          result[key] = this.buildRequestBody(params, value);
        } else {
          result[key] = value;
        }
      }

      return result;
    }

    return template;
  }

  /**
   * Get mock response for testing
   */
  private getMockResponse(toolName: string, params: Record<string, any>, tool: any): any {

    const category = tool.category;
    const timestamp = Date.now();

    // Generate mock response based on tool category
    switch (category) {
      case 'submit':
        return {
          success: true,
          submissionId: `MOCK-${timestamp}`,
          status: 'submitted',
          message: '申请已提交成功（模拟）',
          data: {
            id: `MOCK-${timestamp}`,
            status: 'pending_approval',
            createdAt: new Date().toISOString(),
            ...params
          }
        };

      case 'query':
        return {
          success: true,
          data: {
            id: params.submissionId || `MOCK-${timestamp}`,
            status: 'pending_approval',
            currentApprover: '张经理',
            submitTime: new Date().toISOString(),
            ...params
          }
        };

      case 'cancel':
        return {
          success: true,
          message: '申请已撤回（模拟）',
          data: {
            id: params.submissionId,
            status: 'cancelled',
            cancelledAt: new Date().toISOString()
          }
        };

      case 'urge':
        return {
          success: true,
          message: '催办成功（模拟）',
          data: {
            id: params.submissionId,
            urgedAt: new Date().toISOString()
          }
        };

      default:
        return {
          success: true,
          message: '操作成功（模拟）',
          data: params
        };
    }
  }
}
