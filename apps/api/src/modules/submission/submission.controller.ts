import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SubmissionService } from './submission.service';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class SubmitDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  draftId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  userId?: string;
}

class SupplementDto {
  @ApiProperty()
  @IsObject()
  supplementData: Record<string, any>;
}

class DelegateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetUserId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason: string;
}

@ApiTags('submissions')
@Controller('submissions')
export class SubmissionController {
  constructor(private readonly submissionService: SubmissionService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a draft' })
  async submit(@Body() dto: SubmitDto) {
    const tenantId = process.env.DEFAULT_TENANT_ID || 'default-tenant';
    const userId = dto.userId || 'default-user';
    const traceId = `submit-${Date.now()}`;

    return this.submissionService.submit({
      tenantId,
      userId,
      draftId: dto.draftId,
      idempotencyKey: dto.idempotencyKey,
      traceId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List submissions' })
  async list(
    @Query('tenantId') tenantId: string,
    @Query('userId') userId?: string,
  ) {
    return this.submissionService.listSubmissions(tenantId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get submission by ID' })
  async get(@Param('id') id: string) {
    return this.submissionService.getSubmission(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a submission' })
  async cancel(
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    const traceId = `cancel-${Date.now()}`;
    return this.submissionService.cancel(id, userId, traceId);
  }

  @Post(':id/urge')
  @ApiOperation({ summary: 'Urge a submission' })
  async urge(
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    const traceId = `urge-${Date.now()}`;
    return this.submissionService.urge(id, userId, traceId);
  }

  @Post(':id/supplement')
  @ApiOperation({ summary: 'Supplement a submission' })
  async supplement(
    @Param('id') id: string,
    @Query('userId') userId: string,
    @Body() dto: SupplementDto,
  ) {
    const traceId = `supplement-${Date.now()}`;
    return this.submissionService.supplement(id, userId, dto.supplementData, traceId);
  }

  @Post(':id/delegate')
  @ApiOperation({ summary: 'Delegate a submission' })
  async delegate(
    @Param('id') id: string,
    @Query('userId') userId: string,
    @Body() dto: DelegateDto,
  ) {
    const traceId = `delegate-${Date.now()}`;
    return this.submissionService.delegate(id, userId, dto.targetUserId, dto.reason, traceId);
  }
}
