import { Controller, Post, Get, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { BootstrapService } from './bootstrap.service';
import { CreateBootstrapJobDto } from './dto/create-bootstrap-job.dto';
import { ADMIN_ONLY_ROLES, requireRoles } from '../common/access-role.util';
import { RequestAuthService } from '../common/request-auth.service';

@ApiTags('bootstrap')
@Controller('bootstrap')
export class BootstrapController {
  constructor(
    private readonly bootstrapService: BootstrapService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Post('jobs')
  @ApiOperation({ summary: 'Create a new bootstrap job' })
  async createJob(
    @Req() req: Request,
    @Body() dto: CreateBootstrapJobDto,
  ) {
    const auth = this.requestAuth.resolveTenant(req, dto.tenantId);
    requireRoles(auth.roles, ADMIN_ONLY_ROLES, '只有超级管理员可以创建初始化任务');
    return this.bootstrapService.createJob({
      ...dto,
      tenantId: auth.tenantId,
    });
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get bootstrap job by ID' })
  async getJob(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = this.requestAuth.resolveTenant(req);
    requireRoles(auth.roles, ADMIN_ONLY_ROLES, '只有超级管理员可以查看初始化任务');
    return this.bootstrapService.getJob(id, auth.tenantId);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List bootstrap jobs' })
  async listJobs(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
  ) {
    const auth = this.requestAuth.resolveTenant(req, tenantId);
    requireRoles(auth.roles, ADMIN_ONLY_ROLES, '只有超级管理员可以查看初始化任务');
    return this.bootstrapService.listJobs(auth.tenantId);
  }

  @Get('jobs/:id/report')
  @ApiOperation({ summary: 'Get bootstrap report' })
  async getReport(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = this.requestAuth.resolveTenant(req);
    requireRoles(auth.roles, ADMIN_ONLY_ROLES, '只有超级管理员可以查看初始化报告');
    return this.bootstrapService.getReport(id, auth.tenantId);
  }

  @Post('jobs/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a bootstrap job after connector deletion' })
  async reactivate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      mode: 'reuse' | 'new';
      apiDocContent?: string;
      apiDocUrl?: string;
      apiDocType?: string;
      rpaFlowContent?: string;
      rpaSourceType?: string;
      platformConfig?: Record<string, any>;
      accessMode?: 'backend_api' | 'direct_link' | 'text_guide';
      bootstrapMode?: 'api_only' | 'rpa_only' | 'hybrid';
      oaUrl?: string;
      identityScope?: 'teacher' | 'student' | 'both';
      authConfig?: Record<string, any>;
    },
  ) {
    const auth = this.requestAuth.resolveTenant(req);
    requireRoles(auth.roles, ADMIN_ONLY_ROLES, '只有超级管理员可以重新激活初始化任务');
    return this.bootstrapService.reactivate(id, auth.tenantId, body.mode, {
      apiDocContent: body.apiDocContent,
      apiDocUrl: body.apiDocUrl,
      apiDocType: body.apiDocType,
      rpaFlowContent: body.rpaFlowContent,
      rpaSourceType: body.rpaSourceType,
      platformConfig: body.platformConfig,
      accessMode: body.accessMode,
      bootstrapMode: body.bootstrapMode,
      oaUrl: body.oaUrl,
      identityScope: body.identityScope,
      authConfig: body.authConfig,
    });
  }

  @Delete('jobs/:id')
  @ApiOperation({ summary: 'Permanently delete a bootstrap job and all related data' })
  async deleteJob(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = this.requestAuth.resolveTenant(req);
    requireRoles(auth.roles, ADMIN_ONLY_ROLES, '只有超级管理员可以删除初始化任务');
    return this.bootstrapService.deleteJob(id, auth.tenantId);
  }
}
