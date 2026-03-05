import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview' })
  async getOverview(
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string,
  ) {
    const tenant = tenantId || process.env.DEFAULT_TENANT_ID || 'default-tenant';
    const user = userId || 'default-user';
    return this.dashboardService.getOverview(tenant, user);
  }
}
