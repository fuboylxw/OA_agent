import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AdapterRuntimeService } from '../adapter-runtime/adapter-runtime.service';
import { GenericHttpAdapter } from '../adapter-runtime/generic-http-adapter';
import { ProbeResult, ProbeStatus, ValidationReport } from './types';

@Injectable()
export class EndpointValidatorService {
  private readonly logger = new Logger(EndpointValidatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRuntime: AdapterRuntimeService,
  ) {}

  async validate(
    connectorId: string,
    tenantId: string,
    skipProbe = true,
  ): Promise<ValidationReport> {
    const connector = await this.prisma.connector.findFirst({
      where: {
        id: connectorId,
        tenantId,
      },
      select: { id: true },
    });

    if (!connector) {
      throw new NotFoundException('Connector not found');
    }

    const adapter = await this.adapterRuntime.createAdapterForConnector(connectorId);

    try {
      const health = await adapter.healthCheck();
      if (!health.healthy) {
        this.logger.warn(`Connector ${connectorId}: connectivity failed - ${health.message}`);
        return {
          overall: 'failed',
          connectivity: false,
          authValid: false,
          endpoints: [],
          summary: { total: 0, reachable: 0, unreachable: 0, unknown: 0 },
        };
      }

      if (skipProbe) {
        this.logger.log(`Connector ${connectorId}: skipping endpoint probe`);
        return {
          overall: 'skipped',
          connectivity: true,
          authValid: true,
          endpoints: [],
          summary: { total: 0, reachable: 0, unreachable: 0, unknown: 0 },
        };
      }

      if (!('probeEndpoint' in adapter)) {
        this.logger.log(`Connector ${connectorId}: adapter does not support probing`);
        return {
          overall: 'skipped',
          connectivity: true,
          authValid: true,
          endpoints: [],
          summary: { total: 0, reachable: 0, unreachable: 0, unknown: 0 },
        };
      }

      const genericAdapter = adapter as GenericHttpAdapter;
    const tools = await this.prisma.mCPTool.findMany({
      where: {
        connectorId,
        tenantId,
        enabled: true,
      },
    });

    if (tools.length === 0) {
      return {
        overall: 'skipped',
        connectivity: true,
        authValid: true,
        endpoints: [],
        summary: { total: 0, reachable: 0, unreachable: 0, unknown: 0 },
      };
    }

    const results: ProbeResult[] = [];
    const concurrency = 5;

    for (let index = 0; index < tools.length; index += concurrency) {
      const batch = tools.slice(index, index + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (tool) => {
          const probe = await genericAdapter.probeEndpoint({
            toolName: tool.toolName,
            category: tool.category,
            apiEndpoint: tool.apiEndpoint,
            httpMethod: tool.httpMethod,
            headers: tool.headers as any,
            bodyTemplate: tool.bodyTemplate,
            paramMapping: tool.paramMapping as any,
            responseMapping: tool.responseMapping as any,
            flowCode: tool.flowCode,
          });

          return {
            path: tool.apiEndpoint,
            method: tool.httpMethod,
            status: probe.status as ProbeStatus,
            statusCode: probe.statusCode,
            responseTimeMs: probe.responseTimeMs,
            error: probe.error,
          };
        }),
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            path: 'unknown',
            method: 'unknown',
            status: 'unreachable',
            error: result.reason?.message || 'Unknown error',
          });
        }
      }
    }

    const reachable = results.filter((result) => result.status === 'reachable').length;
    const unreachable = results.filter((result) =>
      ['unreachable', 'not_found', 'server_error', 'auth_failed'].includes(result.status),
    ).length;
    const unknown = results.filter((result) => result.status === 'unknown').length;

    let overall: ValidationReport['overall'];
    if (reachable === results.length) {
      overall = 'passed';
    } else if (reachable > 0) {
      overall = 'partial';
    } else {
      overall = 'failed';
    }

    for (const result of results) {
      if (result.status === 'not_found' || result.status === 'unreachable') {
        await this.prisma.mCPTool.updateMany({
          where: {
            connectorId,
            tenantId,
            apiEndpoint: result.path,
            httpMethod: result.method,
          },
          data: { enabled: false },
        });
      }
    }

    this.logger.log(
      `Connector ${connectorId}: validated ${results.length} endpoints - ${reachable} reachable, ${unreachable} unreachable, ${unknown} unknown`,
    );

    return {
      overall,
      connectivity: true,
      authValid: true,
      endpoints: results,
      summary: { total: results.length, reachable, unreachable, unknown },
    };
    } finally {
      if (typeof (adapter as any).destroy === 'function') {
        try { await (adapter as any).destroy(); } catch { /* ignore cleanup errors */ }
      }
    }
  }
}
