import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator';

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

  @ApiProperty({ required: false, description: 'OA 地址' })
  @IsOptional()
  @ValidateIf((o) => o.oaUrl !== '')
  @IsUrl({ require_tld: false })
  oaUrl?: string;

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
    description: '页面流程 JSON 或文字示教说明',
    example: '# 全局\n入口链接: https://oa.example.com/workbench\n执行方式: browser\n# 共享步骤\n点击 登录工作台\n## 流程: 请假申请\n流程编码: leave_request\n参数:\n- 开始日期 | date | 必填\n- 结束日期 | date | 必填\n- 请假原因 | textarea | 必填\n步骤:\n- 点击 申请中心\n- 点击 请假申请\n- 输入 开始日期\n- 输入 结束日期\n- 输入 请假原因\n- 点击 提交\n- 看到 已提交 就结束\n测试样例:\n- 开始日期: 2026-04-01\n- 结束日期: 2026-04-02\n- 请假原因: 家中有事',
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
