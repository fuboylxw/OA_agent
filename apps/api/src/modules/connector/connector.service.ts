import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateConnectorDto, UpdateConnectorDto } from './dto';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';

@Injectable()
export class ConnectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRuntimeService: AdapterRuntimeService,
  ) {}

  async create(dto: CreateConnectorDto, tenantId: string) {
    const { publicAuthConfig, secretRef } = this.splitAuthConfig(dto.authConfig);

    return this.prisma.$transaction(async (tx) => {
      const connector = await tx.connector.create({
        data: {
          tenantId,
          name: dto.name,
          oaType: dto.oaType,
          oaVendor: dto.oaVendor,
          oaVersion: dto.oaVersion,
          baseUrl: dto.baseUrl,
          authType: dto.authType,
          authConfig: publicAuthConfig,
          healthCheckUrl: dto.healthCheckUrl,
          oclLevel: dto.oclLevel,
          falLevel: dto.falLevel,
          status: 'active',
        },
      });

      await tx.connectorCapability.create({
        data: {
          tenantId,
          connectorId: connector.id,
          ...this.inferCapabilities(dto),
        },
      });

      if (secretRef) {
        await tx.connectorSecretRef.create({
          data: {
            tenantId,
            connectorId: connector.id,
            ...secretRef,
          },
        });
      }

      return connector;
    });
  }

  async list(tenantId: string) {
    return this.prisma.connector.findMany({
      where: {
        tenantId,
        bootstrapJobs: {
          some: {},
        },
      },
      include: {
        capability: true,
        secretRef: true,
        processTemplates: {
          where: { status: 'published' },
          orderBy: [
            { updatedAt: 'desc' },
            { version: 'desc' },
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, tenantId: string) {
    const connector = await this.prisma.connector.findFirst({
      where: {
        id,
        tenantId,
        bootstrapJobs: {
          some: {},
        },
      },
      include: {
        capability: true,
        secretRef: true,
        processTemplates: {
          where: { status: 'published' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    return connector;
  }

  async update(id: string, tenantId: string, dto: UpdateConnectorDto) {
    const existing = await this.prisma.connector.findFirst({
      where: { id, tenantId },
      include: {
        capability: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Connector not found');
    }

    const { publicAuthConfig, secretRef } = this.splitAuthConfig(dto.authConfig);

    return this.prisma.$transaction(async (tx) => {
      const connector = await tx.connector.update({
        where: { id },
        data: {
          name: dto.name,
          oaType: dto.oaType,
          oaVendor: dto.oaVendor,
          oaVersion: dto.oaVersion,
          baseUrl: dto.baseUrl,
          authType: dto.authType,
          authConfig: dto.authConfig ? publicAuthConfig : undefined,
          healthCheckUrl: dto.healthCheckUrl,
          oclLevel: dto.oclLevel,
          falLevel: dto.falLevel,
          status: dto.status,
        },
      });

      if (dto.authConfig) {
        if (secretRef) {
          await tx.connectorSecretRef.upsert({
            where: { connectorId: id },
            create: {
              tenantId: existing.tenantId,
              connectorId: id,
              ...secretRef,
            },
            update: secretRef,
          });
        } else {
          await tx.connectorSecretRef.deleteMany({
            where: { connectorId: id },
          });
        }
      }

      if (dto.oaType ?? dto.authType ?? dto.oclLevel ?? dto.falLevel) {
        await tx.connectorCapability.upsert({
          where: { connectorId: id },
          create: {
            tenantId: existing.tenantId,
            connectorId: id,
            ...this.inferCapabilities({
              name: connector.name,
              oaType: dto.oaType ?? connector.oaType,
              oaVendor: dto.oaVendor ?? connector.oaVendor ?? undefined,
              oaVersion: dto.oaVersion ?? connector.oaVersion ?? undefined,
              baseUrl: dto.baseUrl ?? connector.baseUrl,
              authType: dto.authType ?? connector.authType,
              authConfig: dto.authConfig ?? (connector.authConfig as Record<string, any>),
              healthCheckUrl: dto.healthCheckUrl ?? connector.healthCheckUrl ?? undefined,
              oclLevel: dto.oclLevel ?? connector.oclLevel,
              falLevel: dto.falLevel ?? connector.falLevel ?? undefined,
            }, existing.capability?.metadata as Record<string, any> | undefined),
          },
          update: this.inferCapabilities({
            name: connector.name,
            oaType: dto.oaType ?? connector.oaType,
            oaVendor: dto.oaVendor ?? connector.oaVendor ?? undefined,
            oaVersion: dto.oaVersion ?? connector.oaVersion ?? undefined,
            baseUrl: dto.baseUrl ?? connector.baseUrl,
            authType: dto.authType ?? connector.authType,
            authConfig: dto.authConfig ?? (connector.authConfig as Record<string, any>),
            healthCheckUrl: dto.healthCheckUrl ?? connector.healthCheckUrl ?? undefined,
            oclLevel: dto.oclLevel ?? connector.oclLevel,
            falLevel: dto.falLevel ?? connector.falLevel ?? undefined,
          }, existing.capability?.metadata as Record<string, any> | undefined),
        });
      }

      return connector;
    });
  }

  async delete(id: string, tenantId: string) {
    const connector = await this.prisma.connector.findFirst({
      where: { id, tenantId },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    // 所有关联表均已配置 onDelete: Cascade，数据库自动级联删除：
    // Connector → ProcessTemplate → Submission → SubmissionStatus/SubmissionEvent
    //                             → ProcessDraft
    //           → MCPTool, RemoteProcess, SyncLog, SyncCursor, SyncJob,
    //             WebhookInbox, ReferenceDataset → ReferenceItem,
    //             ConnectorCapability, ConnectorSecretRef
    return this.prisma.connector.delete({ where: { id } });
  }

  async healthCheck(id: string, tenantId: string) {
    const connector = await this.get(id, tenantId);

    const adapter = await this.adapterRuntimeService.createAdapterForConnector(id, []);
    const result = await adapter.healthCheck();

    // Update last health check time
    await this.prisma.connector.update({
      where: { id },
      data: {
        lastHealthCheck: new Date(),
        status: result.healthy ? 'active' : 'inactive',
      },
    });

    return result;
  }

  private inferCapabilities(
    dto: CreateConnectorDto | UpdateConnectorDto,
    existingMetadata?: Record<string, any>,
  ) {
    const oclLevel = dto.oclLevel || 'OCL0';
    const supportsRead = ['OCL2', 'OCL3', 'OCL4', 'OCL5'].includes(oclLevel);
    const supportsWrite = ['OCL3', 'OCL4', 'OCL5'].includes(oclLevel);
    const supportsAdvanced = ['OCL4', 'OCL5'].includes(oclLevel);

    return {
      supportsDiscovery: true,
      supportsSchemaSync: supportsRead,
      supportsReferenceSync: supportsRead,
      supportsStatusPull: supportsRead,
      supportsWebhook: supportsAdvanced,
      supportsCancel: supportsWrite,
      supportsUrge: supportsWrite,
      supportsDelegate: supportsAdvanced,
      supportsSupplement: supportsAdvanced,
      supportsRealtimePerm: dto.oaType === 'hybrid' || supportsAdvanced,
      supportsIdempotency: supportsAdvanced,
      syncModes: supportsAdvanced ? ['full', 'incremental'] : ['full'],
      metadata: {
        ...(existingMetadata || {}),
        inferredFrom: existingMetadata ? 'connector_update' : 'connector_create',
        oclLevel,
        syncPolicy: existingMetadata?.syncPolicy || this.buildDefaultSyncPolicy({
          supportsSchemaSync: supportsRead,
          supportsReferenceSync: supportsRead,
          supportsStatusPull: supportsRead,
        }),
      },
    };
  }

  private buildDefaultSyncPolicy(input: {
    supportsSchemaSync: boolean;
    supportsReferenceSync: boolean;
    supportsStatusPull: boolean;
  }) {
    return {
      enabled: true,
      domains: {
        schema: {
          enabled: input.supportsSchemaSync,
          intervalMinutes: 360,
        },
        reference: {
          enabled: input.supportsReferenceSync,
          intervalMinutes: 120,
        },
        status: {
          enabled: input.supportsStatusPull,
          intervalMinutes: 10,
        },
      },
    };
  }

  private splitAuthConfig(authConfig?: Record<string, any>) {
    if (!authConfig) {
      return {
        publicAuthConfig: {},
        secretRef: null as null | {
          secretProvider: string;
          secretPath: string;
          secretVersion?: string;
        },
      };
    }

    const {
      secretProvider,
      secretPath,
      secretVersion,
      ...publicAuthConfig
    } = authConfig;

    if (secretProvider && secretPath) {
      return {
        publicAuthConfig,
        secretRef: {
          secretProvider,
          secretPath,
          secretVersion,
        },
      };
    }

    return {
      publicAuthConfig: authConfig,
      secretRef: null,
    };
  }
}
