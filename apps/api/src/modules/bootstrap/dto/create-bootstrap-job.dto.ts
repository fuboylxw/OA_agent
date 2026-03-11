import { IsOptional, IsString, IsUrl, IsIn, IsObject, ValidateIf } from 'class-validator';
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
  @ValidateIf((o) => o.oaUrl !== '')
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
  @ValidateIf((o) => o.apiDocUrl !== '')
  @IsUrl({ require_tld: false })
  apiDocUrl?: string;

  @ApiProperty({
    required: false,
    description: '认证类型',
    enum: ['apikey', 'cookie', 'basic', 'oauth2'],
  })
  @IsOptional()
  @IsIn(['apikey', 'cookie', 'basic', 'oauth2'])
  authType?: string;

  @ApiProperty({
    required: false,
    description: '认证配置（根据 authType 不同字段不同）',
    example: {
      username: 'admin',
      password: 'xxx',
      loginPath: '/api/auth/login',
      headerName: 'x-token',
      token: 'xxx',
      appKey: 'xxx',
      appSecret: 'xxx',
    },
  })
  @IsOptional()
  @IsObject()
  authConfig?: Record<string, any>;
}
