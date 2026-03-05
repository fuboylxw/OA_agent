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
}
