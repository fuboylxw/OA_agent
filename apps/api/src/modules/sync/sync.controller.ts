import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SyncService, type SyncDomain } from './sync.service';

@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('jobs')
  @ApiOperation({ summary: 'List sync jobs' })
  async listJobs(
    @Query('tenantId') tenantId: string,
    @Query('connectorId') connectorId?: string,
    @Query('syncDomain') syncDomain?: string,
    @Query('status') status?: string,
  ) {
    return this.syncService.listJobs(tenantId, connectorId, syncDomain, status);
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get a sync job' })
  async getJob(@Param('id') id: string) {
    return this.syncService.getJob(id);
  }

  @Get('connectors/:connectorId/config')
  @ApiOperation({ summary: 'Get sync policy for a connector' })
  async getConfig(@Param('connectorId') connectorId: string) {
    return this.syncService.getConfig(connectorId);
  }

  @Post('connectors/:connectorId/config')
  @ApiOperation({ summary: 'Update sync policy for a connector' })
  async updateConfig(
    @Param('connectorId') connectorId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.syncService.updateConfig(connectorId, body);
  }

  @Post('run-due')
  @ApiOperation({ summary: 'Dispatch due scheduled sync jobs' })
  async runDueSchedules(@Query('connectorId') connectorId?: string) {
    return this.syncService.dispatchDueSchedules(connectorId);
  }

  @Post('connectors/:connectorId/:syncDomain')
  @ApiOperation({ summary: 'Create a sync job for a connector' })
  async enqueue(
    @Param('connectorId') connectorId: string,
    @Param('syncDomain') syncDomain: SyncDomain,
    @Body() body: { triggerType?: 'manual' | 'schedule' | 'repair' | 'webhook'; scope?: Record<string, any>; requestedBy?: string },
  ) {
    return this.syncService.enqueue({
      connectorId,
      syncDomain,
      triggerType: body?.triggerType,
      scope: body?.scope,
      requestedBy: body?.requestedBy,
    });
  }

  @Get('connectors/:connectorId/remote-processes')
  @ApiOperation({ summary: 'List remote processes discovered for a connector' })
  async listRemoteProcesses(
    @Param('connectorId') connectorId: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.syncService.listRemoteProcesses(tenantId, connectorId);
  }

  @Get('remote-processes/:id')
  @ApiOperation({ summary: 'Get remote process detail' })
  async getRemoteProcess(@Param('id') id: string) {
    return this.syncService.getRemoteProcess(id);
  }

  @Get('connectors/:connectorId/reference-datasets')
  @ApiOperation({ summary: 'List reference datasets for a connector' })
  async listReferenceDatasets(
    @Param('connectorId') connectorId: string,
    @Query('tenantId') tenantId: string,
    @Query('datasetType') datasetType?: string,
  ) {
    return this.syncService.listReferenceDatasets(tenantId, connectorId, datasetType);
  }

  @Get('reference-datasets/:id')
  @ApiOperation({ summary: 'Get reference dataset detail' })
  async getReferenceDataset(@Param('id') id: string) {
    return this.syncService.getReferenceDataset(id);
  }

  @Get('reference-datasets/:id/items')
  @ApiOperation({ summary: 'List reference dataset items' })
  async listReferenceItems(
    @Param('id') id: string,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
  ) {
    return this.syncService.listReferenceItems(id, keyword, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('cursors')
  @ApiOperation({ summary: 'List sync cursors' })
  async listCursors(
    @Query('tenantId') tenantId: string,
    @Query('connectorId') connectorId?: string,
  ) {
    return this.syncService.listCursors(tenantId, connectorId);
  }
}
