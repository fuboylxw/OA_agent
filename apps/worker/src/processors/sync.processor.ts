import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { AdapterFactory, type OAAdapter } from '@uniflow/oa-adapters';
import { recordRuntimeDiagnostic } from '@uniflow/agent-kernel';
import {
  buildFlowChangeSummary,
  buildStatusEventRemoteId,
  createDeterministicHash,
  mergeDiscoveredFlowUiHints,
  normalizeProcessName,
  type FlowDiscoverySnapshot,
} from '@uniflow/shared-types';
import { PrismaService } from '../services/prisma.service';

@Processor('sync')
@Injectable()
export class SyncProcessor {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process('run')
  async handleSync(job: Job<{ syncJobId: string }>) {
    const syncJob = await this.prisma.syncJob.findUnique({
      where: { id: job.data.syncJobId },
    });

    if (!syncJob) {
      throw new Error(`Sync job ${job.data.syncJobId} not found`);
    }

    await this.prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: 'running',
        startedAt: new Date(),
        errorMessage: null,
      },
    });

    try {
      let result: Record<string, any>;
      switch (syncJob.syncDomain) {
        case 'schema':
          result = await this.runSchemaSync(syncJob);
          break;
        case 'reference':
          result = await this.runReferenceSync(syncJob);
          break;
        case 'status':
          result = await this.runStatusSync(syncJob);
          break;
        default:
          throw new Error(`Unsupported sync domain: ${syncJob.syncDomain}`);
      }

      const finalStatus = result.failedStatuses && result.failedStatuses > 0
        ? 'partial'
        : 'succeeded';
      await this.prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          status: finalStatus,
          result,
          finishedAt: new Date(),
        },
      });

      await this.prisma.syncCursor.upsert({
        where: {
          connectorId_syncDomain: {
            connectorId: syncJob.connectorId,
            syncDomain: syncJob.syncDomain,
          },
        },
        create: {
          tenantId: syncJob.tenantId,
          connectorId: syncJob.connectorId,
          syncDomain: syncJob.syncDomain,
          cursorType: 'watermark',
          cursorValue: result.cursorValue,
          lastVersion: result.lastVersion,
          lastSuccessAt: new Date(),
          metadata: result.cursorMetadata || {},
        },
        update: {
          cursorValue: result.cursorValue,
          lastVersion: result.lastVersion,
          lastSuccessAt: new Date(),
          metadata: result.cursorMetadata || {},
        },
      });

      this.logger.log(`Sync job ${syncJob.id} completed for domain ${syncJob.syncDomain}`);
      return result;
    } catch (error: any) {
      await this.prisma.syncJob.update({
        where: { id: syncJob.id },
        data: {
          status: 'failed',
          errorMessage: error.message,
          finishedAt: new Date(),
        },
      });

      await this.prisma.syncCursor.upsert({
        where: {
          connectorId_syncDomain: {
            connectorId: syncJob.connectorId,
            syncDomain: syncJob.syncDomain,
          },
        },
        create: {
          tenantId: syncJob.tenantId,
          connectorId: syncJob.connectorId,
          syncDomain: syncJob.syncDomain,
          cursorType: 'watermark',
          lastFailureAt: new Date(),
          metadata: { errorMessage: error.message },
        },
        update: {
          lastFailureAt: new Date(),
          metadata: { errorMessage: error.message },
        },
      });

      this.logger.error(`Sync job ${syncJob.id} failed: ${error.message}`);
      recordRuntimeDiagnostic({
        source: 'worker',
        category: 'system',
        eventType: 'worker_error',
        level: 'error',
        scope: 'sync.handleSync',
        message: error.message,
        tenantId: syncJob.tenantId,
        data: {
          syncJobId: syncJob.id,
          connectorId: syncJob.connectorId,
          syncDomain: syncJob.syncDomain,
          stack: error.stack,
        },
      });
      throw error;
    }
  }

  private async runSchemaSync(syncJob: {
    id: string;
    tenantId: string;
    connectorId: string;
  }) {
    const syncedAt = new Date();
    const adapter = await this.createAdapterForConnector(syncJob.connectorId);
    const discovery = await adapter.discover();
    const discoveredFlows = discovery.discoveredFlows.map((flow) => ({
      ...flow,
      flowName: normalizeProcessName({
        processName: flow.flowName,
        processCode: flow.flowCode,
      }),
    }));
    const [templates, remoteProcesses] = await Promise.all([
      this.prisma.processTemplate.findMany({
        where: {
          tenantId: syncJob.tenantId,
          connectorId: syncJob.connectorId,
        },
        orderBy: [
          { processCode: 'asc' },
          { version: 'desc' },
        ],
      }),
      this.prisma.remoteProcess.findMany({
        where: {
          tenantId: syncJob.tenantId,
          connectorId: syncJob.connectorId,
        },
      }),
    ]);

    let processedTemplates = 0;
    let versionedTemplates = 0;
    const seenRemoteProcessIds = new Set<string>();
    const templatesByProcessCode = this.groupTemplatesByProcessCode(templates);
    const remoteProcessMap = new Map(
      remoteProcesses.map((remoteProcess) => [remoteProcess.remoteProcessId, remoteProcess]),
    );

    for (const flow of discoveredFlows) {
      const template = templatesByProcessCode.get(flow.flowCode)?.[0];
      const existingRemoteProcess = remoteProcessMap.get(flow.flowCode);
      const sourceHash = this.computeSourceHash(flow);
      const existingFlow = this.extractKnownFlow(existingRemoteProcess, template);
      const remoteProcess = await this.prisma.remoteProcess.upsert({
        where: {
          connectorId_remoteProcessId: {
            connectorId: syncJob.connectorId,
            remoteProcessId: flow.flowCode,
          },
        },
        create: {
          tenantId: syncJob.tenantId,
          connectorId: syncJob.connectorId,
          remoteProcessId: flow.flowCode,
          remoteProcessCode: flow.flowCode,
          remoteProcessName: flow.flowName,
          processCategory: template?.processCategory || existingRemoteProcess?.processCategory,
          sourceVersion: discovery.oaVersion || 'live',
          sourceHash,
          latestTemplateId: template?.id,
          status: 'active',
          metadata: {
            ...((existingRemoteProcess?.metadata as Record<string, any> | null) || {}),
            flow,
            discoveredBy: 'worker_sync',
          },
          lastSchemaSyncAt: syncedAt,
          lastDriftCheckAt: syncedAt,
        },
        update: {
          remoteProcessCode: flow.flowCode,
          remoteProcessName: flow.flowName,
          processCategory: template?.processCategory || existingRemoteProcess?.processCategory,
          sourceVersion: discovery.oaVersion || 'live',
          sourceHash,
          latestTemplateId: template?.id,
          status: 'active',
          metadata: {
            ...((existingRemoteProcess?.metadata as Record<string, any> | null) || {}),
            flow,
            discoveredBy: 'worker_sync',
          },
          lastSchemaSyncAt: syncedAt,
          lastDriftCheckAt: syncedAt,
        },
      });
      seenRemoteProcessIds.add(flow.flowCode);

      if (template && template.sourceHash !== sourceHash) {
        const changeSummary = buildFlowChangeSummary(existingFlow, flow);
        const versionedTemplate = await this.prisma.processTemplate.create({
          data: {
            tenantId: template.tenantId,
            connectorId: template.connectorId,
            remoteProcessId: remoteProcess.id,
            processCode: template.processCode,
            processName: flow.flowName || template.processName,
            processCategory: template.processCategory || existingRemoteProcess?.processCategory,
            description: template.description,
            version: template.version + 1,
            status: 'draft',
            falLevel: template.falLevel,
            sourceHash,
            sourceVersion: discovery.oaVersion || template.sourceVersion || String(template.version + 1),
            reviewStatus: 'review',
            changeSummary: changeSummary as any,
            supersedesId: template.id,
            schema: template.schema as any,
            rules: template.rules as any,
            permissions: template.permissions as any,
            uiHints: mergeDiscoveredFlowUiHints(template.uiHints as Record<string, any> | null, flow),
            lastSyncedAt: syncedAt,
          },
        });

        await this.prisma.remoteProcess.update({
          where: { id: remoteProcess.id },
          data: {
            latestTemplateId: versionedTemplate.id,
            sourceVersion: discovery.oaVersion || remoteProcess.sourceVersion,
            lastDriftCheckAt: syncedAt,
          },
        });
        templatesByProcessCode.set(flow.flowCode, [versionedTemplate, ...(templatesByProcessCode.get(flow.flowCode) || [])]);
        versionedTemplates += 1;
      } else if (template) {
        await this.prisma.processTemplate.update({
          where: { id: template.id },
          data: {
            remoteProcessId: remoteProcess.id,
            processName: flow.flowName || template.processName,
            sourceHash,
            sourceVersion: discovery.oaVersion || template.sourceVersion,
            uiHints: mergeDiscoveredFlowUiHints(template.uiHints as Record<string, any> | null, flow),
            lastSyncedAt: syncedAt,
          },
        });
      }

      processedTemplates += 1;
    }

    const deprecatedRemoteProcesses = await this.prisma.remoteProcess.updateMany({
      where: {
        tenantId: syncJob.tenantId,
        connectorId: syncJob.connectorId,
        remoteProcessId: {
          notIn: Array.from(seenRemoteProcessIds),
        },
        status: {
          not: 'deprecated',
        },
      },
      data: {
        status: 'deprecated',
        lastDriftCheckAt: syncedAt,
      },
    });

    return {
      syncJobId: syncJob.id,
      syncDomain: 'schema',
      discoveredFlows: discoveredFlows.length,
      processedTemplates,
      remoteProcessesUpserted: processedTemplates,
      driftedTemplates: versionedTemplates,
      reviewRequiredTemplates: versionedTemplates,
      deprecatedRemoteProcesses: deprecatedRemoteProcesses.count,
      cursorValue: new Date().toISOString(),
      lastVersion: discovery.oaVersion || String(processedTemplates),
      cursorMetadata: {
        processedTemplates,
        driftedTemplates: versionedTemplates,
        deprecatedRemoteProcesses: deprecatedRemoteProcesses.count,
        oaVendor: discovery.oaVendor,
      },
    };
  }

  private async runReferenceSync(syncJob: {
    id: string;
    tenantId: string;
    connectorId: string;
  }) {
    const syncedAt = new Date();
    const adapter = await this.createAdapterForConnector(syncJob.connectorId);
    const supportedDatasets = ['department', 'user'];
    let syncedDatasets = 0;
    let syncedItems = 0;
    let deactivatedItems = 0;

    for (const datasetCode of supportedDatasets) {
      if (!adapter.listReferenceData) {
        continue;
      }

      try {
        const dataset = await adapter.listReferenceData(datasetCode);
        const sourceHash = createHash('sha256')
          .update(JSON.stringify(dataset.items))
          .digest('hex');

        const storedDataset = await this.prisma.referenceDataset.upsert({
          where: {
            connectorId_datasetCode: {
              connectorId: syncJob.connectorId,
              datasetCode: dataset.datasetCode,
            },
          },
          create: {
            tenantId: syncJob.tenantId,
            connectorId: syncJob.connectorId,
            datasetCode: dataset.datasetCode,
            datasetName: dataset.datasetName,
            datasetType: dataset.datasetType,
            syncMode: dataset.syncMode,
            sourceVersion: dataset.sourceVersion,
            sourceHash,
            lastSyncedAt: syncedAt,
          },
          update: {
            datasetName: dataset.datasetName,
            datasetType: dataset.datasetType,
            syncMode: dataset.syncMode,
            sourceVersion: dataset.sourceVersion,
            sourceHash,
            lastSyncedAt: syncedAt,
          },
        });
        const activeItemIds: string[] = [];

        for (const item of dataset.items) {
          const itemId = this.buildReferenceItemId(storedDataset.id, item.remoteItemId, item.itemKey);
          await this.prisma.referenceItem.upsert({
            where: {
              id: itemId,
            },
            create: {
              id: itemId,
              datasetId: storedDataset.id,
              remoteItemId: item.remoteItemId,
              itemKey: item.itemKey,
              itemLabel: item.itemLabel,
              itemValue: item.itemValue,
              parentKey: item.parentKey,
              payload: item.payload,
            },
            update: {
              itemLabel: item.itemLabel,
              itemValue: item.itemValue,
              parentKey: item.parentKey,
              payload: item.payload,
              status: 'active',
            },
          });
          activeItemIds.push(itemId);
          syncedItems += 1;
        }

        if (dataset.syncMode !== 'incremental') {
          const staleItems = await this.prisma.referenceItem.updateMany({
            where: {
              datasetId: storedDataset.id,
              id: {
                notIn: activeItemIds,
              },
              status: 'active',
            },
            data: {
              status: 'inactive',
            },
          });
          deactivatedItems += staleItems.count;
        }

        syncedDatasets += 1;
      } catch {
        // Ignore unsupported datasets for the current adapter.
      }
    }

    return {
      syncJobId: syncJob.id,
      syncDomain: 'reference',
      syncedDatasets,
      syncedItems,
      deactivatedItems,
      cursorValue: new Date().toISOString(),
      lastVersion: String(syncedItems),
      cursorMetadata: {
        syncedDatasets,
        syncedItems,
        deactivatedItems,
      },
    };
  }

  private async runStatusSync(syncJob: {
    id: string;
    tenantId: string;
    connectorId: string;
  }) {
    const templateIds = await this.prisma.processTemplate.findMany({
      where: {
        tenantId: syncJob.tenantId,
        connectorId: syncJob.connectorId,
      },
      select: { id: true },
    });

    const submissions = await this.prisma.submission.findMany({
      where: {
        tenantId: syncJob.tenantId,
        templateId: { in: templateIds.map((item) => item.id) },
        status: { in: ['pending', 'submitted'] },
      },
      select: {
        id: true,
        status: true,
        oaSubmissionId: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    const adapter = await this.createAdapterForConnector(syncJob.connectorId);
    let syncedStatuses = 0;
    let failedStatuses = 0;
    let deduplicatedStatuses = 0;

    for (const submission of submissions) {
      if (!submission.oaSubmissionId) {
        continue;
      }

      try {
        const result = await adapter.queryStatus(submission.oaSubmissionId);
        const remoteEventId = buildStatusEventRemoteId(submission.oaSubmissionId, result as Record<string, any>);
        const eventCreated = await this.createSubmissionEvent({
          data: {
            tenantId: syncJob.tenantId,
            submissionId: submission.id,
            eventType: 'status_synced',
            eventSource: 'oa_pull',
            remoteEventId,
            eventTime: new Date(),
            status: result.status,
            payload: result as any,
          },
        });

        if (eventCreated) {
          await this.prisma.submissionStatus.create({
            data: {
              submissionId: submission.id,
              status: result.status,
              statusDetail: result as any,
            },
          });
          syncedStatuses += 1;
        } else {
          deduplicatedStatuses += 1;
        }
        await this.prisma.submission.update({
          where: { id: submission.id },
          data: {
            status: this.mapOAStatusToSubmissionStatus(result.status, submission.status),
          },
        });
      } catch {
        failedStatuses += 1;
      }
    }

    return {
      syncJobId: syncJob.id,
      syncDomain: 'status',
      candidateSubmissions: submissions.length,
      oaTrackedSubmissions: submissions.filter((item) => !!item.oaSubmissionId).length,
      syncedStatuses,
      failedStatuses,
      deduplicatedStatuses,
      cursorValue: new Date().toISOString(),
      lastVersion: submissions[0]?.updatedAt.toISOString() || null,
      cursorMetadata: {
        candidateSubmissions: submissions.length,
        syncedStatuses,
        failedStatuses,
        deduplicatedStatuses,
      },
    };
  }

  private computeSourceHash(input: FlowDiscoverySnapshot) {
    return createDeterministicHash(input);
  }

  private async createAdapterForConnector(connectorId: string): Promise<OAAdapter> {
    const connector = await this.prisma.connector.findUnique({
      where: { id: connectorId },
      include: {
        secretRef: true,
      },
    });

    if (!connector) {
      throw new Error(`Connector ${connectorId} not found`);
    }

    const authConfig = await this.resolveAuthConfig(
      connector.id,
      connector.authType,
      connector.authConfig as any,
      connector.secretRef,
    );
    return AdapterFactory.createAdapter({
      oaVendor: connector.oaVendor || undefined,
      oaType: connector.oaType as 'openapi' | 'form-page' | 'hybrid',
      baseUrl: connector.baseUrl,
      authType: connector.authType,
      authConfig,
    });
  }

  private async resolveAuthConfig(
    connectorId: string,
    authType: string,
    authConfig: Record<string, any>,
    secretRef?: { secretProvider: string; secretPath: string } | null,
  ) {
    if (!secretRef || secretRef.secretProvider !== 'env') {
      return authConfig || {};
    }

    const raw = process.env[secretRef.secretPath];
    if (raw) {
      return this.mapRawSecret(authType, authConfig, raw);
    }

    const latestPublishedJob = await this.prisma.bootstrapJob.findFirst({
      where: {
        connectorId,
        status: {
          in: ['PUBLISHED', 'PARTIALLY_PUBLISHED'],
        },
      },
      orderBy: [
        { completedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        authConfig: true,
      },
    });

    const fallbackAuthConfig = latestPublishedJob?.authConfig;
    if (fallbackAuthConfig && typeof fallbackAuthConfig === 'object' && !Array.isArray(fallbackAuthConfig)) {
      const sensitiveKeys = new Set([
        'password',
        'token',
        'appSecret',
        'accessToken',
        'refreshToken',
        'secret',
        'serviceToken',
        'ticketHeaderValue',
      ]);
      const authSecrets = Object.fromEntries(
        Object.entries(fallbackAuthConfig as Record<string, any>).filter(([key, value]) =>
          sensitiveKeys.has(key) && value !== undefined && value !== null && value !== ''
        ),
      );
      const fallbackPlatformConfig = (fallbackAuthConfig as Record<string, any>).platformConfig;
      const platformSecrets = fallbackPlatformConfig
        && typeof fallbackPlatformConfig === 'object'
        && !Array.isArray(fallbackPlatformConfig)
        ? Object.fromEntries(
            Object.entries(fallbackPlatformConfig as Record<string, any>).filter(([key, value]) =>
              sensitiveKeys.has(key) && value !== undefined && value !== null && value !== ''
            ),
          )
        : null;

      return this.mergeAuthConfig(authConfig || {}, {
        ...authSecrets,
        ...(platformSecrets && Object.keys(platformSecrets).length > 0
          ? { platformConfig: platformSecrets }
          : {}),
      });
    }

    return authConfig || {};
  }

  private mapRawSecret(
    authType: string,
    authConfig: Record<string, any>,
    raw: string,
  ) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return this.mergeAuthConfig(authConfig || {}, parsed as Record<string, any>);
      }
    } catch {
      // Fall back to auth type mapping below.
    }

    if (authType === 'apikey') {
      return {
        ...(authConfig || {}),
        token: raw,
      };
    }
    if (authType === 'oauth2') {
      return {
        ...(authConfig || {}),
        accessToken: raw,
      };
    }
    if (authType === 'basic' || authType === 'cookie') {
      return {
        ...(authConfig || {}),
        password: raw,
      };
    }

    return authConfig || {};
  }

  private mergeAuthConfig(
    baseConfig: Record<string, any>,
    resolvedSecret: Record<string, any>,
  ) {
    const merged = {
      ...baseConfig,
      ...resolvedSecret,
    };

    const basePlatformConfig = baseConfig.platformConfig;
    const secretPlatformConfig = resolvedSecret.platformConfig;
    if (
      (basePlatformConfig && typeof basePlatformConfig === 'object' && !Array.isArray(basePlatformConfig))
      || (secretPlatformConfig && typeof secretPlatformConfig === 'object' && !Array.isArray(secretPlatformConfig))
    ) {
      merged.platformConfig = {
        ...((basePlatformConfig as Record<string, any> | undefined) || {}),
        ...((secretPlatformConfig as Record<string, any> | undefined) || {}),
      };
    }

    return merged;
  }

  private buildReferenceItemId(datasetId: string, remoteItemId?: string, itemKey?: string) {
    return `${datasetId}:${remoteItemId || itemKey || 'unknown'}`;
  }

  private async createSubmissionEvent(input: {
    data: Prisma.SubmissionEventUncheckedCreateInput;
  }) {
    try {
      await this.prisma.submissionEvent.create(input);
      return true;
    } catch (error) {
      if (this.isDuplicateSubmissionEventError(error)) {
        return false;
      }
      throw error;
    }
  }

  private mapOAStatusToSubmissionStatus(oaStatus: string, fallbackStatus: string) {
    const normalized = (oaStatus || '').toLowerCase();

    if (!normalized) return fallbackStatus;
    if (['error', 'failed', 'failure'].includes(normalized)) return 'failed';
    if (['cancelled', 'canceled', 'revoked'].includes(normalized)) return 'cancelled';
    if (normalized.includes('reject')) return 'failed';
    if (normalized.includes('approve') || normalized.includes('finish') || normalized.includes('complete')) {
      return 'approved';
    }
    if (normalized.includes('pending') || normalized.includes('review') || normalized.includes('process')) {
      return 'submitted';
    }

    return fallbackStatus;
  }

  private groupTemplatesByProcessCode(templates: Array<any>) {
    return templates.reduce<Map<string, Array<any>>>((acc, template) => {
      const current = acc.get(template.processCode) || [];
      current.push(template);
      acc.set(template.processCode, current);
      return acc;
    }, new Map());
  }

  private extractKnownFlow(remoteProcess: any, latestTemplate: any): FlowDiscoverySnapshot | null {
    const remoteFlow = (remoteProcess?.metadata as Record<string, any> | null)?.flow;
    if (remoteFlow?.flowCode) {
      return {
        flowCode: remoteFlow.flowCode,
        flowName: remoteFlow.flowName || latestTemplate?.processName || remoteProcess?.remoteProcessName,
        entryUrl: remoteFlow.entryUrl,
        submitUrl: remoteFlow.submitUrl,
        queryUrl: remoteFlow.queryUrl,
      };
    }

    if (!latestTemplate && !remoteProcess) {
      return null;
    }

    const discoveryHints = (latestTemplate?.uiHints as Record<string, any> | null)?.discovery?.flow;
    return {
      flowCode: latestTemplate?.processCode || remoteProcess?.remoteProcessId,
      flowName: discoveryHints?.flowName || latestTemplate?.processName || remoteProcess?.remoteProcessName,
      entryUrl: discoveryHints?.entryUrl || null,
      submitUrl: discoveryHints?.submitUrl || null,
      queryUrl: discoveryHints?.queryUrl || null,
    };
  }

  private isDuplicateSubmissionEventError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
