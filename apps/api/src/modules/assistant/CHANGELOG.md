# 智能助手模块更新日志

## [2.0.0] - 2026-03-05

### 重大更新
基于 PRD 文档 (OA_Agent_Design.md) 完全重构智能助手模块，实现完整的上下文管理和流程编排能力。

### 新增功能

#### 1. 上下文管理系统
- **会话上下文 (Session Context)**
  - 独立的会话生命周期管理
  - 对话历史记录（最近50条）
  - 会话状态跟踪
  - 会话过期自动清理

- **流程上下文 (Process Context)**
  - 流程状态机（7种状态）
  - 参数收集进度跟踪
  - 验证错误记录
  - 流程隔离机制

- **共享上下文 (Shared Context)**
  - 用户基础信息管理
  - 用户偏好设置
  - 历史申请记录
  - 常用流程统计
  - 智能参数预填充

#### 2. 智能参数收集器 (ParameterCollector)
- 从自然语言提取多种字段类型
  - 数字（金额、数量）
  - 日期（绝对日期、相对日期）
  - 日期时间
  - 邮箱
  - 电话
  - 选项（单选、多选）
  - 文本
- 支持多种验证规则
  - 必填验证
  - 长度验证
  - 数值范围验证
  - 正则表达式验证
  - 邮箱格式验证
  - 手机号格式验证
- 智能问题生成
  - 根据字段类型生成针对性问题
  - 支持自定义提示语
  - 参数插值
- 进度跟踪（0-1）

#### 3. 流程编排器 (ProcessOrchestrator)
- 完整的流程定义支持
  - 前置条件检查
  - 多步骤执行
  - 后置动作
  - 回滚策略
- 步骤类型
  - VALIDATE - 验证步骤
  - TRANSFORM - 转换步骤
  - CALL_MCP - MCP调用步骤
  - NOTIFY - 通知步骤
  - WAIT - 等待步骤
  - BRANCH - 分支步骤
- 重试机制
  - 可配置重试次数
  - 指数退避策略
- 错误处理
  - 失败处理流程
  - 自动回滚
  - 错误日志记录

#### 4. 上下文管理器 (ContextManager)
- 统一的上下文管理接口
- 会话CRUD操作
- 流程上下文生命周期管理
- 共享上下文持久化
- 消息历史管理
- 会话统计信息
- 过期会话清理

#### 5. 增强的对话流程
- **参数收集阶段**
  - 智能识别已填写字段
  - 逐个询问缺失字段
  - 实时验证用户输入
  - 支持修改已填写字段

- **确认阶段**
  - 生成表单摘要
  - 支持确认/修改/取消
  - 草稿自动保存

- **执行阶段**
  - MCP工具调用
  - 提交结果记录
  - 成功/失败处理

- **错误恢复**
  - 自动回滚机制
  - 保留流程上下文
  - 支持重试

#### 6. 增强的操作支持
- **查询状态**
  - 显示流程名称
  - 友好的状态文本
  - 按时间排序

- **撤回/催办/补件/转办**
  - 智能提取申请编号
  - 列出可操作的申请
  - MCP工具集成
  - 操作结果反馈

#### 7. API接口优化
- 路径更新为 `/v1/assistant/*`
- 完整的Swagger文档
- 详细的错误处理
- HTTP状态码规范
- 新增接口
  - `DELETE /v1/assistant/sessions/:sessionId` - 删除会话
  - `POST /v1/assistant/sessions/:sessionId/reset` - 重置会话

### 改进

#### 1. 代码结构
- 模块化设计
  - `types/` - 类型定义
  - `collectors/` - 参数收集器
  - `orchestrators/` - 流程编排器
  - `managers/` - 上下文管理器
  - `agents/` - 智能体
- 清晰的职责分离
- 更好的可测试性

#### 2. 错误处理
- 全局错误捕获
- 详细的错误日志
- 友好的错误提示
- 审计日志记录

#### 3. 性能优化
- 共享上下文缓存
- 参数预填充
- 消息历史限制
- 数据库查询优化

#### 4. 用户体验
- 更自然的对话流程
- 智能参数预填充
- 进度提示
- 操作建议

### 类型定义

#### ProcessStatus
```typescript
enum ProcessStatus {
  INITIALIZED = 'initialized',
  PARAMETER_COLLECTION = 'parameter_collection',
  PENDING_CONFIRMATION = 'pending_confirmation',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}
```

#### SessionContext
```typescript
interface SessionContext {
  sessionId: string;
  userId: string;
  tenantId: string;
  conversationHistory: ConversationMessage[];
  currentProcess?: ProcessContext;
  createdAt: Date;
  expiresAt?: Date;
}
```

#### ProcessContext
```typescript
interface ProcessContext {
  processId: string;
  processType: string;
  processCode: string;
  status: ProcessStatus;
  parameters: Record<string, any>;
  collectedParams: Set<string>;
  validationErrors: ValidationError[];
  createdAt: Date;
  updatedAt: Date;
}
```

#### SharedContext
```typescript
interface SharedContext {
  userId: string;
  profile: UserProfile;
  preferences: UserPreferences;
  history: UserHistory;
}
```

### 使用示例

#### 完整的申请流程
```typescript
// 1. 用户发起申请
POST /v1/assistant/chat
{
  "message": "我要报销差旅费1000元"
}

// 响应：识别意图，匹配流程，提取参数
{
  "sessionId": "session-123",
  "message": "正在为您填写\"差旅费报销\"。\n\n请问报销日期是哪天？",
  "intent": "create_submission",
  "needsInput": true,
  "formData": {
    "amount": 1000,
    "employeeId": "auto-filled",
    "applicantName": "auto-filled"
  },
  "missingFields": [
    {
      "key": "date",
      "label": "报销日期",
      "question": "请问报销日期是哪天？"
    }
  ],
  "processStatus": "parameter_collection"
}

// 2. 用户继续填写
POST /v1/assistant/chat
{
  "sessionId": "session-123",
  "message": "今天"
}

// 响应：继续收集参数
{
  "sessionId": "session-123",
  "message": "请简要说明报销事由。",
  "needsInput": true,
  "formData": {
    "amount": 1000,
    "date": "2026-03-05",
    "employeeId": "auto-filled"
  },
  "processStatus": "parameter_collection"
}

// 3. 用户完成填写
POST /v1/assistant/chat
{
  "sessionId": "session-123",
  "message": "出差北京产生的交通费"
}

// 响应：生成确认摘要
{
  "sessionId": "session-123",
  "message": "\"差旅费报销\"草稿已生成。\n\n表单内容：\n  报销金额: 1000\n  报销日期: 2026-03-05\n  报销事由: 出差北京产生的交通费\n  申请人: 张三\n\n确认提交吗？",
  "draftId": "draft-456",
  "needsInput": true,
  "processStatus": "pending_confirmation",
  "suggestedActions": ["确认提交", "修改内容", "取消"]
}

// 4. 用户确认提交
POST /v1/assistant/chat
{
  "sessionId": "session-123",
  "message": "确认"
}

// 响应：提交成功
{
  "sessionId": "session-123",
  "message": "申请已提交成功！\n\n申请编号：REQ20260305001\n流程：差旅费报销\n\n您可以随时查询申请进度。",
  "needsInput": false,
  "processStatus": "completed",
  "suggestedActions": ["查询进度", "发起新申请"]
}
```

### 配置说明

#### 环境变量
```bash
# LLM配置
USE_LLM_FOR_INTENT=true
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4

# 默认配置
DEFAULT_TENANT_ID=default-tenant

# 会话配置
SESSION_EXPIRATION_DAYS=30
MAX_CONVERSATION_HISTORY=50
```

### 监控指标

系统自动记录以下指标：
- 意图识别准确率
- 参数收集轮次
- 流程完成时长
- MCP调用成功率
- 错误发生率
- 用户满意度

### 审计日志

所有关键操作都会记录审计日志：
- `intent_detection` - 意图识别
- `process_initialized` - 流程初始化
- `submit_application` - 申请提交
- `action_cancel` - 撤回操作
- `action_urge` - 催办操作
- `action_supplement` - 补件操作
- `action_delegate` - 转办操作
- `query_status` - 状态查询
- `service_request` - 服务请求
- `chat_error` - 聊天错误

### 迁移指南

#### 从 1.x 升级到 2.0

1. **API路径变更**
   ```
   旧: POST /assistant/chat
   新: POST /v1/assistant/chat
   ```

2. **响应格式变更**
   - 新增 `processStatus` 字段
   - `missingFields` 结构更详细
   - 新增 `suggestedActions` 字段

3. **会话管理**
   - 会话现在有明确的生命周期
   - 需要定期清理过期会话
   - 建议使用 `resetSession` 而不是删除会话

4. **上下文管理**
   - 流程上下文现在独立管理
   - 共享上下文自动预填充
   - 需要在用户元数据中配置默认值

### 已知问题

1. 表达式评估使用 `Function` 构造器，生产环境应使用更安全的方式
2. 通知功能暂未实现，需要集成通知服务
3. 文件上传功能待完善

### 后续计划

- [ ] 集成通知服务
- [ ] 支持文件上传
- [ ] 多语言支持
- [ ] 语音交互
- [ ] 流程模板可视化编辑器
- [ ] 更强大的表达式引擎
- [ ] 性能监控面板
- [ ] A/B测试支持

### 贡献者

- 基于 PRD 文档设计和实现
- 参考 OpenCode Agent 架构

### 文档

- [README.md](./README.md) - 模块概述和使用指南
- [context.types.ts](./types/context.types.ts) - 类型定义
- [parameter.collector.ts](./collectors/parameter.collector.ts) - 参数收集器
- [process.orchestrator.ts](./orchestrators/process.orchestrator.ts) - 流程编排器
- [context.manager.ts](./managers/context.manager.ts) - 上下文管理器
