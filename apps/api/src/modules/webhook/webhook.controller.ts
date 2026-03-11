import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhookService } from './webhook.service';

@ApiTags('webhook')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

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
  async process(@Param('id') id: string) {
    return this.webhookService.processInbox(id);
  }

  @Get('inbox')
  @ApiOperation({ summary: 'List webhook inbox events' })
  async listInbox(
    @Query('tenantId') tenantId: string,
    @Query('connectorId') connectorId?: string,
    @Query('processStatus') processStatus?: string,
  ) {
    return this.webhookService.listInbox(tenantId, connectorId, processStatus);
  }

  @Get('inbox/:id')
  @ApiOperation({ summary: 'Get webhook inbox event detail' })
  async getInbox(@Param('id') id: string) {
    return this.webhookService.getInbox(id);
  }

  @Get('connectors/:connectorId/config')
  @ApiOperation({ summary: 'Get webhook config for a connector' })
  async getConfig(@Param('connectorId') connectorId: string) {
    return this.webhookService.getConfig(connectorId);
  }

  @Post('connectors/:connectorId/config')
  @ApiOperation({ summary: 'Update webhook config for a connector' })
  async updateConfig(
    @Param('connectorId') connectorId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.webhookService.updateConfig(connectorId, body);
  }
}
