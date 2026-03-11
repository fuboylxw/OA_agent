import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';

@Injectable()
export class ReferenceSyncService {
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

  private buildReferenceItemId(datasetId: string, remoteItemId?: string, itemKey?: string) {
    return `${datasetId}:${remoteItemId || itemKey || 'unknown'}`;
  }
}
