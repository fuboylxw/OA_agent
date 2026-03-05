# API上传与办事流程识别系统 - 快速开始

## 功能概述

本系统实现了完整的API文件上传、办事流程接口识别、验证和MCP工具自动生成功能。

### 核心功能

1. **API文档解析** - 支持OpenAPI、Swagger、Postman等格式
2. **智能识别** - 自动识别办事流程接口（请假、报销、考勤等）
3. **接口验证** - 验证接口可访问性和参数
4. **数据存储** - 存储到ProcessTemplate和MCPTool表
5. **MCP工具生成** - 自动生成MCP工具定义
6. **前端展示** - 提供上传页面和流程库页面

## 快速开始

### 1. 启动服务

```bash
# 启动数据库和Redis
docker compose up -d postgres redis

# 启动API服务
cd apps/api
pnpm dev

# 启动前端服务
cd apps/web
pnpm dev
```

### 2. 访问页面

- API上传页面: http://localhost:3000/api-upload
- 流程库页面: http://localhost:3000/process-library

### 3. 上传API文档

#### 方式1: 通过前端页面

1. 访问 http://localhost:3000/api-upload
2. 选择API文档文件（支持.json, .yaml格式）
3. 填写配置信息：
   - 文档类型：OpenAPI 3.0 / Swagger 2.0 / Postman / 自定义
   - OA系统URL：如 https://oa.example.com
   - 认证配置：根据认证类型填写
4. 勾选选项：
   - ✓ 自动验证接口可访问性
   - ✓ 自动生成MCP工具
5. 点击"上传并处理"

#### 方式2: 通过API调用

```bash
# 使用示例文件
curl -X POST http://localhost:3001/mcp/upload-api-json \
  -H "Content-Type: application/json" \
  -d @fixtures/sample-oa-api.json
```

完整请求示例：

```bash
curl -X POST http://localhost:3001/mcp/upload-api-json \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "default-tenant",
    "connectorId": "default-connector",
    "docType": "openapi",
    "docContent": "...",
    "oaUrl": "https://oa.example.com",
    "authConfig": {
      "type": "apikey",
      "headerName": "X-API-Key",
      "apiKey": "your-api-key"
    },
    "autoValidate": true,
    "autoGenerateMcp": true
  }'
```

### 4. 查看结果

上传成功后，系统会返回：

```json
{
  "uploadId": "upload-1234567890",
  "totalEndpoints": 7,
  "workflowEndpoints": 5,
  "validatedEndpoints": 5,
  "generatedMcpTools": 5,
  "workflowApis": [...],
  "validationResults": [...],
  "mcpTools": [...]
}
```

### 5. 查看流程库

访问 http://localhost:3000/process-library 查看所有识别的办事流程。

## 测试

### 运行自动化测试

```bash
# 运行测试脚本
pnpm tsx scripts/test-api-upload.ts
```

测试脚本会：
1. 上传示例API文档
2. 显示识别的办事流程接口
3. 显示生成的MCP工具
4. 查询流程库
5. 测试MCP工具执行
6. 生成测试报告

### 使用示例文件

项目提供了示例API文档：

```bash
fixtures/sample-oa-api.json
```

包含以下办事流程接口：
- 请假申请 (POST /leave/submit)
- 报销申请 (POST /expense/submit)
- 考勤查询 (GET /attendance/query)
- 加班申请 (POST /overtime/submit)
- 出差申请 (POST /business-trip/submit)

## 认证配置示例

### API Key认证

```json
{
  "type": "apikey",
  "headerName": "X-API-Key",
  "apiKey": "your-api-key-here"
}
```

### Bearer Token认证

```json
{
  "type": "bearer",
  "token": "your-bearer-token-here"
}
```

### Basic Auth认证

```json
{
  "type": "basic",
  "username": "your-username",
  "password": "your-password"
}
```

### OAuth 2.0认证

```json
{
  "type": "oauth2",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "tokenUrl": "https://oa.example.com/oauth/token"
}
```

## API端点

### 上传API文档（文件）

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
- autoValidate: 是否自动验证（'true'/'false'）
- autoGenerateMcp: 是否自动生成MCP工具（'true'/'false'）
```

### 上传API文档（JSON）

```
POST /api/mcp/upload-api-json
Content-Type: application/json

Body: {
  "tenantId": "string",
  "connectorId": "string",
  "docType": "openapi" | "swagger" | "postman" | "custom",
  "docContent": "string",
  "oaUrl": "string",
  "authConfig": {},
  "autoValidate": boolean,
  "autoGenerateMcp": boolean
}
```

### 获取上传历史

```
GET /api/mcp/upload-history?tenantId=xxx&connectorId=xxx
```

### 列出MCP工具

```
GET /api/mcp/tools?connectorId=xxx&category=submit
```

### 执行MCP工具

```
POST /api/mcp/tools/:toolName/execute
Body: {
  "connectorId": "string",
  "params": {}
}
```

### 测试MCP工具

```
POST /api/mcp/tools/:toolName/test?connectorId=xxx
```

## 工作流程

```
1. 用户上传API文档
   ↓
2. ApiDocParserAgent 解析文档
   ↓
3. WorkflowApiIdentifierAgent 识别办事流程接口
   ↓
4. ApiValidatorAgent 验证接口（可选）
   ↓
5. 存储到 ProcessTemplate 表
   ↓
6. MCPToolGeneratorService 生成MCP工具
   ↓
7. 存储到 MCPTool 表
   ↓
8. 返回处理结果
```

## 识别规则

系统使用以下规则识别办事流程接口：

### 包含的接口类型
- 请假申请、审批
- 报销申请、审批
- 考勤查询、打卡
- 加班申请
- 出差申请
- 采购申请
- 会议室预订
- 等等...

### 排除的接口类型
- 用户管理（登录、注册、个人信息）
- 系统管理（配置、日志、监控）
- 基础数据（部门列表、员工列表）
- 认证授权（token刷新、权限检查）

## 数据库表

### ProcessTemplate
存储识别的办事流程定义

```sql
SELECT * FROM process_templates
WHERE tenant_id = 'default-tenant'
ORDER BY created_at DESC;
```

### MCPTool
存储自动生成的MCP工具

```sql
SELECT * FROM mcp_tools
WHERE connector_id = 'default-connector'
ORDER BY created_at DESC;
```

## 故障排查

### 上传失败

**问题**: 文件上传失败

**解决方案**:
- 检查文件格式是否正确（.json, .yaml）
- 确认文件大小不超过限制
- 查看API服务日志

### 识别不准确

**问题**: 办事流程接口识别不准确

**解决方案**:
- 确保API文档包含详细的描述信息
- 使用OpenAPI 3.0格式以获得最佳效果
- 检查LLM配置（OPENAI_API_KEY等）

### 验证失败

**问题**: 接口验证失败

**解决方案**:
- 确认OA系统URL可访问
- 检查认证配置是否正确
- 查看网络连接和防火墙设置
- 可以先关闭自动验证功能

### MCP工具生成失败

**问题**: MCP工具生成失败

**解决方案**:
- 检查数据库连接
- 确认connectorId存在
- 查看API服务日志获取详细错误

## 环境变量

确保以下环境变量已配置：

```bash
# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/oa_agent

# OpenAI (用于LLM识别)
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1

# 或使用其他LLM提供商
# ANTHROPIC_API_KEY=...
# AZURE_OPENAI_API_KEY=...
```

## 下一步

1. 查看完整文档: [docs/API_UPLOAD_SYSTEM.md](../docs/API_UPLOAD_SYSTEM.md)
2. 了解系统架构: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
3. 查看API文档: http://localhost:3001/api/docs

## 支持

如有问题，请：
1. 查看日志文件
2. 运行测试脚本诊断
3. 提交Issue到GitHub仓库
