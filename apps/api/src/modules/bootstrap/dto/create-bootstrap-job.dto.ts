import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator';

export class CreateBootstrapJobDto {
  @ApiProperty({ required: false, description: '租户 ID' })
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiProperty({ required: false, description: '连接器名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, description: '导入目标连接器 ID' })
  @IsOptional()
  @IsString()
  connectorId?: string;

  @ApiProperty({ required: false, description: '业务系统网址；新建连接器时必填' })
  @ValidateIf((o) => !o.connectorId)
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  oaUrl?: string;

  @ApiProperty({
    required: false,
    description: '连接器访问范围；新建连接器时必填',
    enum: ['teacher', 'student', 'both'],
  })
  @ValidateIf((o) => !o.connectorId)
  @IsString()
  @IsNotEmpty()
  @IsIn(['teacher', 'student', 'both'])
  identityScope?: string;

  @ApiProperty({
    required: false,
    description: '用户选择的接入方式',
    enum: ['backend_api', 'direct_link', 'text_guide'],
    default: 'backend_api',
  })
  @IsOptional()
  @IsIn(['backend_api', 'direct_link', 'text_guide'])
  accessMode?: string;

  @ApiProperty({
    required: false,
    description: '内部兼容模式',
    enum: ['api_only', 'rpa_only', 'hybrid'],
    default: 'api_only',
  })
  @IsOptional()
  @IsIn(['api_only', 'rpa_only', 'hybrid'])
  bootstrapMode?: string;

  @ApiProperty({
    required: false,
    description: '接口文档类型',
    enum: ['openapi', 'swagger', 'custom'],
  })
  @IsOptional()
  @IsIn(['openapi', 'swagger', 'custom'])
  apiDocType?: string;

  @ApiProperty({ required: false, description: '接口文档内容' })
  @IsOptional()
  @IsString()
  apiDocContent?: string;

  @ApiProperty({ required: false, description: '接口文档链接' })
  @IsOptional()
  @ValidateIf((o) => o.apiDocUrl !== '')
  @IsUrl({ require_tld: false })
  apiDocUrl?: string;

  @ApiProperty({
    required: false,
    description: '页面流程 JSON，或按“先访问什么、再填写什么、最后点击什么”描述的流程化文字模板',
    example: '# 全局\n认证入口: https://auth.example.com/\n系统网址: https://oa.example.com/\n\n## 流程: 流程A\n描述: 通用页面办理流程示例\n步骤:\n- 访问 https://auth.example.com/\n- 访问 https://oa.example.com/\n- 访问 https://oa.example.com/workflow/new?templateId=process_alpha\n- 填写 字段一\n- 填写 字段二\n- 上传 材料一\n- 点击 保存待发\n- 看到 提交成功 就结束',
  })
  @IsOptional()
  @IsString()
  rpaFlowContent?: string;

  @ApiProperty({
    required: false,
    description: '页面流程来源类型',
    enum: ['manual', 'recording', 'bundle', 'direct_link', 'text_guide'],
  })
  @IsOptional()
  @IsIn(['manual', 'recording', 'bundle', 'direct_link', 'text_guide'])
  rpaSourceType?: string;

  @ApiProperty({ required: false, description: '页面接入运行配置' })
  @IsOptional()
  @IsObject()
  platformConfig?: Record<string, any>;

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
    description: '认证配置',
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
