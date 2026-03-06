import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'User login' })
  async login(
    @Body() body: { username: string; password: string; tenantId?: string },
  ) {
    const tenantId = body.tenantId || process.env.DEFAULT_TENANT_ID || '8ac5d38e-08ea-4fcd-b976-2ccb3df9a82c';
    return this.authService.login(body.username, body.password, tenantId);
  }

  @Get('user-info')
  @ApiOperation({ summary: 'Get current user info' })
  async getUserInfo(@Query('userId') userId: string) {
    return this.authService.getUserInfo(userId);
  }
}
