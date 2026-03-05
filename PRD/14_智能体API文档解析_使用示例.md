# API文档解析智能体 - 使用示例

## 1. 基础使用

### 1.1 上传并解析OpenAPI文档

```bash
curl -X POST http://localhost:3000/api/v1/bootstrap/jobs/job-123/parse-document \
  -H "Content-Type: application/json" \
  -d '{
    "documentType": "openapi",
    "documentUrl": "https://oa.example.com/openapi.json",
    "parseOptions": {
      "filterNonBusinessEndpoints": true,
      "includeUserLinks": true,
      "confidenceThreshold": 0.8
    }
  }'
```

**响应**:
```json
{
  "code": 0,
  "message": "解析任务已创建",
  "data": {
    "parseJobId": "parse-uuid-123",
    "status": "PARSING",
    "estimatedTime": 120
  }
}
```

### 1.2 查询解析状态

```bash
curl -X GET "http://localhost:3000/api/v1/bootstrap/jobs/job-123/parse-status?parseJobId=parse-uuid-123"
```

**响应**:
```json
{
  "code": 0,
  "data": {
    "parseJobId": "parse-uuid-123",
    "status": "COMPLETED",
    "progress": 100,
    "result": {
      "totalEndpoints": 45,
      "businessEndpoints": 25,
      "filteredEndpoints": 20,
      "extractedProcesses": 5,
      "extractedFields": 48,
      "confidence": 0.87
    }
  }
}
```

### 1.3 获取解析结果

```bash
curl -X GET http://localhost:3000/api/v1/bootstrap/jobs/job-123/parse-result
```

### 1.4 确认并发布

```bash
curl -X POST http://localhost:3000/api/v1/bootstrap/jobs/job-123/confirm-parse \
  -H "Content-Type: application/json" \
  -d '{
    "parseJobId": "parse-uuid-123",
    "action": "publish",
    "comment": "解析结果准确，发布到流程库"
  }'
```

---

## 2. 高级功能

### 2.1 只过滤非业务接口，不解析链接

```json
{
  "documentType": "openapi",
  "documentUrl": "https://oa.example.com/openapi.json",
  "parseOptions": {
    "filterNonBusinessEndpoints": true,
    "includeUserLinks": false
  }
}
```

### 2.2 直接上传文档内容

```json
{
  "documentType": "openapi",
  "documentContent": "{\"openapi\":\"3.0.0\",\"paths\":{...}}",
  "parseOptions": {
    "filterNonBusinessEndpoints": true,
    "includeUserLinks": true
  }
}
```

### 2.3 人工修改后发布

```bash
curl -X POST http://localhost:3000/api/v1/bootstrap/jobs/job-123/confirm-parse \
  -H "Content-Type: application/json" \
  -d '{
    "parseJobId": "parse-uuid-123",
    "action": "publish",
    "modifications": [
      {
        "processCode": "LEAVE_REQUEST",
        "fieldCode": "leave_type",
        "changes": {
          "fieldName": "请假类别",
          "options": ["事假", "病假", "年假", "调休", "婚假"]
        }
      }
    ],
    "comment": "增加婚假选项"
  }'
```

### 2.4 重新解析（调整参数）

```bash
curl -X POST http://localhost:3000/api/v1/bootstrap/jobs/job-123/reparse \
  -H "Content-Type: application/json" \
  -d '{
    "parseJobId": "parse-uuid-123",
    "parseOptions": {
      "confidenceThreshold": 0.7,
      "filterNonBusinessEndpoints": true
    },
    "focusEndpoints": [
      "/api/v1/leave/submit",
      "/api/v1/expense/submit"
    ]
  }'
```

---

## 3. OpenAPI文档示例

### 3.1 标准OpenAPI文档

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "University OA API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "https://oa.example.com/api"
    }
  ],
  "paths": {
    "/v1/leave/submit": {
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
        },
        "responses": {
          "200": {
            "description": "提交成功",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string",
                      "description": "申请ID"
                    },
                    "status": {
                      "type": "string",
                      "description": "申请状态"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/v1/leave/{id}": {
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
        ],
        "responses": {
          "200": {
            "description": "查询成功"
          }
        }
      }
    }
  }
}
```

### 3.2 带用户链接的OpenAPI文档

```json
{
  "openapi": "3.0.0",
  "paths": {
    "/v1/leave/submit": {
      "post": {
        "summary": "提交请假申请",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "properties": {
                  "leave_type": {
                    "type": "string",
                    "description": "请假类型",
                    "x-options-url": "https://oa.example.com/api/v1/dict/leave-types"
                  },
                  "department": {
                    "type": "string",
                    "description": "所属部门",
                    "x-data-source": "https://oa.example.com/api/v1/departments"
                  },
                  "approver": {
                    "type": "string",
                    "description": "审批人",
                    "x-data-source": "https://oa.example.com/api/v1/users?role=approver"
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

**链接返回格式示例**:

```json
// GET https://oa.example.com/api/v1/dict/leave-types
{
  "code": 0,
  "data": [
    { "value": "1", "label": "事假" },
    { "value": "2", "label": "病假" },
    { "value": "3", "label": "年假" },
    { "value": "4", "label": "调休" }
  ]
}
```

---

## 4. 过滤效果示例

### 4.1 原始文档（45个接口）

```
/api/v1/login                    [POST]   - 用户登录
/api/v1/logout                   [POST]   - 用户登出
/api/v1/user/create              [POST]   - 创建用户
/api/v1/user/update              [PUT]    - 更新用户
/api/v1/role/list                [GET]    - 角色列表
/api/v1/permission/assign        [POST]   - 分配权限
/api/v1/config/get               [GET]    - 获取配置
/api/v1/config/set               [POST]   - 设置配置
/api/v1/health                   [GET]    - 健康检查
/api/v1/metrics                  [GET]    - 系统指标
/api/v1/logs/query               [GET]    - 日志查询
/api/v1/file/upload              [POST]   - 文件上传
/api/v1/notification/send        [POST]   - 发送通知
/api/v1/department/list          [GET]    - 部门列表
/api/v1/leave/submit             [POST]   - 提交请假 ✓
/api/v1/leave/{id}               [GET]    - 查询请假 ✓
/api/v1/leave/{id}/cancel        [POST]   - 撤回请假 ✓
/api/v1/expense/submit           [POST]   - 提交报销 ✓
/api/v1/expense/{id}             [GET]    - 查询报销 ✓
/api/v1/expense/{id}/supplement  [POST]   - 补件报销 ✓
/api/v1/purchase/apply           [POST]   - 采购申请 ✓
/api/v1/purchase/{id}            [GET]    - 查询采购 ✓
/api/v1/travel/apply             [POST]   - 出差申请 ✓
/api/v1/travel/{id}              [GET]    - 查询出差 ✓
/api/v1/seal/apply               [POST]   - 用印申请 ✓
/api/v1/seal/{id}                [GET]    - 查询用印 ✓
...
```

### 4.2 过滤后（25个业务接口）

```
/api/v1/leave/submit             [POST]   - 提交请假
/api/v1/leave/{id}               [GET]    - 查询请假
/api/v1/leave/{id}/cancel        [POST]   - 撤回请假
/api/v1/expense/submit           [POST]   - 提交报销
/api/v1/expense/{id}             [GET]    - 查询报销
/api/v1/expense/{id}/supplement  [POST]   - 补件报销
/api/v1/purchase/apply           [POST]   - 采购申请
/api/v1/purchase/{id}            [GET]    - 查询采购
/api/v1/travel/apply             [POST]   - 出差申请
/api/v1/travel/{id}              [GET]    - 查询出差
/api/v1/seal/apply               [POST]   - 用印申请
/api/v1/seal/{id}                [GET]    - 查询用印
/api/v1/meeting/book             [POST]   - 会议室预订
/api/v1/meeting/{id}             [GET]    - 查询预订
/api/v1/vehicle/apply            [POST]   - 车辆申请
/api/v1/vehicle/{id}             [GET]    - 查询车辆
...
```

### 4.3 过滤统计

```json
{
  "totalEndpoints": 45,
  "businessEndpoints": 25,
  "filteredEndpoints": 20,
  "filterCategories": {
    "authentication": 2,
    "userManagement": 4,
    "systemConfig": 3,
    "monitoring": 3,
    "fileService": 2,
    "notification": 2,
    "organization": 4
  }
}
```

---

## 5. 解析结果示例

### 5.1 提取的流程

```json
{
  "processes": [
    {
      "processCode": "LEAVE_REQUEST",
      "processName": "请假申请",
      "processCategory": "人事",
      "description": "教职工请假申请流程",
      "confidence": 0.92,
      "endpoints": [
        {
          "method": "POST",
          "path": "/api/v1/leave/submit",
          "description": "提交请假申请"
        },
        {
          "method": "GET",
          "path": "/api/v1/leave/{id}",
          "description": "查询请假状态"
        },
        {
          "method": "POST",
          "path": "/api/v1/leave/{id}/cancel",
          "description": "撤回请假申请"
        }
      ],
      "fields": [
        {
          "fieldCode": "leave_type",
          "fieldName": "请假类型",
          "fieldType": "select",
          "required": true,
          "options": ["事假", "病假", "年假", "调休"],
          "confidence": 0.95,
          "dataSource": "x-options-url"
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
          "fieldCode": "days",
          "fieldName": "请假天数",
          "fieldType": "number",
          "required": true,
          "min": 0.5,
          "max": 365,
          "confidence": 0.90
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
      "endpoints": [...],
      "fields": [...]
    }
  ]
}
```

---

## 6. 错误处理

### 6.1 文档格式错误

```json
{
  "code": 40001,
  "message": "文档格式不支持",
  "data": {
    "supportedFormats": ["openapi", "swagger", "postman", "har"],
    "providedFormat": "unknown"
  }
}
```

### 6.2 链接获取失败

```json
{
  "code": 0,
  "message": "解析完成，但部分链接获取失败",
  "data": {
    "parseJobId": "parse-uuid-123",
    "status": "COMPLETED",
    "warnings": [
      {
        "message": "获取链接内容失败: https://oa.example.com/api/v1/dict/leave-types",
        "error": "Network timeout"
      }
    ]
  }
}
```

### 6.3 置信度过低

```json
{
  "code": 0,
  "message": "解析完成，但需要人工审核",
  "data": {
    "parseJobId": "parse-uuid-123",
    "status": "REVIEW_REQUIRED",
    "reason": "部分字段置信度低于阈值(0.8)",
    "lowConfidenceFields": [
      {
        "processCode": "LEAVE_REQUEST",
        "fieldCode": "approver",
        "confidence": 0.65
      }
    ]
  }
}
```

---

## 7. 最佳实践

### 7.1 推荐配置

```json
{
  "parseOptions": {
    "filterNonBusinessEndpoints": true,
    "includeUserLinks": true,
    "extractBusinessLogic": true,
    "generateFieldMapping": true,
    "confidenceThreshold": 0.8,
    "autoPublish": false
  }
}
```

### 7.2 性能优化

1. **大文档处理**：超过100个接口时，系统自动分批处理
2. **缓存机制**：相同文档hash不重复解析
3. **并发控制**：单租户最多3个并发解析任务
4. **超时设置**：链接获取5秒超时，整体解析5分钟超时

### 7.3 质量保证

1. **人工审核**：置信度<0.8的结果需要人工审核
2. **增量更新**：支持只解析变更的接口
3. **版本管理**：每次解析保留历史记录
4. **回滚机制**：支持回退到之前的解析版本

---

## 8. 监控指标

### 8.1 业务指标

```json
{
  "parseSuccessRate": 0.92,
  "averageParseTime": 125,
  "averageConfidence": 0.87,
  "reviewRequiredRate": 0.18,
  "filterEfficiency": 0.44
}
```

### 8.2 技术指标

```json
{
  "llmApiSuccessRate": 0.998,
  "averageTokens": 18500,
  "linkFetchSuccessRate": 0.95,
  "cacheHitRate": 0.35
}
```

---

## 9. 常见问题

**Q1: 为什么有些业务接口被过滤了？**
A: 可能是接口命名不规范。可以在解析结果中查看 `filteredEndpoints`，如果发现误过滤，可以使用 `focusEndpoints` 参数重新解析。

**Q2: 链接解析失败怎么办？**
A: 系统会继续解析，但字段选项列表可能不完整。可以在人工审核时手动补充。

**Q3: 如何提高解析准确率？**
A: 确保API文档完整、规范，包含详细的描述和示例。使用标准的OpenAPI 3.0格式。

**Q4: 支持私有网络的链接吗？**
A: 支持。需要配置网络访问权限，或者在 `documentContent` 中直接包含链接数据。

**Q5: 解析结果可以导出吗？**
A: 可以。通过 `/parse-result` 接口获取完整JSON，或者发布到流程库后导出。