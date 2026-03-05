import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import axios, { AxiosRequestConfig } from 'axios';

@Injectable()
export class MCPExecutorService {
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

    console.log(`[MCP Executor] Executing tool: ${toolName}`);
    console.log(`[MCP Executor] Input params:`, params);

    // 2. Apply parameter mapping
    const mappedParams = this.applyParamMapping(
      params,
      tool.paramMapping as any,
    );

    console.log(`[MCP Executor] Mapped params:`, mappedParams);

    // 3. Build HTTP request
    const request = this.buildRequest(tool, mappedParams);

    console.log(`[MCP Executor] HTTP request:`, {
      method: request.method,
      url: request.url,
      headers: request.headers,
    });

    // 4. Execute HTTP request
    try {
      const response = await axios(request);

      console.log(`[MCP Executor] Response status:`, response.status);
      console.log(`[MCP Executor] Response data:`, response.data);

      // 5. Apply response mapping
      const mappedResponse = this.applyResponseMapping(
        response.data,
        tool.responseMapping as any,
      );

      console.log(`[MCP Executor] Mapped response:`, mappedResponse);

      return mappedResponse;
    } catch (error: any) {
      console.error(`[MCP Executor] Request failed:`, error.message);
      if (error.response) {
        console.error(`[MCP Executor] Error response:`, error.response.data);
      }
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
        // Custom transform function (eval - use with caution)
        if (transform.startsWith('function:')) {
          const funcBody = transform.replace('function:', '');
          try {
            const func = new Function('value', `return ${funcBody}`);
            return func(value);
          } catch (error) {
            console.error(`Transform function error:`, error);
            return value;
          }
        }
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
}
