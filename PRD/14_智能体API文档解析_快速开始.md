# 智能体API文档解析接口 - 快速开始指南

## 前置条件

1. **环境要求**
   - Node.js 18+
   - PostgreSQL 16
   - Redis 7
   - Anthropic API Key

2. **依赖安装**
```bash
cd OA_agent
pnpm install
```

---

## 配置步骤

### 1. 环境变量配置

在 `apps/api/.env` 文件中添加：

```bash
# LLM配置
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
LLM_MODEL=claude-opus-4-6
LLM_MAX_TOKENS=16000
LLM_TEMPERATURE=0.2

# 解析配置
PARSE_CONFIDENCE_THRESHOLD=0.8
PARSE_TIMEOUT_MS=300000
PARSE_MAX_CONCURRENT=3
PARSE_CACHE_TTL=86400

# 文档配置
DOCUMENT_MAX_SIZE_MB=10
```

### 2. 数据库迁移

将以下内容添加到 `apps/api/prisma/schema.prisma`：

```prisma
model ParseJob {
  id              String   @id @default(uuid())
  bootstrapJobId  String
  bootstrapJob    BootstrapJob @relation(fields: [bootstrapJobId], references: [id])

  documentType    String
  documentUrl     String?
  documentHash    String

  status          String
  progress        Int      @default(0)

  parseOptions    Json
  parseResult     Json?
  parseMetadata   Json?

  warnings        Json[]
  errors          Json[]

  reviewedBy      String?
  reviewedAt      DateTime?
  reviewComment   String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  completedAt     DateTime?

  extractedProcesses ExtractedProcess[]

  @@index([bootstrapJobId])
  @@index([status])
  @@index([documentHash])
}

model ExtractedProcess {
  id              String   @id @default(uuid())
  parseJobId      String
  parseJob        ParseJob @relation(fields: [parseJobId], references: [id])

  processCode     String
  processName     String
  processCategory String
  description     String?

  confidence      Float
  endpoints       Json
  fields          Json

  status          String
  publishedTemplateId String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([parseJobId])
  @@index([processCode])
  @@index([status])
}

model ProcessTemplate {
  id              String   @id @default(uuid())
  tenantId        String

  processCode     String
  processName     String
  processCategory String
  description     String?

  version         Int      @default(1)
  status          String
  falLevel        String

  fields          Json
  endpoints       Json
  rules           Json

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  publishedAt     DateTime?

  @@unique([tenantId, processCode, version])
  @@index([tenantId, status])
  @@index([processCode])
}
```

然后运行迁移：

```bash
cd apps/api
npx prisma migrate dev --name add_parse_job_tables
npx prisma generate
```

### 3. 启动服务

```bash
# 启动数据库和Redis
docker-compose up -d postgres redis

# 启动API服务
cd apps/api
pnpm run start:dev
```

---

## 快速测试

### 测试1: 解析示例OpenAPI文档

创建测试文档 `test-openapi.json`：

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "Test OA API",
    "version": "1.0.0"
  },
  "paths": {
    "/api/v1/login": {
      "post": {
        "summary": "用户登录",
        "tags": ["auth"]
      }
    },
    "/api/v1/health": {
      "get": {
        "summary": "健康检查",
        "tags": ["system"]
      }
    },
    "/api/v1/leave/submit": {
      "post": {
        "summary": "提交请假申请",
        "tags": ["leave"],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["leave_type", "start_date", "end_date", "reason"],
                "properties": {
                  "leave_type": {
                    "type": "string",
                    "description": "请假类型",
                    "enum": ["事假", "病假", "年假"]
                  },
                  "start_date": {
                    "type": "string",
                    "format": "date",
                    "description": "开始日期"
                  },
                  "end_date": {
                    "type": "string",
                    "format": "date",
                    "description": "结束日期"
                  },
                  "reason": {
                    "type": "string",
                    "description": "请假事由",
                    "maxLength": 500
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/leave/{id}": {
      "get": {
        "summary": "查询请假状态",
        "tags": ["leave"],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ]
      }
    },
    "/api/v1/expense/submit": {
      "post": {
        "summary": "提交报销申请",
        "tags": ["expense"],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["amount", "category", "description"],
                "properties": {
                  "amount": {
                    "type": "number",
                    "description": "报销金额",
                    "minimum": 0
                  },
                  "category": {
                    "type": "string",
                    "description": "报销类别",
                    "enum": ["差旅费", "办公费", "招待费"]
                  },
                  "description": {
                    "type": "string",
                    "description": "报销说明"
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### 测试2: 创建Bootstrap Job

```bash
curl -X POST http://localhost:3000/api/v1/bootstrap/jobs \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: test-tenant-123" \
  -d '{
    "oaUrl": "https://oa.example.com",
    "openApiUrl": "https://oa.example.com/openapi.json"
  }'
```

记录返回的 `jobId`。

### 测试3: 上传并解析文档

```bash
# 读取文档内容
DOCUMENT_CONTENT=$(cat test-openapi.json | jq -c .)

# 发起解析请求
curl -X POST http://localhost:3000/api/v1/bootstrap/jobs/{jobId}/parse-document \
  -H "Content-Type: application/json" \
  -d "{
    \"documentType\": \"openapi\",
    \"documentContent\": $DOCUMENT_CONTENT,
    \"parseOptions\": {
      \"filterNonBusinessEndpoints\": true,
      \"includeUserLinks\": false,
      \"confidenceThreshold\": 0.8
    }
  }"
```

记录返回的 `parseJobId`。

### 测试4: 查询解析状态

```bash
# 轮询查询状态
while true; do
  STATUS=$(curl -s "http://localhost:3000/api/v1/bootstrap/jobs/{jobId}/parse-status?parseJobId={parseJobId}" | jq -r '.data.status')
  echo "当前状态: $STATUS"

  if [ "$STATUS" = "COMPLETED" ] || [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "REVIEW_REQUIRED" ]; then
    break
  fi

  sleep 5
done
```

### 测试5: 获取解析结果

```bash
curl -X GET "http://localhost:3000/api/v1/bootstrap/jobs/{jobId}/parse-result" | jq .
```

**预期结果**：

```json
{
  "code": 0,
  "data": {
    "parseJobId": "parse-uuid-123",
    "documentInfo": {
      "type": "openapi",
      "version": "3.0.0",
      "title": "Test OA API"
    },
    "filteringSummary": {
      "enabled": true,
      "totalEndpoints": 5,
      "businessEndpoints": 3,
      "filteredEndpoints": [
        "/api/v1/login",
        "/api/v1/health"
      ]
    },
    "extractedProcesses": [
      {
        "processCode": "LEAVE_REQUEST",
        "processName": "请假申请",
        "processCategory": "人事",
        "confidence": 0.92,
        "endpoints": [
          {
            "method": "POST",
            "path": "/api/v1/leave/submit"
          },
          {
            "method": "GET",
            "path": "/api/v1/leave/{id}"
          }
        ],
        "fields": [
          {
            "fieldCode": "leave_type",
            "fieldName": "请假类型",
            "fieldType": "select",
            "required": true,
            "options": ["事假", "病假", "年假"],
            "confidence": 0.95
          },
          {
            "fieldCode": "start_date",
            "fieldName": "开始日期",
            "fieldType": "date",
            "required": true,
            "confidence": 0.98
          },
          {
            "fieldCode": "end_date",
            "fieldName": "结束日期",
            "fieldType": "date",
            "required": true,
            "confidence": 0.98
          },
          {
            "fieldCode": "reason",
            "fieldName": "请假事由",
            "fieldType": "textarea",
            "required": true,
            "maxLength": 500,
            "confidence": 0.90
          }
        ]
      },
      {
        "processCode": "EXPENSE_CLAIM",
        "processName": "费用报销",
        "processCategory": "财务",
        "confidence": 0.89,
        "endpoints": [
          {
            "method": "POST",
            "path": "/api/v1/expense/submit"
          }
        ],
        "fields": [
          {
            "fieldCode": "amount",
            "fieldName": "报销金额",
            "fieldType": "number",
            "required": true,
            "min": 0,
            "confidence": 0.95
          },
          {
            "fieldCode": "category",
            "fieldName": "报销类别",
            "fieldType": "select",
            "required": true,
            "options": ["差旅费", "办公费", "招待费"],
            "confidence": 0.93
          },
          {
            "fieldCode": "description",
            "fieldName": "报销说明",
            "fieldType": "textarea",
            "required": true,
            "confidence": 0.88
          }
        ]
      }
    ],
    "warnings": [],
    "metadata": {
      "parseTime": 125,
      "llmModel": "claude-opus-4-6",
      "llmTokens": 12500,
      "totalEndpoints": 5,
      "businessEndpoints": 3,
      "filteredEndpoints": 2
    }
  }
}
```

### 测试6: 确认并发布

```bash
curl -X POST "http://localhost:3000/api/v1/bootstrap/jobs/{jobId}/confirm-parse" \
  -H "Content-Type: application/json" \
  -d '{
    "parseJobId": "{parseJobId}",
    "action": "publish",
    "comment": "解析结果准确，发布到流程库"
  }'
```

**预期结果**：

```json
{
  "code": 0,
  "message": "解析结果已发布到流程库",
  "data": {
    "publishedProcesses": 2,
    "publishedFields": 7,
    "publishedTemplateIds": [
      "template-uuid-1",
      "template-uuid-2"
    ]
  }
}
```

---

## 验证结果

### 1. 检查数据库

```sql
-- 查看解析任务
SELECT id, status, progress, created_at, completed_at
FROM "ParseJob"
ORDER BY created_at DESC
LIMIT 5;

-- 查看提取的流程
SELECT id, process_code, process_name, process_category, confidence, status
FROM "ExtractedProcess"
ORDER BY created_at DESC;

-- 查看发布的流程模板
SELECT id, process_code, process_name, status, version
FROM "ProcessTemplate"
ORDER BY created_at DESC;
```

### 2. 检查日志

```bash
# 查看API日志
tail -f apps/api/logs/app.log | grep -i "parse"

# 查看解析统计
curl -X GET "http://localhost:3000/api/v1/bootstrap/jobs/{jobId}/parse-status" | jq '.data.result'
```

---

## 常见问题排查

### 问题1: LLM API调用失败

**错误信息**：
```
Error: Anthropic API call failed: 401 Unauthorized
```

**解决方案**：
1. 检查 `ANTHROPIC_API_KEY` 是否正确配置
2. 确认API Key有效且有足够的配额
3. 检查网络连接是否正常

### 问题2: 解析超时

**错误信息**：
```
Error: Parse timeout after 300000ms
```

**解决方案**：
1. 增加 `PARSE_TIMEOUT_MS` 配置
2. 检查文档大小，考虑分批处理
3. 检查LLM API响应速度

### 问题3: 过滤结果不准确

**现象**：业务接口被误过滤

**解决方案**：
1. 检查接口命名是否规范
2. 查看 `filteredEndpoints` 列表
3. 使用 `focusEndpoints` 参数重新解析
4. 关闭过滤功能：`filterNonBusinessEndpoints: false`

### 问题4: 链接获取失败

**错误信息**：
```
Warning: 获取链接内容失败: Network timeout
```

**解决方案**：
1. 检查链接URL是否可访问
2. 确认网络权限配置
3. 增加超时时间
4. 关闭链接解析：`includeUserLinks: false`

---

## 性能优化建议

### 1. 大文档处理

对于超过100个接口的文档：

```bash
# 方案1: 先过滤再解析
curl -X POST http://localhost:3000/api/v1/bootstrap/jobs/{jobId}/parse-document \
  -d '{
    "parseOptions": {
      "filterNonBusinessEndpoints": true,
      "includeUserLinks": false
    }
  }'

# 方案2: 分批解析
curl -X POST http://localhost:3000/api/v1/bootstrap/jobs/{jobId}/parse-document \
  -d '{
    "parseOptions": {
      "focusEndpoints": [
        "/api/v1/leave/submit",
        "/api/v1/expense/submit"
      ]
    }
  }'
```

### 2. 缓存利用

相同文档不会重复解析，系统会自动返回缓存结果：

```bash
# 第一次解析：耗时120秒
# 第二次解析：耗时<1秒（缓存命中）
```

### 3. 并发控制

单租户最多3个并发解析任务，超过会排队：

```bash
# 监控队列状态
curl -X GET "http://localhost:3000/api/v1/bootstrap/jobs?tenantId={tenantId}&status=PARSING"
```

---

## 下一步

1. **集成到前端**：在Bootstrap Center页面添加"解析API文档"按钮
2. **批量处理**：支持批量上传多个API文档
3. **模板管理**：在流程库中管理解析生成的模板
4. **监控告警**：配置解析失败告警通知

---

## 相关文档

- [PRD设计文档](./14_智能体API文档解析接口设计.md)
- [使用示例](./14_智能体API文档解析_使用示例.md)
- [实现清单](./14_智能体API文档解析_实现清单.md)
- [API文档](./07_API草案.md)

---

## 技术支持

如有问题，请查看：
1. 日志文件：`apps/api/logs/app.log`
2. 数据库记录：`ParseJob` 和 `ExtractedProcess` 表
3. 解析结果：通过 `/parse-result` 接口查看详细信息

**完成！** 🎉

现在你可以开始使用智能体API文档解析功能了。