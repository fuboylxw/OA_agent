# 14 智能体API文档解析接口设计

**文档版本**: v1.0
**创建日期**: 2026-03-05
**模块名称**: Agent API Document Parser
**负责人**: 系统架构组

---

## 14.1 功能概述

### 核心功能
在初始化中心（Bootstrap Center）上传API文档后，通过智能体自动解析、读取API文档内容，提取关键信息并结构化存储到流程库和字段库中。

### 业务价值
- **自动化**：减少90%的人工配置工作
- **准确性**：AI解析准确率≥85%
- **可扩展**：支持多种API文档格式（OpenAPI、Swagger、Postman等）
- **可追溯**：完整的解析日志和版本管理

---

## 14.2 系统架构

### 整体流程

```
用户上传API文档
    ↓
文档预处理（格式识别、验证）
    ↓
智能体解析（提取API信息）
    ↓
结构化转换（生成IR中间表示）
    ↓
存储到数据库（流程库+字段库）
    ↓
生成解析报告
```

### 技术架构

```
┌─────────────────────────────────────────────┐
│         Bootstrap Controller                 │
│  POST /bootstrap/jobs/:id/parse-document    │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│      Document Parser Service                 │
│  - 文档格式识别                              │
│  - 文档验证                                  │
│  - 调用智能体解析                            │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│      API Document Agent (LLM)                │
│  - 提取API端点信息                           │
│  - 识别请求/响应结构                         │
│  - 推断业务流程                              │
│  - 生成字段映射                              │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│      IR Normalizer Service                   │
│  - 转换为统一IR格式                          │
│  - 字段类型标准化                            │
│  - 生成流程模板                              │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│      Database Storage                        │
│  - ProcessTemplate (流程库)                 │
│  - FieldDefinition (字段库)                 │
│  - ParseLog (解析日志)                      │
└─────────────────────────────────────────────┘
```

---

## 14.3 API接口设计

### 14.3.1 上传并解析API文档

**端点**: `POST /api/v1/bootstrap/jobs/:id/parse-document`

**功能**: 上传API文档并触发智能体解析

**请求**:
```json
{
  "documentType": "openapi",
  "documentUrl": "https://example.com/openapi.json",
  "documentContent": "...",
  "parseOptions": {
    "autoPublish": false,
    "extractBusinessLogic": true,
    "generateFieldMapping": true,
    "confidenceThreshold": 0.8,
    "filterNonBusinessEndpoints": true,
    "includeUserLinks": true
  }
}
```

**参数说明**:
- `documentType`: 文档类型（openapi/swagger/postman/har）
- `documentUrl`: 文档URL（与documentContent二选一）
- `documentContent`: 文档内容（与documentUrl二选一）
- `parseOptions`: 解析选项
  - `autoPublish`: 是否自动发布到流程库
  - `extractBusinessLogic`: 是否提取业务逻辑
  - `generateFieldMapping`: 是否生成字段映射
  - `confidenceThreshold`: 置信度阈值（0-1）
  - `filterNonBusinessEndpoints`: 是否过滤非业务流程接口（默认true）
  - `includeUserLinks`: 是否解析用户接口链接内容（默认true）

**响应**:
```json
{
  "code": 0,
  "message": "解析任务已创建",
  "data": {
    "parseJobId": "parse-uuid-123",
    "bootstrapJobId": "job-uuid-456",
    "status": "PARSING",
    "estimatedTime": 120,
    "createdAt": "2026-03-05T10:00:00Z",
    "filteringEnabled": true,
    "userLinksEnabled": true
  }
}
```

---

### 14.3.2 查询解析状态

**端点**: `GET /api/v1/bootstrap/jobs/:id/parse-status`

**功能**: 查询API文档解析状态

**查询参数**:
- `parseJobId` (optional): 解析任务ID

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
      "parsedEndpoints": 25,
      "extractedProcesses": 5,
      "extractedFields": 48,
      "confidence": 0.87,
      "warnings": [
        {
          "endpoint": "/api/v1/leave/submit",
          "message": "字段类型推断置信度较低",
          "confidence": 0.72
        }
      ]
    },
    "startedAt": "2026-03-05T10:00:00Z",
    "completedAt": "2026-03-05T10:02:15Z"
  }
}
```

**状态枚举**:
- `PENDING`: 等待解析
- `PARSING`: 解析中
- `COMPLETED`: 解析完成
- `FAILED`: 解析失败
- `REVIEW_REQUIRED`: 需要人工审核

---

### 14.3.3 获取解析结果

**端点**: `GET /api/v1/bootstrap/jobs/:id/parse-result`

**功能**: 获取详细的解析结果

**响应**:
```json
{
  "code": 0,
  "data": {
    "parseJobId": "parse-uuid-123",
    "documentInfo": {
      "type": "openapi",
      "version": "3.0.0",
      "title": "University OA API",
      "baseUrl": "https://oa.example.com/api"
    },
    "filteringSummary": {
      "enabled": true,
      "totalEndpoints": 45,
      "businessEndpoints": 25,
      "filteredEndpoints": [
        "/api/v1/system/config",
        "/api/v1/user/login",
        "/api/v1/health",
        "/api/v1/metrics"
      ],
      "filterReasoning": "过滤了系统配置、认证、监控等非业务接口"
    },
    "extractedProcesses": [
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
            "fieldCode": "reason",
            "fieldName": "请假事由",
            "fieldType": "textarea",
            "required": true,
            "maxLength": 500,
            "confidence": 0.90
          }
        ]
      }
    ],
    "fieldMapping": {
      "leave_type": {
        "oaFieldName": "leaveType",
        "platformFieldName": "leave_type",
        "transformRule": "direct"
      }
    },
    "warnings": [],
    "metadata": {
      "parseTime": 135,
      "llmModel": "claude-opus-4-6",
      "llmTokens": 15420,
      "totalEndpoints": 45,
      "businessEndpoints": 25,
      "filteredEndpoints": 20
    }
  }
}
```

---

### 14.3.4 确认并发布解析结果

**端点**: `POST /api/v1/bootstrap/jobs/:id/confirm-parse`

**功能**: 人工审核后确认解析结果并发布到流程库

**请求**:
```json
{
  "parseJobId": "parse-uuid-123",
  "action": "publish",
  "modifications": [
    {
      "processCode": "LEAVE_REQUEST",
      "fieldCode": "leave_type",
      "changes": {
        "fieldName": "请假类别",
        "options": ["事假", "病假", "年假", "调休"]
      }
    }
  ],
  "comment": "增加调休选项"
}
```

**参数说明**:
- `action`: 操作类型（publish/reject/modify）
- `modifications`: 修改内容（可选）
- `comment`: 审核意见

**响应**:
```json
{
  "code": 0,
  "message": "解析结果已发布到流程库",
  "data": {
    "publishedProcesses": 5,
    "publishedFields": 48,
    "publishedTemplateIds": [
      "template-uuid-1",
      "template-uuid-2"
    ]
  }
}
```

---

### 14.3.5 重新解析

**端点**: `POST /api/v1/bootstrap/jobs/:id/reparse`

**功能**: 调整参数后重新解析

**请求**:
```json
{
  "parseJobId": "parse-uuid-123",
  "parseOptions": {
    "confidenceThreshold": 0.7,
    "extractBusinessLogic": true
  },
  "focusEndpoints": [
    "/api/v1/leave/submit",
    "/api/v1/expense/submit"
  ]
}
```

---

## 14.4 智能体设计

### 14.4.1 Agent职责

**API Document Parser Agent** 负责：
1. 识别API文档格式和版本
2. **过滤非业务流程接口**（新增）
   - 识别系统管理、配置、监控等非业务接口
   - 只保留业务申请相关的接口
   - 提供过滤依据说明
3. **解析用户接口链接内容**（新增）
   - 识别字段中的链接引用（x-options-url、x-data-source等）
   - 获取链接内容并丰富字段定义
   - 自动提取选项列表和约束条件
4. 提取API端点信息（路径、方法、参数）
5. 分析请求/响应结构
6. 推断业务流程和分类
7. 生成字段定义和约束
8. 识别字段间关系（依赖、联动）
9. 评估解析置信度

### 14.4.2 非业务接口过滤规则

**需要过滤的接口类型**：

1. **系统管理接口**
   - 用户管理：`/user/create`, `/user/update`, `/user/delete`
   - 角色管理：`/role/*`, `/permission/*`
   - 组织架构：`/department/*`, `/organization/*`

2. **系统配置接口**
   - 参数设置：`/config/*`, `/settings/*`
   - 字典管理：`/dict/*`, `/dictionary/*`
   - 系统初始化：`/init/*`, `/setup/*`

3. **认证授权接口**
   - 登录登出：`/login`, `/logout`, `/auth/*`
   - Token管理：`/token/*`, `/refresh`
   - SSO相关：`/sso/*`, `/oauth/*`

4. **监控运维接口**
   - 健康检查：`/health`, `/ping`, `/status`
   - 指标统计：`/metrics`, `/stats`
   - 日志查询：`/logs/*`, `/audit/*`

5. **通用服务接口**
   - 文件服务：`/file/upload`, `/file/download`
   - 消息通知：`/notification/*`, `/message/*`
   - 搜索服务：`/search/*`

**保留的业务接口特征**：
- 包含业务关键词：leave（请假）、expense（报销）、purchase（采购）、travel（出差）、seal（用印）、meeting（会议）、vehicle（车辆）等
- 包含业务操作：submit（提交）、apply（申请）、approve（审批）、cancel（撤回）、urge（催办）
- 查询业务状态：`/xxx/{id}`, `/xxx/detail`, `/xxx/status`

### 14.4.3 用户接口链接解析

**支持的链接类型**：

1. **选项列表链接**（x-options-url）
```json
{
  "leave_type": {
    "type": "string",
    "description": "请假类型",
    "x-options-url": "https://oa.example.com/api/v1/dict/leave-types"
  }
}
```

2. **数据源链接**（x-data-source）
```json
{
  "department": {
    "type": "string",
    "description": "部门",
    "x-data-source": "https://oa.example.com/api/v1/departments"
  }
}
```

3. **级联数据链接**（x-cascade-url）
```json
{
  "city": {
    "type": "string",
    "description": "城市",
    "x-cascade-url": "https://oa.example.com/api/v1/regions/{province}/cities"
  }
}
```

**解析流程**：
1. 扫描API文档中的字段定义
2. 识别包含链接引用的字段（x-options-url、x-data-source等）
3. 发起HTTP请求获取链接内容（5秒超时）
4. 解析响应数据，提取选项列表
5. 将选项数据添加到字段定义的 x-options-data 中
6. LLM解析时使用 x-options-data 作为选项列表

### 14.4.2 Agent Prompt设计

```typescript
const API_DOCUMENT_PARSER_PROMPT = `
你是一个专业的API文档解析专家，负责从API文档中提取OA办公流程信息。

## 任务目标
分析提供的API文档，识别其中的办公流程（如请假、报销、采购等），并提取以下信息：

1. **流程识别**
   - 流程代码（processCode）：使用大写下划线命名，如 LEAVE_REQUEST
   - 流程名称（processName）：中文名称
   - 流程分类（processCategory）：人事/财务/行政/采购等
   - 流程描述（description）

2. **端点映射**
   - 提交端点：POST /xxx/submit
   - 查询端点：GET /xxx/{id}
   - 操作端点：POST /xxx/{id}/cancel 等

3. **字段提取**
   - 字段代码（fieldCode）：小写下划线命名
   - 字段名称（fieldName）：中文名称
   - 字段类型（fieldType）：text/number/date/select/textarea等
   - 是否必填（required）
   - 字段约束（maxLength/min/max/pattern等）
   - 选项列表（options）：如果是select类型

4. **置信度评估**
   - 为每个提取的信息标注置信度（0-1）
   - 如果信息不明确，标注为低置信度并说明原因

## 输出格式
返回JSON格式，结构如下：
{
  "processes": [
    {
      "processCode": "LEAVE_REQUEST",
      "processName": "请假申请",
      "processCategory": "人事",
      "description": "...",
      "confidence": 0.92,
      "endpoints": [...],
      "fields": [...]
    }
  ],
  "warnings": [...]
}

## 注意事项
- 优先识别高频办公流程（请假、报销、采购、出差、用印）
- 字段类型推断要准确，日期用date，金额用number
- 如果API文档信息不完整，在warnings中说明
- 保持字段命名的一致性
`;
```

### 14.4.3 Agent实现

```typescript
// apps/api/src/modules/bootstrap/agents/api-document-parser.agent.ts

import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

@Injectable()
export class ApiDocumentParserAgent {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async parseDocument(documentContent: string, documentType: string) {
    const prompt = this.buildPrompt(documentContent, documentType);

    const response = await this.anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const result = this.extractJsonFromResponse(response);
    return this.validateAndEnrich(result);
  }

  private buildPrompt(documentContent: string, documentType: string): string {
    return `
${API_DOCUMENT_PARSER_PROMPT}

## API文档类型
${documentType}

## API文档内容
\`\`\`json
${documentContent}
\`\`\`

请开始解析。
    `;
  }

  private extractJsonFromResponse(response: any): any {
    const content = response.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('无法从LLM响应中提取JSON');
    }
    return JSON.parse(jsonMatch[0]);
  }

  private validateAndEnrich(result: any): any {
    // 验证必填字段
    if (!result.processes || !Array.isArray(result.processes)) {
      throw new Error('解析结果缺少processes字段');
    }

    // 为每个流程生成唯一ID
    result.processes.forEach((process: any) => {
      process.id = this.generateProcessId(process.processCode);

      // 验证字段类型
      process.fields?.forEach((field: any) => {
        if (!this.isValidFieldType(field.fieldType)) {
          field.fieldType = 'text'; // 默认类型
          field.confidence = Math.min(field.confidence || 0.5, 0.6);
        }
      });
    });

    return result;
  }

  private generateProcessId(processCode: string): string {
    return `process-${processCode.toLowerCase()}-${Date.now()}`;
  }

  private isValidFieldType(type: string): boolean {
    const validTypes = [
      'text', 'number', 'date', 'datetime', 'select',
      'multiselect', 'textarea', 'file', 'boolean'
    ];
    return validTypes.includes(type);
  }
}
```

---

## 14.5 数据模型

### 14.5.1 ParseJob表

```prisma
model ParseJob {
  id              String   @id @default(uuid())
  bootstrapJobId  String
  bootstrapJob    BootstrapJob @relation(fields: [bootstrapJobId], references: [id])

  documentType    String   // openapi/swagger/postman/har
  documentUrl     String?
  documentHash    String   // 文档内容哈希

  status          String   // PENDING/PARSING/COMPLETED/FAILED/REVIEW_REQUIRED
  progress        Int      @default(0)

  parseOptions    Json     // 解析选项
  parseResult     Json?    // 解析结果
  parseMetadata   Json?    // 元数据（耗时、token等）

  warnings        Json[]   // 警告信息
  errors          Json[]   // 错误信息

  reviewedBy      String?
  reviewedAt      DateTime?
  reviewComment   String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  completedAt     DateTime?

  @@index([bootstrapJobId])
  @@index([status])
}
```

### 14.5.2 ExtractedProcess表

```prisma
model ExtractedProcess {
  id              String   @id @default(uuid())
  parseJobId      String
  parseJob        ParseJob @relation(fields: [parseJobId], references: [id])

  processCode     String
  processName     String
  processCategory String
  description     String?

  confidence      Float    // 0-1
  endpoints       Json     // API端点信息
  fields          Json     // 字段定义

  status          String   // EXTRACTED/REVIEWED/PUBLISHED/REJECTED
  publishedTemplateId String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([parseJobId])
  @@index([processCode])
}
```

---

## 14.6 业务流程

### 14.6.1 完整解析流程

```
1. 用户上传API文档
   ↓
2. 系统验证文档格式
   ↓
3. 创建ParseJob记录（status=PENDING）
   ↓
4. 加入解析队列
   ↓
5. Worker拉取任务，调用Agent解析
   ↓
6. Agent返回解析结果
   ↓
7. 系统验证和标准化结果
   ↓
8. 更新ParseJob（status=COMPLETED）
   ↓
9. 如果confidence < threshold，status=REVIEW_REQUIRED
   ↓
10. 管理员审核（可选修改）
   ↓
11. 确认后发布到流程库
   ↓
12. 生成ProcessTemplate和FieldDefinition记录
```

### 14.6.2 错误处理

**文档格式错误**:
```json
{
  "code": 40001,
  "message": "文档格式不支持",
  "data": {
    "supportedFormats": ["openapi", "swagger", "postman", "har"]
  }
}
```

**解析失败**:
```json
{
  "code": 50001,
  "message": "API文档解析失败",
  "data": {
    "parseJobId": "parse-uuid-123",
    "error": "LLM返回格式错误",
    "retryable": true
  }
}
```

**置信度过低**:
```json
{
  "code": 0,
  "message": "解析完成，但需要人工审核",
  "data": {
    "parseJobId": "parse-uuid-123",
    "status": "REVIEW_REQUIRED",
    "reason": "部分字段置信度低于阈值(0.8)"
  }
}
```

---

## 14.7 性能优化

### 14.7.1 缓存策略

- **文档缓存**: 相同文档hash不重复解析
- **结果缓存**: 解析结果缓存24小时
- **Agent响应缓存**: 相同prompt缓存1小时

### 14.7.2 并发控制

- 单个租户最多3个并发解析任务
- 使用BullMQ队列控制并发
- 大文档分片解析（>100个端点）

### 14.7.3 成本控制

- 文档预处理：过滤无关信息
- Token优化：只发送必要的文档内容
- 增量解析：只解析变更的端点

---

## 14.8 监控指标

### 14.8.1 业务指标

- 解析成功率：≥90%
- 平均解析时间：≤2分钟
- 置信度平均值：≥0.85
- 需要人工审核率：≤20%

### 14.8.2 技术指标

- LLM API调用成功率：≥99%
- 平均Token消耗：≤20k/文档
- 队列处理延迟：≤10秒
- 数据库写入成功率：100%

---

## 14.9 安全考虑

### 14.9.1 文档安全

- 文档内容加密存储
- 敏感信息脱敏（API Key、密码等）
- 文档访问权限控制

### 14.9.2 解析安全

- 文档大小限制：≤10MB
- 解析超时控制：5分钟
- 恶意内容检测

---

## 14.10 测试用例

### 14.10.1 单元测试

```typescript
describe('ApiDocumentParserAgent', () => {
  it('应该正确解析OpenAPI 3.0文档', async () => {
    const document = loadFixture('openapi-sample.json');
    const result = await agent.parseDocument(document, 'openapi');

    expect(result.processes).toHaveLength(5);
    expect(result.processes[0].processCode).toBe('LEAVE_REQUEST');
    expect(result.processes[0].confidence).toBeGreaterThan(0.8);
  });

  it('应该识别字段类型', async () => {
    const document = loadFixture('openapi-with-fields.json');
    const result = await agent.parseDocument(document, 'openapi');

    const dateField = result.processes[0].fields.find(
      f => f.fieldCode === 'start_date'
    );
    expect(dateField.fieldType).toBe('date');
  });

  it('应该处理低置信度情况', async () => {
    const document = loadFixture('incomplete-api-doc.json');
    const result = await agent.parseDocument(document, 'openapi');

    expect(result.warnings).not.toHaveLength(0);
  });
});
```

### 14.10.2 集成测试

```typescript
describe('Parse Document E2E', () => {
  it('应该完成完整的解析流程', async () => {
    // 1. 上传文档
    const response = await request(app)
      .post('/api/v1/bootstrap/jobs/job-123/parse-document')
      .send({
        documentType: 'openapi',
        documentUrl: 'https://example.com/openapi.json'
      });

    expect(response.status).toBe(200);
    const parseJobId = response.body.data.parseJobId;

    // 2. 等待解析完成
    await waitForStatus(parseJobId, 'COMPLETED', 180000);

    // 3. 获取解析结果
    const result = await request(app)
      .get(`/api/v1/bootstrap/jobs/job-123/parse-result`);

    expect(result.body.data.extractedProcesses.length).toBeGreaterThan(0);

    // 4. 发布到流程库
    const publish = await request(app)
      .post(`/api/v1/bootstrap/jobs/job-123/confirm-parse`)
      .send({ parseJobId, action: 'publish' });

    expect(publish.body.data.publishedProcesses).toBeGreaterThan(0);
  });
});
```

---

## 14.11 部署清单

### 14.11.1 环境变量

```bash
# LLM配置
ANTHROPIC_API_KEY=sk-xxx
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
DOCUMENT_STORAGE_PATH=/data/documents
```

### 14.11.2 依赖服务

- PostgreSQL 16（存储解析结果）
- Redis 7（缓存和队列）
- MinIO（文档存储）
- Anthropic API（LLM服务）

---

## 14.12 上线计划

### Phase 1: MVP（Week 1-2）
- ✅ 支持OpenAPI 3.0格式
- ✅ 基础字段提取（5种常见类型）
- ✅ 同步解析（无队列）
- ✅ 简单的置信度评估

### Phase 2: 增强（Week 3-4）
- ✅ 支持Swagger 2.0、Postman Collection
- ✅ 异步队列处理
- ✅ 人工审核流程
- ✅ 解析结果缓存

### Phase 3: 优化（Week 5-6）
- ✅ 支持HAR文件
- ✅ 增量解析
- ✅ 高级字段类型推断
- ✅ 字段关系识别

---

## 14.13 FAQ

**Q1: 支持哪些API文档格式？**
A: MVP阶段支持OpenAPI 3.0，后续支持Swagger 2.0、Postman Collection、HAR文件。

**Q2: 解析准确率如何保证？**
A: 使用Claude Opus 4.6模型，准确率≥85%。低置信度结果会标记为需要人工审核。

**Q3: 解析一个文档需要多长时间？**
A: 平均2分钟，取决于文档大小和API端点数量。

**Q4: 如何处理解析错误？**
A: 系统会自动重试3次，如果仍失败会通知管理员人工介入。

**Q5: 解析结果可以修改吗？**
A: 可以。在发布前可以人工审核和修改字段定义、流程分类等。

---

**文档状态**: ✅ 完成
**下一步**: 开发实现和测试