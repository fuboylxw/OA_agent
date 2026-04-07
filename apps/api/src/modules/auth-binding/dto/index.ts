import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsISO8601,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAuthBindingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  connectorId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bindingName?: string;

  @ApiProperty({ enum: ['user', 'service'], required: false, default: 'user' })
  @IsOptional()
  @IsIn(['user', 'service'])
  ownerType?: 'user' | 'service';

  @ApiProperty({ required: false, description: 'Only allowed for admin/flow_manager' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ enum: ['oauth2', 'basic', 'apikey', 'cookie'] })
  @IsString()
  @IsIn(['oauth2', 'basic', 'apikey', 'cookie'])
  authType: string;

  @ApiProperty({
    enum: ['password_bootstrap', 'api_token', 'cookie_session', 'browser_session', 'ticket_broker'],
  })
  @IsString()
  @IsIn(['password_bootstrap', 'api_token', 'cookie_session', 'browser_session', 'ticket_broker'])
  authMode: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpsertAuthSessionAssetDto {
  @ApiProperty({
    enum: ['auth_payload', 'api_token', 'cookie_session', 'browser_session', 'jump_ticket'],
  })
  @IsString()
  @IsIn(['auth_payload', 'api_token', 'cookie_session', 'browser_session', 'jump_ticket'])
  assetType: string;

  @ApiProperty({ required: false, enum: ['active', 'stale', 'expired', 'revoked'], default: 'active' })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'stale', 'expired', 'revoked'])
  status?: string;

  @ApiProperty({ type: Object, description: 'Sensitive payload. Stored encrypted on the server.' })
  payload: any;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  issuedAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
