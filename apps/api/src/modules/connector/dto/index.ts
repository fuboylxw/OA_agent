import { IsString, IsNotEmpty, IsOptional, IsEnum, IsObject, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateConnectorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: ['teacher', 'student', 'both'], description: '连接器适用身份范围' })
  @IsEnum(['teacher', 'student', 'both'])
  identityScope: string;

  @ApiProperty({ enum: ['openapi', 'form-page', 'hybrid'] })
  @IsEnum(['openapi', 'form-page', 'hybrid'])
  oaType: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  oaVendor?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  oaVersion?: string;

  @ApiProperty()
  @IsUrl()
  baseUrl: string;

  @ApiProperty({ enum: ['oauth2', 'basic', 'apikey', 'cookie'] })
  @IsEnum(['oauth2', 'basic', 'apikey', 'cookie'])
  authType: string;

  @ApiProperty()
  @IsObject()
  authConfig: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  healthCheckUrl?: string;

  @ApiProperty({ enum: ['OCL0', 'OCL1', 'OCL2', 'OCL3', 'OCL4', 'OCL5'] })
  @IsEnum(['OCL0', 'OCL1', 'OCL2', 'OCL3', 'OCL4', 'OCL5'])
  oclLevel: string;

  @ApiProperty({ enum: ['F0', 'F1', 'F2', 'F3', 'F4'], required: false })
  @IsOptional()
  @IsEnum(['F0', 'F1', 'F2', 'F3', 'F4'])
  falLevel?: string;
}

export class UpdateConnectorDto {
  @ApiProperty({ enum: ['teacher', 'student', 'both'], required: false, description: '连接器适用身份范围' })
  @IsOptional()
  @IsEnum(['teacher', 'student', 'both'])
  identityScope?: string;

  @ApiProperty({ enum: ['openapi', 'form-page', 'hybrid'], required: false })
  @IsOptional()
  @IsEnum(['openapi', 'form-page', 'hybrid'])
  oaType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  oaVendor?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  oaVersion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  baseUrl?: string;

  @ApiProperty({ enum: ['oauth2', 'basic', 'apikey', 'cookie'], required: false })
  @IsOptional()
  @IsEnum(['oauth2', 'basic', 'apikey', 'cookie'])
  authType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  authConfig?: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  healthCheckUrl?: string;

  @ApiProperty({ enum: ['OCL0', 'OCL1', 'OCL2', 'OCL3', 'OCL4', 'OCL5'], required: false })
  @IsOptional()
  @IsEnum(['OCL0', 'OCL1', 'OCL2', 'OCL3', 'OCL4', 'OCL5'])
  oclLevel?: string;

  @ApiProperty({ enum: ['F0', 'F1', 'F2', 'F3', 'F4'], required: false })
  @IsOptional()
  @IsEnum(['F0', 'F1', 'F2', 'F3', 'F4'])
  falLevel?: string;

  @ApiProperty({ enum: ['active', 'inactive'], required: false })
  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: string;
}
