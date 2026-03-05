# API 接口测试指南

本文档提供快速测试所有 API 接口的方法和示例。

## 快速开始

### 1. 启动服务

```bash
# 启动 Docker 服务 (PostgreSQL, Redis, MinIO)
docker compose up -d

# 生成 Prisma Client
npx prisma generate --schema=prisma/schema.prisma

# 启动 API 服务
cd apps/api
pnpm dev
```

API 服务将在 `http://localhost:3001` 启动。

### 2. 运行测试脚本

```bash
# 测试所有接口
./scripts/test-all-endpoints.sh

# 测试完整工作流
./scripts/test-complete-workflow.sh
```

---

## 测试环境变量

```bash
API_URL="http://localhost:3001/api/v1"
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
USER_ID="e228391e-81b2-401c-8381-995be98b3866"  # admin 用户
```

---

## 接口分类测试

### 1. Health Check

```bash
# 健康检查
curl http://localhost:3001/api/v1/health
```

**预期响应**:
```json
{
  "status": "ok",
  "timestamp": "2026-03-03T07:26:27.808Z",
  "service": "uniflow-oa-api"
}
```

---

### 2. Connectors (连接器)

```bash
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"

# 列出连接器
curl "http://localhost:3001/api/v1/connectors?tenantId=$TENANT_ID"

# 创建连接器
curl -X POST http://localhost:3001/api/v1/connectors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test OA",
    "oaType": "openapi",
    "baseUrl": "http://example.com",
    "authType": "apikey",
    "authConfig": {"key": "test"},
    "oclLevel": "OCL3"
  }'

# 获取连接器详情
curl http://localhost:3001/api/v1/connectors/{connector_id}

# 更新连接器
curl -X PUT http://localhost:3001/api/v1/connectors/{connector_id} \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Name"}'

# 健康检查
curl -X POST http://localhost:3001/api/v1/connectors/{connector_id}/health-check

# 删除连接器
curl -X DELETE http://localhost:3001/api/v1/connectors/{connector_id}
```

---

### 3. Process Library (流程库)

```bash
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"

# 列出流程模板
curl "http://localhost:3001/api/v1/process-library?tenantId=$TENANT_ID"

# 根据流程代码获取
curl "http://localhost:3001/api/v1/process-library/travel_expense?tenantId=$TENANT_ID"

# 根据 ID 获取
curl http://localhost:3001/api/v1/process-library/id/{template_id}

# 列出所有版本
curl "http://localhost:3001/api/v1/process-library/travel_expense/versions?tenantId=$TENANT_ID"
```

---

### 4. Bootstrap (初始化中心)

```bash
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"

# 创建初始化任务
curl -X POST http://localhost:3001/api/v1/bootstrap/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "oaUrl": "http://test-oa.example.com",
    "openApiUrl": "http://test-oa.example.com/openapi.json"
  }'

# 列出任务
curl "http://localhost:3001/api/v1/bootstrap/jobs?tenantId=$TENANT_ID"

# 获取任务详情
curl http://localhost:3001/api/v1/bootstrap/jobs/{job_id}

# 获取评估报告
curl http://localhost:3001/api/v1/bootstrap/jobs/{job_id}/report

# 发布到流程库
curl -X POST http://localhost:3001/api/v1/bootstrap/jobs/{job_id}/publish
```

---

### 5. Assistant (智能助手)

```bash
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
USER_ID="e228391e-81b2-401c-8381-995be98b3866"

# 发送消息
curl -X POST http://localhost:3001/api/v1/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "我要报销差旅费1000元，事由是出差北京，日期2026-03-01",
    "userId": "'$USER_ID'"
  }'

# 列出会话
curl "http://localhost:3001/api/v1/assistant/sessions?tenantId=$TENANT_ID&userId=$USER_ID"

# 获取会话消息
curl http://localhost:3001/api/v1/assistant/sessions/{session_id}/messages
```

**助手功能测试**:

1. **意图识别** (7种意图):
   - `CREATE_SUBMISSION`: "我要报销"
   - `QUERY_STATUS`: "我的申请到哪了"
   - `CANCEL_SUBMISSION`: "撤回申请"
   - `URGE`: "催办"
   - `SUPPLEMENT`: "补件"
   - `DELEGATE`: "转办"
   - `SERVICE_REQUEST`: "有什么流程"

2. **流程匹配**:
   - 关键词匹配
   - 模糊匹配
   - 分类匹配

3. **表单提取**:
   - 数字: "1000元", "金额1000"
   - 日期: "2026-03-01", "今天", "明天"
   - 文本: "事由是XXX", "原因：XXX"

---

### 6. Submissions (提交管理)

```bash
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
USER_ID="e228391e-81b2-401c-8381-995be98b3866"

# 提交草稿
curl -X POST http://localhost:3001/api/v1/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "draftId": "{draft_id}",
    "idempotencyKey": "unique-key-123",
    "userId": "'$USER_ID'"
  }'

# 列出提交
curl "http://localhost:3001/api/v1/submissions?tenantId=$TENANT_ID"

# 获取提交详情
curl http://localhost:3001/api/v1/submissions/{submission_id}

# 撤回
curl -X POST "http://localhost:3001/api/v1/submissions/{submission_id}/cancel?userId=$USER_ID"

# 催办
curl -X POST "http://localhost:3001/api/v1/submissions/{submission_id}/urge?userId=$USER_ID"

# 补件
curl -X POST "http://localhost:3001/api/v1/submissions/{submission_id}/supplement?userId=$USER_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "supplementData": {
      "attachment": "receipt.pdf",
      "note": "补充发票"
    }
  }'

# 转办
curl -X POST "http://localhost:3001/api/v1/submissions/{submission_id}/delegate?userId=$USER_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "targetUserId": "{target_user_id}",
    "reason": "我要出差，请帮忙处理"
  }'
```

---

### 7. Status (状态查询)

```bash
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
USER_ID="e228391e-81b2-401c-8381-995be98b3866"

# 查询提交状态
curl http://localhost:3001/api/v1/status/submissions/{submission_id}

# 列出我的提交
curl "http://localhost:3001/api/v1/status/my?tenantId=$TENANT_ID&userId=$USER_ID"

# 获取时间线
curl http://localhost:3001/api/v1/status/submissions/{submission_id}/timeline
```

---

### 8. Permission (权限管理)

```bash
USER_ID="e228391e-81b2-401c-8381-995be98b3866"

# 检查权限
curl -X POST http://localhost:3001/api/v1/permission/check \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "'$USER_ID'",
    "processCode": "travel_expense",
    "action": "submit"
  }'
```

**支持的操作**:
- `view`: 查看
- `submit`: 提交
- `cancel`: 撤回
- `urge`: 催办
- `delegate`: 转办
- `supplement`: 补件

---

### 9. Audit (审计日志)

```bash
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"

# 查询日志
curl "http://localhost:3001/api/v1/audit/logs?tenantId=$TENANT_ID&limit=10"

# 按用户查询
curl "http://localhost:3001/api/v1/audit/logs?tenantId=$TENANT_ID&userId=$USER_ID"

# 按操作查询
curl "http://localhost:3001/api/v1/audit/logs?tenantId=$TENANT_ID&action=submit_created"

# 获取追踪链路
curl "http://localhost:3001/api/v1/audit/trace/{trace_id}?tenantId=$TENANT_ID"

# 获取统计
curl "http://localhost:3001/api/v1/audit/stats?tenantId=$TENANT_ID"
```

---

## 完整工作流示例

### 场景: 用户通过对话提交差旅费报销

```bash
TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
USER_ID="e228391e-81b2-401c-8381-995be98b3866"

# Step 1: 与助手对话
CHAT_RESPONSE=$(curl -s -X POST http://localhost:3001/api/v1/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "我要报销差旅费3000元，事由是参加技术会议，日期2026-03-10",
    "userId": "'$USER_ID'"
  }')

echo "$CHAT_RESPONSE" | jq .

# 提取 draftId
DRAFT_ID=$(echo "$CHAT_RESPONSE" | jq -r .draftId)
echo "Draft ID: $DRAFT_ID"

# Step 2: 提交草稿
SUBMIT_RESPONSE=$(curl -s -X POST http://localhost:3001/api/v1/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "draftId": "'$DRAFT_ID'",
    "idempotencyKey": "workflow-'$(date +%s)'",
    "userId": "'$USER_ID'"
  }')

echo "$SUBMIT_RESPONSE" | jq .

# 提取 submissionId
SUBMISSION_ID=$(echo "$SUBMIT_RESPONSE" | jq -r .submissionId)
echo "Submission ID: $SUBMISSION_ID"

# Step 3: 查询状态
curl -s http://localhost:3001/api/v1/status/submissions/$SUBMISSION_ID | jq .

# Step 4: 催办
curl -s -X POST "http://localhost:3001/api/v1/submissions/$SUBMISSION_ID/urge?userId=$USER_ID" | jq .

# Step 5: 补件
curl -s -X POST "http://localhost:3001/api/v1/submissions/$SUBMISSION_ID/supplement?userId=$USER_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "supplementData": {
      "attachment": "invoice.pdf",
      "note": "补充发票"
    }
  }' | jq .

# Step 6: 查看审计日志
curl -s "http://localhost:3001/api/v1/audit/logs?tenantId=$TENANT_ID&userId=$USER_ID&limit=5" | jq .

# Step 7: 撤回 (如果需要)
curl -s -X POST "http://localhost:3001/api/v1/submissions/$SUBMISSION_ID/cancel?userId=$USER_ID" | jq .
```

---

## 测试数据

### 默认租户
```json
{
  "id": "7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe",
  "code": "default",
  "name": "Default Tenant"
}
```

### 测试用户

**管理员**:
```json
{
  "id": "e228391e-81b2-401c-8381-995be98b3866",
  "username": "admin",
  "email": "admin@example.com",
  "displayName": "Administrator",
  "roles": ["admin", "flow_manager"]
}
```

**普通用户**:
```json
{
  "id": "3e5c8252-04f5-40e1-89df-99e62f766ae1",
  "username": "testuser",
  "email": "test@example.com",
  "displayName": "Test User",
  "roles": ["user"]
}
```

### 测试流程模板

**差旅费报销**:
```json
{
  "processCode": "travel_expense",
  "processName": "差旅费报销",
  "processCategory": "财务类",
  "falLevel": "F2",
  "schema": {
    "fields": [
      {
        "key": "amount",
        "label": "报销金额",
        "type": "number",
        "required": true
      },
      {
        "key": "reason",
        "label": "报销事由",
        "type": "text",
        "required": true
      },
      {
        "key": "date",
        "label": "发生日期",
        "type": "date",
        "required": true
      }
    ]
  }
}
```

---

## 常见问题

### Q1: 如何创建测试流程模板？

```bash
docker exec uniflow-postgres psql -U uniflow -d uniflow_oa -c "
INSERT INTO process_templates (
  id, \"tenantId\", \"connectorId\", \"processCode\", \"processName\",
  \"processCategory\", version, status, \"falLevel\", schema, rules,
  permissions, \"publishedAt\", \"createdAt\", \"updatedAt\"
) VALUES (
  'test-template-001',
  '7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe',
  '{connector_id}',
  'travel_expense',
  '差旅费报销',
  '财务类',
  1,
  'published',
  'F2',
  '{\"fields\": [{\"key\": \"amount\", \"label\": \"报销金额\", \"type\": \"number\", \"required\": true}]}',
  '[]',
  '[]',
  NOW(),
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;
"
```

### Q2: 如何查看数据库中的数据？

```bash
# 查看用户
docker exec uniflow-postgres psql -U uniflow -d uniflow_oa -c "SELECT id, username FROM users;"

# 查看连接器
docker exec uniflow-postgres psql -U uniflow -d uniflow_oa -c "SELECT id, name, \"oaType\" FROM connectors;"

# 查看流程模板
docker exec uniflow-postgres psql -U uniflow -d uniflow_oa -c "SELECT id, \"processCode\", \"processName\" FROM process_templates WHERE status='published';"

# 查看提交记录
docker exec uniflow-postgres psql -U uniflow -d uniflow_oa -c "SELECT id, status, \"createdAt\" FROM submissions ORDER BY \"createdAt\" DESC LIMIT 10;"
```

### Q3: 如何重置测试数据？

```bash
# 重置数据库
npx prisma migrate reset --schema=prisma/schema.prisma

# 重新生成 Prisma Client
npx prisma generate --schema=prisma/schema.prisma

# 运行种子数据
cd apps/api && pnpm prisma db seed
```

### Q4: Chat 接口返回 500 错误？

**原因**: 使用了不存在的 userId

**解决**: 使用数据库中真实的用户 ID:
```bash
# 查询用户 ID
docker exec uniflow-postgres psql -U uniflow -d uniflow_oa -c "SELECT id, username FROM users;"
```

### Q5: Process Library 为空？

**原因**: 没有已发布的流程模板

**解决**: 创建测试流程模板 (参考 Q1)

---

## API 文档

访问 Swagger 文档: http://localhost:3001/api/docs

---

## 测试报告

完整的测试报告请查看: [API_TEST_COMPLETE_REPORT.md](./API_TEST_COMPLETE_REPORT.md)

---

## 相关文档

- [README.md](./README.md) - 项目概览
- [QUICK_START.md](./QUICK_START.md) - 快速开始
- [docs/API.md](./docs/API.md) - API 详细文档
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - 架构设计

---

**最后更新**: 2026-03-03
