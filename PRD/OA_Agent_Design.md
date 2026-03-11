# OA智能申请代理系统 PRD

> 企业级接入、同步、版本治理设计参见 `15_企业级OA接入与同步架构设计.md`

## 1. 项目概述

### 1.1 目标
设计一个智能代理系统，能够自动处理OA申请流程，通过自然语言交互理解用户意图，收集必要参数，并调用MCP接口完成申请操作。

### 1.2 核心特性
- 上下文隔离：不同申请流程间互不干扰
- 部分上下文共享：用户基础信息、常用配置可跨流程复用
- 意图识别：准确理解用户的申请需求
- 参数收集：交互式获取完整的申请参数
- 接口调用：通过MCP统一调用OA系统接口

## 2. 系统架构设计

### 2.1 整体架构（参考OpenCode Agent设计）
```
┌─────────────────────────────────────────────────────────┐
│                    用户交互层                              │
│              (Natural Language Interface)                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   Agent核心层                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ 意图识别模块  │  │ 参数收集模块  │  │ 流程编排模块  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   上下文管理层                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ 会话上下文    │  │ 共享上下文    │  │ 流程上下文    │  │
│  │ (Session)    │  │ (Shared)     │  │ (Process)    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    MCP接口层                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ 请假申请接口  │  │ 报销申请接口  │  │ 审批查询接口  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   OA系统接口                              │
└─────────────────────────────────────────────────────────┘
```

### 2.2 上下文隔离与共享机制

#### 2.2.1 会话上下文 (Session Context)
- **作用域**: 单次对话会话
- **生命周期**: 会话开始到结束
- **内容**:
  - 当前对话历史
  - 临时变量
  - 会话状态
- **隔离性**: 完全隔离，不同会话互不影响

#### 2.2.2 流程上下文 (Process Context)
- **作用域**: 单个申请流程
- **生命周期**: 流程启动到完成/取消
- **内容**:
  - 流程类型（请假、报销、出差等）
  - 已收集的参数
  - 流程状态（初始化、参数收集中、待确认、执行中、完成）
  - 流程ID
- **隔离性**: 不同流程类型完全隔离

#### 2.2.3 共享上下文 (Shared Context)
- **作用域**: 全局
- **生命周期**: 持久化存储
- **内容**:
  - 用户基础信息（姓名、工号、部门、职位）
  - 常用配置（默认审批人、抄送人）
  - 历史申请记录摘要
  - 用户偏好设置
- **共享性**: 所有流程可读取，需权限控制写入

## 3. 核心模块设计

### 3.1 意图识别模块

#### 3.1.1 功能
- 识别用户的申请意图类型
- 提取初始参数信息
- 判断是否为多意图组合

#### 3.1.2 支持的意图类型
```typescript
enum IntentType {
  LEAVE_REQUEST = "leave_request",           // 请假申请
  REIMBURSEMENT = "reimbursement",          // 报销申请
  BUSINESS_TRIP = "business_trip",          // 出差申请
  OVERTIME = "overtime",                    // 加班申请
  PROCUREMENT = "procurement",              // 采购申请
  APPROVAL_QUERY = "approval_query",        // 审批查询
  CANCEL_REQUEST = "cancel_request",        // 取消申请
  UNKNOWN = "unknown"                       // 未知意图
}
```

#### 3.1.3 意图识别流程
```
用户输入 → NLU处理 → 意图分类 → 置信度评估 →
  ├─ 高置信度 → 进入参数收集
  ├─ 中置信度 → 确认意图
  └─ 低置信度 → 引导用户明确意图
```

### 3.2 参数收集模块

#### 3.2.1 参数定义结构
```typescript
interface ParameterDefinition {
  name: string;                    // 参数名称
  type: string;                    // 参数类型
  required: boolean;               // 是否必填
  description: string;             // 参数描述
  validation?: ValidationRule;     // 验证规则
  defaultValue?: any;              // 默认值
  source?: "user_input" | "shared_context" | "system"; // 来源
  prompt?: string;                 // 收集提示语
}
```

#### 3.2.2 参数收集策略
1. **智能预填充**: 从共享上下文读取可用参数
2. **交互式收集**: 缺失参数逐个询问
3. **批量收集**: 相关参数组合询问
4. **验证反馈**: 实时验证并提示错误
5. **确认机制**: 参数收集完成后整体确认

#### 3.2.3 参数收集状态机
```
初始化 → 分析已有参数 → 识别缺失参数 →
  ├─ 有缺失 → 生成询问 → 接收输入 → 验证 →
  │    ├─ 验证通过 → 更新参数 → 识别缺失参数
  │    └─ 验证失败 → 提示错误 → 接收输入
  └─ 无缺失 → 生成确认摘要 → 等待确认 →
       ├─ 确认 → 执行流程
       └─ 修改 → 识别修改项 → 接收输入
```

### 3.3 流程编排模块

#### 3.3.1 流程定义
```typescript
interface ProcessDefinition {
  processType: IntentType;
  parameters: ParameterDefinition[];
  preConditions?: Condition[];      // 前置条件
  steps: ProcessStep[];             // 执行步骤
  postActions?: Action[];           // 后置动作
  rollbackStrategy?: RollbackStrategy; // 回滚策略
}
```

#### 3.3.2 执行步骤
```typescript
interface ProcessStep {
  stepId: string;
  stepName: string;
  action: "validate" | "transform" | "call_mcp" | "notify";
  config: any;
  onSuccess?: string;  // 下一步骤ID
  onFailure?: string;  // 失败处理步骤ID
}
```

## 4. MCP接口设计

### 4.1 接口规范

#### 4.1.1 请假申请接口
```typescript
interface LeaveRequestMCP {
  name: "oa.leave.create";
  input: {
    employeeId: string;
    leaveType: "annual" | "sick" | "personal" | "other";
    startDate: string;      // ISO 8601
    endDate: string;        // ISO 8601
    duration: number;       // 天数
    reason: string;
    approver: string;       // 审批人工号
    cc?: string[];          // 抄送人
    attachments?: string[]; // 附件URL
  };
  output: {
    requestId: string;
    status: "submitted" | "failed";
    message: string;
    approvalUrl?: string;
  };
}
```

#### 4.1.2 报销申请接口
```typescript
interface ReimbursementMCP {
  name: "oa.reimbursement.create";
  input: {
    employeeId: string;
    category: "travel" | "meal" | "office" | "other";
    items: Array<{
      description: string;
      amount: number;
      date: string;
      invoice: string;  // 发票号或附件
    }>;
    totalAmount: number;
    approver: string;
    bankAccount?: string;
  };
  output: {
    requestId: string;
    status: "submitted" | "failed";
    message: string;
  };
}
```

#### 4.1.3 审批查询接口
```typescript
interface ApprovalQueryMCP {
  name: "oa.approval.query";
  input: {
    employeeId: string;
    requestId?: string;
    status?: "pending" | "approved" | "rejected" | "all";
    startDate?: string;
    endDate?: string;
    limit?: number;
  };
  output: {
    requests: Array<{
      requestId: string;
      type: string;
      submitTime: string;
      status: string;
      currentApprover?: string;
      summary: string;
    }>;
    total: number;
  };
}
```

### 4.2 MCP工具注册
```typescript
// MCP Server配置
const mcpTools = [
  {
    name: "oa.leave.create",
    description: "创建请假申请",
    inputSchema: { /* JSON Schema */ }
  },
  {
    name: "oa.reimbursement.create",
    description: "创建报销申请",
    inputSchema: { /* JSON Schema */ }
  },
  {
    name: "oa.approval.query",
    description: "查询审批状态",
    inputSchema: { /* JSON Schema */ }
  }
  // ... 其他接口
];
```

## 5. 实现流程示例

### 5.1 请假申请完整流程

```
用户: "我要请假"
  ↓
[意图识别] → IntentType.LEAVE_REQUEST
  ↓
[创建流程上下文]
  processId: "leave_20260305_001"
  type: "leave_request"
  status: "parameter_collection"
  parameters: {}
  ↓
[参数收集 - 第1轮]
Agent: "好的，我帮您申请请假。请问您要请什么类型的假？（年假/病假/事假/其他）"
  ↓
用户: "年假"
  ↓
[更新参数] parameters.leaveType = "annual"
  ↓
[参数收集 - 第2轮]
Agent: "请问请假的起止时间是？"
  ↓
用户: "3月10日到3月12日"
  ↓
[解析并验证]
  parameters.startDate = "2026-03-10"
  parameters.endDate = "2026-03-12"
  parameters.duration = 3
  ↓
[参数收集 - 第3轮]
Agent: "请简要说明请假原因"
  ↓
用户: "家里有事需要处理"
  ↓
[更新参数] parameters.reason = "家里有事需要处理"
  ↓
[从共享上下文获取]
  parameters.employeeId = "从共享上下文读取"
  parameters.approver = "从共享上下文读取默认审批人"
  ↓
[生成确认摘要]
Agent: "请确认您的请假申请信息：
- 类型：年假
- 时间：2026-03-10 至 2026-03-12（共3天）
- 原因：家里有事需要处理
- 审批人：张经理

确认提交吗？（是/否/修改）"
  ↓
用户: "是"
  ↓
[调用MCP接口]
  调用 oa.leave.create
  ↓
[接收结果]
  requestId: "REQ20260305001"
  status: "submitted"
  ↓
[更新流程状态] status: "completed"
  ↓
Agent: "请假申请已提交成功！
申请单号：REQ20260305001
您可以通过「查询审批」功能查看审批进度。"
  ↓
[清理流程上下文，保留会话上下文]
```

### 5.2 上下文使用示例

#### 5.2.1 首次请假（无共享上下文）
```
需要收集的参数：
- employeeId ✗ (需询问)
- leaveType ✗ (需询问)
- startDate ✗ (需询问)
- endDate ✗ (需询问)
- reason ✗ (需询问)
- approver ✗ (需询问)

交互轮次：6轮
```

#### 5.2.2 再次请假（有共享上下文）
```
从共享上下文获取：
- employeeId ✓ (自动填充)
- approver ✓ (使用默认值)

需要收集的参数：
- leaveType ✗ (需询问)
- startDate ✗ (需询问)
- endDate ✗ (需询问)
- reason ✗ (需询问)

交互轮次：4轮（减少2轮）
```

## 6. 技术实现要点

### 6.1 上下文存储设计

```typescript
// 会话上下文（内存存储）
class SessionContext {
  sessionId: string;
  userId: string;
  conversationHistory: Message[];
  currentProcess?: ProcessContext;
  createdAt: Date;
  expiresAt: Date;
}

// 流程上下文（内存存储，可持久化）
class ProcessContext {
  processId: string;
  processType: IntentType;
  status: ProcessStatus;
  parameters: Record<string, any>;
  collectedParams: Set<string>;
  validationErrors: ValidationError[];
  createdAt: Date;
  updatedAt: Date;
}

// 共享上下文（持久化存储）
class SharedContext {
  userId: string;
  profile: {
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
  preferences: {
    defaultApprover?: string;
    defaultCC?: string[];
    language: string;
  };
  history: {
    recentRequests: RequestSummary[];
    frequentTypes: string[];
  };
}
```

### 6.2 参数验证器

```typescript
class ParameterValidator {
  static validate(param: ParameterDefinition, value: any): ValidationResult {
    // 类型验证
    // 格式验证
    // 业务规则验证
    // 依赖参数验证
  }

  static validateAll(params: Record<string, any>, definitions: ParameterDefinition[]): ValidationResult {
    // 批量验证
    // 跨参数验证
  }
}
```

### 6.3 MCP客户端封装

```typescript
class MCPClient {
  async callTool(toolName: string, input: any): Promise<any> {
    // 连接MCP服务器
    // 调用工具
    // 错误处理
    // 结果解析
  }

  async listTools(): Promise<Tool[]> {
    // 获取可用工具列表
  }
}
```

## 7. 错误处理与容错

### 7.1 错误类型
- 参数验证错误：提示用户重新输入
- MCP调用失败：重试机制（最多3次）
- 网络超时：提示用户稍后重试
- 权限错误：提示用户联系管理员
- 业务规则错误：解释原因并引导修正

### 7.2 回滚策略
- 流程执行失败时，清理已创建的临时数据
- 保留流程上下文，允许用户修改后重试
- 记录失败日志，便于问题排查

## 8. 扩展性设计

### 8.1 新增申请类型
1. 定义ProcessDefinition
2. 定义ParameterDefinition[]
3. 实现MCP接口
4. 注册到意图识别模块

### 8.2 自定义流程
- 支持通过配置文件定义新流程
- 支持流程模板复用
- 支持条件分支和循环

## 9. 安全性考虑

- 敏感信息加密存储
- 接口调用鉴权
- 操作日志审计
- 防止参数注入攻击
- 会话超时机制

## 10. 性能优化

- 共享上下文缓存
- 参数预加载
- 异步MCP调用
- 批量操作支持

## 11. 监控与日志

- 意图识别准确率统计
- 参数收集轮次统计
- MCP调用成功率
- 流程完成时长
- 用户满意度反馈
