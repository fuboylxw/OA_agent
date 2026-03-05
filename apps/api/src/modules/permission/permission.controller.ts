import { Controller, Post, Body, Get, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PermissionService } from './permission.service';
import { IsString, IsEnum, IsOptional, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class CheckPermissionDto {
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
  constructor(private readonly permissionService: PermissionService) {}

  @Post('check')
  @ApiOperation({ summary: 'Check permission for an action' })
  async check(@Body() dto: CheckPermissionDto) {
    const tenantId = process.env.DEFAULT_TENANT_ID || 'default-tenant';
    return this.permissionService.check({
      tenantId,
      userId: dto.userId,
      processCode: dto.processCode,
      action: dto.action,
      context: dto.context,
      traceId: `perm-${Date.now()}`,
    });
  }
}
