import { IsOptional, IsString, IsUrl, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBootstrapJobDto {
  @ApiProperty({ required: false, description: '租户ID' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiProperty({ required: false, description: 'OA 系统名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, description: 'OA 系统地址' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  oaUrl?: string;

  @ApiProperty({ required: false, description: 'API 文档类型', enum: ['openapi', 'swagger', 'custom'] })
  @IsOptional()
  @IsIn(['openapi', 'swagger', 'custom'])
  apiDocType?: string;

  @ApiProperty({ required: false, description: 'API 文档内容（JSON 或文本）' })
  @IsOptional()
  @IsString()
  apiDocContent?: string;

  @ApiProperty({ required: false, description: 'API 文档 URL' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  apiDocUrl?: string;
}
