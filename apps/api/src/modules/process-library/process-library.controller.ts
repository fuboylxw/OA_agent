import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { ProcessLibraryService } from './process-library.service';
import { RequestAuthService } from '../common/request-auth.service';

@ApiTags('process-library')
@Controller('process-library')
export class ProcessLibraryController {
  constructor(
    private readonly processLibraryService: ProcessLibraryService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List published process templates' })
  async list(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('category') category?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { tenantId, requireUser: true });
    return this.processLibraryService.list(auth.tenantId, category);
  }

  @Get(':processCode')
  @ApiOperation({ summary: 'Get process template by code' })
  async getByCode(
    @Req() req: Request,
    @Param('processCode') processCode: string,
    @Query('tenantId') tenantId: string,
    @Query('version') version?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { tenantId, requireUser: true });
    return this.processLibraryService.getByCode(
      auth.tenantId,
      processCode,
      version ? parseInt(version, 10) : undefined,
    );
  }

  @Get('id/:id')
  @ApiOperation({ summary: 'Get process template by ID' })
  async getById(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.processLibraryService.getById(id, auth.tenantId);
  }

  @Get(':processCode/versions')
  @ApiOperation({ summary: 'List all versions of a process' })
  async listVersions(
    @Req() req: Request,
    @Param('processCode') processCode: string,
    @Query('tenantId') tenantId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { tenantId, requireUser: true });
    return this.processLibraryService.listVersions(auth.tenantId, processCode);
  }
}
