import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BootstrapService } from './bootstrap.service';
import { CreateBootstrapJobDto } from './dto/create-bootstrap-job.dto';

@ApiTags('bootstrap')
@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  @Post('jobs')
  @ApiOperation({ summary: 'Create a new bootstrap job' })
  async createJob(@Body() dto: CreateBootstrapJobDto) {
    return this.bootstrapService.createJob(dto);
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get bootstrap job by ID' })
  async getJob(@Param('id') id: string) {
    return this.bootstrapService.getJob(id);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List bootstrap jobs' })
  async listJobs(@Query('tenantId') tenantId: string) {
    return this.bootstrapService.listJobs(tenantId);
  }

  @Get('jobs/:id/report')
  @ApiOperation({ summary: 'Get bootstrap report' })
  async getReport(@Param('id') id: string) {
    return this.bootstrapService.getReport(id);
  }

  @Post('jobs/:id/publish')
  @ApiOperation({ summary: 'Publish bootstrap job to process library' })
  async publishJob(@Param('id') id: string) {
    return this.bootstrapService.publishJob(id);
  }
}
