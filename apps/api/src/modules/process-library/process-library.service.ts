import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { normalizeProcessName, parseRpaFlowDefinitions } from '@uniflow/shared-types';
import { PrismaService } from '../common/prisma.service';
import { CreateProcessTemplateDto } from './dto/create-process-template.dto';

type ProcessLibraryItem = {
  id: string;
  processCode: string;
  processName: string;
  processCategory: string | null;
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
    oaType: string;
    oclLevel: string;
  } | null;
};

@Injectable()
export class ProcessLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, category?: string, connectorId?: string) {
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
    const connector = await this.prisma.connector.findFirst({
      where: {
        id: dto.connectorId,
        tenantId,
        bootstrapJobs: {
          some: {},
        },
      },
      select: {
        id: true,
        name: true,
        oaType: true,
        baseUrl: true,
      },
    });

    if (!connector) {
      throw new NotFoundException('所属连接器不存在');
    }

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
    };

    const submitSteps = definition.actions?.submit?.steps;
    if (!Array.isArray(submitSteps) || submitSteps.length === 0) {
      throw new BadRequestException('流程定义必须包含可执行的提交步骤');
    }

    const schemaFields = (definition.fields || []).map((field, index) => ({
      key: String(field?.key || '').trim() || `field_${index + 1}`,
      label: String(field?.label || field?.key || `字段${index + 1}`).trim(),
      type: String(field?.type || 'text').trim() || 'text',
      required: Boolean(field?.required),
    }));

    const sourceHash = createHash('sha256')
      .update(JSON.stringify(definition))
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const remoteProcess = await tx.remoteProcess.upsert({
        where: {
          connectorId_remoteProcessId: {
            connectorId: connector.id,
            remoteProcessId: processCode,
          },
        },
        create: {
          tenantId,
          connectorId: connector.id,
          remoteProcessId: processCode,
          remoteProcessCode: processCode,
          remoteProcessName: processName,
          processCategory,
          sourceHash,
          sourceVersion: '1',
          status: 'active',
          metadata: {
            source: 'process_library_manual',
            description,
          },
          lastSchemaSyncAt: new Date(),
          lastDriftCheckAt: new Date(),
        },
        update: {
          remoteProcessCode: processCode,
          remoteProcessName: processName,
          processCategory,
          sourceHash,
          status: 'active',
          metadata: {
            source: 'process_library_manual',
            description,
          },
          lastSchemaSyncAt: new Date(),
          lastDriftCheckAt: new Date(),
        },
      });

      const latestTemplate = await tx.processTemplate.findFirst({
        where: {
          tenantId,
          connectorId: connector.id,
          processCode,
        },
        orderBy: {
          version: 'desc',
        },
      });

      const nextVersion = (latestTemplate?.version || 0) + 1;
      const uiHints = {
        executionModes: {
          submit: ['rpa'],
          queryStatus: definition.actions?.queryStatus ? ['rpa'] : [],
        },
        rpaDefinition: definition,
        source: 'process_library_manual',
      } as unknown as Prisma.InputJsonValue;
      const template = await tx.processTemplate.create({
        data: {
          tenantId,
          connectorId: connector.id,
          remoteProcessId: remoteProcess.id,
          processCode,
          processName,
          processCategory,
          description,
          version: nextVersion,
          status: 'published',
          falLevel: dto.falLevel || 'F2',
          sourceHash,
          sourceVersion: String(nextVersion),
          supersedesId: latestTemplate?.id,
          schema: {
            fields: schemaFields,
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
          processCode,
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

  async getByCode(tenantId: string, processCode: string, version?: number) {
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

  async getById(id: string, tenantId: string) {
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

  async listVersions(tenantId: string, processCode: string) {
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
}
