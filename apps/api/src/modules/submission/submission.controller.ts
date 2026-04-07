import { Controller, Post, Get, Body, Param, Query, Req, Res, Sse, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Observable, filter, map } from 'rxjs';
import { SubmissionService } from './submission.service';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RequestAuthService } from '../common/request-auth.service';

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
  constructor(
    private readonly submissionService: SubmissionService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Submit a draft' })
  async submit(@Req() req: Request, @Body() dto: SubmitDto) {
    const auth = await this.requestAuth.resolveUser(req, {
      userId: dto.userId,
      requireUser: true,
    });
    const traceId = `submit-${Date.now()}`;

    return this.submissionService.submit({
      tenantId: auth.tenantId,
      userId: auth.userId!,
      draftId: dto.draftId,
      idempotencyKey: dto.idempotencyKey,
      traceId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List submissions' })
  async list(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Query('userId') userId?: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId,
      userId,
      requireUser: true,
    });
    return this.submissionService.listSubmissions(auth.tenantId, auth.userId!);
  }

  @Sse('events')
  @ApiOperation({ summary: 'SSE stream for submission status updates' })
  async events(@Req() req: Request): Promise<Observable<MessageEvent>> {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.submissionService.statusUpdates$.pipe(
      filter(e => e.tenantId === auth.tenantId && e.userId === auth.userId),
      map(e => ({ data: e }) as MessageEvent),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get submission by ID' })
  async get(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, { requireUser: true });
    return this.submissionService.getSubmission(id, auth.tenantId);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a submission' })
  async cancel(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      userId,
      requireUser: true,
    });
    const traceId = `cancel-${Date.now()}`;
    return this.submissionService.cancel(id, auth.tenantId, auth.userId!, traceId);
  }

  @Post(':id/urge')
  @ApiOperation({ summary: 'Urge a submission' })
  async urge(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      userId,
      requireUser: true,
    });
    const traceId = `urge-${Date.now()}`;
    return this.submissionService.urge(id, auth.tenantId, auth.userId!, traceId);
  }

  @Post(':id/supplement')
  @ApiOperation({ summary: 'Supplement a submission' })
  async supplement(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('userId') userId: string,
    @Body() dto: SupplementDto,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      userId,
      requireUser: true,
    });
    const traceId = `supplement-${Date.now()}`;
    return this.submissionService.supplement(
      id,
      auth.tenantId,
      auth.userId!,
      dto.supplementData,
      traceId,
    );
  }

  @Post(':id/delegate')
  @ApiOperation({ summary: 'Delegate a submission' })
  async delegate(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('userId') userId: string,
    @Body() dto: DelegateDto,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      userId,
      requireUser: true,
    });
    const traceId = `delegate-${Date.now()}`;
    return this.submissionService.delegate(
      id,
      auth.tenantId,
      auth.userId!,
      dto.targetUserId,
      dto.reason,
      traceId,
    );
  }
}
