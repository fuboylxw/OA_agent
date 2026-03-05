import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConnectorService } from './connector.service';
import { CreateConnectorDto, UpdateConnectorDto } from './dto';

@ApiTags('connectors')
@Controller('connectors')
export class ConnectorController {
  constructor(private readonly connectorService: ConnectorService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new connector' })
  async create(@Body() dto: CreateConnectorDto) {
    return this.connectorService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List connectors' })
  async list(@Query('tenantId') tenantId: string) {
    return this.connectorService.list(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get connector by ID' })
  async get(@Param('id') id: string) {
    return this.connectorService.get(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update connector' })
  async update(@Param('id') id: string, @Body() dto: UpdateConnectorDto) {
    return this.connectorService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete connector' })
  async delete(@Param('id') id: string) {
    return this.connectorService.delete(id);
  }

  @Post(':id/health-check')
  @ApiOperation({ summary: 'Run health check on connector' })
  async healthCheck(@Param('id') id: string) {
    return this.connectorService.healthCheck(id);
  }
}
