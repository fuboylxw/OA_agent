
# 07 API草案

**文档版本**: v1.0
**创建日期**: 2026-03-03

---

## 7.1 API设计原则

### 统一响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": { ... },
  "request_id": "uuid",
  "timestamp": "2026-03-03T10:00:00Z"
}
```

**错误码规范**：
- `0`: 成功
- `400xx`: 客户端错误（40001=参数错误，40003=权限不足）
- `500xx`: 服务端错误（50001=内部错误，50002=外部服务错误）

### RESTful规范

- 使用标准HTTP方法：GET（查询）、POST（创建）、PUT（更新）、DELETE（删除）
- URL使用复数名词：`/api/v1/submissions`
- 版本控制：`/api/v1/`
- 分页参数：`limit`、`offset`

---

## 7.2 Bootstrap模块

### POST /api/v1/bootstrap/jobs
**功能**：创建初始化任务

**请求**：
```json
{
  "oaUrl": "https://oa.example.com",
  "openApiUrl": "https://oa.example.com/openapi.json",
  "harFileUrl": "https://example.com/recording.har"
}
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "id": "uuid",
    "tenantId": "uuid",
    "status": "CREATED",
    "oaUrl": "https://oa.example.com",
    "createdAt": "2026-03-03T10:00:00Z"
  }
}
```

---

### GET /api/v1/bootstrap/jobs
**功能**：列出初始化任务

**查询参数**：
- `tenantId` (required): 租户ID
- `status` (optional): 状态过滤
- `limit` (optional, default=20): 每页数量
- `offset` (optional, default=0): 偏移量

**响应**：
```json
{
  "code": 0,
  "data": [
    {
      "id": "uuid",
      "status": "REVIEW",
      "oaUrl": "https://oa.example.com",
      "createdAt": "2026-03-03T10:00:00Z",
      "updatedAt": "2026-03-03T10:15:00Z"
    }
  ]
}
```

---

### GET /api/v1/bootstrap/jobs/:id
**功能**：获取任务详情

**响应**：
```json
{
  "code": 0,
  "data": {
    "id": "uuid",
    "status": "REVIEW",
    "sources": [...],
    "reports": [...],
    "flowIRs": [...],
    "fieldIRs": [...]
  }
}
```

---

### GET /api/v1/bootstrap/jobs/:id/report
**功能**：获取OCL报告

**响应**：
```json
{
  "code": 0,
  "data": {
    "oclLevel": "OCL3",
    "coverage": 0.85,
    "confidence": 0.90,
    "risk": "low",
    "evidence": {...},
    "recommendation": "建议发布"
  }
}
```

---

### POST /api/v1/bootstrap/jobs/:id/publish
**功能**：发布到流程库

**响应**：
```json
{
  "code": 0,
  "data": {
    "jobId": "uuid",
    "status": "PUBLISHED",
    "publishedTemplates": 5
  }
}
```

---

## 7.3 Connector模块

### POST /api/v1/connectors
**功能**：创建连接器

**请求**：
```json
{
  "name": "Test OA",
  "oaType": "openapi",
  "baseUrl": "https://oa.example.com",
  "authType": "apikey",
  "authConfig": {"key": "xxx"},
  "oclLevel": "OCL3"
}
```

---

### GET /api/v1/connectors
**功能**：列出连接器

**查询参数**：
- `tenantId` (required)
- `status` (optional)

---

### GET /api/v1/connectors/:id
**功能**：获取连接器详情

---

### PUT /api/v1/connectors/:id
**功能**：更新连接器

---

### DELETE /api/v1/connectors/:id
**功能**：删除连接器

---

### POST /api/v1/connectors/:id/health-check
**功能**：健康检查

**响应**：
```json
{
  "code": 0,
  "data": {
    "healthy": true,
    "latencyMs": 101,
    "message": "OA系统连接正常"
  }
}
```

---

## 7.4 Process Library模块

### GET /api/v1/process-library
**功能**：列出流程模板

**查询参数**：
- `tenantId` (required)
- `status` (optional): published/draft/archived
- `category` (optional): 分类过滤

**响应**：
```json
{
  "code": 0,
  "data": [
    {
      "id": "uuid",
      "processCode": "EXPENSE_CLAIM",
      "processName": "差旅报销",
      "processCategory": "财务",
      "version": 1,
      "status": "published",
      "falLevel": "F3"
    }
  ]
}
```

---

### GET /api/v1/process-library/:processCode
**功能**：根据流程代码获取模板

---

### GET /api/v1/process-library/id/:id
**功能**：根据ID获取模板详情

**响应**：
```json
{
  "code": 0,
  "data": {
    "id": "uuid",
    "processCode": "EXPENSE_CLAIM",
    "processName": "差旅报销",
    "fields": [
      {
        "fieldCode": "amount",
        "fieldName": "金额",
        "fieldType": "number",
        "required": true
      }
    ],
    "rules": [...]
  }
}
```

---

### GET /api/v1/process-library/:processCode/versions
**功能**：获取流程的所有版本

---

## 7.5 Assistant模块

### POST /api/v1/assistant/chat
**功能**：发送对话消息

**请求**：
```json
{
  "sessionId": "uuid",
  "message": "我要报销差旅费1200元",
  "userId": "uuid"
}
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "sessionId": "uuid",
    "message": "好的，我帮您发起差旅报销申请。请问出差日期是？",
    "needsInput": true,
    "suggestedActions": [],
    "draft": null
  }
}
```

**草稿确认响应**：
```json
{
  "code": 0,
  "data": {
    "sessionId": "uuid",
    "message": "请确认以下信息",
    "needsInput": true,
    "draft": {
      "processCode": "EXPENSE_CLAIM",
      "processName": "差旅报销",
      "fields": {
        "amount": 1200,
        "destination": "北京",
        "startDate": "2026-03-01",
        "endDate": "2026-03-03"
      }
    },
    "suggestedActions": ["确认提交", "修改"]
  }
}
```

---

### GET /api/v1/assistant/sessions
**功能**：列出用户的对话会话

**查询参数**：
- `tenantId` (required)
- `userId` (required)

---

### GET /api/v1/assistant/sessions/:sessionId/messages
**功能**：获取会话的所有消息

---

## 7.6 Permission模块

### POST /api/v1/permission/check
**功能**：检查用户权限

**请求**：
```json
{
  "userId": "uuid",
  "processCode": "EXPENSE_CLAIM",
  "action": "submit"
}
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "allowed": true,
    "reason": null,
    "platformCheck": {
      "passed": true,
      "reason": "用户角色teacher有报销权限"
    },
    "oaCheck": {
      "passed": true,
      "reason": "OA系统确认有权限"
    }
  }
}
```

**拒绝响应**：
```json
{
  "code": 0,
  "data": {
    "allowed": false,
    "reason": "您当前角色（教师）没有大额采购申请权限",
    "platformCheck": {
      "passed": false,
      "reason": "角色teacher不在流程白名单"
    },
    "oaCheck": {
      "passed": true,
      "reason": "OA check skipped (platform denied)"
    },
    "suggestion": "联系部门主任代为发起，或申请权限升级"
  }
}
```

---

## 7.7 Submission模块

### POST /api/v1/submissions
**功能**：创建提交

**请求**：
```json
{
  "templateId": "uuid",
  "sessionId": "uuid",
  "idempotencyKey": "uuid",
  "formData": {
    "amount": 1200,
    "destination": "北京",
    "startDate": "2026-03-01",
    "endDate": "2026-03-03"
  }
}
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "id": "uuid",
    "status": "SUBMITTED",
    "oaRefId": "OA-12345678",
    "createdAt": "2026-03-03T10:00:00Z"
  }
}
```

---

### GET /api/v1/submissions
**功能**：列出提交记录

**查询参数**：
- `tenantId` (required)
- `userId` (optional)
- `status` (optional)
- `limit`, `offset`

---

### GET /api/v1/submissions/:id
**功能**：获取提交详情

---

### POST /api/v1/submissions/:id/cancel
**功能**：撤回提交

**请求**：
```json
{
  "reason": "金额填写错误"
}
```

---

### POST /api/v1/submissions/:id/urge
**功能**：催办

---

### POST /api/v1/submissions/:id/supplement
**功能**：补件

**请求**：
```json
{
  "supplementData": {
    "invoice": "file_url"
  }
}
```

---

### POST /api/v1/submissions/:id/delegate
**功能**：转办

**请求**：
```json
{
  "targetUserId": "uuid",
  "reason": "出差在外"
}
```

---

## 7.8 Status模块

### GET /api/v1/status/submissions/:id
**功能**：查询提交状态

**响应**：
```json
{
  "code": 0,
  "data": {
    "id": "uuid",
    "status": "IN_PROGRESS",
    "currentNode": "财务处审核",
    "timeline": [
      {
        "timestamp": "2026-03-03T10:00:00Z",
        "event": "提交申请",
        "operator": "张老师"
      },
      {
        "timestamp": "2026-03-03T14:00:00Z",
        "event": "部门主任已审批",
        "operator": "李主任"
      },
      {
        "timestamp": "2026-03-04T09:00:00Z",
        "event": "财务处审核中",
        "operator": "系统"
      }
    ]
  }
}
```

---

### GET /api/v1/status/my
**功能**：我的提交列表

**查询参数**：
- `tenantId` (required)
- `userId` (required)
- `status` (optional)

---

### GET /api/v1/status/submissions/:id/timeline
**功能**：获取状态时间线

---

## 7.9 Audit模块

### GET /api/v1/audit/logs
**功能**：查询审计日志

**查询参数**：
- `tenantId` (required)
- `userId` (optional)
- `action` (optional)
- `traceId` (optional)
- `startTime`, `endTime` (optional)
- `limit`, `offset`

**响应**：
```json
{
  "code": 0,
  "data": {
    "logs": [
      {
        "id": "uuid",
        "traceId": "trace-uuid",
        "action": "submission.create",
        "userId": "uuid",
        "result": "success",
        "detail": {...},
        "createdAt": "2026-03-03T10:00:00Z"
      }
    ],
    "total": 100,
    "limit": 20,
    "offset": 0
  }
}
```

---

### GET /api/v1/audit/trace/:traceId
**功能**：根据traceId查询完整链路

---

### GET /api/v1/audit/stats
**功能**：获取审计统计

**响应**：
```json
{
  "code": 0,
  "data": {
    "total": 10000,
    "byAction": [
      {"action": "submission.create", "count": 5000},
      {"action": "permission.check", "count": 3000}
    ],
    "byResult": [
      {"result": "success", "count": 9500},
      {"result": "failure", "count": 500}
    ]
  }
}
```

---

## 7.10 Health Check

### GET /api/v1/health
**功能**：健康检查

**响应**：
```json
{
  "status": "ok",
  "timestamp": "2026-03-03T10:00:00Z",
  "service": "uniflow-oa-api",
  "version": "1.0.0"
}
```

---

## 7.11 API认证

### MVP阶段（Mock认证）
```
Headers:
  X-User-Id: uuid
  X-Tenant-Id: uuid
```

### 生产环境（JWT认证）
```
Headers:
  Authorization: Bearer <jwt_token>
```

**JWT Payload**：
```json
{
  "sub": "user_id",
  "tenant_id": "tenant_id",
  "roles": ["teacher"],
  "exp": 1234567890
}
```

---

## 7.12 API限流

| 端点类型 | 限流策略 |
|----------|----------|
| 查询接口 | 100 req/min/user |
| 创建接口 | 20 req/min/user |
| 提交接口 | 10 req/min/user |
| 健康检查 | 无限制 |

---

## 7.13 API版本管理

- 当前版本：`v1`
- 版本策略：URL路径版本控制 `/api/v1/`
- 向后兼容：v1保持向后兼容，重大变更发布v2
- 废弃策略：提前6个月通知，响应头添加 `X-API-Deprecated: true`

---

**文档状态**: ✅ 完成
