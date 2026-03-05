# API上传与办事流程识别系统

## 概述

本系统实现了API文件上传、自动识别办事流程接口、验证接口可访问性、存储到数据库，并自动生成MCP工具的完整流程。

## 功能特性

### 1. API文档解析
- 支持多种格式：OpenAPI 3.0、Swagger 2.0、Postman Collection、自定义格式
- 自动提取API端点、参数、请求体、响应等信息
- 支持LLM智能解析自定义格式文档

### 2. 办事流程接口识别
- 使用规则引擎 + LLM智能识别办事流程接口
- 自动分类：请假、报销、考勤、出差、加班、采购等
- 过滤非办事流程接口（系统管理、用户管理等）
- 提供置信度评分

### 3. 接口验证
- 自动测试接口可访问性
- 验证认证配置是否正确
- 分析所需参数和数据类型
- 生成测试用例和示例请求

### 4. 数据存储
- 存储到ProcessTemplate表
- 关联Connector和Tenant
- 保存验证结果和元数据

### 5. MCP工具自动生成
- 根据办事流程API自动生成MCP工具
- 生成工具Schema（JSON Schema格式）
- 配置参数映射和响应映射
- 生成测试数据

### 6. 前端展示
- API上传页面：支持文件上传和配置
- 流程库页面：展示所有识别的办事流程
- 实时显示处理进度和结果

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (Next.js)                          │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  API上传页面      │         │   流程库页面      │         │
│  └──────────────────┘         └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    后端 API (NestJS)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              MCPController                            │  │
│  │  - POST /mcp/upload-api                              │  │
│  │  - POST /mcp/upload-api-json                         │  │
│  │  - GET  /mcp/upload-history                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           ApiUploadService                            │  │
│  │  1. 解析API文档                                        │  │
│  │  2. 识别办事流程接口                                   │  │
│  │  3. 验证接口                                           │  │
│  │  4. 存储到数据库                                       │  │
│  │  5. 生成MCP工具                                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                 │
│         ┌──────────────────┼──────────────────┐            │
│         ▼                  ▼                  ▼             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ ApiDocParser│  │ Workflow    │  │ ApiValidator│        │
│  │   Agent     │  │ Identifier  │  │   Agent     │        │
│  │             │  │   Agent     │  │             │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                            │                                 │
│                            ▼                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │        MCPToolGeneratorService                        │  │
│  │  - 生成MCP工具定义                                     │  │
│  │  - 配置参数映射                                        │  │
│  │  - 生成测试数据                                        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   数据库 (PostgreSQL)                        │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ ProcessTemplate  │  │    MCPTool       │               │
│  │  - 流程定义       │  │  - MCP工具定义    │               │
│  │  - 字段Schema     │  │  - 参数映射       │               │
│  │  - 验证结果       │  │  - 测试数据       │               │
│  └──────────────────┘  └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

## 核心智能体

### 1. ApiDocParserAgent
**功能**: 解析API文档

**输入**:
```typescript
{
  docType: 'openapi' | 'swagger' | 'postman' | 'custom',
  docContent: string,
  oaUrl: string
}
```

**输出**:
```typescript
{
  authType: string,
  baseUrl: string,
  endpoints: Array<{
    path: string,
    method: string,
    description: string,
    parameters: Array<...>,
    requestBody: any,
    responses: any
  }>
}
```

### 2. WorkflowApiIdentifierAgent
**功能**: 识别办事流程接口

**输入**:
```typescript
{
  endpoints: Array<{
    path: string,
    method: string,
    description: string,
    ...
  }>
}
```

**输出**:
```typescript
{
  workflowApis: Array<{
    path: string,
    method: string,
    description: string,
    workflowType: string,      // leave_request, expense_claim, etc.
    workflowCategory: string,  // 请假, 报销, etc.
    confidence: number,        // 0.0 - 1.0
    reason: string
  }>,
  nonWorkflowApis: Array<...>
}
```

**识别规则**:
1. 基于规则的初步过滤（排除系统接口）
2. LLM智能识别办事流程特征
3. 置信度评分

### 3. ApiValidatorAgent
**功能**: 验证接口可访问性

**输入**:
```typescript
{
  baseUrl: string,
  authConfig: any,
  endpoint: {
    path: string,
    method: string,
    parameters: Array<...>,
    requestBody: any
  }
}
```

**输出**:
```typescript
{
  isAccessible: boolean,
  statusCode: number,
  responseTime: number,
  requiredParams: Array<{
    name: string,
    type: string,
    required: boolean,
    sampleValue: any
  }>,
  validationResult: {
    canConnect: boolean,
    authValid: boolean,
    endpointExists: boolean,
    recommendation: string
  }
}
```

## API接口

### 1. 上传API文件（文件上传）
```
POST /api/mcp/upload-api
Content-Type: multipart/form-data

参数:
- file: API文档文件
- tenantId: 租户ID
- connectorId: 连接器ID
- docType: 文档类型
- oaUrl: OA系统URL
- authConfig: 认证配置（JSON字符串）
- autoValidate: 是否自动验证
- autoGenerateMcp: 是否自动生成MCP工具
```

### 2. 上传API文件（JSON）
```
POST /api/mcp/upload-api-json
Content-Type: application/json

{
  "tenantId": "string",
  "connectorId": "string",
  "docType": "openapi",
  "docContent": "string",
  "oaUrl": "string",
  "authConfig": {},
  "autoValidate": true,
  "autoGenerateMcp": true
}
```

### 3. 获取上传历史
```
GET /api/mcp/upload-history?tenantId=xxx&connectorId=xxx
```

## 数据库表结构

### ProcessTemplate
存储识别的办事流程定义

```sql
- id: UUID
- tenantId: 租户ID
- connectorId: 连接器ID
- processCode: 流程代码（如 leave_request）
- processName: 流程名称
- processCategory: 流程分类（如 请假）
- version: 版本号
- status: 状态（draft/published/archived）
- falLevel: 自动化级别（F0-F4）
- schema: 字段定义（JSON）
- rules: 规则定义（JSON）
- permissions: 权限定义（JSON）
- uiHints: UI提示（包含API信息和验证结果）
- createdAt: 创建时间
- updatedAt: 更新时间
```

### MCPTool
存储自动生成的MCP工具

```sql
- id: UUID
- tenantId: 租户ID
- connectorId: 连接器ID
- toolName: 工具名称
- toolDescription: 工具描述
- toolSchema: 工具Schema（JSON Schema格式）
- apiEndpoint: API端点
- httpMethod: HTTP方法
- headers: 请求头模板
- bodyTemplate: 请求体模板
- paramMapping: 参数映射
- responseMapping: 响应映射
- flowCode: 关联的流程代码
- category: 工具分类（submit/query/cancel/urge/list/get）
- enabled: 是否启用
- testInput: 测试输入
- testOutput: 测试输出
- createdAt: 创建时间
- updatedAt: 更新时间
```

## 使用流程

### 1. 上传API文档
1. 访问 `/api-upload` 页面
2. 选择API文档文件（OpenAPI/Swagger/Postman）
3. 填写OA系统URL和认证配置
4. 选择是否自动验证和生成MCP工具
5. 点击"上传并处理"

### 2. 查看处理结果
- 总接口数
- 识别的办事流程接口数
- 验证通过的接口数
- 生成的MCP工具数
- 详细的接口列表和验证结果

### 3. 查看流程库
1. 访问 `/process-library` 页面
2. 查看所有识别的办事流程
3. 搜索和筛选流程
4. 查看流程详情、API信息、验证结果

### 4. 使用MCP工具
生成的MCP工具可以通过以下方式使用：
- 在聊天助手中调用
- 通过API直接执行
- 在流程提交时自动调用

## 配置示例

### OpenAPI认证配置
```json
{
  "type": "apikey",
  "headerName": "X-API-Key",
  "apiKey": "your-api-key-here"
}
```

### Bearer Token认证配置
```json
{
  "type": "bearer",
  "token": "your-bearer-token-here"
}
```

### OAuth 2.0认证配置
```json
{
  "type": "oauth2",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "tokenUrl": "https://oa.example.com/oauth/token"
}
```

## 扩展性

### 添加新的文档类型
在 `ApiDocParserAgent` 中添加新的解析方法：

```typescript
if (input.docType === 'new-format') {
  return this.parseNewFormat(input.docContent, input.oaUrl);
}
```

### 自定义识别规则
在 `WorkflowApiIdentifierAgent` 中修改 `ruleBasedFilter` 方法：

```typescript
private ruleBasedFilter(endpoints: any[]): any[] {
  // 添加自定义过滤规则
  return endpoints.filter(endpoint => {
    // 自定义逻辑
  });
}
```

### 添加新的验证逻辑
在 `ApiValidatorAgent` 中扩展验证方法：

```typescript
private async customValidation(endpoint: any): Promise<any> {
  // 自定义验证逻辑
}
```

## 最佳实践

1. **API文档质量**: 确保上传的API文档完整、准确
2. **认证配置**: 提供正确的认证信息以便验证接口
3. **分批处理**: 对于大量接口，建议分批上传
4. **定期更新**: 当OA系统API变更时，重新上传文档
5. **验证结果**: 关注验证失败的接口，及时修正配置

## 故障排查

### 上传失败
- 检查文件格式是否正确
- 确认文件大小不超过限制
- 查看后端日志获取详细错误信息

### 识别不准确
- 提供更详细的API描述
- 使用OpenAPI格式以获得更好的识别效果
- 检查LLM配置是否正确

### 验证失败
- 确认OA系统URL可访问
- 检查认证配置是否正确
- 查看网络连接和防火墙设置

## 未来改进

1. 支持更多API文档格式（GraphQL、gRPC等）
2. 增强识别算法，提高准确率
3. 支持批量导入和导出
4. 添加API版本管理
5. 实现API变更检测和通知
6. 提供API测试工具
7. 支持自定义识别规则配置