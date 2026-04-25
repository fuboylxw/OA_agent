import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class PreviewProcessTemplateDto {
  @ApiPropertyOptional({ description: '所属连接器 ID；预解析时可不传' })
  @IsOptional()
  @IsUUID()
  connectorId?: string;

  @ApiPropertyOptional({ description: '流程名称；如前端已允许用户修改，可作为显式覆盖值传入' })
  @IsOptional()
  @IsString()
  processName?: string;

  @ApiPropertyOptional({ description: '流程描述；如前端已允许用户修改，可作为显式覆盖值传入' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: '流程办理方式',
    enum: ['rpa', 'url', 'api'],
    default: 'url',
  })
  @IsOptional()
  @IsIn(['rpa', 'url', 'api'])
  accessMode?: 'rpa' | 'url' | 'api';

  @ApiPropertyOptional({
    description: '录入内容类型',
    enum: ['text', 'json'],
    default: 'text',
  })
  @IsOptional()
  @IsIn(['text', 'json'])
  authoringMode?: 'text' | 'json';

  @ApiProperty({
    description: '流程模板正文',
  })
  @IsString()
  rpaFlowContent: string;
}
