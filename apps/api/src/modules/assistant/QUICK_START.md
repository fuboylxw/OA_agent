# OA智能助手模块 - 快速开始指南

## 目录

1. [安装与配置](#安装与配置)
2. [基础使用](#基础使用)
3. [高级功能](#高级功能)
4. [API参考](#api参考)
5. [常见问题](#常见问题)

## 安装与配置

### 环境要求

- Node.js >= 18.0.0
- PostgreSQL >= 14.0
- Redis >= 6.0 (可选，用于缓存)

### 环境变量配置

在 `.env` 文件中添加以下配置：

```bash
# 数据库配置
DATABASE_URL="postgresql://user:password@localhost:5432/oa_agent"

# LLM配置
USE_LLM_FOR_INTENT=true
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4
LLM_BASE_URL=https://api.openai.com/v1

# 默认配置
DEFAULT_TENANT_ID=default-tenant

# 会话配置
SESSION_EXPIRATION_DAYS=30
MAX_CONVERSATION_HISTORY=50

# 日志配置
LOG_LEVEL=info
```

### 数据库迁移

```bash
# 运行数据库迁移
pnpm prisma migrate dev

# 生成Prisma客户端
pnpm prisma generate
```

### 启动服务

```bash
# 开发模式
pnpm dev

# 生产模式
pnpm build
pnpm start
```

## 基础使用

### 1. 发起对话

```bash
curl -X POST http://localhost:3001/api/v1/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "我要报销差旅费"
  }'
```

响应：

```json
{
  "sessionId": "session-123",
  "message": "正在为您填写\"差旅费报销\"。\n\n请问报销金额是多少？",
  "intent": "create_submission",
  "needsInput": true,
  "formData": {
    "employeeId": "auto-filled",
    "applicantName": "auto-filled"
  },
  "missingFields": [
    {
      "key": "amount",
      "label": "报销金额",
      "question": "请问报销金额是多少？"
    }
  ],
  "processStatus": "parameter_collection"
}
```

### 2. 继续对话

```bash
curl -X POST http://localhost:3001/api/v1/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "session-123",
    "message": "1000元"
  }'
```

### 3. 查询会话列表

```bash
curl -X GET "http://localhost:3001/api/v1/assistant/sessions?userId=user-123"
```

### 4. 查询会话消息

```bash
curl -X GET "http://localhost:3001/api/v1/assistant/sessions/session-123/messages"
```

### 5. 重置会话

```bash
curl -X POST "http://localhost:3001/api/v1/assistant/sessions/session-123/reset"
```

### 6. 删除会话

```bash
curl -X DELETE "http://localhost:3001/api/v1/assistant/sessions/session-123"
```

## 高级功能

### 1. 自定义流程定义

创建自定义流程模板：

```typescript
import { ProcessDefinition, ParameterDefinition } from '@/modules/assistant';

const customProcess: ProcessDefinition = {
  processType: 'custom_approval',
  processCode: 'CUSTOM_001',
  processName: '自定义审批',
  parameters: [
    {
      name: 'title',
      type: 'text',
      required: true,
      description: '标题',
      validation: [
        {
          type: 'min_length',
          params: { min: 5 },
          message: '标题至少5个字符',
        },
      ],
    },
    {
      name: 'amount',
      type: 'number',
      required: true,
      description: '金额',
      validation: [
        {
          type: 'min_value',
          params: { min: 0 },
          message: '金额必须大于0',
        },
      ],
    },
  ],
  steps: [
    {
      stepId: 'validate',
      stepName: '验证参数',
      action: 'validate',
      config: {
        rules: [
          {
            type: 'custom',
            expression: '{amount} <= 10000',
            message: '金额不能超过10000',
          },
        ],
      },
      onSuccess: 'submit',
      onFailure: 'notify_error',
    },
    {
      stepId: 'submit',
      stepName: '提交申请',
      action: 'call_mcp',
      config: {
        toolName: 'custom.submit',
        inputMapping: {
          title: 'title',
          amount: 'amount',
        },
      },
      retryPolicy: {
        maxAttempts: 3,
        backoffMs: 1000,
        backoffMultiplier: 2,
      },
    },
  ],
  rollbackStrategy: {
    enabled: true,
    steps: [
      {
        stepId: 'cleanup',
        action: 'delete_draft',
        config: {},
      },
    ],
  },
};
```

### 2. 自定义参数验证

```typescript
import { ParameterValidator, ValidationRule } from '@/modules/assistant';

const validator = new ParameterValidator();

// 自定义验证规则
const customRule: ValidationRule = {
  type: 'custom',
  params: {
    validator: (value: any) => {
      // 自定义验证逻辑
      return value > 0 && value < 100000;
    },
  },
  message: '金额必须在0-100000之间',
};

// 验证参数
const errors = validator.validate(parameterDefinition, value);
if (errors.length > 0) {
  console.error('验证失败:', errors);
}
```

### 3. 使用上下文管理器

```typescript
import { ContextManager } from '@/modules/assistant';

// 注入依赖
constructor(private readonly contextManager: ContextManager) {}

// 获取会话上下文
const session = await this.contextManager.getSession(sessionId);

// 创建流程上下文
const process = await this.contextManager.createProcessContext(
  sessionId,
  'leave_request',
  'submission'
);

// 更新流程上下文
await this.contextManager.updateProcessContext(sessionId, {
  status: ProcessStatus.PARAMETER_COLLECTION,
  parameters: { leaveType: 'annual' },
});

// 获取共享上下文
const sharedContext = await this.contextManager.getSharedContext(
  userId,
  tenantId
);

// 清理过期会话
const cleaned = await this.contextManager.cleanupExpiredSessions(30);
console.log(`清理了 ${cleaned} 个过期会话`);
```

### 4. 使用参数收集器

```typescript
import { ParameterCollector } from '@/modules/assistant';

const collector = new ParameterCollector();

// 收集参数
const result = await collector.collectParameters(
  userInput,
  processContext,
  parameterDefinitions,
  sharedContext
);

console.log('收集进度:', result.progress);
console.log('是否完成:', result.isComplete);
console.log('下一个问题:', result.nextQuestion);
console.log('验证错误:', result.validationErrors);
```

### 5. 使用流程编排器

```typescript
import { ProcessOrchestrator } from '@/modules/assistant';

const orchestrator = new ProcessOrchestrator(mcpExecutor, prisma);

// 执行流程
const result = await orchestrator.executeProcess(
  processDefinition,
  processContext,
  connectorId
);

if (result.success) {
  console.log('流程执行成功:', result.result);
} else {
  console.error('流程执行失败:', result.error);
}
```

### 6. 异常处理

```typescript
import {
  ExceptionHandler,
  ParameterRequiredException,
  ProcessException,
} from '@/modules/assistant';

try {
  // 业务逻辑
  if (!params.amount) {
    throw new ParameterRequiredException('amount');
  }

  // 执行流程
  await executeProcess();
} catch (error) {
  // 处理异常
  const handled = ExceptionHandler.handle(error);

  // 记录日志
  ExceptionHandler.logError(error, 'ProcessExecution');

  // 判断是否可重试
  if (ExceptionHandler.isRetryable(error)) {
    console.log('错误可重试');
  }

  // 获取用户友好的消息
  const message = ExceptionHandler.getUserFriendlyMessage(error);

  // 返回错误响应
  return ExceptionHandler.formatErrorResponse(error);
}
```

### 7. 使用工具类

```typescript
import { AssistantUtils } from '@/modules/assistant';

// 日期处理
const date = AssistantUtils.parseRelativeDate('明天');
const formatted = AssistantUtils.formatDate(new Date());
const diff = AssistantUtils.calculateDateDiff('2026-03-01', '2026-03-10');

// 金额处理
const amount = AssistantUtils.parseAmount('1000元');
const formatted = AssistantUtils.formatAmount(1000);

// 文本处理
const truncated = AssistantUtils.truncate('很长的文本...', 20);
const keywords = AssistantUtils.extractKeywords('这是一段文本');
const similarity = AssistantUtils.calculateSimilarity('文本1', '文本2');

// 时间范围
const range = AssistantUtils.parseTimeRange('从3月1日到3月10日');
const validation = AssistantUtils.validateDateRange(range.start, range.end);

// 重试
const result = await AssistantUtils.retry(
  async () => await someAsyncOperation(),
  {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2,
  }
);

// 批处理
const results = await AssistantUtils.batchProcess(
  items,
  async (item) => await processItem(item),
  10 // 批次大小
);
```

## API参考

### POST /v1/assistant/chat

发送消息给智能助手。

**请求体:**

```typescript
{
  message: string;          // 必填，用户消息
  sessionId?: string;       // 可选，会话ID
  userId?: string;          // 可选，用户ID
  tenantId?: string;        // 可选，租户ID
}
```

**响应:**

```typescript
{
  sessionId: string;        // 会话ID
  message: string;          // 助手回复
  intent?: string;          // 识别的意图
  draftId?: string;         // 草稿ID
  needsInput: boolean;      // 是否需要用户输入
  suggestedActions?: string[];  // 建议的操作
  formData?: Record<string, any>;  // 表单数据
  missingFields?: Array<{   // 缺失的字段
    key: string;
    label: string;
    question: string;
  }>;
  processStatus?: string;   // 流程状态
}
```

### GET /v1/assistant/sessions

获取会话列表。

**查询参数:**

- `tenantId` (可选): 租户ID
- `userId` (可选): 用户ID

**响应:**

```typescript
Array<{
  id: string;
  userId: string;
  tenantId: string;
  status: string;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    messages: number;
  };
}>
```

### GET /v1/assistant/sessions/:sessionId/messages

获取会话消息。

**响应:**

```typescript
Array<{
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: any;
  createdAt: Date;
}>
```

### POST /v1/assistant/sessions/:sessionId/reset

重置会话上下文。

**响应:**

```typescript
{
  success: boolean;
  message: string;
}
```

### DELETE /v1/assistant/sessions/:sessionId

删除会话。

**响应:**

```typescript
{
  success: boolean;
  message: string;
}
```

## 常见问题

### 1. 如何配置用户的默认审批人？

在用户表的 `metadata` 字段中配置：

```json
{
  "defaultApprover": "manager-user-id",
  "defaultCC": ["cc1-user-id", "cc2-user-id"]
}
```

### 2. 如何添加新的流程类型？

1. 在 `ProcessLibrary` 中创建流程模板
2. 定义字段Schema
3. 实现对应的MCP工具
4. 系统会自动识别和支持

### 3. 如何自定义参数提取逻辑？

扩展 `ParameterCollector` 类：

```typescript
class CustomParameterCollector extends ParameterCollector {
  protected extractValue(input: string, def: ParameterDefinition): any {
    // 自定义提取逻辑
    if (def.type === 'custom_type') {
      return this.extractCustomType(input);
    }
    return super.extractValue(input, def);
  }

  private extractCustomType(input: string): any {
    // 实现自定义类型的提取
  }
}
```

### 4. 如何处理长时间运行的流程？

使用异步处理和状态跟踪：

```typescript
// 1. 创建流程记录
const process = await createProcess();

// 2. 异步执行
executeProcessAsync(process.id).catch(error => {
  // 记录错误
  logError(error);
});

// 3. 返回处理中状态
return {
  processId: process.id,
  status: 'processing',
  message: '流程正在处理中，请稍后查询结果',
};
```

### 5. 如何实现多轮对话的上下文保持？

系统自动管理对话上下文，只需确保传递正确的 `sessionId`：

```typescript
// 第一轮
const response1 = await chat({ message: '我要请假' });
const sessionId = response1.sessionId;

// 第二轮（传递sessionId）
const response2 = await chat({
  sessionId,
  message: '年假'
});

// 第三轮
const response3 = await chat({
  sessionId,
  message: '3月10日到3月12日'
});
```

### 6. 如何优化参数收集的轮次？

1. **配置用户默认值**: 在共享上下文中配置常用参数
2. **智能提取**: 从用户输入中提取多个参数
3. **批量询问**: 将相关参数组合询问

```typescript
// 批量询问示例
const question = '请提供以下信息：\n' +
  '1. 报销金额\n' +
  '2. 报销日期\n' +
  '3. 报销事由';
```

### 7. 如何处理并发请求？

系统使用数据库事务和乐观锁来处理并发：

```typescript
// 使用事务
await prisma.$transaction(async (tx) => {
  // 更新会话
  await tx.chatSession.update({
    where: { id: sessionId },
    data: { metadata: newMetadata },
  });

  // 创建消息
  await tx.chatMessage.create({
    data: { sessionId, content, role: 'user' },
  });
});
```

### 8. 如何监控系统性能？

使用审计日志和统计信息：

```typescript
// 获取会话统计
const stats = await contextManager.getSessionStats(userId, tenantId);
console.log('总会话数:', stats.totalSessions);
console.log('活跃会话数:', stats.activeSessions);
console.log('平均消息数:', stats.averageMessagesPerSession);

// 查询审计日志
const logs = await prisma.auditLog.findMany({
  where: {
    action: 'submit_application',
    result: 'success',
    createdAt: {
      gte: new Date('2026-03-01'),
    },
  },
});
```

### 9. 如何实现国际化？

1. 在常量中定义多语言文本
2. 根据用户语言偏好选择对应文本

```typescript
const messages = {
  'zh-CN': {
    greeting: '您好',
    submit: '提交',
  },
  'en-US': {
    greeting: 'Hello',
    submit: 'Submit',
  },
};

const language = sharedContext.preferences.language;
const text = messages[language].greeting;
```

### 10. 如何调试流程执行？

启用详细日志：

```bash
# 设置日志级别
LOG_LEVEL=debug

# 查看日志
tail -f logs/assistant.log
```

在代码中添加调试信息：

```typescript
console.log('[Debug] Process context:', processContext);
console.log('[Debug] Parameters:', parameters);
console.log('[Debug] Validation errors:', errors);
```

## 更多资源

- [完整文档](./README.md)
- [更新日志](./CHANGELOG.md)
- [优化总结](./OPTIMIZATION_SUMMARY.md)
- [类型定义](./types/context.types.ts)
- [示例代码](./examples/)

## 技术支持

如有问题，请：

1. 查看文档和常见问题
2. 查看审计日志排查问题
3. 提交Issue到GitHub仓库
4. 联系技术支持团队

## 许可证

MIT License
