import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Response } from 'express';
import { ConnectorService } from './connector.service';
import { CreateConnectorDto, UpdateConnectorDto } from './dto';
import { RequestAuthService } from '../common/request-auth.service';
import { AuthBindingService } from '../auth-binding/auth-binding.service';
import { Public } from '../common/public.decorator';

@ApiTags('connectors')
@Controller('connectors')
export class ConnectorController {
  constructor(
    private readonly connectorService: ConnectorService,
    private readonly requestAuth: RequestAuthService,
    private readonly authBindingService: AuthBindingService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new connector' })
  async create(
    @Req() req: Request,
    @Body() dto: CreateConnectorDto,
  ) {
    const auth = this.requestAuth.resolveTenant(req);
    return this.connectorService.create(dto, auth.tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'List connectors' })
  async list(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
  ) {
    const auth = this.requestAuth.resolveTenant(req, tenantId);
    return this.connectorService.list(auth.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get connector by ID' })
  async get(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = this.requestAuth.resolveTenant(req);
    return this.connectorService.get(id, auth.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update connector' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateConnectorDto,
  ) {
    const auth = this.requestAuth.resolveTenant(req);
    return this.connectorService.update(id, auth.tenantId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete connector' })
  async delete(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = this.requestAuth.resolveTenant(req);
    return this.connectorService.delete(id, auth.tenantId);
  }

  @Post(':id/health-check')
  @ApiOperation({ summary: 'Run health check on connector' })
  async healthCheck(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = this.requestAuth.resolveTenant(req);
    return this.connectorService.healthCheck(id, auth.tenantId);
  }

  @Get(':id/delegated-auth/start')
  @ApiOperation({ summary: 'Start delegated authorization for a connector' })
  async startDelegatedAuth(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
    @Query('sessionId') sessionId: string,
    @Query('processCode') processCode?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    const result = await this.authBindingService.beginDelegatedAuth({
      tenantId: auth.tenantId,
      userId: auth.userId,
      roles: auth.roles,
    }, {
      connectorId: id,
      sessionId,
      processCode,
      requestBaseUrl: this.resolveRequestBaseUrl(req),
    });

    if (result.redirectUrl) {
      return res.redirect(result.redirectUrl);
    }

    return res
      .status(200)
      .type('html')
      .send(this.buildDelegatedAuthHtml({
        success: true,
        connectorId: id,
        connectorName: result.connectorName,
        sessionId,
        message: `${result.connectorName} authorization is already available`,
        statusUrl: result.statusUrl,
      }));
  }

  @Get(':id/delegated-auth/status')
  @ApiOperation({ summary: 'Query delegated authorization status for a connector' })
  async getDelegatedAuthStatus(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('sessionId') sessionId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.authBindingService.getDelegatedAuthStatus({
      tenantId: auth.tenantId,
      userId: auth.userId,
      roles: auth.roles,
    }, {
      connectorId: id,
      sessionId,
    });
  }

  @Public()
  @Get(':id/delegated-auth/callback')
  @ApiOperation({ summary: 'Receive delegated authorization callback' })
  async completeDelegatedAuth(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    const result = await this.authBindingService.completeDelegatedAuth({
      connectorId: id,
      state: state || null,
      code: code || null,
      error: error || null,
      errorDescription: errorDescription || null,
      requestBaseUrl: this.resolveRequestBaseUrl(req),
    });

    return res
      .status(result.success ? 200 : 400)
      .type('html')
      .send(this.buildDelegatedAuthHtml(result));
  }

  private resolveRequestBaseUrl(req: Request) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const proto = forwardedProto || req.protocol || 'http';
    const host = forwardedHost || req.get('host') || 'localhost:3001';
    return `${proto}://${host}`.replace(/\/+$/, '');
  }

  private buildDelegatedAuthHtml(result: {
    success: boolean;
    connectorId: string;
    connectorName?: string;
    sessionId?: string;
    message: string;
    statusUrl?: string;
  }) {
    const payload = JSON.stringify({
      type: 'delegated-auth-result',
      success: result.success,
      connectorId: result.connectorId,
      connectorName: result.connectorName,
      sessionId: result.sessionId,
      message: result.message,
      statusUrl: result.statusUrl,
    });
    const escapedMessage = result.message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${result.success ? '授权完成' : '授权失败'}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; color: #0f172a;">
    <h1 style="font-size: 20px; margin: 0 0 12px;">${result.success ? '授权完成' : '授权失败'}</h1>
    <p style="margin: 0; line-height: 1.6;">${escapedMessage}</p>
    <script>
      (function () {
        var payload = ${payload};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, '*');
          }
        } catch (error) {}
        setTimeout(function () { window.close(); }, 300);
      })();
    </script>
  </body>
</html>`;
  }
}
