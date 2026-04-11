import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { createHash } from 'crypto';
import {
  normalizeProcessName,
  resolveAssistantFieldPresentation,
} from '@uniflow/shared-types';
import {
  IdentifiedWorkflow,
  DetectedSyncCapabilities,
  GenerateResult,
  GeneratedTool,
  SyncStrategy,
  WorkflowEndpoint,
  NormalizedEndpoint,
  EndpointRole,
} from './types';

@Injectable()
export class MCPGeneratorService {
  private readonly logger = new Logger(MCPGeneratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 从识别出的 workflows 生成 MCPTool + ProcessTemplate
   */
  async generate(
    tenantId: string,
    connectorId: string,
    workflows: IdentifiedWorkflow[],
    syncCapabilities: DetectedSyncCapabilities,
    baseUrl?: string,
  ): Promise<GenerateResult> {
    const generatedTools: GeneratedTool[] = [];
    const processTemplates: GenerateResult['processTemplates'] = [];
    const usedToolNames = new Set<string>();

    // 获取 connector baseUrl（如果调用方未传入）
    let resolvedBaseUrl = baseUrl;
    if (!resolvedBaseUrl) {
      const connector = await this.prisma.connector.findFirst({
        where: {
          id: connectorId,
          tenantId,
        },
        select: {
          baseUrl: true,
        },
      });

      if (!connector) {
        throw new NotFoundException('Connector not found');
      }

      resolvedBaseUrl = connector.baseUrl;
    }

    // 1. 为每个 workflow 的每个 endpoint 生成 MCPTool
    for (const workflow of workflows) {
      const normalizedWorkflow: IdentifiedWorkflow = {
        ...workflow,
        processName: normalizeProcessName({
          processName: workflow.processName,
          processCode: workflow.processCode,
        }),
      };

      for (const wep of normalizedWorkflow.endpoints) {
        const toolName = this.uniqueToolName(
          `${normalizedWorkflow.processCode}_${wep.role}`,
          usedToolNames,
        );

        const tool = await this.createMCPTool(
          tenantId,
          connectorId,
          toolName,
          normalizedWorkflow,
          wep,
          resolvedBaseUrl,
        );

        generatedTools.push({
          toolName: tool.toolName,
          toolDescription: tool.toolDescription,
          category: tool.category,
          flowCode: tool.flowCode,
          apiEndpoint: tool.apiEndpoint,
          httpMethod: tool.httpMethod,
        });
      }

      // 为每个 workflow 创建 ProcessTemplate
      const template = await this.createProcessTemplate(
        tenantId,
        connectorId,
        normalizedWorkflow,
      );
      processTemplates.push({
        processCode: normalizedWorkflow.processCode,
        processName: normalizedWorkflow.processName,
        category: normalizedWorkflow.category,
        templateId: template.id,
      });
    }

    // 2. 为同步辅助端点生成 MCPTool（不属于任何 workflow）
    await this.createSyncTools(
      tenantId,
      connectorId,
      syncCapabilities,
      usedToolNames,
      generatedTools,
      resolvedBaseUrl,
    );

    // 3. 确定同步策略
    const syncStrategy = this.determineSyncStrategy(generatedTools);

    // 4. 更新 connector 的 syncStrategy
    await this.prisma.connector.updateMany({
      where: {
        id: connectorId,
        tenantId,
      },
      data: { syncStrategy: syncStrategy as any },
    });

    // 5. 更新 ConnectorCapability
    await this.updateCapabilities(connectorId, tenantId, generatedTools, syncCapabilities);

    this.logger.log(
      `Generated ${generatedTools.length} tools, ${processTemplates.length} templates for connector ${connectorId}`,
    );

    return {
      connectorId,
      tools: generatedTools,
      processTemplates,
      syncStrategy,
    };
  }

  // ── MCPTool 创建 ──────────────────────────────────────────

  private async createMCPTool(
    tenantId: string,
    connectorId: string,
    toolName: string,
    workflow: IdentifiedWorkflow,
    wep: WorkflowEndpoint,
    baseUrl: string,
  ) {
    const ep = wep.endpoint;
    const fullUrl = this.buildFullUrl(baseUrl, ep.path);
    const allParams = this.extractAllParams(ep);
    const toolSchema = this.buildToolSchema(allParams);
    const paramMapping = this.buildParamMapping(allParams);
    const bodyTemplate = this.buildBodyTemplate(ep.requestBody?.schema);
    const testInput = this.buildTestInput(allParams);

    return this.prisma.mCPTool.upsert({
      where: {
        connectorId_toolName: { connectorId, toolName },
      },
      create: {
        tenantId,
        connectorId,
        toolName,
        toolDescription: `${workflow.processName} - ${ep.summary}`,
        toolSchema,
        apiEndpoint: fullUrl,
        httpMethod: ep.method,
        headers: {},
        bodyTemplate,
        paramMapping,
        responseMapping: {
          success: 'success',
          data: 'data',
          message: 'message',
        },
        flowCode: workflow.processCode,
        category: wep.role,
        enabled: true,
        testInput,
        testOutput: null,
      },
      update: {
        toolDescription: `${workflow.processName} - ${ep.summary}`,
        toolSchema,
        apiEndpoint: fullUrl,
        httpMethod: ep.method,
        bodyTemplate,
        paramMapping,
        category: wep.role,
        testInput,
        updatedAt: new Date(),
      },
    });
  }

  // ── 同步辅助工具创建 ──────────────────────────────────────

  private async createSyncTools(
    tenantId: string,
    connectorId: string,
    syncCapabilities: DetectedSyncCapabilities,
    usedToolNames: Set<string>,
    generatedTools: GeneratedTool[],
    baseUrl: string,
  ) {
    // webhook_register
    if (syncCapabilities.webhookEndpoint) {
      const ep = syncCapabilities.webhookEndpoint;
      const fullUrl = this.buildFullUrl(baseUrl, ep.path);
      const toolName = this.uniqueToolName('_system_webhook_register', usedToolNames);
      await this.prisma.mCPTool.upsert({
        where: { connectorId_toolName: { connectorId, toolName } },
        create: {
          tenantId,
          connectorId,
          toolName,
          toolDescription: ep.description || 'Register webhook callback',
          toolSchema: { type: 'object', properties: { callbackUrl: { type: 'string' }, events: { type: 'array', items: { type: 'string' } } }, required: ['callbackUrl'] },
          apiEndpoint: fullUrl,
          httpMethod: ep.method,
          headers: {},
          paramMapping: { callbackUrl: 'callbackUrl', events: 'events' },
          responseMapping: { success: 'success', data: 'data' },
          flowCode: null,
          category: 'webhook_register',
          enabled: true,
        },
        update: { apiEndpoint: fullUrl, httpMethod: ep.method, updatedAt: new Date() },
      });
      generatedTools.push({
        toolName,
        toolDescription: ep.description || 'Register webhook callback',
        category: 'webhook_register',
        flowCode: null,
        apiEndpoint: fullUrl,
        httpMethod: ep.method,
      });
    }

    // batch_query
    if (syncCapabilities.batchQueryEndpoint) {
      const ep = syncCapabilities.batchQueryEndpoint;
      const fullUrl = this.buildFullUrl(baseUrl, ep.path);
      const toolName = this.uniqueToolName('_system_batch_query', usedToolNames);
      await this.prisma.mCPTool.upsert({
        where: { connectorId_toolName: { connectorId, toolName } },
        create: {
          tenantId,
          connectorId,
          toolName,
          toolDescription: ep.description || 'Batch query submission status',
          toolSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
          apiEndpoint: fullUrl,
          httpMethod: ep.method,
          headers: {},
          paramMapping: { ids: 'ids' },
          responseMapping: { success: 'success', data: 'data' },
          flowCode: null,
          category: 'batch_query',
          enabled: true,
        },
        update: { apiEndpoint: fullUrl, httpMethod: ep.method, updatedAt: new Date() },
      });
      generatedTools.push({
        toolName,
        toolDescription: ep.description || 'Batch query submission status',
        category: 'batch_query',
        flowCode: null,
        apiEndpoint: fullUrl,
        httpMethod: ep.method,
      });
    }

    // status_query (per-process)
    for (const sq of syncCapabilities.singleQueryEndpoints) {
      const fullUrl = this.buildFullUrl(baseUrl, sq.path);
      const toolName = this.uniqueToolName(
        sq.processCode === '_global' ? '_system_status_query' : `${sq.processCode}_status_query`,
        usedToolNames,
      );
      await this.prisma.mCPTool.upsert({
        where: { connectorId_toolName: { connectorId, toolName } },
        create: {
          tenantId,
          connectorId,
          toolName,
          toolDescription: `Query status for ${sq.processCode}`,
          toolSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          apiEndpoint: fullUrl,
          httpMethod: sq.method,
          headers: {},
          paramMapping: { id: 'id' },
          responseMapping: { success: 'success', data: 'data', status: 'status' },
          flowCode: sq.processCode === '_global' ? null : sq.processCode,
          category: 'status_query',
          enabled: true,
        },
        update: { apiEndpoint: fullUrl, httpMethod: sq.method, updatedAt: new Date() },
      });
      generatedTools.push({
        toolName,
        toolDescription: `Query status for ${sq.processCode}`,
        category: 'status_query',
        flowCode: sq.processCode === '_global' ? null : sq.processCode,
        apiEndpoint: fullUrl,
        httpMethod: sq.method,
      });
    }

    // flow_list — 流程列表接口，用于运行时动态发现流程类型
    if (syncCapabilities.flowListEndpoint) {
      const ep = syncCapabilities.flowListEndpoint;
      const fullUrl = this.buildFullUrl(baseUrl, ep.path);
      const toolName = this.uniqueToolName('_system_flow_list', usedToolNames);
      await this.prisma.mCPTool.upsert({
        where: { connectorId_toolName: { connectorId, toolName } },
        create: {
          tenantId,
          connectorId,
          toolName,
          toolDescription: ep.description || 'List available flow/form types',
          toolSchema: { type: 'object', properties: {} },
          apiEndpoint: fullUrl,
          httpMethod: ep.method,
          headers: {},
          paramMapping: {},
          responseMapping: {
            listPath: ep.responseListPath || 'data',
            code: ep.fieldMapping?.code || 'code',
            name: ep.fieldMapping?.name || 'name',
            category: ep.fieldMapping?.category || 'category',
          },
          flowCode: null,
          category: 'flow_list',
          enabled: true,
        },
        update: {
          apiEndpoint: fullUrl,
          httpMethod: ep.method,
          responseMapping: {
            listPath: ep.responseListPath || 'data',
            code: ep.fieldMapping?.code || 'code',
            name: ep.fieldMapping?.name || 'name',
            category: ep.fieldMapping?.category || 'category',
          },
          updatedAt: new Date(),
        },
      });
      generatedTools.push({
        toolName,
        toolDescription: ep.description || 'List available flow/form types',
        category: 'flow_list',
        flowCode: null,
        apiEndpoint: fullUrl,
        httpMethod: ep.method,
      });
    }
  }

  // ── 同步策略 ──────────────────────────────────────────────

  determineSyncStrategy(tools: GeneratedTool[]): SyncStrategy {
    const categories = new Set(tools.map(t => t.category));

    const webhookTool = tools.find(t => t.category === 'webhook_register');
    const batchTool = tools.find(t => t.category === 'batch_query');
    const statusTool = tools.find(t => t.category === 'status_query');
    const queryTool = tools.find(t => t.category === 'query');

    if (webhookTool) {
      return {
        primary: 'webhook',
        fallback: statusTool || queryTool ? 'single_polling' : 'manual',
        pollingIntervalMs: 300_000,
        webhookRegisterToolName: webhookTool.toolName,
        statusQueryToolName: statusTool?.toolName || queryTool?.toolName,
      };
    }

    if (batchTool) {
      return {
        primary: 'batch_polling',
        fallback: 'manual',
        pollingIntervalMs: 300_000,
        batchQueryToolName: batchTool.toolName,
        statusQueryToolName: statusTool?.toolName || queryTool?.toolName,
      };
    }

    if (statusTool || queryTool) {
      return {
        primary: 'single_polling',
        fallback: 'manual',
        pollingIntervalMs: 300_000,
        statusQueryToolName: statusTool?.toolName || queryTool?.toolName,
      };
    }

    return {
      primary: 'manual',
      fallback: null,
      pollingIntervalMs: 0,
    };
  }

  // ── ProcessTemplate 创建 ──────────────────────────────────

  private async createProcessTemplate(
    tenantId: string,
    connectorId: string,
    workflow: IdentifiedWorkflow,
  ) {
    const sourceHash = createHash('sha256')
      .update(JSON.stringify({
        processCode: workflow.processCode,
        endpoints: workflow.endpoints.map(e => `${e.endpoint.method} ${e.endpoint.path}`),
      }))
      .digest('hex');

    // Upsert RemoteProcess
    const remoteProcess = await this.prisma.remoteProcess.upsert({
      where: {
        connectorId_remoteProcessId: {
          connectorId,
          remoteProcessId: workflow.processCode,
        },
      },
      create: {
        tenantId,
        connectorId,
        remoteProcessId: workflow.processCode,
        remoteProcessCode: workflow.processCode,
        remoteProcessName: workflow.processName,
        processCategory: workflow.category,
        sourceHash,
        sourceVersion: '1',
        metadata: { confidence: workflow.confidence, description: workflow.description },
        lastSchemaSyncAt: new Date(),
      },
      update: {
        remoteProcessName: workflow.processName,
        processCategory: workflow.category,
        sourceHash,
        metadata: { confidence: workflow.confidence, description: workflow.description },
        lastSchemaSyncAt: new Date(),
      },
    });

    // 提取字段 schema
    const schemaFields = this.extractSchemaFields(workflow);

    // 查找最新版本
    const latest = await this.prisma.processTemplate.findFirst({
      where: { connectorId, processCode: workflow.processCode },
      orderBy: { version: 'desc' },
    });
    const nextVersion = latest ? latest.version + 1 : 1;

    const template = await this.prisma.processTemplate.create({
      data: {
        tenantId,
        connectorId,
        remoteProcessId: remoteProcess.id,
        processCode: workflow.processCode,
        processName: workflow.processName,
        processCategory: workflow.category,
        description: workflow.description,
        version: nextVersion,
        status: 'published',
        falLevel: 'F1',
        sourceHash,
        sourceVersion: String(nextVersion),
        schema: { fields: schemaFields },
        rules: null,
        permissions: null,
        lastSyncedAt: new Date(),
        publishedAt: new Date(),
      },
    });

    await this.prisma.remoteProcess.update({
      where: { id: remoteProcess.id },
      data: { latestTemplateId: template.id },
    });

    return template;
  }

  // ── ConnectorCapability 更新 ──────────────────────────────

  private async updateCapabilities(
    connectorId: string,
    tenantId: string,
    tools: GeneratedTool[],
    syncCapabilities: DetectedSyncCapabilities,
  ) {
    const categories = new Set(tools.map(t => t.category));

    await this.prisma.connectorCapability.upsert({
      where: { connectorId },
      create: {
        tenantId,
        connectorId,
        supportsDiscovery: true,
        supportsSchemaSync: true,
        supportsReferenceSync: categories.has('reference_data'),
        supportsStatusPull: categories.has('query') || categories.has('status_query'),
        supportsWebhook: !!syncCapabilities.webhookEndpoint,
        supportsCancel: categories.has('cancel'),
        supportsUrge: categories.has('urge'),
        supportsDelegate: false,
        supportsSupplement: false,
        supportsRealtimePerm: false,
        supportsIdempotency: false,
        metadata: { generatedAt: new Date().toISOString(), toolCount: tools.length },
      },
      update: {
        supportsReferenceSync: categories.has('reference_data'),
        supportsStatusPull: categories.has('query') || categories.has('status_query'),
        supportsWebhook: !!syncCapabilities.webhookEndpoint,
        supportsCancel: categories.has('cancel'),
        supportsUrge: categories.has('urge'),
        metadata: { generatedAt: new Date().toISOString(), toolCount: tools.length },
        updatedAt: new Date(),
      },
    });
  }

  // ── 辅助方法 ──────────────────────────────────────────────

  private extractAllParams(ep: NormalizedEndpoint): Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
  }> {
    const params = ep.parameters.map(p => ({
      name: p.name,
      type: p.type,
      required: p.required,
      description: p.description,
    }));

    // 从 requestBody schema 中提取字段
    const bodySchema = ep.requestBody?.schema;
    if (bodySchema?.properties) {
      const requiredFields = bodySchema.required || [];
      for (const [key, value] of Object.entries(bodySchema.properties)) {
        const prop = value as any;
        params.push({
          name: key,
          type: prop.type || 'string',
          required: requiredFields.includes(key),
          description: prop.description || key,
        });
      }
    }

    return params;
  }

  private buildToolSchema(params: Array<{ name: string; type: string; required: boolean; description: string }>): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const p of params) {
      properties[p.name] = {
        type: this.mapJsonSchemaType(p.type),
        description: p.description,
      };
      if (p.required) required.push(p.name);
    }

    return { type: 'object', properties, required };
  }

  private buildParamMapping(params: Array<{ name: string }>): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const p of params) mapping[p.name] = p.name;
    return mapping;
  }

  private buildBodyTemplate(schema: any): any {
    if (!schema?.properties) return null;
    const template: Record<string, string> = {};
    for (const key of Object.keys(schema.properties)) {
      template[key] = `{{${key}}}`;
    }
    return template;
  }

  private buildTestInput(params: Array<{ name: string; type: string; required: boolean }>): Record<string, any> {
    const input: Record<string, any> = {};
    for (const p of params) {
      if (p.required) {
        input[p.name] = this.sampleValue(p.type);
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

  private mapJsonSchemaType(type: string): string {
    const map: Record<string, string> = {
      string: 'string', number: 'number', integer: 'integer',
      boolean: 'boolean', array: 'array', object: 'object',
    };
    return map[(type || 'string').toLowerCase()] || 'string';
  }

  private extractSchemaFields(workflow: IdentifiedWorkflow): any[] {
    const fields: any[] = [];
    const seen = new Set<string>();

    for (const wep of workflow.endpoints) {
      if (wep.role !== 'submit') continue;
      for (const p of this.extractAllParams(wep.endpoint)) {
        if (seen.has(p.name)) continue;
        seen.add(p.name);
        const presentation = resolveAssistantFieldPresentation({
          key: p.name,
          label: p.description || p.name,
          type: this.mapFieldType(p.type),
          processCode: workflow.processCode,
        });
        fields.push({
          key: p.name,
          label: presentation.label,
          type: presentation.type,
          required: p.required,
        });
      }
    }

    return fields;
  }

  private mapFieldType(apiType: string): string {
    const map: Record<string, string> = {
      string: 'text', number: 'number', integer: 'number',
      boolean: 'checkbox', array: 'select', object: 'json', file: 'file',
    };
    return map[(apiType || 'string').toLowerCase()] || 'text';
  }

  private uniqueToolName(base: string, used: Set<string>): string {
    let name = base.toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 120);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    let suffix = 2;
    while (used.has(`${name}_${suffix}`)) suffix++;
    name = `${name}_${suffix}`;
    used.add(name);
    return name;
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
