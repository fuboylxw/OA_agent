import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { v4 as uuidv4 } from 'uuid';

export interface AuditLogQuery {
  tenantId: string;
  userId?: string;
  action?: string;
  traceId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface CreateAuditLogInput {
  tenantId: string;
  traceId: string;
  userId?: string;
  action: string;
  resource?: string;
  result: 'success' | 'denied' | 'error';
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(input: CreateAuditLogInput) {
    return this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        traceId: input.traceId,
        userId: input.userId,
        action: input.action,
        resource: input.resource,
        result: input.result,
        details: input.details,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  async queryLogs(query: AuditLogQuery) {
    const where: any = {
      tenantId: query.tenantId,
    };

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.traceId) {
      where.traceId = query.traceId;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = query.startDate;
      }
      if (query.endDate) {
        where.createdAt.lte = query.endDate;
      }
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit || 100,
        skip: query.offset || 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      total,
      limit: query.limit || 100,
      offset: query.offset || 0,
    };
  }

  async getTrace(tenantId: string, traceId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        traceId,
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      traceId,
      logs,
      timeline: logs.map(log => ({
        timestamp: log.createdAt,
        action: log.action,
        result: log.result,
        resource: log.resource,
      })),
    };
  }

  async getStats(query: { tenantId: string; startDate?: Date; endDate?: Date }) {
    const where: any = {
      tenantId: query.tenantId,
    };

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = query.startDate;
      }
      if (query.endDate) {
        where.createdAt.lte = query.endDate;
      }
    }

    const [total, byAction, byResult] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.groupBy({
        by: ['action'],
        where,
        _count: true,
      }),
      this.prisma.auditLog.groupBy({
        by: ['result'],
        where,
        _count: true,
      }),
    ]);

    return {
      total,
      byAction: byAction.map(item => ({
        action: item.action,
        count: item._count,
      })),
      byResult: byResult.map(item => ({
        result: item.result,
        count: item._count,
      })),
    };
  }

  generateTraceId(): string {
    return `trace-${uuidv4()}`;
  }
}
