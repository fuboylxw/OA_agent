import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SyncCursorService } from './sync-cursor.service';
import { SchemaSyncService } from './schema-sync.service';
import { ReferenceSyncService } from './reference-sync.service';
import { StatusSyncService } from './status-sync.service';

export const SYNC_DOMAINS = ['schema', 'reference', 'status'] as const;
export type SyncDomain = typeof SYNC_DOMAINS[number];

export const SYNC_TRIGGER_TYPES = ['manual', 'schedule', 'repair', 'webhook'] as const;
export type SyncTriggerType = typeof SYNC_TRIGGER_TYPES[number];

interface EnqueueSyncInput {
  connectorId: string;
  syncDomain: SyncDomain;
  triggerType?: SyncTriggerType;
  scope?: Record<string, any>;
  requestedBy?: string;
  jobId?: string;
}

interface SyncDomainScheduleConfig {
  enabled?: boolean;
  intervalMinutes?: number;
  scope?: Record<string, any>;
}

export interface SyncScheduleConfig {
  enabled?: boolean;
  domains?: Partial<Record<SyncDomain, SyncDomainScheduleConfig>>;
  updatedAt?: string;
  updatedBy?: string;
}

type ConnectorCapabilityView = {
  connectorId: string;
  supportsSchemaSync: boolean;
  supportsReferenceSync: boolean;
  supportsStatusPull: boolean;
  metadata?: Prisma.JsonValue | null;
};

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly syncCursorService: SyncCursorService,
    private readonly schemaSyncService: SchemaSyncService,
    private readonly referenceSyncService: ReferenceSyncService,
    private readonly statusSyncService: StatusSyncService,
    @InjectQueue('sync') private readonly syncQueue: Queue,
  ) {}

  async enqueue(input: EnqueueSyncInput) {
    this.assertSyncDomain(input.syncDomain);

    const connector = await this.prisma.connector.findUnique({
      where: { id: input.connectorId },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    const cursor = await this.syncCursorService.getOrCreate(
      connector.tenantId,
      connector.id,
      input.syncDomain,
    );

    let created = true;
    let syncJob;
    try {
      syncJob = await this.prisma.syncJob.create({
        data: {
          ...(input.jobId ? { id: input.jobId } : {}),
          tenantId: connector.tenantId,
          connectorId: connector.id,
          syncDomain: input.syncDomain,
          triggerType: input.triggerType || 'manual',
          status: 'pending',
          scope: input.scope || null,
          cursorSnapshot: {
            cursorType: cursor.cursorType,
            cursorValue: cursor.cursorValue,
            lastVersion: cursor.lastVersion,
            metadata: cursor.metadata,
          },
        },
      });
    } catch (error) {
      if (!input.jobId || !this.isDuplicateKeyError(error)) {
        throw error;
      }

      created = false;
      syncJob = await this.prisma.syncJob.findUnique({
        where: { id: input.jobId },
      });
      if (!syncJob) {
        throw error;
      }
    }

    await this.syncQueue.add(
      'run',
      { syncJobId: syncJob.id },
      {
        jobId: `sync:${syncJob.id}`,
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    );

    await this.auditService.createLog({
      tenantId: connector.tenantId,
      traceId: `sync-${syncJob.id}`,
      userId: input.requestedBy,
      action: created ? 'sync_enqueued' : 'sync_reused',
      resource: connector.id,
      result: 'success',
      details: {
        syncJobId: syncJob.id,
        syncDomain: input.syncDomain,
        triggerType: syncJob.triggerType,
        duplicate: !created,
      },
    });

    return syncJob;
  }

  async execute(syncJobId: string) {
    const syncJob = await this.prisma.syncJob.findUnique({
      where: { id: syncJobId },
      include: {
        connector: {
          include: {
            capability: true,
          },
        },
      },
    });

    if (!syncJob) {
      throw new NotFoundException('Sync job not found');
    }

    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: 'running',
        startedAt: new Date(),
        errorMessage: null,
      },
    });

    try {
      let result: Record<string, any>;
      switch (syncJob.syncDomain as SyncDomain) {
        case 'schema':
          result = await this.schemaSyncService.run(syncJob);
          break;
        case 'reference':
          result = await this.referenceSyncService.run(syncJob);
          break;
        case 'status':
          result = await this.statusSyncService.run(syncJob);
          break;
        default:
          throw new BadRequestException(`Unsupported sync domain: ${syncJob.syncDomain}`);
      }
      const finalStatus = result.failedStatuses && result.failedStatuses > 0
        ? 'partial'
        : 'succeeded';

      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: finalStatus,
          result,
          finishedAt: new Date(),
        },
      });

      await this.syncCursorService.markSuccess(
        syncJob.tenantId,
        syncJob.connectorId,
        syncJob.syncDomain,
        result.cursorValue,
        result.lastVersion,
        result.cursorMetadata,
      );

      return result;
    } catch (error: any) {
      await this.prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'failed',
          errorMessage: error.message,
          finishedAt: new Date(),
        },
      });

      await this.syncCursorService.markFailure(
        syncJob.tenantId,
        syncJob.connectorId,
        syncJob.syncDomain,
        { errorMessage: error.message },
      );

      await this.auditService.createLog({
        tenantId: syncJob.tenantId,
        traceId: `sync-${syncJob.id}`,
        action: 'sync_failed',
        resource: syncJob.connectorId,
        result: 'error',
        details: {
          syncJobId: syncJob.id,
          syncDomain: syncJob.syncDomain,
          errorMessage: error.message,
        },
      });

      throw error;
    }
  }

  async listJobs(tenantId: string, connectorId?: string, syncDomain?: string, status?: string) {
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }

    return this.prisma.syncJob.findMany({
      where: {
        tenantId,
        ...(connectorId && { connectorId }),
        ...(syncDomain && { syncDomain }),
        ...(status && { status }),
      },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaVendor: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getJob(id: string) {
    const syncJob = await this.prisma.syncJob.findUnique({
      where: { id },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaType: true,
            oaVendor: true,
            capability: true,
          },
        },
      },
    });

    if (!syncJob) {
      throw new NotFoundException('Sync job not found');
    }

    return syncJob;
  }

  async getConfig(connectorId: string) {
    const capability = await this.prisma.connectorCapability.findUnique({
      where: { connectorId },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    if (!capability) {
      throw new NotFoundException('Connector capability not found');
    }

    return {
      connector: capability.connector,
      syncPolicy: this.normalizeSyncPolicy(this.readSyncPolicy(capability), capability),
    };
  }

  async updateConfig(connectorId: string, config: Record<string, any>) {
    const connector = await this.prisma.connector.findUnique({
      where: { id: connectorId },
      include: {
        capability: true,
      },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    const capabilityDefaults = connector.capability || this.buildCapabilityDefaults({
      connectorId: connector.id,
      oaType: connector.oaType,
      oclLevel: connector.oclLevel,
    });
    const currentMetadata = (connector.capability?.metadata as Record<string, any> | null) || {};
    const currentPolicy = this.normalizeSyncPolicy(
      this.readSyncPolicy(capabilityDefaults),
      capabilityDefaults,
    );
    const nextPolicy = this.normalizeSyncPolicy(
      {
        ...currentPolicy,
        ...config,
        domains: {
          ...(currentPolicy.domains || {}),
          ...((config?.domains as Record<string, any> | undefined) || {}),
        },
        updatedAt: new Date().toISOString(),
      },
      capabilityDefaults,
    );

    const updatedMetadata = {
      ...currentMetadata,
      syncPolicy: nextPolicy,
    } as unknown as Prisma.InputJsonValue;

    await this.prisma.connectorCapability.upsert({
      where: { connectorId },
      create: {
        tenantId: connector.tenantId,
        connectorId,
        supportsDiscovery: true,
        supportsSchemaSync: capabilityDefaults.supportsSchemaSync,
        supportsReferenceSync: capabilityDefaults.supportsReferenceSync,
        supportsStatusPull: capabilityDefaults.supportsStatusPull,
        supportsWebhook: connector.capability?.supportsWebhook ?? false,
        supportsCancel: connector.capability?.supportsCancel ?? false,
        supportsUrge: connector.capability?.supportsUrge ?? false,
        supportsDelegate: connector.capability?.supportsDelegate ?? false,
        supportsSupplement: connector.capability?.supportsSupplement ?? false,
        supportsRealtimePerm: connector.capability?.supportsRealtimePerm ?? false,
        supportsIdempotency: connector.capability?.supportsIdempotency ?? false,
        syncModes: connector.capability?.syncModes ?? ['full'],
        metadata: updatedMetadata,
      },
      update: {
        metadata: updatedMetadata,
      },
    });

    return nextPolicy;
  }

  async dispatchDueSchedules(connectorId?: string) {
    const capabilities = await this.prisma.connectorCapability.findMany({
      where: {
        ...(connectorId && { connectorId }),
        connector: {
          status: 'active',
        },
      },
      include: {
        connector: {
          select: {
            id: true,
            tenantId: true,
            name: true,
            status: true,
          },
        },
      },
      orderBy: { connectorId: 'asc' },
    });

    const now = new Date();
    let evaluated = 0;
    let enqueued = 0;
    const skipped: Array<Record<string, any>> = [];
    const jobs: Array<Record<string, any>> = [];

    for (const capability of capabilities) {
      const syncPolicy = this.normalizeSyncPolicy(this.readSyncPolicy(capability), capability);
      if (!syncPolicy.enabled) {
        continue;
      }

      for (const syncDomain of SYNC_DOMAINS) {
        const domainConfig = syncPolicy.domains?.[syncDomain];
        if (!domainConfig?.enabled) {
          continue;
        }

        evaluated += 1;
        if (!this.isDomainSupported(capability, syncDomain)) {
          skipped.push({
            connectorId: capability.connectorId,
            syncDomain,
            reason: 'unsupported_domain',
          });
          continue;
        }

        const latestJob = await this.prisma.syncJob.findFirst({
          where: {
            connectorId: capability.connectorId,
            syncDomain,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (latestJob && ['pending', 'running'].includes(latestJob.status)) {
          skipped.push({
            connectorId: capability.connectorId,
            syncDomain,
            reason: 'job_in_progress',
            syncJobId: latestJob.id,
          });
          continue;
        }

        const intervalMinutes = Math.max(domainConfig.intervalMinutes || 0, 1);
        const baseline = latestJob
          ? (latestJob.finishedAt || latestJob.startedAt || latestJob.createdAt)
          : null;
        const due = !baseline || (now.getTime() - baseline.getTime()) >= intervalMinutes * 60 * 1000;

        if (!due) {
          skipped.push({
            connectorId: capability.connectorId,
            syncDomain,
            reason: 'not_due',
            nextRunAt: new Date(baseline!.getTime() + intervalMinutes * 60 * 1000).toISOString(),
          });
          continue;
        }

        const scheduleSlot = this.computeScheduleSlot(now, intervalMinutes);
        const syncJob = await this.enqueue({
          connectorId: capability.connectorId,
          syncDomain,
          triggerType: 'schedule',
          requestedBy: 'system:scheduler',
          jobId: this.buildScheduledJobId(capability.connectorId, syncDomain, scheduleSlot),
          scope: {
            ...(domainConfig.scope || {}),
            scheduleSlot,
            intervalMinutes,
          },
        });

        enqueued += 1;
        jobs.push({
          connectorId: capability.connectorId,
          connectorName: capability.connector.name,
          syncDomain,
          syncJobId: syncJob.id,
          intervalMinutes,
          scheduleSlot,
        });
      }
    }

    return {
      evaluated,
      enqueued,
      skipped,
      jobs,
      executedAt: now.toISOString(),
    };
  }

  async listRemoteProcesses(tenantId: string, connectorId: string) {
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }

    return this.prisma.remoteProcess.findMany({
      where: {
        tenantId,
        connectorId,
      },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaVendor: true,
          },
        },
        processTemplates: {
          orderBy: { version: 'desc' },
          take: 5,
        },
      },
      orderBy: [
        { processCategory: 'asc' },
        { remoteProcessName: 'asc' },
      ],
    });
  }

  async getRemoteProcess(id: string) {
    const remoteProcess = await this.prisma.remoteProcess.findUnique({
      where: { id },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaVendor: true,
            oaType: true,
          },
        },
        processTemplates: {
          orderBy: { version: 'desc' },
        },
      },
    });

    if (!remoteProcess) {
      throw new NotFoundException('Remote process not found');
    }

    return remoteProcess;
  }

  async listReferenceDatasets(tenantId: string, connectorId: string, datasetType?: string) {
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }

    return this.prisma.referenceDataset.findMany({
      where: {
        tenantId,
        connectorId,
        ...(datasetType && { datasetType }),
      },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaVendor: true,
          },
        },
        _count: {
          select: { items: true },
        },
      },
      orderBy: [
        { datasetType: 'asc' },
        { datasetName: 'asc' },
      ],
    });
  }

  async getReferenceDataset(id: string) {
    const dataset = await this.prisma.referenceDataset.findUnique({
      where: { id },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaVendor: true,
            oaType: true,
          },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    if (!dataset) {
      throw new NotFoundException('Reference dataset not found');
    }

    return dataset;
  }

  async listReferenceItems(datasetId: string, keyword?: string, limit = 100) {
    return this.prisma.referenceItem.findMany({
      where: {
        datasetId,
        ...(keyword
          ? {
              OR: [
                { itemKey: { contains: keyword } },
                { itemLabel: { contains: keyword } },
                { itemValue: { contains: keyword } },
              ],
            }
          : {}),
      },
      orderBy: [
        { parentKey: 'asc' },
        { itemLabel: 'asc' },
      ],
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  async listCursors(tenantId: string, connectorId?: string) {
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
    }

    return this.prisma.syncCursor.findMany({
      where: {
        tenantId,
        ...(connectorId && { connectorId }),
      },
      include: {
        connector: {
          select: {
            id: true,
            name: true,
            oaVendor: true,
          },
        },
      },
      orderBy: [
        { connectorId: 'asc' },
        { syncDomain: 'asc' },
      ],
    });
  }

  getRecommendedSyncPolicy(capability: ConnectorCapabilityView) {
    return this.normalizeSyncPolicy(undefined, capability);
  }

  private assertSyncDomain(syncDomain: string): asserts syncDomain is SyncDomain {
    if (!SYNC_DOMAINS.includes(syncDomain as SyncDomain)) {
      throw new BadRequestException(`Unsupported sync domain: ${syncDomain}`);
    }
  }

  private readSyncPolicy(capability: { metadata?: Prisma.JsonValue | null }) {
    const metadata = (capability.metadata as Record<string, any> | null) || {};
    return (metadata.syncPolicy as SyncScheduleConfig | undefined) || undefined;
  }

  private normalizeSyncPolicy(
    syncPolicy: SyncScheduleConfig | undefined,
    capability: ConnectorCapabilityView,
  ): SyncScheduleConfig {
    const currentDomains = (syncPolicy?.domains || {}) as Partial<Record<SyncDomain, SyncDomainScheduleConfig>>;
    const defaultDomains: Record<SyncDomain, SyncDomainScheduleConfig> = {
      schema: {
        enabled: capability.supportsSchemaSync,
        intervalMinutes: 360,
      },
      reference: {
        enabled: capability.supportsReferenceSync,
        intervalMinutes: 120,
      },
      status: {
        enabled: capability.supportsStatusPull,
        intervalMinutes: 10,
      },
    };

    return {
      enabled: syncPolicy?.enabled !== false,
      updatedAt: syncPolicy?.updatedAt,
      updatedBy: syncPolicy?.updatedBy,
      domains: {
        schema: {
          ...defaultDomains.schema,
          ...(currentDomains.schema || {}),
          enabled: capability.supportsSchemaSync && currentDomains.schema?.enabled !== false,
        },
        reference: {
          ...defaultDomains.reference,
          ...(currentDomains.reference || {}),
          enabled: capability.supportsReferenceSync && currentDomains.reference?.enabled !== false,
        },
        status: {
          ...defaultDomains.status,
          ...(currentDomains.status || {}),
          enabled: capability.supportsStatusPull && currentDomains.status?.enabled !== false,
        },
      },
    };
  }

  private isDomainSupported(capability: ConnectorCapabilityView, syncDomain: SyncDomain) {
    switch (syncDomain) {
      case 'schema':
        return capability.supportsSchemaSync;
      case 'reference':
        return capability.supportsReferenceSync;
      case 'status':
        return capability.supportsStatusPull;
      default:
        return false;
    }
  }

  private computeScheduleSlot(now: Date, intervalMinutes: number) {
    const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;
    return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs).toISOString();
  }

  private buildScheduledJobId(connectorId: string, syncDomain: SyncDomain, scheduleSlot: string) {
    return `sync_sched_${createHash('sha256')
      .update(`${connectorId}:${syncDomain}:${scheduleSlot}`)
      .digest('hex')
      .slice(0, 32)}`;
  }

  private buildCapabilityDefaults(input: { connectorId: string; oaType: string; oclLevel: string }) {
    const supportsRead = ['OCL2', 'OCL3', 'OCL4', 'OCL5'].includes(input.oclLevel);
    const supportsWrite = ['OCL3', 'OCL4', 'OCL5'].includes(input.oclLevel);
    const supportsAdvanced = ['OCL4', 'OCL5'].includes(input.oclLevel);

    return {
      connectorId: input.connectorId,
      supportsSchemaSync: supportsRead,
      supportsReferenceSync: supportsRead,
      supportsStatusPull: supportsRead,
      supportsWebhook: supportsAdvanced,
      supportsCancel: supportsWrite,
      supportsUrge: supportsWrite,
      supportsDelegate: supportsAdvanced,
      supportsSupplement: supportsAdvanced,
      supportsRealtimePerm: input.oaType === 'hybrid' || supportsAdvanced,
      supportsIdempotency: supportsAdvanced,
      syncModes: supportsAdvanced ? ['full', 'incremental'] : ['full'],
      metadata: {
        inferredFrom: 'sync_service',
        oclLevel: input.oclLevel,
      },
    };
  }

  private isDuplicateKeyError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
