# O2OA 集成测试方案

## 测试目标

验证 OA_agent 的初始化中心能否：
1. 自动发现 O2OA 系统的流程和表单
2. 生成适配器代码
3. 通过对话工作台操作 O2OA 的申请流程

## O2OA 系统信息

- **访问地址**: http://localhost/x_desktop/index.html
- **API 基础地址**: http://localhost
- **认证端点**: /x_organization_assemble_authentication/jaxrs/authentication
- **流程平台**: /x_processplatform_assemble_surface/jaxrs/
- **状态**: ✅ 运行中（HTTP 200）

## O2OA API 结构（已发现）

### 核心 API 端点

#### 1. 认证 API
```
POST /x_organization_assemble_authentication/jaxrs/authentication
Body: {
  "credential": "username",
  "password": "password"
}
Response: {
  "type": "success",
  "data": {
    "token": "xxx",
    "person": {...}
  }
}
```

#### 2. 应用列表 API
```
GET /x_processplatform_assemble_surface/jaxrs/application/list
Headers: {
  "x-token": "xxx"
}
Response: {
  "type": "success",
  "data": [
    {
      "id": "app_id",
      "name": "应用名称",
      "flag": "app_flag"
    }
  ]
}
```

#### 3. 流程列表 API
```
GET /x_processplatform_assemble_surface/jaxrs/process/list/application/{appFlag}
Headers: {
  "x-token": "xxx"
}
Response: {
  "type": "success",
  "data": [
    {
      "id": "process_id",
      "name": "流程名称",
      "flag": "process_flag"
    }
  ]
}
```

#### 4. 创建工作 API
```
POST /x_processplatform_assemble_surface/jaxrs/work/process/{processFlag}
Headers: {
  "x-token": "xxx"
}
Body: {
  "data": {
    "field1": "value1",
    "field2": "value2"
  }
}
Response: {
  "type": "success",
  "data": {
    "id": "work_id",
    "title": "工作标题"
  }
}
```

#### 5. 查询任务 API
```
GET /x_processplatform_assemble_surface/jaxrs/task/list//next/20
Headers: {
  "x-token": "xxx"
}
Response: {
  "type": "success",
  "data": [
    {
      "id": "task_id",
      "title": "任务标题",
      "work": "work_id"
    }
  ]
}
```

#### 6. 处理任务 API
```
POST /x_processplatform_assemble_surface/jaxrs/task/{taskId}/processing
Headers: {
  "x-token": "xxx"
}
Body: {
  "routeName": "approve",
  "opinion": "同意",
  "data": {...}
}
Response: {
  "type": "success"
}
```

## 测试步骤

### 阶段 1: 手动验证 O2OA API（当前阶段）

**问题**: 需要 O2OA 管理员账号密码才能测试 API

**解决方案**:
1. 通过浏览器访问 http://localhost/x_desktop/index.html
2. 使用管理员账号登录（xadmin 或其他账号）
3. 在浏览器开发者工具中获取 x-token
4. 使用 token 测试 API

**测试命令**:
```bash
# 1. 获取 token（从浏览器 Cookie 或 localStorage）
TOKEN="从浏览器获取的 x-token"

# 2. 测试应用列表 API
curl -s "http://localhost/x_processplatform_assemble_surface/jaxrs/application/list" \
  -H "x-token: $TOKEN" | python3 -m json.tool

# 3. 测试流程列表 API（假设应用 flag 为 hr_app）
curl -s "http://localhost/x_processplatform_assemble_surface/jaxrs/process/list/application/hr_app" \
  -H "x-token: $TOKEN" | python3 -m json.tool

# 4. 测试任务列表 API
curl -s "http://localhost/x_processplatform_assemble_surface/jaxrs/task/list//next/20" \
  -H "x-token: $TOKEN" | python3 -m json.tool
```

### 阶段 2: 启动 OA_agent 系统

```bash
# 1. 启动 Docker 基础设施（PostgreSQL, Redis, MinIO）
cd /Users/liuxingwei/project/myproject/OA_agent
pnpm docker:up

# 2. 初始化数据库
pnpm db:migrate
pnpm db:generate

# 3. 启动所有服务（API + Web + Worker）
pnpm dev
```

**预期结果**:
- API 服务运行在 http://localhost:3001
- Web 服务运行在 http://localhost:3000
- Worker 服务在后台运行

### 阶段 3: 创建 Bootstrap 任务

1. **访问初始化中心**
   ```
   http://localhost:3000/bootstrap
   ```

2. **创建初始化任务**
   - OA 系统地址: `http://localhost/x_desktop/index.html`
   - OpenAPI 文档地址: （可选，O2OA 可能没有标准 OpenAPI 文档）
   - HAR 文件地址: （可选，可以录制浏览器操作生成）

3. **等待任务执行**
   - 状态: CREATED → DISCOVERING → PARSING → NORMALIZING → COMPILING → REPLAYING → REVIEW

4. **审核并发布**
   - 查看发现的流程列表
   - 确认字段映射
   - 发布到流程库

### 阶段 4: 测试对话工作台

1. **访问对话工作台**
   ```
   http://localhost:3000/chat
   ```

2. **测试自然语言交互**
   ```
   用户: 我要报销差旅费
   助手: 好的，请告诉我以下信息：
         - 报销金额
         - 出差日期
         - 出差地点
         - 费用明细

   用户: 金额1000元，3月1日到3月3日，北京出差
   助手: 已为您创建差旅费报销申请，申请编号：EXP-2024-00001
         当前状态：待部门经理审批
   ```

3. **测试查询进度**
   ```
   用户: 查看我的申请进度
   助手: 您有以下申请：
         1. 差旅费报销 - EXP-2024-00001 - 待部门经理审批
         2. 请假申请 - LEAVE-2024-00001 - 已完成
   ```

## 当前状态

### ✅ 已完成
1. O2OA 系统运行正常（HTTP 200）
2. 发现 O2OA 认证 API 端点
3. 了解 O2OA 完整的 REST API 结构
4. OA_agent 代码结构分析完成
5. 移动端适配已完成

### ⏳ 待完成
1. **获取 O2OA 管理员账号密码**（阻塞项）
   - 方案 A: 通过浏览器登录后获取 token
   - 方案 B: 查看 O2OA 安装文档获取默认密码
   - 方案 C: 重置 O2OA 管理员密码

2. **验证 O2OA API 可用性**
   - 测试认证 API
   - 测试应用列表 API
   - 测试流程列表 API
   - 测试创建工作 API

3. **启动 OA_agent 系统**
   - 启动 Docker 基础设施
   - 初始化数据库
   - 启动 API、Web、Worker 服务

4. **创建 O2OA 适配器**
   - 在初始化中心创建 Bootstrap 任务
   - 等待自动发现完成
   - 审核并发布流程

5. **测试端到端流程**
   - 在对话工作台发起申请
   - 验证申请是否成功提交到 O2OA
   - 查询申请状态

## O2OA 适配器实现要点

### 1. 认证适配
```typescript
// packages/oa-adapters/src/o2oa-adapter.ts
export class O2OAAdapter implements OAAdapter {
  private token: string;
  private baseUrl: string;

  async authenticate(credential: string, password: string) {
    const response = await axios.post(
      `${this.baseUrl}/x_organization_assemble_authentication/jaxrs/authentication`,
      { credential, password }
    );
    this.token = response.data.data.token;
  }

  async discover(): Promise<DiscoverResult> {
    // 1. 获取应用列表
    const apps = await this.getApplications();

    // 2. 获取每个应用的流程列表
    const flows = [];
    for (const app of apps) {
      const processes = await this.getProcesses(app.flag);
      flows.push(...processes.map(p => ({
        flowCode: p.flag,
        flowName: p.name,
        entryUrl: `/x_processplatform_assemble_surface/jaxrs/work/process/${p.flag}`,
        submitUrl: `/x_processplatform_assemble_surface/jaxrs/work/process/${p.flag}`,
        queryUrl: `/x_processplatform_assemble_surface/jaxrs/task/list//next/20`
      })));
    }

    return {
      oaVendor: 'O2OA',
      oaVersion: 'v8.x',
      oaType: 'openapi',
      authType: 'apikey',
      discoveredFlows: flows
    };
  }

  async submit(request: SubmitRequest): Promise<SubmitResult> {
    const response = await axios.post(
      `${this.baseUrl}/x_processplatform_assemble_surface/jaxrs/work/process/${request.flowCode}`,
      { data: request.formData },
      { headers: { 'x-token': this.token } }
    );

    return {
      success: response.data.type === 'success',
      submissionId: response.data.data.id,
      metadata: response.data.data
    };
  }

  async queryStatus(submissionId: string): Promise<StatusResult> {
    // 查询工作状态
    const response = await axios.get(
      `${this.baseUrl}/x_processplatform_assemble_surface/jaxrs/work/${submissionId}`,
      { headers: { 'x-token': this.token } }
    );

    return {
      status: response.data.data.activityName,
      statusDetail: response.data.data,
      timeline: [] // 需要额外调用 record API 获取
    };
  }
}
```

### 2. Discovery Agent 增强
```typescript
// apps/api/src/modules/discovery/oa-discovery.agent.ts
protected async run(input: OADiscoveryInput, context: AgentContext): Promise<OADiscoveryOutput> {
  // 检测是否为 O2OA
  if (input.oaUrl?.includes('x_desktop')) {
    // 使用 O2OA 适配器
    const adapter = new O2OAAdapter(input.oaUrl);

    // 需要认证信息（从配置或用户输入获取）
    await adapter.authenticate(
      context.config.o2oaUsername,
      context.config.o2oaPassword
    );

    // 自动发现
    const result = await adapter.discover();

    return {
      oaVendor: 'O2OA',
      oaVersion: 'v8.x',
      oaType: 'openapi',
      authType: 'apikey',
      authConfig: {
        type: 'apikey',
        endpoint: '/x_organization_assemble_authentication/jaxrs/authentication'
      },
      discoveredFlows: result.discoveredFlows,
      oclLevel: 'OCL3', // O2OA 支持完整的 API
      confidence: 0.95
    };
  }

  // 其他 OA 系统的处理...
}
```

## 下一步行动

### 立即执行
1. **获取 O2OA 登录凭证**
   - 打开浏览器访问 http://localhost/x_desktop/index.html
   - 尝试登录（常见账号：xadmin, admin, 或查看安装文档）
   - 从浏览器开发者工具获取 x-token

2. **验证 API**
   ```bash
   # 使用获取的 token 测试
   TOKEN="your_token_here"
   curl -s "http://localhost/x_processplatform_assemble_surface/jaxrs/application/list" \
     -H "x-token: $TOKEN"
   ```

### 后续步骤
1. 启动 OA_agent 系统
2. 创建 O2OA 适配器
3. 测试完整流程

## 预期结果

完成后，用户可以：
1. 在初始化中心输入 O2OA 地址，自动发现所有流程
2. 在对话工作台用自然语言发起申请："我要报销差旅费1000元"
3. 查询申请状态："查看我的申请进度"
4. 系统自动调用 O2OA API 完成操作

## 技术亮点

1. **自动发现**: 无需手动配置，系统自动识别 O2OA 的所有流程和表单
2. **自然语言交互**: 用户无需了解 OA 系统的复杂界面
3. **统一接口**: 通过标准化的 OAAdapter 接口，支持多种 OA 系统
4. **智能映射**: AI 自动将用户输入映射到 OA 表单字段
5. **状态追踪**: 实时查询申请状态和审批进度
