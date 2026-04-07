import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequestAuthService } from '../common/request-auth.service';
import { AuthBindingService } from './auth-binding.service';
import { CreateAuthBindingDto, UpsertAuthSessionAssetDto } from './dto';

@ApiTags('auth-bindings')
@Controller('auth-bindings')
export class AuthBindingController {
  constructor(
    private readonly authBindingService: AuthBindingService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a secure auth binding for a connector' })
  async create(
    @Req() req: Request,
    @Body() dto: CreateAuthBindingDto,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.authBindingService.createBinding({
      tenantId: auth.tenantId,
      userId: auth.userId,
      roles: auth.roles,
    }, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List auth bindings for the current user or tenant' })
  async list(
    @Req() req: Request,
    @Query('connectorId') connectorId?: string,
    @Query('includeAllUsers') includeAllUsers?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.authBindingService.listBindings({
      tenantId: auth.tenantId,
      userId: auth.userId,
      roles: auth.roles,
    }, {
      connectorId: connectorId?.trim() || undefined,
      includeAllUsers: includeAllUsers === 'true',
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get auth binding details without exposing sensitive payloads' })
  async get(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.authBindingService.getBinding({
      tenantId: auth.tenantId,
      userId: auth.userId,
      roles: auth.roles,
    }, id);
  }

  @Post(':id/default')
  @ApiOperation({ summary: 'Mark an auth binding as the default for its scope' })
  async markDefault(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.authBindingService.markDefault({
      tenantId: auth.tenantId,
      userId: auth.userId,
      roles: auth.roles,
    }, id);
  }

  @Post(':id/assets')
  @ApiOperation({ summary: 'Store an encrypted auth/session asset for a binding' })
  async upsertAsset(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpsertAuthSessionAssetDto,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.authBindingService.upsertSessionAsset({
      tenantId: auth.tenantId,
      userId: auth.userId,
      roles: auth.roles,
    }, id, dto);
  }
}
