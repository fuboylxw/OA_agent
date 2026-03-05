# 🚀 MCP 架构快速开始指南

## 📋 概述

基于 MCP (Model Context Protocol) 的新架构允许你通过上传 API 文档快速接入任意 OA 系统，无需编写任何适配器代码。

## 🎯 核心概念

### 传统方式 vs MCP 方式

**传统方式**（需要 2-3 天）：
```typescript
// 1. 编写适配器代码
class MyOAAdapter implements OAAdapter {
  async discover() { /* 硬编码 */ }
  async submit() { /* 硬编码 */ }
  async queryStatus() { /* 硬编码 */ }
  // ... 更多方法
}

// 2. 编写测试
// 3. 部署上线
```

**MCP 方式**（只需 5 分钟）：
```bash
# 1. 上传 API 文档
curl -X POST http://localhost:3001/api/v1/bootstrap/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "oaUrl": "https://your-oa.com",
    "apiDocUrl": "https://your-oa.com/api-docs.json"
  }'

# 2. 等待自动解析（5-10 秒）
# 3. 完成！可以使用了
```

---

## 🛠️ 使用方法

### 方式 1: 提供 API 文档 URL

**适用场景**: OA 系统提供了 OpenAPI/Swagger 文档

```bash
curl -X POST http://localhost:3001/api/v1/bootstrap/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "oaUrl": "https://your-oa-system.com",
    "apiDocType": "openapi",
    "apiDocUrl": "https://your-oa-system.com/api-docs.json"
  }'
```

### 方式 2: 直接上传 API 文档内容

**适用场景**: 你有 API 文档的 JSON 内容

```bash
curl -X POST http://localhost:3001/api/v1/bootstrap/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "oaUrl": "https://your-oa-system.com",
    "apiDocType": "openapi",
    "apiDocContent": "{\"openapi\":\"3.0.0\",\"paths\":...}"
  }'
```

### 方式 3: 只提供 OA URL（自动探测）

**适用场景**: O2OA 系统或其他已知的 OA 系统

```bash
curl -X POST http://localhost:3001/api/v1/bootstrap/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "oaUrl": "http://localhost/x_desktop/index.html"
  }'
```

系统会自动：
1. 检测 OA 类型（O2OA/钉钉/企业微信等）
2. 探测已知的 API 端点
3. 调用 API 获取应用和流程列表
4. 生成伪 OpenAPI 文档

---

## 📊 查看生成的 MCP 工具

### 1. 查看 Bootstrap 任务状态

```bash
# 获取任务 ID（从创建响应中）
JOB_ID="415253c4-4e89-44e8-8339-a3aba5e05908"

# 查看任务详情
curl http://localhost:3001/api/v1/bootstrap/jobs/$JOB_ID | jq
```

**响应示例**:
```json
{
  "id": "415253c4-4e89-44e8-8339-a3aba5e05908",
  "status": "REVIEW",
  "flowIRs": [
    {
      "flowCode": "default",
      "flowName": "创建工作（发起流程）",
      "submitUrl": "/x_processplatform_assemble_surface/jaxrs/work"
    }
  ],
  "reports": [
    {
      "oclLevel": "OCL3",
      "confidence": 0.9,
      "recommendation": "Successfully parsed API documentation. 11 endpoints discovered."
    }
  ]
}
```

### 2. 查看生成的 MCP 工具列表

```bash
# 从任务详情中获取 connectorId
CONNECTOR_ID="030d6fbd-87b1-4adf-be2a-4008f00a0c1e"

# 列出所有工具
curl "http://localhost:3001/api/v1/mcp/tools?connectorId=$CONNECTOR_ID" | jq
```

**响应示例**:
```json
[
  {
    "id": "tool-1",
    "toolName": "post_work",
    "toolDescription": "创建工作（发起流程）",
    "category": "submit",
    "flowCode": "default",
    "enabled": true
  },
  {
    "id": "tool-2",
    "toolName": "get_worklog_work",
    "toolDescription": "获取工作日志",
    "category": "query",
    "enabled": true
  }
  // ... 更多工具
]
```

### 3. 查看工具详情

```bash
curl "http://localhost:3001/api/v1/mcp/tools/post_work?connectorId=$CONNECTOR_ID" | jq
```

**响应示例**:
```json
{
  "id": "tool-1",
  "toolName": "post_work",
  "toolDescription": "创建工作（发起流程）",
  "toolSchema": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "description": "标题"
      },
      "content": {
        "type": "string",
        "description": "内容"
      }
    },
    "required": ["title"]
  },
  "apiEndpoint": "/x_processplatform_assemble_surface/jaxrs/work",
  "httpMethod": "POST",
  "paramMapping": {
    "title": "title",
    "content": "content"
  },
  "responseMapping": {
    "success": "type",
    "submissionId": "data.id",
    "message": "message"
  },
  "category": "submit",
  "testInput": {
    "title": "测试申请",
    "content": "这是一个测试"
  }
}
```

---

## 🧪 测试 MCP 工具

### 使用测试数据测试工具

```bash
curl -X POST "http://localhost:3001/api/v1/mcp/tools/post_work/test?connectorId=$CONNECTOR_ID"
```

**响应示例**:
```json
{
  "success": "success",
  "submissionId": "work-12345",
  "message": "工作创建成功"
}
```

### 使用自定义参数执行工具

```bash
curl -X POST "http://localhost:3001/api/v1/mcp/tools/post_work/execute" \
  -H 'Content-Type: application/json' \
  -d '{
    "connectorId": "030d6fbd-87b1-4adf-be2a-4008f00a0c1e",
    "params": {
      "title": "差旅费报销",
      "content": "北京出差，费用 1000 元"
    }
  }'
```

**响应示例**:
```json
{
  "success": "success",
  "submissionId": "work-67890",
  "message": "工作创建成功"
}
```

---

## 📝 发布到流程库

当你确认工具测试通过后，可以发布到流程库，让用户通过对话工作台使用。

```bash
curl -X POST "http://localhost:3001/api/v1/bootstrap/jobs/$JOB_ID/publish"
```

**响应示例**:
```json
{
  "success": true,
  "connectorId": "030d6fbd-87b1-4adf-be2a-4008f00a0c1e"
}
```

发布后：
- ✅ MCP 工具已关联到正式的 Connector
- ✅ 流程已发布到流程库
- ✅ 用户可以在对话工作台中使用

---

## 💬 通过对话工作台使用

### 前端访问

打开对话工作台：
```bash
open http://localhost:3000/chat
```

### 对话示例

**用户**: "我要报销差旅费"

**系统内部流程**:
1. Intent Agent 识别意图: `create_submission`
2. Flow Agent 匹配流程: `差旅费报销`
3. Form Agent 提取字段: `{amount: 1000, ...}`
4. 查询 MCP 工具: `category=submit, flowCode=travel_expense`
5. MCPExecutor 执行工具:
   ```typescript
   await mcpExecutor.executeTool('post_work', {
     title: '差旅费报销',
     amount: 1000,
     reason: '北京出差'
   }, connectorId);
   ```
6. 返回结果

**助手**: "申请已提交成功！申请编号：EXP-2024-001"

---

## 🔧 高级配置

### 自定义参数映射

如果自动生成的参数映射不符合需求，可以手动编辑：

```bash
curl -X PUT "http://localhost:3001/api/v1/mcp/tools/tool-1" \
  -H 'Content-Type: application/json' \
  -d '{
    "paramMapping": {
      "title": "title",
      "amount": {
        "source": "amount",
        "transform": "toNumber"
      },
      "submitDate": {
        "source": "date",
        "transform": "toDate"
      }
    }
  }'
```

**支持的转换函数**:
- `toString` - 转为字符串
- `toNumber` - 转为数字
- `toBoolean` - 转为布尔值
- `toDate` - 转为 ISO 日期字符串
- `toArray` - 转为数组
- `toUpperCase` - 转为大写
- `toLowerCase` - 转为小写
- `function:value * 100` - 自定义函数（使用 JavaScript 表达式）

### 自定义响应映射

```bash
curl -X PUT "http://localhost:3001/api/v1/mcp/tools/tool-1" \
  -H 'Content-Type: application/json' \
  -d '{
    "responseMapping": {
      "success": "type",
      "submissionId": "data.work.id",
      "title": "data.work.title",
      "status": "data.work.activityName"
    }
  }'
```

**点号路径访问**:
- `"data.id"` → 访问 `response.data.id`
- `"data.work.title"` → 访问 `response.data.work.title`
- `"items[0].name"` → 访问 `response.items[0].name`

### 禁用/启用工具

```bash
# 禁用工具
curl -X PUT "http://localhost:3001/api/v1/mcp/tools/tool-1" \
  -H 'Content-Type: application/json' \
  -d '{"enabled": false}'

# 启用工具
curl -X PUT "http://localhost:3001/api/v1/mcp/tools/tool-1" \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true}'
```

---

## 🎓 实际案例

### 案例 1: 接入 O2OA 系统

**步骤 1**: 创建 Bootstrap 任务
```bash
curl -X POST http://localhost:3001/api/v1/bootstrap/jobs \
  -H 'Content-Type: application/json' \
  -d '{"oaUrl":"http://localhost/x_desktop/index.html"}'
```

**步骤 2**: 等待处理（约 20 秒）

**步骤 3**: 查看结果
```bash
# 获取任务 ID
JOB_ID="415253c4-4e89-44e8-8339-a3aba5e05908"

# 查看生成的工具
curl "http://localhost:3001/api/v1/mcp/tools?connectorId=030d6fbd-87b1-4adf-be2a-4008f00a0c1e"
```

**结果**: ✅ 生成了 11 个 MCP 工具
- `post_work` - 创建工作（发起流程）
- `get_work` - 获取工作详情
- `delete_work` - 删除/撤回工作
- `put_task_process` - 处理任务（审批）
- `get_worklog_work` - 获取工作日志
- `get_application_list` - 获取应用列表
- `get_process_list_application` - 获取流程列表
- `get_task_list_my` - 获取我的待办任务
- `get_workcompleted_list_my` - 获取已完成工作
- `get_person_list` - 获取人员列表
- `get_department_list` - 获取部门列表

**步骤 4**: 测试工具
```bash
curl -X POST "http://localhost:3001/api/v1/mcp/tools/post_work/test?connectorId=030d6fbd-87b1-4adf-be2a-4008f00a0c1e"
```

**步骤 5**: 发布
```bash
curl -X POST "http://localhost:3001/api/v1/bootstrap/jobs/$JOB_ID/publish"
```

**完成！** 🎉

---

## 🐛 故障排查

### 问题 1: Bootstrap 任务失败

**症状**: 任务状态变为 `FAILED`

**排查步骤**:
```bash
# 1. 查看任务详情
curl http://localhost:3001/api/v1/bootstrap/jobs/$JOB_ID

# 2. 查看 Worker 日志
tail -100 /tmp/oa-agent-worker.log

# 3. 检查 O2OA 系统是否可访问
curl -I http://localhost/x_desktop/index.html

# 4. 检查 O2OA Token 是否有效
curl -H "x-token: $O2OA_TOKEN" \
  http://localhost/x_processplatform_assemble_surface/jaxrs/application/list
```

### 问题 2: 工具执行失败

**症状**: 执行工具时返回错误

**排查步骤**:
```bash
# 1. 查看工具详情
curl "http://localhost:3001/api/v1/mcp/tools/post_work?connectorId=$CONNECTOR_ID"

# 2. 检查参数映射是否正确
# 3. 检查 API 端点是否可访问
# 4. 检查认证配置是否正确

# 5. 查看 API 日志
tail -100 /tmp/oa-agent-api.log
```

### 问题 3: 没有生成工具

**症状**: Bootstrap 完成但没有生成 MCP 工具

**原因**:
- API 文档格式不正确
- API 文档为空
- 解析失败

**解决方案**:
```bash
# 1. 检查 API 文档内容
curl https://your-oa-system.com/api-docs.json | jq

# 2. 验证 API 文档格式
# OpenAPI 文档必须包含 "openapi" 或 "swagger" 字段

# 3. 重新创建任务，使用 apiDocContent 直接上传内容
```

---

## 📚 参考资料

### API 文档格式支持

| 格式 | 支持 | 说明 |
|------|------|------|
| OpenAPI 3.0 | ✅ | 推荐，自动解析 |
| Swagger 2.0 | ✅ | 自动解析 |
| Postman Collection | ⏳ | 计划支持 |
| HAR 文件 | ⏳ | 计划支持 |
| 自定义文档 | ✅ | 使用 LLM 解析 |

### 认证方式支持

| 认证方式 | 支持 | 配置示例 |
|---------|------|---------|
| API Key | ✅ | `{token: "xxx", headerName: "x-token"}` |
| Basic Auth | ✅ | `{username: "xxx", password: "xxx"}` |
| OAuth2 | ✅ | `{accessToken: "xxx"}` |
| Cookie | ⏳ | 计划支持 |

### 工具分类

| 分类 | 说明 | 示例 |
|------|------|------|
| submit | 提交申请 | 创建工作、发起流程 |
| query | 查询状态 | 获取工作日志、查询进度 |
| cancel | 取消申请 | 删除工作、撤回申请 |
| urge | 催办 | 催办任务 |
| approve | 审批 | 处理任务、审批申请 |
| list | 列表查询 | 获取任务列表、应用列表 |
| get | 详情查询 | 获取工作详情 |

---

## 🎯 最佳实践

### 1. API 文档准备

- ✅ 确保 API 文档完整（包含所有端点）
- ✅ 包含详细的参数描述
- ✅ 包含响应格式示例
- ✅ 标注必填参数

### 2. 工具命名

- ✅ 使用清晰的工具名（如 `submit_expense` 而不是 `api1`）
- ✅ 包含动作和资源（如 `get_task_list`）
- ✅ 使用下划线分隔（如 `post_work` 而不是 `postWork`）

### 3. 参数映射

- ✅ 使用简单映射（1:1）作为默认
- ✅ 只在必要时使用转换函数
- ✅ 测试参数映射是否正确

### 4. 测试

- ✅ 先使用测试数据测试工具
- ✅ 验证响应映射是否正确
- ✅ 确认所有必填参数都已提供
- ✅ 测试通过后再发布

---

## 🚀 下一步

1. **接入你的第一个 OA 系统**
   - 准备 API 文档
   - 创建 Bootstrap 任务
   - 测试生成的工具
   - 发布到流程库

2. **在对话工作台中使用**
   - 打开 http://localhost:3000/chat
   - 尝试发起申请
   - 查询申请状态

3. **优化和调整**
   - 根据实际使用情况调整参数映射
   - 优化响应映射
   - 添加更多工具

---

**祝你使用愉快！** 🎉

如有问题，请查看：
- 完整实现报告: `MCP_IMPLEMENTATION_REPORT.md`
- 架构设计文档: `ARCHITECTURE_REDESIGN.md`
- 测试报告: `ACTUAL_TEST_REPORT.md`
