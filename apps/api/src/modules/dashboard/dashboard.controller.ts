import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardService } from './dashboard.service';
import { RequestAuthService } from '../common/request-auth.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview' })
  async getOverview(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      userId,
      requireUser: true,
    });
    return this.dashboardService.getOverview(auth.tenantId, auth.userId!);
  }
}
