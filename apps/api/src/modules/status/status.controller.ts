import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StatusService } from './status.service';

@ApiTags('status')
@Controller('status')
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  @Get('submissions/:id')
  @ApiOperation({ summary: 'Query submission status' })
  async queryStatus(@Param('id') id: string) {
    const traceId = `status-${Date.now()}`;
    return this.statusService.queryStatus(id, traceId);
  }

  @Get('my')
  @ApiOperation({ summary: 'List my submissions' })
  async listMy(
    @Query('tenantId') tenantId: string,
    @Query('userId') userId: string,
  ) {
    return this.statusService.listMySubmissions(tenantId, userId);
  }

  @Get('submissions/:id/timeline')
  @ApiOperation({ summary: 'Get submission timeline' })
  async getTimeline(@Param('id') id: string) {
    return this.statusService.getTimeline(id);
  }
}
