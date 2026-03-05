# API Documentation

## Base URL

```
http://localhost:3001/api/v1
```

## Authentication

Currently using mock authentication. In production, use JWT tokens:

```
Authorization: Bearer <token>
```

## Common Headers

```
Content-Type: application/json
X-Tenant-ID: <tenant-id>
X-User-ID: <user-id>
```

## Error Responses

All endpoints return errors in this format:

```json
{
  "statusCode": 400,
  "message": "Error message",
  "error": "Bad Request"
}
```

---

## Bootstrap APIs

### Create Bootstrap Job

Create a new OA system initialization job.

**Endpoint**: `POST /bootstrap/jobs`

**Request Body**:
```json
{
  "oaUrl": "http://example.com",
  "openApiUrl": "http://example.com/openapi.json",
  "harFileUrl": "http://example.com/capture.har",
  "uploadedFiles": ["file1.json", "file2.har"]
}
```

**Response**:
```json
{
  "id": "job-uuid",
  "tenantId": "tenant-id",
  "status": "CREATED",
  "createdAt": "2024-03-02T10:00:00Z"
}
```

### Get Bootstrap Job

Get details of a bootstrap job.

**Endpoint**: `GET /bootstrap/jobs/:id`

**Response**:
```json
{
  "id": "job-uuid",
  "status": "REVIEW",
  "flowIRs": [...],
  "fieldIRs": [...],
  "reports": [...]
}
```

### Get Bootstrap Report

Get OCL assessment report.

**Endpoint**: `GET /bootstrap/jobs/:id/report`

**Response**:
```json
{
  "oclLevel": "OCL3",
  "coverage": 0.85,
  "confidence": 0.9,
  "risk": "medium",
  "evidence": [
    {
      "type": "api_discovery",
      "description": "Found 10 API endpoints",
      "confidence": 0.9
    }
  ],
  "recommendation": "System can be integrated with stable submission support"
}
```

### Publish Bootstrap Job

Publish job to process library.

**Endpoint**: `POST /bootstrap/jobs/:id/publish`

**Response**:
```json
{
  "success": true,
  "connectorId": "connector-uuid"
}
```

---

## Connector APIs

### Create Connector

**Endpoint**: `POST /connectors`

**Request Body**:
```json
{
  "name": "University OA",
  "oaType": "openapi",
  "baseUrl": "http://oa.example.com",
  "authType": "apikey",
  "authConfig": {
    "apiKey": "xxx"
  },
  "oclLevel": "OCL3"
}
```

### List Connectors

**Endpoint**: `GET /connectors?tenantId=xxx`

### Health Check

**Endpoint**: `POST /connectors/:id/health-check`

---

## Process Library APIs

### List Processes

**Endpoint**: `GET /process-library?tenantId=xxx&category=财务`

**Response**:
```json
[
  {
    "id": "template-uuid",
    "processCode": "travel_expense",
    "processName": "差旅费报销",
    "falLevel": "F2",
    "schema": {
      "fields": [...]
    }
  }
]
```

### Get Process by Code

**Endpoint**: `GET /process-library/:processCode?tenantId=xxx`

---

## Assistant APIs

### Send Chat Message

**Endpoint**: `POST /assistant/chat`

**Request Body**:
```json
{
  "sessionId": "session-uuid",
  "message": "我要报销差旅费1000元",
  "userId": "user-id"
}
```

**Response**:
```json
{
  "sessionId": "session-uuid",
  "message": "正在为您填写差旅费报销。请问事由是什么？",
  "intent": "create_submission",
  "draftId": "draft-uuid",
  "needsInput": true,
  "formData": {
    "amount": 1000
  },
  "missingFields": [
    {
      "key": "reason",
      "label": "事由",
      "question": "请问事由是什么？"
    }
  ]
}
```

---

## Permission APIs

### Check Permission

**Endpoint**: `POST /permission/check`

**Request Body**:
```json
{
  "userId": "user-id",
  "processCode": "travel_expense",
  "action": "submit"
}
```

**Response**:
```json
{
  "allowed": true,
  "reason": "权限校验通过",
  "platformCheck": {
    "passed": true,
    "reason": "角色匹配"
  },
  "oaCheck": {
    "passed": true,
    "reason": "OA实时权限通过"
  }
}
```

---

## Submission APIs

### Submit Draft

**Endpoint**: `POST /submissions`

**Request Body**:
```json
{
  "draftId": "draft-uuid",
  "idempotencyKey": "unique-key",
  "userId": "user-id"
}
```

**Response**:
```json
{
  "submissionId": "submission-uuid",
  "status": "pending",
  "message": "申请已提交"
}
```

### List Submissions

**Endpoint**: `GET /submissions?tenantId=xxx&userId=xxx`

### Cancel Submission

**Endpoint**: `POST /submissions/:id/cancel?userId=xxx`

### Urge Submission

**Endpoint**: `POST /submissions/:id/urge?userId=xxx`

### Supplement Submission

**Endpoint**: `POST /submissions/:id/supplement?userId=xxx`

**Request Body**:
```json
{
  "supplementData": {
    "additionalInfo": "补充说明"
  }
}
```

### Delegate Submission

**Endpoint**: `POST /submissions/:id/delegate?userId=xxx`

**Request Body**:
```json
{
  "targetUserId": "user-2",
  "reason": "转办原因"
}
```

---

## Status APIs

### Query Status

**Endpoint**: `GET /status/submissions/:id`

**Response**:
```json
{
  "submissionId": "submission-uuid",
  "status": "submitted",
  "oaSubmissionId": "OA-12345",
  "timeline": [
    {
      "timestamp": "2024-03-02T10:00:00Z",
      "status": "created",
      "description": "申请已创建"
    },
    {
      "timestamp": "2024-03-02T10:05:00Z",
      "status": "submitted",
      "description": "已提交至OA系统"
    }
  ]
}
```

### My Submissions

**Endpoint**: `GET /status/my?tenantId=xxx&userId=xxx`

---

## Audit APIs

### Query Audit Logs

**Endpoint**: `GET /audit/logs?tenantId=xxx&userId=xxx&action=submit&startDate=2024-03-01&limit=100`

**Response**:
```json
{
  "logs": [
    {
      "id": "log-uuid",
      "traceId": "trace-123",
      "action": "submit",
      "result": "success",
      "createdAt": "2024-03-02T10:00:00Z"
    }
  ],
  "total": 150,
  "limit": 100,
  "offset": 0
}
```

### Get Trace

**Endpoint**: `GET /audit/trace/:traceId?tenantId=xxx`

**Response**:
```json
{
  "traceId": "trace-123",
  "logs": [...],
  "timeline": [...]
}
```

### Get Statistics

**Endpoint**: `GET /audit/stats?tenantId=xxx&startDate=2024-03-01`

**Response**:
```json
{
  "total": 1000,
  "byAction": [
    { "action": "submit", "count": 500 },
    { "action": "permission_check", "count": 300 }
  ],
  "byResult": [
    { "result": "success", "count": 900 },
    { "result": "denied", "count": 100 }
  ]
}
```

---

## Health Check

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-03-02T10:00:00Z",
  "service": "uniflow-oa-api"
}
```

---

## Rate Limits

- 100 requests per minute per IP
- 1000 requests per hour per user

## Pagination

For list endpoints, use:
- `limit`: Number of items (default: 100, max: 1000)
- `offset`: Skip items (default: 0)

## Filtering

Most list endpoints support filtering:
- `tenantId`: Filter by tenant
- `userId`: Filter by user
- `status`: Filter by status
- `startDate`, `endDate`: Date range

## Sorting

Use `orderBy` parameter:
- `createdAt`: Sort by creation time (default)
- `updatedAt`: Sort by update time
- Add `-` prefix for descending order (e.g., `-createdAt`)

---

For interactive API documentation, visit: http://localhost:3001/api/docs
