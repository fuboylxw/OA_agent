import { Controller, Post, Get, Body, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
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
}
