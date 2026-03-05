# 后端API测试指南

## 快速开始

### 1. 启动服务

```bash
# 启动数据库和Redis
docker compose up -d postgres redis

# 启动API服务
cd apps/api
pnpm dev
```

### 2. 运行测试

```bash
# 方式1: 使用测试脚本（推荐）
chmod +x scripts/run-backend-tests.sh
./scripts/run-backend-tests.sh

# 方式2: 手动运行
pnpm tsx prisma/seed-test.ts  # 准备测试数据
pnpm tsx scripts/test-backend-apis.ts  # 运行测试
```

## 测试覆盖的接口

### 1. 健康检查
- `GET /health` - 服务健康状态

### 2. API上传功能
- `POST /mcp/upload-api-json` - 上传API文档（JSON格式）
- `POST /mcp/upload-api` - 上传API文档（文件上传）
- `GET /mcp/upload-history` - 获取上传历史

### 3. MCP工具管理
- `GET /mcp/tools` - 列出所有MCP工具
- `GET /mcp/tools?category=submit` - 按分类查询
- `GET /mcp/tools/:toolName` - 获取工具详情
- `POST /mcp/tools/:toolName/execute` - 执行MCP工具
- `POST /mcp/tools/:toolName/test` - 测试MCP工具

### 4. 流程库
- `GET /process-library` - 查询流程库

### 5. 连接器管理
- `GET /connectors` - 列出连接器

## 测试数据

测试脚本会自动创建以下测试数据：

- **租户**: test-tenant
- **用户**: testuser
- **连接器**: test-connector
- **流程模板**: leave_request (请假申请)
- **MCP工具**: leave_request_submit

## 测试报告

测试完成后，会生成详细的测试报告：

```
test-reports/backend-api-test-report.json
```

报告包含：
- 测试总数
- 成功/失败数量
- 成功率
- 每个接口的详细结果（状态码、响应时间、错误信息）

## 预期结果

所有接口应该返回真实数据：

### 1. API上传
```json
{
  "uploadId": "upload-1234567890",
  "totalEndpoints": 3,
  "workflowEndpoints": 2,
  "validatedEndpoints": 0,
  "generatedMcpTools": 2,
  "workflowApis": [...],
  "mcpTools": [...]
}
```

### 2. MCP工具列表
```json
[
  {
    "id": "uuid",
    "toolName": "leave_request_submit",
    "toolDescription": "提交请假申请",
    "category": "submit",
    "flowCode": "leave_request",
    "enabled": true,
    "createdAt": "2024-03-20T10:00:00.000Z"
  }
]
```

### 3. 流程库
```json
[
  {
    "id": "uuid",
    "processCode": "leave_request",
    "processName": "请假申请",
    "processCategory": "请假",
    "status": "published",
    "falLevel": "F2",
    "createdAt": "2024-03-20T10:00:00.000Z"
  }
]
```

## 故障排查

### 问题1: API服务未运行
```bash
# 检查服务状态
curl http://localhost:3001/health

# 启动服务
cd apps/api
pnpm dev
```

### 问题2: 数据库连接失败
```bash
# 检查数据库
docker compose ps postgres

# 启动数据库
docker compose up -d postgres

# 检查连接
psql $DATABASE_URL
```

### 问题3: 测试数据创建失败
```bash
# 重新运行迁移
pnpm prisma migrate reset

# 重新创建测试数据
pnpm tsx prisma/seed-test.ts
```

### 问题4: 某些接口返回404
检查路由配置：
- 确认模块已在 `app.module.ts` 中导入
- 确认控制器路径正确
- 查看API服务日志

### 问题5: LLM相关功能失败
检查环境变量：
```bash
# .env 文件中配置
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
```

## 手动测试示例

### 测试API上传
```bash
curl -X POST http://localhost:3001/mcp/upload-api-json \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "test-tenant-id",
    "connectorId": "test-connector-id",
    "docType": "openapi",
    "docContent": "{...}",
    "oaUrl": "https://oa.example.com",
    "authConfig": {"type": "apikey"},
    "autoValidate": false,
    "autoGenerateMcp": true
  }'
```

### 测试MCP工具列表
```bash
curl "http://localhost:3001/mcp/tools?connectorId=test-connector-id"
```

### 测试流程库
```bash
curl "http://localhost:3001/process-library?tenantId=test-tenant-id"
```

## 性能基准

预期响应时间：
- 健康检查: < 50ms
- API上传: < 5000ms (取决于LLM响应)
- 查询接口: < 200ms
- MCP工具执行: < 3000ms (取决于外部API)

## 持续集成

在CI/CD中运行测试：

```yaml
# .github/workflows/test.yml
- name: Run Backend Tests
  run: |
    docker compose up -d postgres redis
    pnpm install
    pnpm prisma migrate deploy
    pnpm tsx prisma/seed-test.ts
    pnpm tsx scripts/test-backend-apis.ts
```

## 下一步

1. 查看测试报告了解详细结果
2. 如有失败，查看日志定位问题
3. 修复问题后重新运行测试
4. 所有测试通过后，可以进行前端集成测试