import { Controller, Get, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @ApiOperation({ summary: 'Query audit logs' })
  async queryLogs(
    @Query('tenantId') tenantId: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('result') result?: string,
    @Query('traceId') traceId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.auditService.queryLogs({
      tenantId,
      userId,
      action,
      result,
      traceId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('trace/:traceId')
  @ApiOperation({ summary: 'Get full trace by trace ID' })
  async getTrace(
    @Param('traceId') traceId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.auditService.getTrace(tenantId, traceId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get audit statistics' })
  async getStats(
    @Query('tenantId') tenantId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.auditService.getStats({
      tenantId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('runtime-events')
  @ApiOperation({ summary: 'Get runtime diagnostic events' })
  async getRuntimeEvents(
    @Query('tenantId') tenantId?: string,
    @Query('traceId') traceId?: string,
    @Query('source') source?: string,
    @Query('category') category?: 'llm' | 'system',
    @Query('eventType') eventType?: 'llm_call' | 'llm_error' | 'audit_error' | 'runtime_error' | 'worker_error',
    @Query('level') level?: 'info' | 'warn' | 'error',
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.queryRuntimeDiagnostics({
      tenantId,
      traceId,
      source,
      category,
      eventType,
      level,
      search,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }
}
