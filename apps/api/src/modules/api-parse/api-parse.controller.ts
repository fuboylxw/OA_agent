import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequestAuthService } from '../common/request-auth.service';
import { ApiParseService } from './api-parse.service';
import { FlowDiscoveryService } from './flow-discovery.service';
import { SyncService } from './sync.service';
import { ParseAndGenerateInput } from './types';

@Controller('api-parse')
export class ApiParseController {
  constructor(
    private readonly apiParseService: ApiParseService,
    private readonly syncService: SyncService,
    private readonly flowDiscovery: FlowDiscoveryService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Post('parse-and-generate')
  @HttpCode(HttpStatus.OK)
  async parseAndGenerate(@Req() req: Request, @Body() input: ParseAndGenerateInput) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId: input.tenantId,
      requireUser: true,
    });

    return this.apiParseService.parseAndGenerate({
      ...input,
      tenantId: auth.tenantId,
    });
  }

  @Post('preview-normalize')
  @HttpCode(HttpStatus.OK)
  async previewNormalize(
    @Req() req: Request,
    @Body() body: { content: string; formatHint?: string },
  ) {
    await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.apiParseService.previewNormalize(body.content, body.formatHint);
  }

  @Post('validate/:connectorId')
  @HttpCode(HttpStatus.OK)
  async validateConnector(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.apiParseService.validateConnector(connectorId, auth.tenantId);
  }

  @Post('webhook/:connectorId')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
    @Body() payload: Record<string, any>,
  ) {
    await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.handleWebhook(connectorId, payload);
  }

  @Post('sync/:submissionId')
  @HttpCode(HttpStatus.OK)
  async syncOnDemand(
    @Req() req: Request,
    @Param('submissionId') submissionId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    const canViewAll = auth.roles.some((role) =>
      ['admin', 'flow_manager', 'auditor'].includes(role),
    );

    return this.syncService.syncOnDemand(
      submissionId,
      auth.tenantId,
      canViewAll ? undefined : auth.userId,
    );
  }

  @Post('sync-all')
  @HttpCode(HttpStatus.OK)
  async pollAll(@Req() req: Request) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.syncService.pollPendingSubmissions(auth.tenantId);
  }

  @Get('flows/:connectorId')
  async listFlows(@Req() req: Request, @Param('connectorId') connectorId: string) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.flowDiscovery.listAllFlows(connectorId, auth.tenantId);
  }

  @Post('flows/:connectorId/discover')
  @HttpCode(HttpStatus.OK)
  async discoverFlows(@Req() req: Request, @Param('connectorId') connectorId: string) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.flowDiscovery.discoverFlows(connectorId, auth.tenantId);
  }

  @Get('flows/:connectorId/search')
  async searchFlow(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
    @Query('keyword') keyword: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    const result = await this.flowDiscovery.findFlow(connectorId, auth.tenantId, keyword);
    return result || { found: false, message: 'No matching flow found' };
  }
}
