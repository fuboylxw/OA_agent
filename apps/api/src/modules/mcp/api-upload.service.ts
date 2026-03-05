import { Injectable } from '@nestjs/common';
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
    console.log(`[ApiUpload] Starting upload for connector ${dto.connectorId}`);

    // 1. 解析API文档
    console.log(`[ApiUpload] Step 1: Parsing API documentation`);
    const parsedDoc = await this.apiDocParser.execute(
      {
        docType: dto.docType,
        docContent: dto.docContent,
        oaUrl: dto.oaUrl,
      },
      { traceId: `upload-${Date.now()}` },
    );

    console.log(`[ApiUpload] Parsed ${parsedDoc.endpoints.length} endpoints`);

    // 2. 识别办事流程接口
    console.log(`[ApiUpload] Step 2: Identifying workflow APIs`);
    const identificationResult = await this.workflowIdentifier.execute(
      { endpoints: parsedDoc.endpoints },
      { traceId: `upload-${Date.now()}` },
    );

    console.log(
      `[ApiUpload] Identified ${identificationResult.workflowApis.length} workflow APIs`,
    );

    // 3. 验证接口（如果启用）
    const validationResults: any[] = [];
    if (dto.autoValidate) {
      console.log(`[ApiUpload] Step 3: Validating workflow APIs`);
      for (const workflowApi of identificationResult.workflowApis) {
        try {
          const validationResult = await this.apiValidator.execute(
            {
              baseUrl: parsedDoc.baseUrl,
              authConfig: dto.authConfig,
              endpoint: {
                path: workflowApi.path,
                method: workflowApi.method,
                parameters: workflowApi.parameters,
                requestBody: workflowApi.requestBody,
              },
            },
            { traceId: `upload-${Date.now()}` },
          );

          validationResults.push({
            path: workflowApi.path,
            method: workflowApi.method,
            ...validationResult,
          });
        } catch (error: any) {
          console.error(
            `[ApiUpload] Validation failed for ${workflowApi.path}:`,
            error.message,
          );
          validationResults.push({
            path: workflowApi.path,
            method: workflowApi.method,
            isAccessible: false,
            errorMessage: error.message,
          });
        }
      }
    }

    // 4. 存储到数据库
    console.log(`[ApiUpload] Step 4: Storing workflow APIs to database`);
    const storedApis = await this.storeWorkflowApis(
      dto.tenantId,
      dto.connectorId,
      identificationResult.workflowApis,
      validationResults,
    );

    // 5. 自动生成MCP工具（如果启用）
    const mcpTools: any[] = [];
    if (dto.autoGenerateMcp) {
      console.log(`[ApiUpload] Step 5: Generating MCP tools`);
      for (const workflowApi of identificationResult.workflowApis) {
        try {
          const mcpTool = await this.mcpToolGenerator.generateFromWorkflowApi(
            dto.tenantId,
            dto.connectorId,
            workflowApi,
            parsedDoc.baseUrl,
            dto.authConfig,
          );
          mcpTools.push(mcpTool);
        } catch (error: any) {
          console.error(
            `[ApiUpload] MCP tool generation failed for ${workflowApi.path}:`,
            error.message,
          );
        }
      }
    }

    const result: ApiUploadResult = {
      uploadId: `upload-${Date.now()}`,
      totalEndpoints: parsedDoc.endpoints.length,
      workflowEndpoints: identificationResult.workflowApis.length,
      validatedEndpoints: validationResults.filter(v => v.isAccessible).length,
      generatedMcpTools: mcpTools.length,
      workflowApis: identificationResult.workflowApis,
      validationResults,
      mcpTools,
    };

    console.log(`[ApiUpload] Upload completed:`, {
      totalEndpoints: result.totalEndpoints,
      workflowEndpoints: result.workflowEndpoints,
      validatedEndpoints: result.validatedEndpoints,
      generatedMcpTools: result.generatedMcpTools,
    });

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

      // 创建或更新ProcessTemplate
      const template = await this.prisma.processTemplate.upsert({
        where: {
          tenantId_processCode_version: {
            tenantId,
            processCode: api.workflowType,
            version: 1,
          },
        },
        create: {
          tenantId,
          connectorId,
          processCode: api.workflowType,
          processName: api.description,
          processCategory: api.workflowCategory,
          version: 1,
          status: 'draft',
          falLevel: 'F1', // 默认智能填表级别
          schema: {
            fields: this.convertParametersToSchema(api.parameters, api.requestBody),
          },
          rules: null,
          permissions: null,
          uiHints: {
            apiPath: api.path,
            apiMethod: api.method,
            confidence: api.confidence,
            validationResult: validation || null,
          },
        },
        update: {
          processName: api.description,
          processCategory: api.workflowCategory,
          schema: {
            fields: this.convertParametersToSchema(api.parameters, api.requestBody),
          },
          uiHints: {
            apiPath: api.path,
            apiMethod: api.method,
            confidence: api.confidence,
            validationResult: validation || null,
          },
          updatedAt: new Date(),
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
    };

    return typeMap[apiType] || 'text';
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