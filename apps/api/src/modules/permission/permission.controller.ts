import { Controller, Post, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PermissionService } from './permission.service';
import { IsString, IsEnum, IsOptional, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequestAuthService } from '../common/request-auth.service';
import { randomUUID } from 'crypto';

class CheckPermissionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiProperty()
  @IsString()
  userId: string;

  @ApiProperty()
  @IsString()
  processCode: string;

  @ApiProperty({ enum: ['view', 'submit', 'cancel', 'urge', 'delegate', 'supplement'] })
  @IsEnum(['view', 'submit', 'cancel', 'urge', 'delegate', 'supplement'])
  action: 'view' | 'submit' | 'cancel' | 'urge' | 'delegate' | 'supplement';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  context?: Record<string, any>;
}

class CreatePolicyDto {
  @ApiProperty()
  @IsString()
  processCode: string;

  @ApiProperty({ enum: ['rbac', 'abac'] })
  @IsEnum(['rbac', 'abac'])
  policyType: string;

  @ApiProperty()
  @IsObject()
  policyRule: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  priority?: number;
}

@ApiTags('permission')
@Controller('permission')
export class PermissionController {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly requestAuth: RequestAuthService,
  ) {}

  @Post('check')
  @ApiOperation({ summary: 'Check permission for an action' })
  async check(
    @Req() req: Request,
    @Body() dto: CheckPermissionDto,
  ) {
    const auth = await this.requestAuth.resolveUser(req, {
      tenantId: dto.tenantId,
      userId: dto.userId,
      requireUser: true,
    });
    return this.permissionService.check({
      tenantId: auth.tenantId,
      userId: auth.userId!,
      processCode: dto.processCode,
      action: dto.action,
      context: dto.context,
      traceId: (req as any).traceId || randomUUID(),
    });
  }
}
