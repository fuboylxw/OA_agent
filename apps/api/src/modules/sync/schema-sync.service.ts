import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import {
  buildFlowChangeSummary,
  createDeterministicHash,
  mergeDiscoveredFlowUiHints,
  normalizeProcessName,
  type FlowDiscoverySnapshot,
} from '@uniflow/shared-types';

@Injectable()
export class SchemaSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRuntimeService: AdapterRuntimeService,
  ) {}

  async run(syncJob: {
    id: string;
    tenantId: string;
    connectorId: string;
  }) {
    const syncedAt = new Date();
    const adapter = await this.adapterRuntimeService.createAdapterForConnector(syncJob.connectorId, []);
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

    let processed = 0;
    let versionedTemplates = 0;
    const seenRemoteProcessIds = new Set<string>();
    const templatesByProcessCode = this.groupTemplatesByProcessCode(templates);
    const remoteProcessMap = new Map(
      remoteProcesses.map((remoteProcess) => [remoteProcess.remoteProcessId, remoteProcess]),
    );

    for (const flow of discoveredFlows) {
      const latestTemplate = templatesByProcessCode.get(flow.flowCode)?.[0];
      const existingRemoteProcess = remoteProcessMap.get(flow.flowCode);
      const sourceHash = this.computeSourceHash(flow);
      const existingFlow = this.extractKnownFlow(existingRemoteProcess, latestTemplate);
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
          processCategory: latestTemplate?.processCategory || existingRemoteProcess?.processCategory,
          sourceVersion: discovery.oaVersion || 'live',
          sourceHash,
          latestTemplateId: latestTemplate?.id,
          status: 'active',
          metadata: {
            ...((existingRemoteProcess?.metadata as Record<string, any> | null) || {}),
            flow,
            discoveredBy: 'schema_sync',
          },
          lastSchemaSyncAt: syncedAt,
          lastDriftCheckAt: syncedAt,
        },
        update: {
          remoteProcessCode: flow.flowCode,
          remoteProcessName: flow.flowName,
          processCategory: latestTemplate?.processCategory || existingRemoteProcess?.processCategory,
          sourceVersion: discovery.oaVersion || 'live',
          sourceHash,
          latestTemplateId: latestTemplate?.id,
          status: 'active',
          metadata: {
            ...((existingRemoteProcess?.metadata as Record<string, any> | null) || {}),
            flow,
            discoveredBy: 'schema_sync',
          },
          lastSchemaSyncAt: syncedAt,
          lastDriftCheckAt: syncedAt,
        },
      });
      seenRemoteProcessIds.add(flow.flowCode);

      if (latestTemplate && latestTemplate.sourceHash !== sourceHash) {
        const changeSummary = buildFlowChangeSummary(existingFlow, flow);
        const versionedTemplate = await this.prisma.processTemplate.create({
          data: {
            tenantId: latestTemplate.tenantId,
            connectorId: latestTemplate.connectorId,
            remoteProcessId: remoteProcess.id,
            processCode: latestTemplate.processCode,
            processName: flow.flowName || latestTemplate.processName,
            processCategory: latestTemplate.processCategory || existingRemoteProcess?.processCategory,
            description: latestTemplate.description,
            version: latestTemplate.version + 1,
            status: 'draft',
            falLevel: latestTemplate.falLevel,
            sourceHash,
            sourceVersion: discovery.oaVersion || latestTemplate.sourceVersion || String(latestTemplate.version + 1),
            reviewStatus: 'review',
            changeSummary: changeSummary as any,
            supersedesId: latestTemplate.id,
            schema: latestTemplate.schema as any,
            rules: latestTemplate.rules as any,
            permissions: latestTemplate.permissions as any,
            uiHints: mergeDiscoveredFlowUiHints(latestTemplate.uiHints as Record<string, any> | null, flow),
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
      } else if (latestTemplate) {
        await this.prisma.processTemplate.update({
          where: { id: latestTemplate.id },
          data: {
            remoteProcessId: remoteProcess.id,
            processName: flow.flowName || latestTemplate.processName,
            sourceHash,
            sourceVersion: discovery.oaVersion || latestTemplate.sourceVersion,
            uiHints: mergeDiscoveredFlowUiHints(latestTemplate.uiHints as Record<string, any> | null, flow),
            lastSyncedAt: syncedAt,
          },
        });
      }

      processed += 1;
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
      processedTemplates: processed,
      remoteProcessesUpserted: processed,
      driftedTemplates: versionedTemplates,
      reviewRequiredTemplates: versionedTemplates,
      deprecatedRemoteProcesses: deprecatedRemoteProcesses.count,
      cursorValue: new Date().toISOString(),
      lastVersion: discovery.oaVersion || String(processed),
      cursorMetadata: {
        processedTemplates: processed,
        driftedTemplates: versionedTemplates,
        deprecatedRemoteProcesses: deprecatedRemoteProcesses.count,
        oaVendor: discovery.oaVendor,
      },
    };
  }

  private computeSourceHash(input: FlowDiscoverySnapshot) {
    return createDeterministicHash(input);
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
}
