import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { ProcessLibraryService } from './process-library.service';
import { RequestAuthService } from '../common/request-auth.service';
import { FLOW_MANAGER_ROLES, requireRoles } from '../common/access-role.util';
import { CreateProcessTemplateDto } from './dto/create-process-template.dto';

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
    @Query('connectorId') connectorId?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { tenantId, requireUser: true });
    return this.processLibraryService.list(auth.tenantId, category, connectorId, {
      identityType: auth.identityType,
      roles: auth.roles,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a published process template under a source system' })
  async create(
    @Req() req: Request,
    @Body() dto: CreateProcessTemplateDto,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    requireRoles(auth.roles, FLOW_MANAGER_ROLES, '只有管理员或流程管理员可以添加流程');

    return this.processLibraryService.createManualProcessTemplate(auth.tenantId, dto);
  }

  @Put('id/:id')
  @ApiOperation({ summary: 'Update an existing process template by publishing a new version' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateProcessTemplateDto,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    requireRoles(auth.roles, FLOW_MANAGER_ROLES, '只有管理员或流程管理员可以修改流程');

    return this.processLibraryService.updateManualProcessTemplate(auth.tenantId, id, dto);
  }

  @Delete('id/:id')
  @ApiOperation({ summary: 'Archive a process template and hide it from the process library' })
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    requireRoles(auth.roles, FLOW_MANAGER_ROLES, '只有管理员或流程管理员可以删除流程');

    return this.processLibraryService.archiveManualProcessTemplate(auth.tenantId, id);
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
      {
        identityType: auth.identityType,
        roles: auth.roles,
      },
    );
  }

  @Get('id/:id')
  @ApiOperation({ summary: 'Get process template by ID' })
  async getById(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.processLibraryService.getById(id, auth.tenantId, {
      identityType: auth.identityType,
      roles: auth.roles,
    });
  }

  @Get(':processCode/versions')
  @ApiOperation({ summary: 'List all versions of a process' })
  async listVersions(
    @Req() req: Request,
    @Param('processCode') processCode: string,
    @Query('tenantId') tenantId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { tenantId, requireUser: true });
    return this.processLibraryService.listVersions(auth.tenantId, processCode, {
      identityType: auth.identityType,
      roles: auth.roles,
    });
  }
}
