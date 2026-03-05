# API 快速参考卡片

## 🚀 快速开始

```bash
# 1. 启动服务
docker compose up -d
cd apps/api && pnpm dev

# 2. 验证接口
curl http://localhost:3001/api/v1/health

# 3. 运行测试
./scripts/test-all-endpoints.sh
```

---

## 📋 常用接口速查

### 环境变量
```bash
export API_URL="http://localhost:3001/api/v1"
export TENANT_ID="7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe"
export USER_ID="e228391e-81b2-401c-8381-995be98b3866"
```

### 1. 智能对话 → 提交流程

```bash
# Step 1: 发起对话
curl -X POST $API_URL/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "我要报销差旅费1000元，事由是出差北京，日期2026-03-01",
    "userId": "'$USER_ID'"
  }'
# 返回: draftId

# Step 2: 提交草稿
curl -X POST $API_URL/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "draftId": "{从上一步获取}",
    "idempotencyKey": "unique-'$(date +%s)'",
    "userId": "'$USER_ID'"
  }'
# 返回: submissionId

# Step 3: 查询状态
curl $API_URL/status/submissions/{submissionId}
```

### 2. 连接器管理

```bash
# 列出连接器
curl "$API_URL/connectors?tenantId=$TENANT_ID"

# 创建连接器
curl -X POST $API_URL/connectors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试OA",
    "oaType": "openapi",
    "baseUrl": "http://example.com",
    "authType": "apikey",
    "authConfig": {"key": "test"},
    "oclLevel": "OCL3"
  }'

# 健康检查
curl -X POST $API_URL/connectors/{id}/health-check
```

### 3. 流程库查询

```bash
# 列出所有流程
curl "$API_URL/process-library?tenantId=$TENANT_ID"

# 获取特定流程
curl "$API_URL/process-library/travel_expense?tenantId=$TENANT_ID"

# 查看所有版本
curl "$API_URL/process-library/travel_expense/versions?tenantId=$TENANT_ID"
```

### 4. 提交操作

```bash
# 催办
curl -X POST "$API_URL/submissions/{id}/urge?userId=$USER_ID"

# 补件
curl -X POST "$API_URL/submissions/{id}/supplement?userId=$USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"supplementData": {"attachment": "file.pdf", "note": "补充材料"}}'

# 转办
curl -X POST "$API_URL/submissions/{id}/delegate?userId=$USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"targetUserId": "other-user-id", "reason": "请帮忙处理"}'

# 撤回
curl -X POST "$API_URL/submissions/{id}/cancel?userId=$USER_ID"
```

### 5. 审计查询

```bash
# 查询日志
curl "$API_URL/audit/logs?tenantId=$TENANT_ID&limit=10"

# 按用户查询
curl "$API_URL/audit/logs?tenantId=$TENANT_ID&userId=$USER_ID"

# 追踪链路
curl "$API_URL/audit/trace/{traceId}?tenantId=$TENANT_ID"

# 统计数据
curl "$API_URL/audit/stats?tenantId=$TENANT_ID"
```

### 6. 权限检查

```bash
curl -X POST $API_URL/permission/check \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "'$USER_ID'",
    "processCode": "travel_expense",
    "action": "submit"
  }'
```

---

## 🎯 测试场景

### 场景 1: 新用户首次使用

```bash
# 1. 查看可用流程
curl "$API_URL/process-library?tenantId=$TENANT_ID"

# 2. 发起对话
curl -X POST $API_URL/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "有什么流程可以办理？", "userId": "'$USER_ID'"}'

# 3. 选择流程并填写
curl -X POST $API_URL/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "我要报销差旅费", "userId": "'$USER_ID'"}'
```

### 场景 2: 查询我的申请

```bash
# 1. 列出我的提交
curl "$API_URL/status/my?tenantId=$TENANT_ID&userId=$USER_ID"

# 2. 查看详情
curl "$API_URL/submissions/{id}"

# 3. 查看时间线
curl "$API_URL/status/submissions/{id}/timeline"
```

### 场景 3: 管理员操作

```bash
# 1. 查看所有提交
curl "$API_URL/submissions?tenantId=$TENANT_ID"

# 2. 查看审计日志
curl "$API_URL/audit/logs?tenantId=$TENANT_ID&limit=50"

# 3. 查看统计
curl "$API_URL/audit/stats?tenantId=$TENANT_ID"

# 4. 管理连接器
curl "$API_URL/connectors?tenantId=$TENANT_ID"
```

---

## 🔧 常见问题快速解决

### Q: 接口返回 404
```bash
# 检查 API 是否启动
curl http://localhost:3001/api/v1/health

# 检查路径是否正确（注意 /api/v1 前缀）
```

### Q: Chat 接口返回 500
```bash
# 确保使用真实的 userId
docker exec uniflow-postgres psql -U uniflow -d uniflow_oa -c \
  "SELECT id, username FROM users;"
```

### Q: Process Library 为空
```bash
# 创建测试流程模板
docker exec uniflow-postgres psql -U uniflow -d uniflow_oa -c "
INSERT INTO process_templates (
  id, \"tenantId\", \"connectorId\", \"processCode\", \"processName\",
  \"processCategory\", version, status, \"falLevel\", schema, rules,
  permissions, \"publishedAt\", \"createdAt\", \"updatedAt\"
) VALUES (
  'test-template-001',
  '7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe',
  '414c145b-bd5e-439f-8dff-36c3584b84ae',
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

### Q: 提交失败
```bash
# 检查权限
curl -X POST $API_URL/permission/check \
  -H "Content-Type: application/json" \
  -d '{"userId": "'$USER_ID'", "processCode": "travel_expense", "action": "submit"}'

# 检查草稿状态
curl "$API_URL/submissions?tenantId=$TENANT_ID&userId=$USER_ID"
```

---

## 📊 响应状态码

| 状态码 | 含义 | 说明 |
|--------|------|------|
| 200 | OK | 请求成功 |
| 201 | Created | 资源创建成功 |
| 400 | Bad Request | 请求参数错误 |
| 404 | Not Found | 资源不存在 |
| 500 | Internal Server Error | 服务器错误 |

---

## 🎨 响应格式示例

### 成功响应
```json
{
  "id": "uuid",
  "status": "success",
  "data": { ... }
}
```

### 错误响应
```json
{
  "statusCode": 400,
  "message": "错误描述",
  "error": "Bad Request"
}
```

### 列表响应
```json
{
  "items": [...],
  "total": 100,
  "limit": 10,
  "offset": 0
}
```

---

## 🔗 相关链接

- **API 文档**: http://localhost:3001/api/docs
- **完整测试报告**: [API_TEST_COMPLETE_REPORT.md](./API_TEST_COMPLETE_REPORT.md)
- **测试指南**: [API_TESTING_GUIDE.md](./API_TESTING_GUIDE.md)
- **项目文档**: [README.md](./README.md)

---

## 💡 提示

1. **使用 jq 格式化输出**:
   ```bash
   curl $API_URL/health | jq .
   ```

2. **保存响应到变量**:
   ```bash
   RESPONSE=$(curl -s $API_URL/health)
   echo $RESPONSE | jq .status
   ```

3. **批量测试**:
   ```bash
   ./scripts/test-all-endpoints.sh
   ```

4. **查看实时日志**:
   ```bash
   # API 日志
   cd apps/api && pnpm dev

   # 数据库日志
   docker logs -f uniflow-postgres
   ```

---

**最后更新**: 2026-03-03
**版本**: 1.0
