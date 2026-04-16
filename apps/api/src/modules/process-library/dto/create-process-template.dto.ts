import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateProcessTemplateDto {
  @ApiProperty({ description: '所属连接器 ID' })
  @IsUUID()
  connectorId: string;

  @ApiProperty({ description: '流程编码' })
  @IsString()
  @IsNotEmpty()
  processCode: string;

  @ApiProperty({ description: '流程名称' })
  @IsString()
  @IsNotEmpty()
  processName: string;

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

  @ApiProperty({
    description: '单个流程定义，支持现有页面/链接流程 JSON 格式',
    example: JSON.stringify({
      flows: [{
        processCode: 'leave_request',
        processName: '请假申请',
        fields: [
          { key: 'start_date', label: '开始日期', type: 'date', required: true },
          { key: 'end_date', label: '结束日期', type: 'date', required: true },
          { key: 'reason', label: '请假原因', type: 'textarea', required: true },
        ],
        actions: {
          submit: {
            steps: [
              { type: 'goto', value: 'https://oa.example.com/leave' },
              { type: 'input', fieldKey: 'start_date', target: { kind: 'text', value: '开始日期' } },
              { type: 'input', fieldKey: 'end_date', target: { kind: 'text', value: '结束日期' } },
              { type: 'input', fieldKey: 'reason', target: { kind: 'text', value: '请假原因' } },
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
