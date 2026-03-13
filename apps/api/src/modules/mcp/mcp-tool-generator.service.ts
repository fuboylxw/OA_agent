import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class MCPToolGeneratorService {
  private readonly logger = new Logger(MCPToolGeneratorService.name);

  constructor(private readonly prisma: PrismaService) {}

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
        toolName: this.generateToolName(api.path, api.method),
        toolDescription: api.description || `Call ${api.method} ${api.path}`,
        toolSchema: this.buildToolSchema(api.parameters),
        apiEndpoint: this.buildFullUrl(parsedApis.baseUrl, api.path),
        httpMethod: api.method.toUpperCase(),
        headers: {},
        bodyTemplate: api.requestBody || null,
        paramMapping: this.buildParamMapping(api.parameters),
        responseMapping: { success: 'type', data: 'data', message: 'message', error: 'message' },
        category: this.categorizeEndpoint(api.method, api.path),
        flowCode: this.extractFlowCode(api.path),
        testInput: this.buildTestInput(api.parameters),
        testOutput: null,
      };

      const createdTool = await this.prisma.mCPTool.create({ data: tool });
      tools.push(createdTool);
      this.logger.log(`Created tool: ${tool.toolName}`);
    }

    return tools;
  }

  async generateFromWorkflowApi(
    tenantId: string,
    connectorId: string,
    workflowApi: any,
    baseUrl: string,
    authConfig: any,
  ) {
    const action = workflowApi.method.toLowerCase() === 'get' ? 'query' : 'submit';
    const toolName = `${workflowApi.workflowType}_${action}`;
    const category = this.categorizeEndpoint(workflowApi.method, workflowApi.path);

    // Merge parameters + requestBody properties into a single param list
    const allParams = [...(workflowApi.parameters || [])];
    if (workflowApi.requestBody?.properties) {
      for (const [key, value] of Object.entries(workflowApi.requestBody.properties)) {
        const prop = value as any;
        allParams.push({
          name: key,
          type: prop.type || 'string',
          required: workflowApi.requestBody.required?.includes(key) || false,
          description: prop.description || key,
        });
      }
    }

    const toolSchema = this.buildToolSchema(allParams);
    const paramMapping = this.buildParamMapping(allParams);
    const headers = this.buildAuthHeaders(authConfig);
    const bodyTemplate = this.buildBodyTemplate(workflowApi.requestBody?.properties);
    const testInput = this.buildTestInput(allParams);
    const fullUrl = this.buildFullUrl(baseUrl, workflowApi.path);

    const mcpTool = await this.prisma.mCPTool.upsert({
      where: {
        connectorId_toolName: { connectorId, toolName },
      },
      create: {
        tenantId,
        connectorId,
        toolName,
        toolDescription: workflowApi.description,
        toolSchema,
        apiEndpoint: fullUrl,
        httpMethod: workflowApi.method,
        headers,
        bodyTemplate,
        paramMapping,
        responseMapping: { success: 'response.success', data: 'response.data', message: 'response.message', code: 'response.code' },
        flowCode: workflowApi.workflowType,
        category,
        enabled: true,
        testInput,
        testOutput: null,
      },
      update: {
        toolDescription: workflowApi.description,
        toolSchema,
        apiEndpoint: fullUrl,
        httpMethod: workflowApi.method,
        headers,
        bodyTemplate,
        paramMapping,
        responseMapping: { success: 'response.success', data: 'response.data', message: 'response.message', code: 'response.code' },
        category,
        testInput,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Generated MCP tool: ${toolName}`);
    return mcpTool;
  }

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
          tenantId, connectorId, workflowApi, baseUrl, authConfig,
        );
        results.push({ success: true, tool: mcpTool });
      } catch (error: any) {
        this.logger.error(`Failed to generate tool for ${workflowApi.path}: ${error.message}`);
        results.push({ success: false, workflowApi, error: error.message });
      }
    }

    return results;
  }

  // ── Shared helpers ──────────────────────────────────────────

  private categorizeEndpoint(method: string, path: string): string {
    const m = method.toUpperCase();
    const p = path.toLowerCase();

    if (p.includes('/submit') || (m === 'POST' && p.includes('/work'))) return 'submit';
    if (p.includes('/status') || p.includes('/query') || p.includes('/worklog')) return 'query';
    if (p.includes('/cancel') || m === 'DELETE') return 'cancel';
    if (p.includes('/urge')) return 'urge';
    if (p.includes('/list') || p.includes('/search')) return 'list';
    if (m === 'GET' && p.match(/\/\{[^}]+\}$/)) return 'get';
    if (m === 'GET') return 'list';
    return 'other';
  }

  private generateToolName(path: string, method: string): string {
    const action = this.extractAction(path, method);
    const resource = this.extractResource(path);
    return `${action}_${resource}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  private extractAction(path: string, method: string): string {
    if (path.includes('/submit')) return 'submit';
    if (path.includes('/query') || path.includes('/status')) return 'query';
    if (path.includes('/cancel')) return 'cancel';
    if (path.includes('/urge')) return 'urge';
    if (path.includes('/list')) return 'list';

    const methodActions: Record<string, string> = {
      GET: 'get', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete',
    };
    return methodActions[method.toUpperCase()] || 'call';
  }

  private extractResource(path: string): string {
    const parts = path.split('/').filter(p => p && !p.match(/^(api|v\d+)$/i));
    return parts[parts.length - 1] || 'resource';
  }

  private extractFlowCode(path: string): string | null {
    const match = path.match(/\/process\/([^\/]+)/);
    return match ? match[1] : null;
  }

  private buildToolSchema(params: Array<{ name: string; type: string; required: boolean; description?: string }>): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of params) {
      properties[param.name] = {
        type: this.mapType(param.type),
        description: param.description || param.name,
      };
      if (param.required) required.push(param.name);
    }

    return { type: 'object', properties, required };
  }

  private buildParamMapping(params: Array<{ name: string }>): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const param of params) {
      mapping[param.name] = param.name;
    }
    return mapping;
  }

  private buildTestInput(params: Array<{ name: string; type: string; required: boolean }>): Record<string, any> {
    const input: Record<string, any> = {};
    for (const param of params) {
      if (param.required) {
        input[param.name] = this.sampleValue(param.type);
      }
    }
    return input;
  }

  private sampleValue(type: string): any {
    switch ((type || 'string').toLowerCase()) {
      case 'string': return 'test_value';
      case 'number': case 'integer': return 100;
      case 'boolean': return true;
      case 'array': return [];
      case 'object': return {};
      default: return 'test';
    }
  }

  private mapType(type: string): string {
    const map: Record<string, string> = {
      string: 'string', number: 'number', integer: 'integer',
      boolean: 'boolean', array: 'array', object: 'object',
    };
    return map[(type || 'string').toLowerCase()] || 'string';
  }

  private buildAuthHeaders(authConfig: any): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (authConfig.type === 'apikey') {
      headers[authConfig.headerName || 'X-API-Key'] = '{{apiKey}}';
    } else if (authConfig.type === 'bearer') {
      headers['Authorization'] = 'Bearer {{token}}';
    }

    return headers;
  }

  private buildBodyTemplate(properties: Record<string, any> | undefined): any {
    if (!properties) return null;

    const template: Record<string, string> = {};
    for (const key of Object.keys(properties)) {
      template[key] = `{{${key}}}`;
    }
    return template;
  }

  private buildFullUrl(baseUrl: string, path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }
}
