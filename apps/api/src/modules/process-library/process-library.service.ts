import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { normalizeProcessName, parseRpaFlowDefinitions } from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { CreateProcessTemplateDto } from './dto/create-process-template.dto';
import { resolveAllowedIdentityScopes } from '../common/identity-scope.util';

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
  definition: Record<string, any>;
  schemaFields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
  }>;
  sourceHash: string;
  hasUrlSubmit: boolean;
  hasUrlQuery: boolean;
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
    const payload = this.buildManualTemplatePayload(dto);
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
    const payload = this.buildManualTemplatePayload(dto);
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

  private buildManualTemplatePayload(dto: CreateProcessTemplateDto): ManualProcessTemplatePayload {
    const definitions = parseRpaFlowDefinitions(dto.rpaFlowContent);
    if (definitions.length !== 1) {
      throw new BadRequestException('单个添加流程只能提交一个流程定义');
    }

    const baseDefinition = definitions[0];
    const processCode = this.normalizeProcessCode(dto.processCode);
    const processName = dto.processName.trim();
    const processCategory = dto.processCategory?.trim() || baseDefinition.category || null;
    const description = dto.description?.trim() || baseDefinition.description || null;

    if (!processCode) {
      throw new BadRequestException('流程编码不能为空');
    }

    if (!processName) {
      throw new BadRequestException('流程名称不能为空');
    }

    const definition = {
      ...baseDefinition,
      processCode,
      processName,
      ...(processCategory ? { category: processCategory } : {}),
      ...(description ? { description } : {}),
    } as Record<string, any>;

    const directLinkDefinition = this.isDirectLinkDefinition(definition);
    const submitSteps = definition.actions?.submit?.steps;
    const hasRpaSubmit = !directLinkDefinition && Array.isArray(submitSteps) && submitSteps.length > 0;
    const hasUrlSubmit = directLinkDefinition && this.hasNetworkRequest(definition.runtime?.networkSubmit);
    if (!hasRpaSubmit && !hasUrlSubmit) {
      throw new BadRequestException(
        directLinkDefinition
          ? '链接直达流程定义必须包含网络提交定义'
          : '流程定义必须包含可执行的提交步骤',
      );
    }

    const hasRpaQuery = !directLinkDefinition
      && Array.isArray(definition.actions?.queryStatus?.steps)
      && definition.actions.queryStatus.steps.length > 0;
    const hasUrlQuery = directLinkDefinition && this.hasNetworkRequest(definition.runtime?.networkStatus);

    const schemaFields = (definition.fields || []).map((field: any, index: number) => ({
      key: String(field?.key || '').trim() || `field_${index + 1}`,
      label: String(field?.label || field?.key || `字段${index + 1}`).trim(),
      type: String(field?.type || 'text').trim() || 'text',
      required: Boolean(field?.required),
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
      definition,
      schemaFields,
      sourceHash,
      hasUrlSubmit,
      hasUrlQuery,
      hasRpaQuery,
    };
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

      const nextVersion = (latestTemplate?.version || 0) + 1;
      const uiHints = {
        executionModes: {
          submit: payload.hasUrlSubmit ? ['url'] : ['rpa'],
          queryStatus: payload.hasUrlQuery ? ['url'] : (payload.hasRpaQuery ? ['rpa'] : []),
        },
        rpaDefinition: payload.definition,
        source: 'process_library_manual',
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
}
