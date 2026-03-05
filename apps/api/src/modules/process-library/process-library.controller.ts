import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProcessLibraryService } from './process-library.service';

@ApiTags('process-library')
@Controller('process-library')
export class ProcessLibraryController {
  constructor(private readonly processLibraryService: ProcessLibraryService) {}

  @Get()
  @ApiOperation({ summary: 'List published process templates' })
  async list(
    @Query('tenantId') tenantId: string,
    @Query('category') category?: string,
  ) {
    return this.processLibraryService.list(tenantId, category);
  }

  @Get(':processCode')
  @ApiOperation({ summary: 'Get process template by code' })
  async getByCode(
    @Param('processCode') processCode: string,
    @Query('tenantId') tenantId: string,
    @Query('version') version?: string,
  ) {
    return this.processLibraryService.getByCode(
      tenantId,
      processCode,
      version ? parseInt(version, 10) : undefined,
    );
  }

  @Get('id/:id')
  @ApiOperation({ summary: 'Get process template by ID' })
  async getById(@Param('id') id: string) {
    return this.processLibraryService.getById(id);
  }

  @Get(':processCode/versions')
  @ApiOperation({ summary: 'List all versions of a process' })
  async listVersions(
    @Param('processCode') processCode: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.processLibraryService.listVersions(tenantId, processCode);
  }
}
