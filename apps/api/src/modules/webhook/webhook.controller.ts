import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { WebhookService } from './webhook.service';
import { RequestAuthService } from '../common/request-auth.service';
import { Public } from '../common/public.decorator';

@ApiTags('webhook')
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 100 } })
  @Post('connectors/:connectorId')
  @ApiOperation({ summary: 'Receive webhook callback for a connector' })
  async receive(
    @Param('connectorId') connectorId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: Request & { rawBody?: string },
    @Body() payload: Record<string, any>,
  ) {
    return this.webhookService.receive(connectorId, headers, payload, request.rawBody);
  }

  @Post('inbox/:id/process')
  @ApiOperation({ summary: 'Process a webhook inbox event' })
  async process(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.webhookService.processInbox(id, auth.tenantId);
  }

  @Get('inbox')
  @ApiOperation({ summary: 'List webhook inbox events' })
  async listInbox(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('connectorId') connectorId?: string,
    @Query('processStatus') processStatus?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      requireUser: true,
    });
    return this.webhookService.listInbox(auth.tenantId, connectorId, processStatus);
  }

  @Get('inbox/:id')
  @ApiOperation({ summary: 'Get webhook inbox event detail' })
  async getInbox(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.webhookService.getInbox(id, auth.tenantId);
  }

  @Get('connectors/:connectorId/config')
  @ApiOperation({ summary: 'Get webhook config for a connector' })
  async getConfig(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.webhookService.getConfig(connectorId, auth.tenantId);
  }

  @Post('connectors/:connectorId/config')
  @ApiOperation({ summary: 'Update webhook config for a connector' })
  async updateConfig(
    @Req() req: Request,
    @Param('connectorId') connectorId: string,
    @Body() body: Record<string, any>,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.webhookService.updateConfig(connectorId, auth.tenantId, body);
  }
}
