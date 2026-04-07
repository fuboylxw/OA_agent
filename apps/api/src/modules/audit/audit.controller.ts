import { Controller, Get, Query, Param, Req, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditService } from './audit.service';
import { RequestAuthService } from '../common/request-auth.service';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Get('logs')
  @ApiOperation({ summary: 'Query audit logs' })
  async queryLogs(
    @Req() req: Request,
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
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      userId,
      requireUser: true,
    });
    const canViewAll = auth.roles.some((role) => ['admin', 'flow_manager', 'auditor'].includes(role));

    return this.auditService.queryLogs({
      tenantId: auth.tenantId,
      userId: canViewAll ? userId : auth.userId,
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
    @Req() req: Request,
    @Param('traceId') traceId: string,
    @Query('tenantId') tenantId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });
    const canViewAll = auth.roles.some((role) => ['admin', 'flow_manager', 'auditor'].includes(role));
    if (!canViewAll) {
      throw new ForbiddenException('当前用户无权查看完整审计链路');
    }
    return this.auditService.getTrace(auth.tenantId, traceId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get audit statistics' })
  async getStats(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });
    const canViewAll = auth.roles.some((role) => ['admin', 'flow_manager', 'auditor'].includes(role));
    if (!canViewAll) {
      throw new ForbiddenException('当前用户无权查看审计统计');
    }

    return this.auditService.getStats({
      tenantId: auth.tenantId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('runtime-events')
  @ApiOperation({ summary: 'Get runtime diagnostic events' })
  async getRuntimeEvents(
    @Req() req: Request,
    @Query('tenantId') tenantId?: string,
    @Query('traceId') traceId?: string,
    @Query('source') source?: string,
    @Query('category') category?: 'llm' | 'system',
    @Query('eventType') eventType?: 'llm_call' | 'llm_error' | 'audit_error' | 'runtime_error' | 'worker_error',
    @Query('level') level?: 'info' | 'warn' | 'error',
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });
    const canViewAll = auth.roles.some((role) => ['admin', 'flow_manager', 'auditor'].includes(role));
    if (!canViewAll) {
      throw new ForbiddenException('当前用户无权查看运行时诊断事件');
    }

    return this.auditService.queryRuntimeDiagnostics({
      tenantId: auth.tenantId,
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
