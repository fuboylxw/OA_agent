import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

interface ParsedApiEndpoint {
  path: string;
  method: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }>;
  requestBody?: any;
  responses?: any;
}

interface ParsedApiDoc {
  authType: string;
  baseUrl: string;
  endpoints: ParsedApiEndpoint[];
}

/**
 * MCP工具生成服务
 *
 * 根据办事流程API自动生成MCP工具定义
 */
@Injectable()
export class MCPToolGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate MCP tools from parsed API documentation
   */
  async generateTools(
    parsedApis: ParsedApiDoc,
    connectorId: string,
    tenantId: string,
  ): Promise<any[]> {
    const tools: any[] = [];

    for (const api of parsedApis.endpoints) {
      const tool = {
        tenantId,
        connectorId,
        toolName: this.generateToolName(api),
        toolDescription: api.description || `Call ${api.method} ${api.path}`,
        toolSchema: this.generateToolSchema(api),
        apiEndpoint: api.path,
        httpMethod: api.method.toUpperCase(),
        headers: {},
        bodyTemplate: api.requestBody || null,
        paramMapping: this.generateParamMapping(api),
        responseMapping: this.generateResponseMapping(api),
        category: this.categorizeApi(api),
        flowCode: this.extractFlowCode(api),
        testInput: this.generateTestInput(api),
        testOutput: null,
      };

      // Create tool in database
      const createdTool = await this.prisma.mCPTool.create({ data: tool });
      tools.push(createdTool);

      console.log(`[MCP Generator] Created tool: ${tool.toolName}`);
    }

    return tools;
  }

  /**
   * 从办事流程API生成MCP工具
   */
  async generateFromWorkflowApi(
    tenantId: string,
    connectorId: string,
    workflowApi: any,
    baseUrl: string,
    authConfig: any,
  ) {
    const toolName = this.generateToolNameFromWorkflow(workflowApi.workflowType, workflowApi.method);
    const category = this.determineCategory(workflowApi.method, workflowApi.path);

    // 生成工具Schema（JSON Schema格式）
    const toolSchema = this.generateWorkflowToolSchema(workflowApi);

    // 生成参数映射
    const paramMapping = this.generateWorkflowParamMapping(workflowApi);

    // 生成响应映射
    const responseMapping = this.generateWorkflowResponseMapping(workflowApi);

    // 生成请求头
    const headers = this.generateHeaders(authConfig);

    // 生成请求体模板
    const bodyTemplate = this.generateBodyTemplate(workflowApi);

    // 生成测试数据
    const testInput = this.generateWorkflowTestInput(workflowApi);

    // 创建MCP工具
    const mcpTool = await this.prisma.mCPTool.upsert({
      where: {
        connectorId_toolName: {
          connectorId,
          toolName,
        },
      },
      create: {
        tenantId,
        connectorId,
        toolName,
        toolDescription: workflowApi.description,
        toolSchema,
        apiEndpoint: workflowApi.path,
        httpMethod: workflowApi.method,
        headers,
        bodyTemplate,
        paramMapping,
        responseMapping,
        flowCode: workflowApi.workflowType,
        category,
        enabled: true,
        testInput,
        testOutput: null,
      },
      update: {
        toolDescription: workflowApi.description,
        toolSchema,
        apiEndpoint: workflowApi.path,
        httpMethod: workflowApi.method,
        headers,
        bodyTemplate,
        paramMapping,
        responseMapping,
        category,
        testInput,
        updatedAt: new Date(),
      },
    });

    console.log(`[MCPToolGenerator] Generated MCP tool: ${toolName}`);

    return mcpTool;
  }

  /**
   * 生成工具名称（从workflow）
   */
  private generateToolNameFromWorkflow(workflowType: string, method: string): string {
    const action = method.toLowerCase() === 'get' ? 'query' : 'submit';
    return `${workflowType}_${action}`;
  }

  /**
   * 确定工具分类
   */
  private determineCategory(method: string, path: string): string {
    const methodLower = method.toLowerCase();

    if (methodLower === 'get') {
      if (path.includes('/list') || path.includes('/search')) {
        return 'list';
      }
      return 'query';
    }

    if (methodLower === 'post') {
      if (path.includes('/submit') || path.includes('/create')) {
        return 'submit';
      }
    }

    if (methodLower === 'delete') {
      return 'cancel';
    }

    if (methodLower === 'put' || methodLower === 'patch') {
      if (path.includes('/urge')) {
        return 'urge';
      }
      return 'submit';
    }

    return 'submit';
  }

  /**
   * 生成工具Schema（从workflow）
   */
  private generateWorkflowToolSchema(workflowApi: any): any {
    const properties: any = {};
    const required: string[] = [];

    // 处理参数
    for (const param of workflowApi.parameters || []) {
      properties[param.name] = {
        type: param.type || 'string',
        description: param.description || param.name,
      };

      if (param.required) {
        required.push(param.name);
      }
    }

    // 处理请求体
    if (workflowApi.requestBody?.properties) {
      for (const [key, value] of Object.entries(workflowApi.requestBody.properties)) {
        const prop = value as any;
        properties[key] = {
          type: prop.type || 'string',
          description: prop.description || key,
        };

        if (workflowApi.requestBody.required?.includes(key)) {
          required.push(key);
        }
      }
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }

  /**
   * 生成参数映射（从workflow）
   */
  private generateWorkflowParamMapping(workflowApi: any): any {
    const mapping: any = {};

    // URL参数和查询参数直接映射
    for (const param of workflowApi.parameters || []) {
      mapping[param.name] = param.name;
    }

    // 请求体参数映射
    if (workflowApi.requestBody?.properties) {
      for (const key of Object.keys(workflowApi.requestBody.properties)) {
        mapping[key] = key;
      }
    }

    return mapping;
  }

  /**
   * 生成响应映射（从workflow）
   */
  private generateWorkflowResponseMapping(workflowApi: any): any {
    return {
      success: 'response.success',
      data: 'response.data',
      message: 'response.message',
      code: 'response.code',
    };
  }

  /**
   * 生成请求头
   */
  private generateHeaders(authConfig: any): any {
    const headers: any = {
      'Content-Type': 'application/json',
    };

    if (authConfig.type === 'apikey') {
      headers[authConfig.headerName || 'X-API-Key'] = '{{apiKey}}';
    } else if (authConfig.type === 'bearer') {
      headers['Authorization'] = 'Bearer {{token}}';
    }

    return headers;
  }

  /**
   * 生成请求体模板
   */
  private generateBodyTemplate(workflowApi: any): any {
    if (!workflowApi.requestBody?.properties) {
      return null;
    }

    const template: any = {};

    for (const [key, value] of Object.entries(workflowApi.requestBody.properties)) {
      template[key] = `{{${key}}}`;
    }

    return template;
  }

  /**
   * 生成测试输入（从workflow）
   */
  private generateWorkflowTestInput(workflowApi: any): any {
    const testInput: any = {};

    // 生成参数测试数据
    for (const param of workflowApi.parameters || []) {
      testInput[param.name] = this.generateSampleValue(param.type || 'string');
    }

    // 生成请求体测试数据
    if (workflowApi.requestBody?.properties) {
      for (const [key, value] of Object.entries(workflowApi.requestBody.properties)) {
        const prop = value as any;
        testInput[key] = this.generateSampleValue(prop.type || 'string');
      }
    }

    return testInput;
  }

  /**
   * 生成示例值
   */
  private generateSampleValue(type: string): any {
    switch (type) {
      case 'string':
        return '测试数据';
      case 'number':
      case 'integer':
        return 100;
      case 'boolean':
        return true;
      case 'array':
        return ['示例1', '示例2'];
      case 'object':
        return { key: 'value' };
      default:
        return null;
    }
  }

  /**
   * 批量生成MCP工具
   */
  async generateBatch(
    tenantId: string,
    connectorId: string,
    workflowApis: any[],
    baseUrl: string,
    authConfig: any,
  ) {
    const results = [];

    for (const workflowApi of workflowApis) {
      try {
        const mcpTool = await this.generateFromWorkflowApi(
          tenantId,
          connectorId,
          workflowApi,
          baseUrl,
          authConfig,
        );
        results.push({ success: true, tool: mcpTool });
      } catch (error: any) {
        console.error(
          `[MCPToolGenerator] Failed to generate tool for ${workflowApi.path}:`,
          error.message,
        );
        results.push({
          success: false,
          workflowApi,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Generate tool name from API endpoint
   */
  private generateToolName(api: ParsedApiEndpoint): string {
    const action = this.extractAction(api.path, api.method);
    const resource = this.extractResource(api.path);
    return `${action}_${resource}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  /**
   * Extract action from method and path
   */
  private extractAction(path: string, method: string): string {
    const methodActions: Record<string, string> = {
      GET: 'get',
      POST: 'create',
      PUT: 'update',
      PATCH: 'update',
      DELETE: 'delete',
    };

    // Check if path contains action keywords
    if (path.includes('/submit')) return 'submit';
    if (path.includes('/query') || path.includes('/status')) return 'query';
    if (path.includes('/cancel')) return 'cancel';
    if (path.includes('/urge')) return 'urge';
    if (path.includes('/list')) return 'list';

    return methodActions[method.toUpperCase()] || 'call';
  }

  /**
   * Extract resource name from path
   */
  private extractResource(path: string): string {
    // Extract the main resource from path
    // e.g., /api/v1/work -> work
    // e.g., /x_processplatform_assemble_surface/jaxrs/work -> work
    const parts = path.split('/').filter(p => p && !p.match(/^(api|v\d+|jaxrs)$/i));
    return parts[parts.length - 1] || 'resource';
  }

  /**
   * Generate MCP tool schema (JSON Schema format)
   */
  private generateToolSchema(api: ParsedApiEndpoint): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of api.parameters) {
      properties[param.name] = {
        type: this.mapTypeToJsonSchema(param.type),
        description: param.description || param.name,
      };

      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }

  /**
   * Map API parameter type to JSON Schema type
   */
  private mapTypeToJsonSchema(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'string',
      number: 'number',
      integer: 'integer',
      boolean: 'boolean',
      array: 'array',
      object: 'object',
    };

    return typeMap[type.toLowerCase()] || 'string';
  }

  /**
   * Generate parameter mapping
   */
  private generateParamMapping(api: ParsedApiEndpoint): Record<string, any> {
    const mapping: Record<string, any> = {};

    for (const param of api.parameters) {
      // Simple 1:1 mapping by default
      mapping[param.name] = param.name;
    }

    return mapping;
  }

  /**
   * Generate response mapping
   */
  private generateResponseMapping(api: ParsedApiEndpoint): Record<string, any> {
    // Default response mapping
    return {
      success: 'type',
      data: 'data',
      message: 'message',
      error: 'message',
    };
  }

  /**
   * Categorize API endpoint
   */
  private categorizeApi(api: ParsedApiEndpoint): string {
    const path = api.path.toLowerCase();
    const method = api.method.toUpperCase();

    if (path.includes('/submit') || (method === 'POST' && path.includes('/work'))) {
      return 'submit';
    }
    if (path.includes('/status') || path.includes('/query')) {
      return 'query';
    }
    if (path.includes('/cancel')) {
      return 'cancel';
    }
    if (path.includes('/urge')) {
      return 'urge';
    }
    if (path.includes('/list') || method === 'GET') {
      return 'list';
    }
    if (method === 'GET' && path.match(/\/\{id\}$/)) {
      return 'get';
    }

    return 'other';
  }

  /**
   * Extract flow code from API path
   */
  private extractFlowCode(api: ParsedApiEndpoint): string | null {
    // Try to extract flow/process code from path
    const match = api.path.match(/\/process\/([^\/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Generate test input for the tool
   */
  private generateTestInput(api: ParsedApiEndpoint): Record<string, any> {
    const testInput: Record<string, any> = {};

    for (const param of api.parameters) {
      if (param.required) {
        testInput[param.name] = this.generateTestValue(param.type);
      }
    }

    return testInput;
  }

  /**
   * Generate test value based on type
   */
  private generateTestValue(type: string): any {
    switch (type.toLowerCase()) {
      case 'string':
        return 'test_value';
      case 'number':
      case 'integer':
        return 100;
      case 'boolean':
        return true;
      case 'array':
        return [];
      case 'object':
        return {};
      default:
        return 'test';
    }
  }
}
