import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import type { SyncDomain } from './sync.service';

@Injectable()
export class SyncCursorService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(tenantId: string, connectorId: string, syncDomain: SyncDomain) {
    return this.prisma.syncCursor.upsert({
      where: {
        connectorId_syncDomain: {
          connectorId,
          syncDomain,
        },
      },
      create: {
        tenantId,
        connectorId,
        syncDomain,
        cursorType: 'watermark',
        cursorValue: null,
        metadata: {},
      },
      update: {},
    });
  }

  async markSuccess(
    tenantId: string,
    connectorId: string,
    syncDomain: string,
    cursorValue?: string,
    lastVersion?: string,
    metadata?: Record<string, any>,
  ) {
    return this.prisma.syncCursor.upsert({
      where: {
        connectorId_syncDomain: {
          connectorId,
          syncDomain,
        },
      },
      create: {
        tenantId,
        connectorId,
        syncDomain,
        cursorType: 'watermark',
        cursorValue,
        lastVersion,
        lastSuccessAt: new Date(),
        metadata: metadata || {},
      },
      update: {
        cursorValue,
        lastVersion,
        lastSuccessAt: new Date(),
        metadata: metadata || {},
      },
    });
  }

  async markFailure(
    tenantId: string,
    connectorId: string,
    syncDomain: string,
    metadata?: Record<string, any>,
  ) {
    return this.prisma.syncCursor.upsert({
      where: {
        connectorId_syncDomain: {
          connectorId,
          syncDomain,
        },
      },
      create: {
        tenantId,
        connectorId,
        syncDomain,
        cursorType: 'watermark',
        lastFailureAt: new Date(),
        metadata: metadata || {},
      },
      update: {
        lastFailureAt: new Date(),
        metadata: metadata || {},
      },
    });
  }
}
