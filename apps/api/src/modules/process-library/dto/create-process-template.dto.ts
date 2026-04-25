import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateProcessTemplateDto {
  @ApiProperty({ description: '所属连接器 ID' })
  @IsUUID()
  connectorId: string;

  @ApiPropertyOptional({ description: '流程编码；不传时系统会根据模板正文自动提取或生成' })
  @IsOptional()
  @IsString()
  processCode?: string;

  @ApiPropertyOptional({ description: '流程名称；优先从模板正文提取' })
  @IsOptional()
  @IsString()
  processName?: string;

  @ApiProperty({ required: false, description: '流程分类' })
  @IsOptional()
  @IsString()
  processCategory?: string;

  @ApiProperty({ required: false, description: '流程描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    required: false,
    description: '流程自动化等级',
    enum: ['F0', 'F1', 'F2', 'F3', 'F4'],
    default: 'F2',
  })
  @IsOptional()
  @IsEnum(['F0', 'F1', 'F2', 'F3', 'F4'])
  falLevel?: string;


  @ApiPropertyOptional({
    description: '流程录入方式',
    enum: ['rpa', 'url', 'api'],
    default: 'url',
  })
  @IsOptional()
  @IsIn(['rpa', 'url', 'api'])
  accessMode?: 'rpa' | 'url' | 'api';

  @ApiPropertyOptional({
    description: '管理员在流程库中录入当前流程时采用的方式',
    enum: ['manual', 'file'],
    default: 'manual',
  })
  @IsOptional()
  @IsIn(['manual', 'file'])
  inputMethod?: 'manual' | 'file';

  @ApiPropertyOptional({
    description: '当前录入内容是简易文字模板还是高级 JSON',
    enum: ['text', 'json'],
    default: 'text',
  })
  @IsOptional()
  @IsIn(['text', 'json'])
  authoringMode?: 'text' | 'json';

  @ApiProperty({
    description: '单个流程定义，支持流程库简易文字模板或高级 JSON',
    example: JSON.stringify({
      flows: [{
        processCode: 'process_alpha',
        processName: '流程A',
        fields: [
          { key: 'field_one', label: '字段一', type: 'text', required: true },
          { key: 'field_two', label: '字段二', type: 'date', required: true },
          { key: 'field_three', label: '字段三', type: 'textarea', required: true },
        ],
        actions: {
          submit: {
            steps: [
              { type: 'goto', value: 'https://oa.example.com/process-alpha' },
              { type: 'input', fieldKey: 'field_one', target: { kind: 'text', value: '字段一' } },
              { type: 'input', fieldKey: 'field_two', target: { kind: 'text', value: '字段二' } },
              { type: 'input', fieldKey: 'field_three', target: { kind: 'text', value: '字段三' } },
              { type: 'click', target: { kind: 'text', value: '提交' } },
            ],
          },
        },
      }],
    }, null, 2),
  })
  @IsString()
  @IsNotEmpty()
  rpaFlowContent: string;
}
