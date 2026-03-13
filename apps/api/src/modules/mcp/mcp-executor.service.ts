import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import axios, { AxiosRequestConfig } from 'axios';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';

const ALLOWED_TRANSFORMS = new Set([
  'toString', 'toNumber', 'toBoolean',
  'toUpperCase', 'toLowerCase', 'toDate', 'toArray',
]);

@Injectable()
export class MCPExecutorService {
  private readonly logger = new Logger(MCPExecutorService.name);

  // Cookie cache: connectorId -> { cookie, expiresAt }
  private cookieCache = new Map<string, { cookie: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRuntimeService: AdapterRuntimeService,
  ) {}

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
      include: {
        connector: {
          include: {
            secretRef: true,
          },
        },
      },
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
    const resolvedAuthConfig = await this.adapterRuntimeService.resolveAuthConfig(tool.connector);
    const request = this.buildRequest(tool, mappedParams, resolvedAuthConfig);

    // 3.5 If cookie auth, get session cookie and attach
    if (tool.connector.authType === 'cookie') {
      const cookie = await this.getCookieForConnector(tool.connector, resolvedAuthConfig);
      request.headers = { ...request.headers, Cookie: cookie };
    }

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
      // If 401, clear cookie cache and retry once
      if (error.response?.status === 401 && tool.connector.authType === 'cookie') {
        this.logger.warn(`Got 401, clearing cookie cache and retrying...`);
        this.cookieCache.delete(tool.connector.id);
        const cookie = await this.getCookieForConnector(tool.connector, resolvedAuthConfig);
        request.headers = { ...request.headers, Cookie: cookie };
        const retryResp = await axios(request);
        return this.applyResponseMapping(retryResp.data, tool.responseMapping as any);
      }
      this.logger.error(`Tool ${toolName} execution failed: ${error.message}`);
      throw new Error(`MCP tool execution failed: ${error.response?.data?.message || error.message}`);
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
  private buildRequest(
    tool: any,
    mappedParams: Record<string, any>,
    resolvedAuthConfig: Record<string, any>,
  ): AxiosRequestConfig {
    const { connector, apiEndpoint, httpMethod, headers, bodyTemplate } = tool;
    const resolvedUrl = this.resolveEndpointUrl(connector.baseUrl, apiEndpoint);
    const pathParamKeys = this.extractPathParamKeys(resolvedUrl);

    const config: AxiosRequestConfig = {
      method: httpMethod.toLowerCase(),
      url: this.applyPathParams(resolvedUrl, mappedParams),
      headers: this.buildHeaders(headers, connector, resolvedAuthConfig),
      timeout: 30000,
    };

    // Build request body
    if (['post', 'put', 'patch'].includes(config.method!)) {
      config.data = this.buildRequestBody(mappedParams, bodyTemplate);
    } else if (config.method === 'get') {
      config.params = this.omitPathParams(mappedParams, pathParamKeys);
    }

    return config;
  }

  /**
   * Build request headers
   */
  private buildHeaders(
    headerTemplate: any,
    connector: any,
    resolvedAuthConfig: Record<string, any>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add template headers
    if (headerTemplate) {
      Object.assign(headers, headerTemplate);
    }

    // Add authentication header
    const authConfig = resolvedAuthConfig as any;
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
    // cookie session auth is handled in executeTool, not here

    return headers;
  }

  /**
   * Login to get session cookie for cookie-based auth
   */
  private async getCookieForConnector(
    connector: any,
    resolvedAuthConfig: Record<string, any>,
  ): Promise<string> {
    const cached = this.cookieCache.get(connector.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.cookie;
    }

    const authConfig = resolvedAuthConfig as any;
    const loginUrl = this.resolveEndpointUrl(connector.baseUrl, authConfig.loginPath || '/api/auth/login');

    this.logger.log(`Cookie auth: logging in to ${loginUrl}`);

    const resp = await axios.post(
      loginUrl,
      { username: authConfig.username, password: authConfig.password },
      { headers: { 'Content-Type': 'application/json' }, maxRedirects: 0 },
    );

    // Extract Set-Cookie header
    const setCookies = resp.headers['set-cookie'];
    if (!setCookies || setCookies.length === 0) {
      throw new Error('Cookie auth login succeeded but no Set-Cookie header returned');
    }

    // Combine all cookies
    const cookie = setCookies.map((c: string) => c.split(';')[0]).join('; ');

    // Cache for 1 hour (conservative, oa_system uses 8h)
    this.cookieCache.set(connector.id, {
      cookie,
      expiresAt: Date.now() + 3600_000,
    });

    this.logger.log(`Cookie auth: login successful, cookie cached`);
    return cookie;
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
   * 解析端点 URL：完整 URL 直接使用，相对路径则拼接 baseUrl（兼容旧数据）
   */
  private resolveEndpointUrl(baseUrl: string, apiEndpoint: string): string {
    if (apiEndpoint.startsWith('http://') || apiEndpoint.startsWith('https://')) {
      return apiEndpoint;
    }
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const normalizedPath = apiEndpoint.startsWith('/') ? apiEndpoint : `/${apiEndpoint}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private extractPathParamKeys(url: string): string[] {
    return Array.from(url.matchAll(/\{(\w+)\}/g)).map(match => match[1]);
  }

  private applyPathParams(url: string, params: Record<string, any>) {
    return url.replace(/\{(\w+)\}/g, (placeholder, key) => {
      const value = params[key];
      return value === undefined || value === null
        ? placeholder
        : encodeURIComponent(String(value));
    });
  }

  private omitPathParams(params: Record<string, any>, pathParamKeys: string[]) {
    if (pathParamKeys.length === 0) {
      return params;
    }

    const result = { ...params };
    for (const key of pathParamKeys) {
      delete result[key];
    }
    return result;
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
