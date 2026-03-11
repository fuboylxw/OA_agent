import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { ApiDocParserAgent } from './agents/api-doc-parser.agent';
import { WorkflowApiIdentifierAgent } from './agents/workflow-api-identifier.agent';
import { ApiValidatorAgent } from './agents/api-validator.agent';
import { MCPToolGeneratorService } from './mcp-tool-generator.service';

export interface UploadApiFileDto {
  tenantId: string;
  connectorId: string;
  docType: 'openapi' | 'swagger' | 'postman' | 'custom';
  docContent: string;
  oaUrl: string;
  authConfig: any;
  autoValidate?: boolean; // 是否自动验证接口
  autoGenerateMcp?: boolean; // 是否自动生成MCP工具
}

export interface ApiUploadResult {
  uploadId: string;
  totalEndpoints: number;
  workflowEndpoints: number;
  validatedEndpoints: number;
  generatedMcpTools: number;
  workflowApis: any[];
  validationResults: any[];
  mcpTools: any[];
}

/**
 * API文件上传服务
 *
 * 功能流程：
 * 1. 解析API文档（OpenAPI/Swagger/自定义）
 * 2. 识别办事流程接口
 * 3. 验证接口可访问性和参数
 * 4. 存储到数据库
 * 5. 自动生成MCP工具
 */
@Injectable()
export class ApiUploadService {
  private readonly logger = new Logger(ApiUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiDocParser: ApiDocParserAgent,
    private readonly workflowIdentifier: WorkflowApiIdentifierAgent,
    private readonly apiValidator: ApiValidatorAgent,
    private readonly mcpToolGenerator: MCPToolGeneratorService,
  ) {}

  /**
   * 上传并处理API文件
   */
  async uploadAndProcess(dto: UploadApiFileDto): Promise<ApiUploadResult> {
    this.logger.log(`Starting upload for connector ${dto.connectorId}`);
    if (!dto.docContent?.trim()) {
      throw new BadRequestException('API document content is required');
    }

    const connector = await this.prisma.connector.findUnique({
      where: { id: dto.connectorId },
      select: { id: true, tenantId: true, baseUrl: true },
    });

    if (!connector) {
      throw new NotFoundException(`Connector ${dto.connectorId} not found`);
    }

    if (connector.tenantId !== dto.tenantId) {
      throw new BadRequestException(
        `Connector ${dto.connectorId} does not belong to tenant ${dto.tenantId}`,
      );
    }

    const oaBaseUrl = dto.oaUrl || connector.baseUrl;
    if (!oaBaseUrl) {
      throw new BadRequestException('OA base URL is required');
    }

    const parsedDocResult = await this.apiDocParser.execute(
      {
        docType: dto.docType,
        docContent: dto.docContent,
        oaUrl: oaBaseUrl,
      },
      { tenantId: dto.tenantId, traceId: `upload-${Date.now()}` },
    );

    if (!parsedDocResult.success || !parsedDocResult.data) {
      throw new BadRequestException(`Failed to parse API doc: ${parsedDocResult.error}`);
    }

    const parsedDoc = parsedDocResult.data;
    this.logger.log(`Parsed ${parsedDoc.endpoints?.length || 0} endpoints`);
    const identificationResultWrapper = await this.workflowIdentifier.execute(
      { endpoints: parsedDoc.endpoints || [] },
      { tenantId: dto.tenantId, traceId: `upload-${Date.now()}` },
    );

    if (!identificationResultWrapper.success || !identificationResultWrapper.data) {
      throw new Error(`Failed to identify workflow APIs: ${identificationResultWrapper.error}`);
    }

    const identificationResult = identificationResultWrapper.data;
    this.logger.log(`Identified ${identificationResult.workflowApis?.length || 0} workflow APIs`);

    const validationResults: any[] = [];
    if (dto.autoValidate) {
      for (const workflowApi of identificationResult.workflowApis || []) {
        try {
          const validationResult = await this.apiValidator.execute(
            {
              baseUrl: parsedDoc.baseUrl || oaBaseUrl,
              authConfig: dto.authConfig,
              endpoint: {
                path: workflowApi.path,
                method: workflowApi.method,
                parameters: workflowApi.parameters,
                requestBody: workflowApi.requestBody,
              },
            },
            { tenantId: dto.tenantId, traceId: `upload-${Date.now()}` },
          );

          validationResults.push({
            path: workflowApi.path,
            method: workflowApi.method,
            ...(validationResult.data || {}),
          });
        } catch (error: any) {
          this.logger.error(`Validation failed for ${workflowApi.path}: ${error.message}`);
          validationResults.push({
            path: workflowApi.path,
            method: workflowApi.method,
            isAccessible: false,
            errorMessage: error.message,
          });
        }
      }
    }

    const storedApis = await this.storeWorkflowApis(
      dto.tenantId,
      dto.connectorId,
      identificationResult.workflowApis || [],
      validationResults,
    );

    const mcpTools: any[] = [];
    if (dto.autoGenerateMcp) {
      for (const workflowApi of identificationResult.workflowApis || []) {
        try {
          const mcpTool = await this.mcpToolGenerator.generateFromWorkflowApi(
            dto.tenantId,
            dto.connectorId,
            workflowApi,
            parsedDoc.baseUrl || oaBaseUrl,
            dto.authConfig,
          );
          mcpTools.push(mcpTool);
        } catch (error: any) {
          this.logger.error(`MCP tool generation failed for ${workflowApi.path}: ${error.message}`);
        }
      }
    }

    const result: ApiUploadResult = {
      uploadId: `upload-${Date.now()}`,
      totalEndpoints: parsedDoc.endpoints?.length || 0,
      workflowEndpoints: identificationResult.workflowApis?.length || 0,
      validatedEndpoints: validationResults.filter(v => v.isAccessible).length,
      generatedMcpTools: mcpTools.length,
      workflowApis: identificationResult.workflowApis || [],
      validationResults,
      mcpTools,
    };

    this.logger.log(
      `Upload completed: ${result.totalEndpoints} endpoints, ${result.workflowEndpoints} workflow, ${result.generatedMcpTools} MCP tools`,
    );

    return result;
  }

  /**
   * 存储办事流程API到数据库
   */
  private async storeWorkflowApis(
    tenantId: string,
    connectorId: string,
    workflowApis: any[],
    validationResults: any[],
  ): Promise<any[]> {
    const stored: any[] = [];

    for (const api of workflowApis) {
      // 查找对应的验证结果
      const validation = validationResults.find(
        v => v.path === api.path && v.method === api.method,
      );
      const schemaFields = this.convertParametersToSchema(api.parameters, api.requestBody);
      const sourceHash = this.computeSourceHash({
        workflowType: api.workflowType,
        workflowCategory: api.workflowCategory,
        path: api.path,
        method: api.method,
        schemaFields,
      });
      const remoteProcess = await this.prisma.remoteProcess.upsert({
        where: {
          connectorId_remoteProcessId: {
            connectorId,
            remoteProcessId: api.workflowType,
          },
        },
        create: {
          tenantId,
          connectorId,
          remoteProcessId: api.workflowType,
          remoteProcessCode: api.workflowType,
          remoteProcessName: api.description,
          processCategory: api.workflowCategory,
          sourceHash,
          sourceVersion: '1',
          metadata: {
            apiPath: api.path,
            apiMethod: api.method,
            confidence: api.confidence,
          },
          lastSchemaSyncAt: new Date(),
        },
        update: {
          remoteProcessCode: api.workflowType,
          remoteProcessName: api.description,
          processCategory: api.workflowCategory,
          sourceHash,
          sourceVersion: '1',
          metadata: {
            apiPath: api.path,
            apiMethod: api.method,
            confidence: api.confidence,
          },
          lastSchemaSyncAt: new Date(),
        },
      });

      // 创建或更新ProcessTemplate
      const template = await this.prisma.processTemplate.upsert({
        where: {
          connectorId_processCode_version: {
            connectorId,
            processCode: api.workflowType,
            version: 1,
          },
        },
        create: {
          tenantId,
          connectorId,
          remoteProcessId: remoteProcess.id,
          processCode: api.workflowType,
          processName: api.description,
          processCategory: api.workflowCategory,
          version: 1,
          status: 'draft',
          falLevel: 'F1', // 默认智能填表级别
          sourceHash,
          sourceVersion: '1',
          schema: {
            fields: schemaFields,
          },
          rules: null,
          permissions: null,
          uiHints: {
            apiPath: api.path,
            apiMethod: api.method,
            confidence: api.confidence,
            validationResult: validation || null,
          },
          lastSyncedAt: new Date(),
        },
        update: {
          remoteProcessId: remoteProcess.id,
          processName: api.description,
          processCategory: api.workflowCategory,
          sourceHash,
          schema: {
            fields: schemaFields,
          },
          uiHints: {
            apiPath: api.path,
            apiMethod: api.method,
            confidence: api.confidence,
            validationResult: validation || null,
          },
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await this.prisma.remoteProcess.update({
        where: { id: remoteProcess.id },
        data: {
          latestTemplateId: template.id,
        },
      });

      stored.push(template);
    }

    return stored;
  }

  /**
   * 将API参数转换为表单Schema
   */
  private convertParametersToSchema(parameters: any[], requestBody: any): any[] {
    const fields: any[] = [];

    // 处理URL参数和查询参数
    for (const param of parameters || []) {
      fields.push({
        key: param.name,
        label: param.description || param.name,
        type: this.mapApiTypeToFieldType(param.type),
        required: param.required || false,
        defaultValue: null,
        validation: param.required ? { required: true } : null,
      });
    }

    // 处理请求体
    if (requestBody?.properties) {
      for (const [key, value] of Object.entries(requestBody.properties)) {
        const prop = value as any;
        fields.push({
          key,
          label: prop.description || key,
          type: this.mapApiTypeToFieldType(prop.type),
          required: requestBody.required?.includes(key) || false,
          defaultValue: prop.default || null,
          validation: requestBody.required?.includes(key)
            ? { required: true }
            : null,
        });
      }
    }

    return fields;
  }

  /**
   * 映射API类型到表单字段类型
   */
  private mapApiTypeToFieldType(apiType: string): string {
    const typeMap: Record<string, string> = {
      string: 'text',
      number: 'number',
      integer: 'number',
      boolean: 'checkbox',
      array: 'select',
      object: 'json',
      file: 'file',
    };

    return typeMap[apiType] || 'text';
  }

  private computeSourceHash(input: Record<string, any>) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  /**
   * 获取上传历史
   */
  async getUploadHistory(tenantId: string, connectorId: string) {
    return this.prisma.processTemplate.findMany({
      where: {
        tenantId,
        connectorId,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        processCode: true,
        processName: true,
        processCategory: true,
        status: true,
        falLevel: true,
        uiHints: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
