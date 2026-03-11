import { Injectable, Logger } from '@nestjs/common';
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

  /**
   * 分级流水线验证：连通性 → 认证 → 逐端点
   */
  async validate(connectorId: string): Promise<ValidationReport> {
    const adapter = await this.adapterRuntime.createAdapterForConnector(connectorId);

    // Level 1: 连通性
    const health = await adapter.healthCheck();
    if (!health.healthy) {
      this.logger.warn(`Connector ${connectorId}: connectivity failed — ${health.message}`);
      return {
        overall: 'failed',
        connectivity: false,
        authValid: false,
        endpoints: [],
        summary: { total: 0, reachable: 0, unreachable: 0, unknown: 0 },
      };
    }

    // Level 2 + 3: 需要 GenericHttpAdapter 才能逐端点探测
    if (!('probeEndpoint' in adapter)) {
      this.logger.log(`Connector ${connectorId}: adapter does not support probing, skipping endpoint validation`);
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
      where: { connectorId, enabled: true },
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

    // Level 2: 认证检测 — 用第一个 GET 端点试探
    const getEndpoint = tools.find(t => t.httpMethod.toUpperCase() === 'GET');
    if (getEndpoint) {
      const authProbe = await genericAdapter.probeEndpoint({
        toolName: getEndpoint.toolName,
        category: getEndpoint.category,
        apiEndpoint: getEndpoint.apiEndpoint,
        httpMethod: getEndpoint.httpMethod,
        headers: getEndpoint.headers as any,
        bodyTemplate: getEndpoint.bodyTemplate,
        paramMapping: getEndpoint.paramMapping as any,
        responseMapping: getEndpoint.responseMapping as any,
        flowCode: getEndpoint.flowCode,
      });

      if (authProbe.status === 'auth_failed') {
        this.logger.warn(`Connector ${connectorId}: auth failed`);
        return {
          overall: 'failed',
          connectivity: true,
          authValid: false,
          endpoints: [{
            path: getEndpoint.apiEndpoint,
            method: getEndpoint.httpMethod,
            status: 'auth_failed',
            statusCode: authProbe.statusCode,
            responseTimeMs: authProbe.responseTimeMs,
          }],
          summary: { total: tools.length, reachable: 0, unreachable: 0, unknown: tools.length },
        };
      }
    }

    // Level 3: 逐端点探测（并发限流 5 个）
    const results: ProbeResult[] = [];
    const concurrency = 5;

    for (let i = 0; i < tools.length; i += concurrency) {
      const batch = tools.slice(i, i + concurrency);
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

      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          results.push({
            path: 'unknown',
            method: 'unknown',
            status: 'unreachable',
            error: r.reason?.message || 'Unknown error',
          });
        }
      }
    }

    const reachable = results.filter(r => r.status === 'reachable').length;
    const unreachable = results.filter(r => ['unreachable', 'not_found', 'server_error', 'auth_failed'].includes(r.status)).length;
    const unknown = results.filter(r => r.status === 'unknown').length;

    let overall: ValidationReport['overall'];
    if (reachable === results.length) overall = 'passed';
    else if (reachable > 0) overall = 'partial';
    else overall = 'failed';

    // 将不可达的端点标记为 disabled
    for (const r of results) {
      if (r.status === 'not_found' || r.status === 'unreachable') {
        await this.prisma.mCPTool.updateMany({
          where: { connectorId, apiEndpoint: r.path, httpMethod: r.method },
          data: { enabled: false },
        });
      }
    }

    this.logger.log(
      `Connector ${connectorId}: validated ${results.length} endpoints — ${reachable} reachable, ${unreachable} unreachable, ${unknown} unknown`,
    );

    return {
      overall,
      connectivity: true,
      authValid: true,
      endpoints: results,
      summary: { total: results.length, reachable, unreachable, unknown },
    };
  }
}
