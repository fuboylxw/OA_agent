import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { normalizeProcessName, parseRpaFlowDefinitions } from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { CreateProcessTemplateDto } from './dto/create-process-template.dto';
import { resolveAllowedIdentityScopes } from '../common/identity-scope.util';
import {
  buildProcessLibraryFlowDefinitions,
  type ProcessLibraryApiToolDefinition,
  type ProcessLibraryAccessMode,
  type ProcessLibraryAuthoringMode,
  type ProcessLibraryInputMethod,
} from './process-library-authoring.util';

type ProcessLibraryItem = {
  id: string;
  processCode: string;
  processName: string;
  processCategory: string | null;
  description: string | null;
  version: number;
  status: string;
  falLevel: string | null;
  uiHints: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
  sourceType: 'published';
  connector?: {
    id: string;
    name: string;
    identityScope: string;
    oaType: string;
    oclLevel: string;
  } | null;
};

type ProcessLibraryAccessContext = {
  identityType?: string;
  roles?: string[];
};

type ManualProcessTemplatePayload = {
  connectorId: string;
  processCode: string;
  processName: string;
  processCategory: string | null;
  description: string | null;
  falLevel: string;
  accessMode: ProcessLibraryAccessMode;
  authoringMode: ProcessLibraryAuthoringMode;
  inputMethod: ProcessLibraryInputMethod;
  authoringText: string | null;
  definition: Record<string, any>;
  apiTools: ProcessLibraryApiToolDefinition[];
  schemaFields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
  }>;
  sourceHash: string;
  hasApiSubmit: boolean;
  hasApiQuery: boolean;
  hasUrlSubmit: boolean;
  hasUrlQuery: boolean;
  hasRpaSubmit: boolean;
  hasRpaQuery: boolean;
};

@Injectable()
export class ProcessLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    category?: string,
    connectorId?: string,
    access?: ProcessLibraryAccessContext,
  ) {
    const connectorScopeFilter = this.buildConnectorScopeFilter(access);
    const publishedTemplates = await this.prisma.processTemplate.findMany({
      where: {
        tenantId,
        status: 'published',
        connector: {
          is: {
            tenantId,
            bootstrapJobs: {
              some: {},
            },
            ...(connectorScopeFilter || {}),
          },
        },
        ...(category && { processCategory: category }),
        ...(connectorId && { connectorId }),
      },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            identityScope: true,
            oaType: true,
            oclLevel: true,
          },
        },
      },
      orderBy: [
        { processCategory: 'asc' },
        { processName: 'asc' },
      ],
    });

    const publishedItems: ProcessLibraryItem[] = publishedTemplates.map((template) => ({
      id: template.id,
      processCode: template.processCode,
      processName: normalizeProcessName({
        processName: template.processName,
        processCode: template.processCode,
      }),
      processCategory: template.processCategory || null,
      description: template.description || null,
      version: template.version,
      status: template.status,
      falLevel: template.falLevel,
      uiHints: (template.uiHints as Record<string, any> | null) || null,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      sourceType: 'published',
      connector: template.connector,
    }));

    return [...publishedItems].sort((a, b) => {
      const categoryCompare = (a.processCategory || '').localeCompare(b.processCategory || '', 'zh-CN');
      if (categoryCompare !== 0) {
        return categoryCompare;
      }

      return a.processName.localeCompare(b.processName, 'zh-CN');
    });
  }

  async createManualProcessTemplate(tenantId: string, dto: CreateProcessTemplateDto) {
    const connector = await this.getManageableConnector(tenantId, dto.connectorId);
    const payload = this.buildManualTemplatePayload(dto, connector);
    return this.publishManualProcessTemplate(tenantId, connector, payload);
  }

  async updateManualProcessTemplate(tenantId: string, templateId: string, dto: CreateProcessTemplateDto) {
    const existing = await this.prisma.processTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
      },
      select: {
        id: true,
        connectorId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('要修改的流程不存在');
    }

    if (existing.connectorId !== dto.connectorId) {
      throw new BadRequestException('修改流程时不允许变更所属连接器');
    }

    const connector = await this.getManageableConnector(tenantId, dto.connectorId);
    const payload = this.buildManualTemplatePayload(dto, connector);
    return this.publishManualProcessTemplate(tenantId, connector, payload, templateId);
  }

  async archiveManualProcessTemplate(tenantId: string, templateId: string) {
    const existing = await this.prisma.processTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
      },
      select: {
        id: true,
        connectorId: true,
        processCode: true,
        remoteProcessId: true,
        status: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('要删除的流程不存在');
    }

    return this.prisma.$transaction(async (tx) => {
      const archived = await tx.processTemplate.updateMany({
        where: {
          tenantId,
          connectorId: existing.connectorId,
          processCode: existing.processCode,
          NOT: {
            status: 'archived',
          },
        },
        data: {
          status: 'archived',
        },
      });

      if (existing.remoteProcessId) {
        await tx.remoteProcess.update({
          where: {
            id: existing.remoteProcessId,
          },
          data: {
            latestTemplateId: null,
            status: 'disabled',
          },
        });
      }

      if (tx.mCPTool?.updateMany) {
        await tx.mCPTool.updateMany({
          where: {
            connectorId: existing.connectorId,
            flowCode: existing.processCode,
            toolName: {
              startsWith: `manual_${existing.processCode}_`,
            },
          },
          data: {
            enabled: false,
          },
        });
      }

      return {
        success: true,
        archivedCount: archived.count,
        processCode: existing.processCode,
      };
    });
  }

  async getByCode(
    tenantId: string,
    processCode: string,
    version?: number,
    access?: ProcessLibraryAccessContext,
  ) {
    const connectorScopeFilter = this.buildConnectorScopeFilter(access);
    const template = await this.prisma.processTemplate.findFirst({
      where: {
        tenantId,
        processCode,
        status: 'published',
        connector: {
          is: {
            tenantId,
            bootstrapJobs: {
              some: {},
            },
            ...(connectorScopeFilter || {}),
          },
        },
        ...(version && { version }),
      },
      include: {
        connector: true,
      },
      orderBy: {
        version: 'desc',
      },
    });

    if (!template) {
      throw new NotFoundException('Process template not found');
    }

    return template;
  }

  async getById(id: string, tenantId: string, access?: ProcessLibraryAccessContext) {
    const connectorScopeFilter = this.buildConnectorScopeFilter(access);
    const template = await this.prisma.processTemplate.findFirst({
      where: {
        id,
        tenantId,
        connector: {
          is: {
            tenantId,
            bootstrapJobs: {
              some: {},
            },
            ...(connectorScopeFilter || {}),
          },
        },
      },
      include: {
        connector: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Process template not found');
    }

    return template;
  }

  async listVersions(tenantId: string, processCode: string, access?: ProcessLibraryAccessContext) {
    const connectorScopeFilter = this.buildConnectorScopeFilter(access);
    return this.prisma.processTemplate.findMany({
      where: {
        tenantId,
        processCode,
        connector: {
          is: {
            tenantId,
            bootstrapJobs: {
              some: {},
            },
            ...(connectorScopeFilter || {}),
          },
        },
      },
      orderBy: {
        version: 'desc',
      },
    });
  }

  private normalizeProcessCode(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private buildConnectorScopeFilter(access?: ProcessLibraryAccessContext) {
    if (access?.roles?.some((role) => role === 'admin' || role === 'flow_manager')) {
      return undefined;
    }

    return {
      identityScope: {
        in: resolveAllowedIdentityScopes(access?.identityType),
      },
    } satisfies Prisma.ConnectorWhereInput;
  }

  private isDirectLinkDefinition(definition: Record<string, any> | null | undefined) {
    if (!definition || typeof definition !== 'object') {
      return false;
    }

    const metadata = definition.metadata && typeof definition.metadata === 'object'
      ? definition.metadata as Record<string, any>
      : {};
    const accessMode = String(definition.accessMode || metadata.accessMode || '').trim().toLowerCase();
    const sourceType = String(definition.sourceType || metadata.sourceType || '').trim().toLowerCase();

    return accessMode === 'direct_link' || sourceType === 'direct_link';
  }

  private hasNetworkRequest(value: unknown) {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && typeof (value as Record<string, any>).url === 'string'
      && (value as Record<string, any>).url.trim(),
    );
  }

  private async getManageableConnector(tenantId: string, connectorId: string) {
    const connector = await this.prisma.connector.findFirst({
      where: {
        id: connectorId,
        tenantId,
        bootstrapJobs: {
          some: {},
        },
      },
      select: {
        id: true,
        name: true,
        identityScope: true,
        oaType: true,
        baseUrl: true,
      },
    });

    if (!connector) {
      throw new NotFoundException('所属连接器不存在');
    }

    return connector;
  }

  private buildManualTemplatePayload(
    dto: CreateProcessTemplateDto,
    connector: {
      id: string;
      name: string;
      identityScope: string | null;
      oaType: string;
      baseUrl: string | null;
    },
  ): ManualProcessTemplatePayload {
    const processCode = this.normalizeProcessCode(dto.processCode);
    const processName = dto.processName.trim();

    if (!processCode) {
      throw new BadRequestException('流程编码不能为空');
    }

    if (!processName) {
      throw new BadRequestException('流程名称不能为空');
    }

    const hintedDefinitions = parseRpaFlowDefinitions(dto.rpaFlowContent);
    const resolvedAccessMode = dto.accessMode === 'rpa' || dto.accessMode === 'url' || dto.accessMode === 'api'
      ? dto.accessMode
      : (hintedDefinitions.some((definition) => this.isDirectLinkDefinition(definition as Record<string, any>)) ? 'url' : 'rpa');
    const resolvedAuthoringMode = dto.authoringMode === 'json' ? 'json' : 'text';
    const resolvedInputMethod: ProcessLibraryInputMethod = dto.inputMethod === 'file' ? 'file' : 'manual';
    const parsed = buildProcessLibraryFlowDefinitions({
      content: dto.rpaFlowContent,
      accessMode: resolvedAccessMode,
      authoringMode: resolvedAuthoringMode,
      connectorBaseUrl: connector.baseUrl,
      processName,
      processCode,
    });

    if (parsed.definitions.length !== 1) {
      throw new BadRequestException('单个添加流程只能提交一个流程定义');
    }

    const baseDefinition = parsed.definitions[0];
    const processCategory = dto.processCategory?.trim() || baseDefinition.category || null;
    const description = dto.description?.trim() || baseDefinition.description || null;

    const definition = {
      ...baseDefinition,
      processCode,
      processName,
      ...(processCategory ? { category: processCategory } : {}),
      ...(description ? { description } : {}),
    } as Record<string, any>;

    const directLinkDefinition = this.isDirectLinkDefinition(definition);
    const submitSteps = definition.actions?.submit?.steps;
    const hasApiSubmit = resolvedAccessMode === 'api'
      && Array.isArray(parsed.apiTools)
      && parsed.apiTools.some((tool) => tool.category === 'submit');
    const hasApiQuery = resolvedAccessMode === 'api'
      && Array.isArray(parsed.apiTools)
      && parsed.apiTools.some((tool) => tool.category === 'query');
    const hasRpaSubmit = resolvedAccessMode !== 'api'
      && !directLinkDefinition
      && Array.isArray(submitSteps)
      && submitSteps.length > 0;
    const hasUrlSubmit = directLinkDefinition && this.hasNetworkRequest(definition.runtime?.networkSubmit);
    if (!hasApiSubmit && !hasRpaSubmit && !hasUrlSubmit) {
      throw new BadRequestException(
        resolvedAccessMode === 'api'
          ? 'API 流程至少需要提供一个提交接口'
          : directLinkDefinition
          ? '链接直达流程定义必须包含网络提交定义'
          : '流程定义必须包含可执行的提交步骤',
      );
    }

    const hasRpaQuery = resolvedAccessMode !== 'api'
      && !directLinkDefinition
      && Array.isArray(definition.actions?.queryStatus?.steps)
      && definition.actions.queryStatus.steps.length > 0;
    const hasUrlQuery = directLinkDefinition && this.hasNetworkRequest(definition.runtime?.networkStatus);

    const schemaFields = (definition.fields || []).map((field: any, index: number) => ({
      key: String(field?.key || '').trim() || `field_${index + 1}`,
      label: String(field?.label || field?.key || `字段${index + 1}`).trim(),
      type: String(field?.type || 'text').trim() || 'text',
      required: Boolean(field?.required),
      defaultValue: field?.defaultValue,
      options: Array.isArray(field?.options)
        ? field.options.map((option: any) => {
            if (typeof option === 'string') {
              const normalized = option.trim();
              return normalized
                ? {
                    label: normalized,
                    value: normalized,
                  }
                : null;
            }

            const label = String(option?.label || option?.value || '').trim();
            const value = String(option?.value || option?.label || '').trim();
            return label && value
              ? { label, value }
              : null;
          }).filter(Boolean)
        : undefined,
      validation: Array.isArray(field?.validation) ? field.validation : undefined,
      description: typeof field?.description === 'string' ? field.description.trim() : undefined,
      example: typeof field?.example === 'string' ? field.example.trim() : undefined,
      multiple: field?.multiple === true,
      uiHints: field?.uiHints && typeof field.uiHints === 'object' && !Array.isArray(field.uiHints)
        ? field.uiHints
        : undefined,
    }));

    const sourceHash = createHash('sha256')
      .update(JSON.stringify(definition))
      .digest('hex');

    return {
      connectorId: dto.connectorId,
      processCode,
      processName,
      processCategory,
      description,
      falLevel: dto.falLevel || 'F2',
      accessMode: resolvedAccessMode === 'api'
        ? 'api'
        : (directLinkDefinition ? 'url' : 'rpa'),
      authoringMode: parsed.normalizedAuthoringMode,
      inputMethod: resolvedInputMethod,
      authoringText: parsed.authoringText
        ? this.syncAuthoringTextTemplate(parsed.authoringText, { processName, processCode, description })
        : null,
      definition,
      apiTools: Array.isArray(parsed.apiTools) ? parsed.apiTools : [],
      schemaFields,
      sourceHash,
      hasApiSubmit,
      hasApiQuery,
      hasUrlSubmit,
      hasUrlQuery,
      hasRpaSubmit,
      hasRpaQuery,
    };
  }

  private syncAuthoringTextTemplate(
    source: string,
    input: {
      processName: string;
      processCode: string;
      description: string | null;
    },
  ) {
    const lines = String(source || '').split(/\r?\n/);
    const nextLines = [...lines];

    const replaceOrInsert = (pattern: RegExp, value: string, insertIndex: number) => {
      const index = nextLines.findIndex((line) => pattern.test(String(line || '').trim()));
      if (index >= 0) {
        nextLines[index] = value;
        return;
      }
      nextLines.splice(insertIndex, 0, value);
    };

    replaceOrInsert(/^(?:#{1,6}\s*)?流程\s*(?:[:：]|\s+)/u, `流程: ${input.processName}`, 0);

    const flowLineIndex = nextLines.findIndex((line) => /^(?:#{1,6}\s*)?流程\s*(?:[:：]|\s+)/u.test(String(line || '').trim()));
    replaceOrInsert(/^(?:流程编码|processCode)\s*[:：]/iu, `流程编码: ${input.processCode}`, flowLineIndex >= 0 ? flowLineIndex + 1 : 1);

    const descriptionIndex = nextLines.findIndex((line) => /^(?:描述|说明|简介|流程描述|description)\s*[:：]/iu.test(String(line || '').trim()));
    if (input.description) {
      const normalizedDescription = `描述: ${input.description}`;
      if (descriptionIndex >= 0) {
        nextLines[descriptionIndex] = normalizedDescription;
      } else {
        const processCodeIndex = nextLines.findIndex((line) => /^(?:流程编码|processCode)\s*[:：]/iu.test(String(line || '').trim()));
        nextLines.splice(processCodeIndex >= 0 ? processCodeIndex + 1 : 2, 0, normalizedDescription);
      }
    } else if (descriptionIndex >= 0) {
      nextLines.splice(descriptionIndex, 1);
    }

    return nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private async publishManualProcessTemplate(
    tenantId: string,
    connector: {
      id: string;
      name: string;
      identityScope: string | null;
      oaType: string;
      baseUrl: string | null;
    },
    payload: ManualProcessTemplatePayload,
    expectedSupersedesId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const latestTemplate = await tx.processTemplate.findFirst({
        where: {
          tenantId,
          connectorId: connector.id,
          processCode: payload.processCode,
        },
        orderBy: {
          version: 'desc',
        },
      });

      if (expectedSupersedesId && latestTemplate && latestTemplate.id !== expectedSupersedesId) {
        throw new BadRequestException('当前流程已有更新版本，请刷新后重试');
      }

      const remoteProcess = await tx.remoteProcess.upsert({
        where: {
          connectorId_remoteProcessId: {
            connectorId: connector.id,
            remoteProcessId: payload.processCode,
          },
        },
        create: {
          tenantId,
          connectorId: connector.id,
          remoteProcessId: payload.processCode,
          remoteProcessCode: payload.processCode,
          remoteProcessName: payload.processName,
          processCategory: payload.processCategory,
          sourceHash: payload.sourceHash,
          sourceVersion: '1',
          status: 'active',
          metadata: {
            source: 'process_library_manual',
            description: payload.description,
          },
          lastSchemaSyncAt: new Date(),
          lastDriftCheckAt: new Date(),
        },
        update: {
          remoteProcessCode: payload.processCode,
          remoteProcessName: payload.processName,
          processCategory: payload.processCategory,
          sourceHash: payload.sourceHash,
          status: 'active',
          metadata: {
            source: 'process_library_manual',
            description: payload.description,
          },
          lastSchemaSyncAt: new Date(),
          lastDriftCheckAt: new Date(),
        },
      });

      await this.syncManualApiTools(tx, {
        tenantId,
        connectorId: connector.id,
        processCode: payload.processCode,
        schemaFields: payload.schemaFields,
        apiTools: payload.accessMode === 'api' ? payload.apiTools : [],
      });

      const nextVersion = (latestTemplate?.version || 0) + 1;
      const submitModes = payload.hasApiSubmit
        ? ['api']
        : (payload.hasUrlSubmit ? ['url'] : (payload.hasRpaSubmit ? ['rpa'] : []));
      const queryModes = payload.hasApiQuery
        ? ['api']
        : (payload.hasUrlQuery ? ['url'] : (payload.hasRpaQuery ? ['rpa'] : []));
      const primaryApiTool = payload.apiTools.find((tool) => tool.category === 'submit');
      const uiHints = {
        executionModes: {
          submit: submitModes,
          queryStatus: queryModes,
        },
        rpaDefinition: payload.definition,
        source: 'process_library_manual',
        ...(primaryApiTool
          ? {
              apiMethod: primaryApiTool.httpMethod,
              apiPath: primaryApiTool.apiEndpoint,
              endpoints: this.buildApiUiHintsEndpoints(payload.apiTools),
            }
          : {}),
        authoring: {
          mode: payload.authoringMode,
          accessMode: payload.accessMode,
          inputMethod: payload.inputMethod,
          textTemplate: payload.authoringText,
        },
      } as unknown as Prisma.InputJsonValue;

      const template = await tx.processTemplate.create({
        data: {
          tenantId,
          connectorId: connector.id,
          remoteProcessId: remoteProcess.id,
          processCode: payload.processCode,
          processName: payload.processName,
          processCategory: payload.processCategory,
          description: payload.description,
          version: nextVersion,
          status: 'published',
          falLevel: payload.falLevel,
          sourceHash: payload.sourceHash,
          sourceVersion: String(nextVersion),
          supersedesId: latestTemplate?.id,
          schema: {
            fields: payload.schemaFields,
          },
          rules: null,
          permissions: null,
          uiHints,
          lastSyncedAt: new Date(),
          publishedAt: new Date(),
        },
        include: {
          connector: {
            select: {
              id: true,
              name: true,
              oaType: true,
              oclLevel: true,
            },
          },
        },
      });

      await tx.processTemplate.updateMany({
        where: {
          tenantId,
          connectorId: connector.id,
          processCode: payload.processCode,
          status: 'published',
          NOT: { id: template.id },
        },
        data: {
          status: 'archived',
        },
      });

      await tx.remoteProcess.update({
        where: { id: remoteProcess.id },
        data: {
          latestTemplateId: template.id,
          sourceVersion: String(template.version),
        },
      });

      return template;
    });
  }

  private async syncManualApiTools(
    tx: any,
    input: {
      tenantId: string;
      connectorId: string;
      processCode: string;
      schemaFields: ManualProcessTemplatePayload['schemaFields'];
      apiTools: ProcessLibraryApiToolDefinition[];
    },
  ) {
    if (!tx?.mCPTool) {
      return;
    }

    const expectedToolNames = input.apiTools.map((tool) => tool.toolName);
    for (const tool of input.apiTools) {
      await tx.mCPTool.upsert({
        where: {
          connectorId_toolName: {
            connectorId: input.connectorId,
            toolName: tool.toolName,
          },
        },
        create: {
          tenantId: input.tenantId,
          connectorId: input.connectorId,
          toolName: tool.toolName,
          toolDescription: tool.toolDescription,
          toolSchema: this.buildManualApiToolSchema(input.schemaFields, tool.category),
          apiEndpoint: tool.apiEndpoint,
          httpMethod: tool.httpMethod,
          headers: tool.headers || {},
          bodyTemplate: tool.bodyTemplate || null,
          paramMapping: tool.paramMapping,
          responseMapping: tool.responseMapping,
          flowCode: input.processCode,
          category: tool.category,
          enabled: true,
          testInput: tool.testInput || null,
          testOutput: null,
        },
        update: {
          toolDescription: tool.toolDescription,
          toolSchema: this.buildManualApiToolSchema(input.schemaFields, tool.category),
          apiEndpoint: tool.apiEndpoint,
          httpMethod: tool.httpMethod,
          headers: tool.headers || {},
          bodyTemplate: tool.bodyTemplate || null,
          paramMapping: tool.paramMapping,
          responseMapping: tool.responseMapping,
          flowCode: input.processCode,
          category: tool.category,
          enabled: true,
          testInput: tool.testInput || null,
          updatedAt: new Date(),
        },
      });
    }

    if (tx.mCPTool.updateMany) {
      await tx.mCPTool.updateMany({
        where: {
          connectorId: input.connectorId,
          flowCode: input.processCode,
          toolName: {
            startsWith: `manual_${input.processCode}_`,
          },
          ...(expectedToolNames.length > 0
            ? {
                NOT: {
                  toolName: {
                    in: expectedToolNames,
                  },
                },
              }
            : {}),
        },
        data: {
          enabled: false,
        },
      });
    }
  }

  private buildManualApiToolSchema(
    schemaFields: ManualProcessTemplatePayload['schemaFields'],
    category: ProcessLibraryApiToolDefinition['category'],
  ) {
    if (category === 'query') {
      return {
        type: 'object',
        properties: {
          submissionId: {
            type: 'string',
            description: '业务系统中的申请单号或提交流水号',
          },
        },
        required: ['submissionId'],
      };
    }

    return {
      type: 'object',
      properties: Object.fromEntries(schemaFields.map((field) => [
        field.key,
        {
          type: field.type === 'number' ? 'number' : 'string',
          description: field.label,
        },
      ])),
      required: schemaFields.filter((field) => field.required).map((field) => field.key),
    };
  }

  private buildApiUiHintsEndpoints(apiTools: ProcessLibraryApiToolDefinition[]) {
    return apiTools.map((tool) => ({
      toolName: tool.toolName,
      category: tool.category === 'query' ? 'query' : 'submit',
      method: tool.httpMethod,
      path: tool.apiEndpoint,
    }));
  }
}
