import { Controller, Post, Get, Body, Query, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RequestAuthService } from '../common/request-auth.service';
import { Public } from '../common/public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  @ApiOperation({ summary: 'User login' })
  async login(
    @Body() body: { username: string; password: string; tenantId?: string },
  ) {
    const tenantId = body.tenantId?.trim() || undefined;
    return this.authService.login(body.username, body.password, tenantId);
  }

  @Public()
  @Get('oauth2/start')
  @ApiOperation({ summary: 'Start unified OAuth2 login' })
  async startOauth2Login(
    @Req() req: Request,
    @Res() res: Response,
    @Query('returnTo') returnTo?: string,
  ) {
    return res.redirect(this.authService.buildOauth2AuthorizationUrl(req, returnTo));
  }

  @Public()
  @Post('oauth2/exchange')
  @ApiOperation({ summary: 'Exchange unified OAuth2 code for local session' })
  async exchangeOauth2Code(
    @Body() body: { code: string; state: string },
  ) {
    return this.authService.exchangeOauth2Code(body.code, body.state);
  }

  @Public()
  @Get('oauth2/logout')
  @ApiOperation({ summary: 'Logout from unified OAuth2 provider' })
  async logoutOauth2(
    @Req() req: Request,
    @Res() res: Response,
    @Query('returnTo') returnTo?: string,
  ) {
    return res.redirect(this.authService.buildOauth2LogoutUrl(req, returnTo));
  }

  @Get('user-info')
  @ApiOperation({ summary: 'Get current user info' })
  async getUserInfo(
    @Req() req: Request,
    @Query('userId') userId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      userId,
      requireUser: true,
    });
    return this.authService.getUserInfo(auth.userId!);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user' })
  async me(@Req() req: Request) {
    const auth = await this.requestAuth.resolveUser(req, {
      requireUser: true,
    });
    return this.authService.getCurrentUser(auth.userId!);
  }
}
