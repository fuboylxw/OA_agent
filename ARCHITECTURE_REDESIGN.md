# OA Agent 架构重新设计 - MCP 协议方案

## 📋 设计目标

将 OA 系统集成从硬编码适配器改为基于 MCP (Model Context Protocol) 的动态工具调用方案。

## 🎯 核心理念

**从"适配器模式"转向"工具协议模式"**

- ❌ 旧方案：为每个 OA 系统编写适配器代码
- ✅ 新方案：用户上传 API 文档 → LLM 解析 → 生成 MCP 工具 → 动态调用

## 🏗️ 新架构流程

### 1. 初始化阶段（Bootstrap）

```
用户上传 API 文档
    ↓
LLM 解析文档（OpenAPI/Swagger/自定义格式）
    ↓
提取 API 能力：
  - 认证方式
  - 可用端点
  - 请求/响应格式
  - 参数定义
    ↓
生成 MCP 工具定义
    ↓
存储到数据库（MCPTool 表）
```

### 2. 运行时阶段（Chat）

```
用户：我要报销差旅费 1000 元
    ↓
Intent Agent：识别意图 = create_submission
    ↓
Flow Agent：匹配流程 = 差旅费报销
    ↓
Form Agent：提取字段 = {amount: 1000, ...}
    ↓
MCP Executor：
  1. 查询该流程对应的 MCP 工具
  2. 构造工具调用参数
  3. 执行 MCP 工具（调用 OA API）
  4. 返回结果
    ↓
返回用户：申请已提交，编号 EXP-2024-001
```

## 📊 数据库设计

### 新增表：MCPTool

```prisma
model MCPTool {
  id          String   @id @default(uuid())
  tenantId    String
  connectorId String

  // MCP 工具定义
  toolName    String   // 工具名称，如 "o2oa_submit_expense"
  toolSchema  Json     // MCP 工具 schema（JSON Schema 格式）

  // API 映射
  apiEndpoint String   // API 端点，如 "/x_processplatform_assemble_surface/jaxrs/work"
  httpMethod  String   // HTTP 方法，如 "POST"
  headers     Json?    // 请求头模板
  bodyTemplate Json?   // 请求体模板

  // 参数映射
  paramMapping Json    // 参数映射规则

  // 响应处理
  responseMapping Json // 响应映射规则

  // 元数据
  flowCode    String?  // 关联的流程代码
  category    String   // 工具分类：submit, query, cancel, urge

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  connector   Connector @relation(fields: [connectorId], references: [id])
  tenant      Tenant    @relation(fields: [tenantId], references: [id])

  @@index([connectorId])
  @@index([flowCode])
}
```

## 🔧 实现步骤

### Step 1: API 文档解析 Agent

```typescript
// apps/api/src/modules/mcp/api-doc-parser.agent.ts

export class ApiDocParserAgent extends BaseAgent {
  async run(input: {
    docType: 'openapi' | 'swagger' | 'postman' | 'custom';
    docContent: string;
    oaUrl: string;
  }) {
    // 使用 LLM 解析 API 文档
    const prompt = `
你是一个 API 文档解析专家。请分析以下 OA 系统的 API 文档，提取所有可用的 API 端点。

文档类型：${input.docType}
OA 系统地址：${input.oaUrl}

文档内容：
${input.docContent}

请提取以下信息：
1. 认证方式（OAuth2/API Key/Cookie/Basic Auth）
2. 所有 API 端点列表
3. 每个端点的：
   - HTTP 方法
   - 路径
   - 请求参数
   - 响应格式
   - 用途说明

以 JSON 格式返回。
`;

    const result = await this.llm.complete(prompt);
    return JSON.parse(result);
  }
}
```

### Step 2: MCP 工具生成器

```typescript
// apps/api/src/modules/mcp/mcp-tool-generator.service.ts

export class MCPToolGeneratorService {
  async generateTools(
    parsedApis: ParsedApiDoc,
    connectorId: string,
  ): Promise<MCPTool[]> {
    const tools: MCPTool[] = [];

    for (const api of parsedApis.endpoints) {
      // 为每个 API 生成 MCP 工具定义
      const tool = {
        toolName: this.generateToolName(api),
        toolSchema: this.generateToolSchema(api),
        apiEndpoint: api.path,
        httpMethod: api.method,
        headers: api.headers,
        bodyTemplate: api.requestBody,
        paramMapping: this.generateParamMapping(api),
        responseMapping: this.generateResponseMapping(api),
        category: this.categorizeApi(api),
      };

      tools.push(tool);
    }

    return tools;
  }

  private generateToolSchema(api: ApiEndpoint): MCPToolSchema {
    return {
      name: this.generateToolName(api),
      description: api.description,
      input_schema: {
        type: 'object',
        properties: this.convertParamsToSchema(api.parameters),
        required: api.parameters
          .filter(p => p.required)
          .map(p => p.name),
      },
    };
  }

  private generateToolName(api: ApiEndpoint): string {
    // 生成工具名称，如：o2oa_submit_expense, o2oa_query_status
    const action = this.extractAction(api.path, api.method);
    const resource = this.extractResource(api.path);
    return `o2oa_${action}_${resource}`;
  }
}
```

### Step 3: MCP 工具执行器

```typescript
// apps/api/src/modules/mcp/mcp-executor.service.ts

export class MCPExecutorService {
  async executeTool(
    toolName: string,
    params: Record<string, any>,
    connectorId: string,
  ): Promise<any> {
    // 1. 查询 MCP 工具定义
    const tool = await this.prisma.mCPTool.findFirst({
      where: { toolName, connectorId },
      include: { connector: true },
    });

    if (!tool) {
      throw new Error(`MCP tool ${toolName} not found`);
    }

    // 2. 应用参数映射
    const mappedParams = this.applyParamMapping(
      params,
      tool.paramMapping,
    );

    // 3. 构造 HTTP 请求
    const request = {
      method: tool.httpMethod,
      url: `${tool.connector.baseUrl}${tool.apiEndpoint}`,
      headers: this.buildHeaders(tool.headers, tool.connector),
      data: this.buildRequestBody(mappedParams, tool.bodyTemplate),
    };

    // 4. 执行 HTTP 请求
    const response = await axios(request);

    // 5. 应用响应映射
    const mappedResponse = this.applyResponseMapping(
      response.data,
      tool.responseMapping,
    );

    return mappedResponse;
  }

  private applyParamMapping(
    params: Record<string, any>,
    mapping: any,
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [targetKey, rule] of Object.entries(mapping)) {
      if (typeof rule === 'string') {
        // 简单映射：target = source
        result[targetKey] = params[rule];
      } else if (typeof rule === 'object') {
        // 复杂映射：支持转换函数
        const { source, transform } = rule as any;
        let value = params[source];

        if (transform) {
          value = this.applyTransform(value, transform);
        }

        result[targetKey] = value;
      }
    }

    return result;
  }
}
```

### Step 4: 集成到 Assistant

```typescript
// apps/api/src/modules/assistant/assistant.service.ts

export class AssistantService {
  async chat(message: string, sessionId: string) {
    // 1. Intent 识别
    const intent = await this.intentAgent.execute({ message });

    if (intent.data.intent === 'create_submission') {
      // 2. Flow 匹配
      const flow = await this.flowAgent.execute({ message });

      // 3. Form 提取
      const form = await this.formAgent.execute({
        message,
        processCode: flow.data.matchedFlow.processCode,
      });

      // 4. 查询该流程对应的 MCP 工具
      const tool = await this.prisma.mCPTool.findFirst({
        where: {
          flowCode: flow.data.matchedFlow.processCode,
          category: 'submit',
        },
      });

      if (!tool) {
        return { message: '该流程暂不支持自动提交' };
      }

      // 5. 执行 MCP 工具
      const result = await this.mcpExecutor.executeTool(
        tool.toolName,
        form.data.extractedFields,
        tool.connectorId,
      );

      return {
        message: `申请已提交成功！\n申请编号：${result.submissionId}\n当前状态：${result.status}`,
        submissionId: result.submissionId,
      };
    }

    // 其他意图处理...
  }
}
```

## 🎨 用户交互流程

### 初始化流程

```typescript
// 1. 用户上传 API 文档
POST /api/v1/bootstrap/jobs
{
  "oaUrl": "http://localhost/x_desktop/index.html",
  "apiDocType": "openapi",
  "apiDocUrl": "http://localhost/api-docs.json"
  // 或者直接上传文档内容
  "apiDocContent": "..."
}

// 2. 系统自动处理
// - 下载/读取 API 文档
// - LLM 解析文档
// - 生成 MCP 工具
// - 存储到数据库

// 3. 用户查看生成的工具
GET /api/v1/mcp/tools?connectorId=xxx
{
  "tools": [
    {
      "toolName": "o2oa_submit_expense",
      "description": "提交差旅费报销申请",
      "category": "submit",
      "flowCode": "travel_expense"
    },
    {
      "toolName": "o2oa_query_status",
      "description": "查询申请状态",
      "category": "query"
    }
  ]
}
```

### 运行时流程

```typescript
// 用户在对话工作台发送消息
POST /api/v1/assistant/chat
{
  "sessionId": "xxx",
  "message": "我要报销差旅费1000元"
}

// 系统内部流程：
// 1. Intent Agent → create_submission
// 2. Flow Agent → travel_expense
// 3. Form Agent → {amount: 1000, ...}
// 4. MCP Executor → 调用 o2oa_submit_expense 工具
// 5. 返回结果

Response:
{
  "message": "申请已提交成功！\n申请编号：EXP-2024-001",
  "submissionId": "EXP-2024-001"
}
```

## 🔄 与现有架构的对比

| 维度 | 旧架构（适配器模式） | 新架构（MCP 协议） |
|------|---------------------|-------------------|
| **扩展性** | 每个 OA 系统需要编写适配器 | 上传 API 文档即可 |
| **维护成本** | 高（代码维护） | 低（配置维护） |
| **灵活性** | 低（硬编码） | 高（动态生成） |
| **通用性** | 低（特定 OA） | 高（任意 API） |
| **开发周期** | 长（编码+测试） | 短（上传+解析） |
| **AI 能力** | 不依赖 | 依赖 LLM 解析 |

## 📝 实现优先级

### P0 - 核心功能
1. ✅ API 文档解析 Agent
2. ✅ MCP 工具生成器
3. ✅ MCP 工具执行器
4. ✅ 数据库 Schema 更新

### P1 - 集成功能
5. ✅ Bootstrap 流程集成
6. ✅ Assistant 集成
7. ✅ 前端上传 API 文档界面

### P2 - 优化功能
8. ⏳ 工具测试与验证
9. ⏳ 参数映射可视化编辑
10. ⏳ 错误处理与重试

## 🎯 下一步行动

1. **更新 Prisma Schema**：添加 MCPTool 表
2. **实现 API 文档解析 Agent**：支持 OpenAPI/Swagger
3. **实现 MCP 工具生成器**：自动生成工具定义
4. **实现 MCP 工具执行器**：动态调用 OA API
5. **更新 Bootstrap 流程**：集成 MCP 工具生成
6. **更新 Assistant**：使用 MCP 工具执行操作
7. **测试完整流程**：O2OA 系统端到端测试

---

**优势总结**：
- 🚀 **快速接入**：上传 API 文档即可，无需编码
- 🔧 **灵活配置**：参数映射可视化编辑
- 🤖 **AI 驱动**：LLM 自动理解 API 语义
- 🌐 **通用方案**：支持任意 RESTful API
- 📈 **易于扩展**：新增 OA 系统零代码

**技术栈**：
- MCP (Model Context Protocol)
- LLM (OpenAI/Claude) for API parsing
- JSON Schema for tool definition
- Dynamic HTTP client for execution
