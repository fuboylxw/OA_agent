import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { StatusService } from './status.service';
import { RequestAuthService } from '../common/request-auth.service';

@ApiTags('status')
@Controller('status')
export class StatusController {
  constructor(
    private readonly statusService: StatusService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Get('submissions/:id')
  @ApiOperation({ summary: 'Query submission status' })
  async queryStatus(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    const canViewAll = auth.roles.some((role) => ['admin', 'flow_manager', 'auditor'].includes(role));
    const traceId = `status-${Date.now()}`;
    return this.statusService.queryStatus(
      id,
      auth.tenantId,
      traceId,
      canViewAll ? undefined : auth.userId,
    );
  }

  @Get('my')
  @ApiOperation({ summary: 'List my submissions' })
  async listMy(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      userId,
      requireUser: true,
    });
    return this.statusService.listMySubmissions(auth.tenantId, auth.userId!);
  }

  @Get('submissions/:id/timeline')
  @ApiOperation({ summary: 'Get submission timeline' })
  async getTimeline(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    const canViewAll = auth.roles.some((role) => ['admin', 'flow_manager', 'auditor'].includes(role));
    return this.statusService.getTimeline(
      id,
      auth.tenantId,
      canViewAll ? undefined : auth.userId,
    );
  }
}
