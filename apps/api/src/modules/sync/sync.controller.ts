import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SyncService, type SyncDomain } from './sync.service';
import { RequestAuthService } from '../common/request-auth.service';

@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Get('jobs')
  @ApiOperation({ summary: 'List sync jobs' })
  async listJobs(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('connectorId') connectorId?: string,
    @Query('syncDomain') syncDomain?: string,
    @Query('status') status?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });
    return this.syncService.listJobs(auth.tenantId, connectorId, syncDomain, status);
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get a sync job' })
  async getJob(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.getJob(id, auth.tenantId);
  }

  @Get('connectors/:connectorId/config')
  @ApiOperation({ summary: 'Get sync policy for a connector' })
  async getConfig(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.getConfig(connectorId, auth.tenantId);
  }

  @Post('connectors/:connectorId/config')
  @ApiOperation({ summary: 'Update sync policy for a connector' })
  async updateConfig(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
    @Body() body: Record<string, any>,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.updateConfig(connectorId, auth.tenantId, body);
  }

  @Post('run-due')
  @ApiOperation({ summary: 'Dispatch due scheduled sync jobs' })
  async runDueSchedules(
    @Req() req: Request,
    @Query('connectorId') connectorId?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.dispatchDueSchedules(connectorId, auth.tenantId);
  }

  @Post('connectors/:connectorId/:syncDomain')
  @ApiOperation({ summary: 'Create a sync job for a connector' })
  async enqueue(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
    @Param('syncDomain') syncDomain: SyncDomain,
    @Body() body: { triggerType?: 'manual' | 'schedule' | 'repair' | 'webhook'; scope?: Record<string, any>; requestedBy?: string },
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.enqueue({
      tenantId: auth.tenantId,
      connectorId,
      syncDomain,
      triggerType: body?.triggerType,
      scope: body?.scope,
      requestedBy: auth.userId || body?.requestedBy,
    });
  }

  @Get('connectors/:connectorId/remote-processes')
  @ApiOperation({ summary: 'List remote processes discovered for a connector' })
  async listRemoteProcesses(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
    @Query('tenantId') tenantId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });
    return this.syncService.listRemoteProcesses(auth.tenantId, connectorId);
  }

  @Get('remote-processes/:id')
  @ApiOperation({ summary: 'Get remote process detail' })
  async getRemoteProcess(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.getRemoteProcess(id, auth.tenantId);
  }

  @Get('connectors/:connectorId/reference-datasets')
  @ApiOperation({ summary: 'List reference datasets for a connector' })
  async listReferenceDatasets(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
    @Query('tenantId') tenantId: string,
    @Query('datasetType') datasetType?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });
    return this.syncService.listReferenceDatasets(auth.tenantId, connectorId, datasetType);
  }

  @Get('reference-datasets/:id')
  @ApiOperation({ summary: 'Get reference dataset detail' })
  async getReferenceDataset(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.getReferenceDataset(id, auth.tenantId);
  }

  @Get('reference-datasets/:id/items')
  @ApiOperation({ summary: 'List reference dataset items' })
  async listReferenceItems(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.listReferenceItems(
      id,
      auth.tenantId,
      keyword,
      limit ? (Number.isFinite(parseInt(limit, 10)) ? parseInt(limit, 10) : undefined) : undefined,
    );
  }

  @Get('cursors')
  @ApiOperation({ summary: 'List sync cursors' })
  async listCursors(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('connectorId') connectorId?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });
    return this.syncService.listCursors(auth.tenantId, connectorId);
  }
}
