# 🎯 O2OA 集成测试 - 执行指南

## 📊 当前系统状态

### ✅ 已就绪
- **O2OA 系统**: ✅ 运行正常 (http://localhost)
- **测试脚本**: ✅ 已创建 (`test-o2oa.sh`)
- **文档**: ✅ 完整（6 个文档文件）
- **适配器代码**: ✅ 示例已创建
- **移动端适配**: ✅ 已完成

### ⏳ 需要启动
- **OA_agent API**: ❌ 未运行 (http://localhost:3001)
- **OA_agent Web**: ❌ 未运行 (http://localhost:3000)
- **PostgreSQL**: ⏳ 需要启动
- **Redis**: ⏳ 需要启动

### 🔑 需要提供
- **O2OA Token**: ⏳ 需要从浏览器获取

---

## 🚀 立即执行步骤

### 步骤 1: 获取 O2OA Token（5 分钟）

**操作**:
1. 打开浏览器访问 O2OA：
   ```bash
   open http://localhost/x_desktop/index.html
   ```

2. 使用管理员账号登录
   - 常见账号：`xadmin`, `admin`
   - 如果不知道密码，查看 O2OA 安装文档或配置文件

3. 登录成功后，按 `F12` 打开开发者工具

4. 切换到 `Console` 标签

5. 输入以下命令并回车：
   ```javascript
   localStorage.getItem('x-token')
   ```

6. 复制输出的 token（不包括引号）
   - 示例：`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

7. 保存 token 到环境变量：
   ```bash
   export O2OA_TOKEN="your_token_here"
   ```

**验证 Token**:
```bash
# 测试 token 是否有效
curl -s "http://localhost/x_processplatform_assemble_surface/jaxrs/application/list" \
  -H "x-token: $O2OA_TOKEN" | python3 -m json.tool

# 如果返回 {"type": "success", ...} 说明 token 有效
# 如果返回 {"type": "error", "message": "会话已过期或未登录"} 说明 token 无效
```

---

### 步骤 2: 启动 OA_agent 系统（10 分钟）

**前置条件**:
- Docker 已安装并运行
- Node.js 20+ 已安装
- pnpm 8+ 已安装

**操作**:

```bash
# 1. 进入项目目录
cd /Users/liuxingwei/project/myproject/OA_agent

# 2. 启动 Docker 基础设施（PostgreSQL, Redis, MinIO）
pnpm docker:up

# 3. 等待服务启动（约 10 秒）
echo "等待 Docker 服务启动..."
sleep 10

# 4. 检查 Docker 服务状态
docker ps | grep -E "postgres|redis|minio"

# 5. 初始化数据库
echo "初始化数据库..."
pnpm db:migrate

# 6. 生成 Prisma Client
pnpm db:generate

# 7. 启动所有服务（API + Web + Worker）
echo "启动 OA_agent 服务..."
pnpm dev
```

**预期输出**:
```
> turbo run dev

• Packages in scope: @uniflow/api, @uniflow/web, @uniflow/worker
• Running dev in 3 packages
• Remote caching disabled

@uniflow/api:dev: [Nest] 12345  - 03/04/2026, 12:00:00 PM     LOG [NestFactory] Starting Nest application...
@uniflow/web:dev: ready - started server on 0.0.0.0:3000, url: http://localhost:3000
@uniflow/worker:dev: Worker started successfully
```

**验证服务**:
```bash
# 检查 API 服务（应返回 200）
curl -I http://localhost:3001/api/v1/bootstrap/jobs?tenantId=default-tenant

# 检查 Web 服务（应返回 200）
curl -I http://localhost:3000

# 如果返回 200，说明服务启动成功
```

---

### 步骤 3: 运行自动化测试（5 分钟）

**操作**:

```bash
# 确保在项目根目录
cd /Users/liuxingwei/project/myproject/OA_agent

# 运行测试脚本
./test-o2oa.sh
```

**脚本会提示输入 O2OA token**:
```
请输入 O2OA token: [粘贴你在步骤 1 获取的 token]
```

**测试流程**:
1. ✅ 检查 O2OA 系统状态
2. ✅ 验证 O2OA API（应用列表、流程列表、任务列表）
3. ✅ 检查 OA_agent 系统状态
4. ✅ 创建 Bootstrap 任务
5. ⏳ 等待任务执行（最多 60 秒）
6. ✅ 显示测试结果

**预期输出**:
```
🚀 O2OA 集成测试开始
====================

步骤 1: 检查 O2OA 系统状态
-----------------------------------
✅ O2OA 系统运行正常 (HTTP 200)

步骤 2: O2OA 认证测试
-----------------------------------
请输入 O2OA token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
✅ Token 已获取

步骤 3: 测试 O2OA API
-----------------------------------
3.1 测试应用列表 API...
✅ 应用列表 API 正常 (发现 3 个应用)
  第一个应用: hr_app

3.2 测试流程列表 API...
✅ 流程列表 API 正常 (发现 5 个流程)

3.3 测试任务列表 API...
✅ 任务列表 API 正常 (当前有 2 个待办任务)

步骤 4: 检查 OA_agent 系统状态
-----------------------------------
✅ OA_agent API 服务运行正常 (HTTP 200)
✅ OA_agent Web 服务运行正常 (HTTP 200)

步骤 5: 创建 Bootstrap 任务
-----------------------------------
正在创建 O2OA 初始化任务...
✅ Bootstrap 任务创建成功
  任务 ID: abc123...

等待任务执行（最多等待 60 秒）...
  [1/12] 当前状态: DISCOVERING
  [2/12] 当前状态: PARSING
  [3/12] 当前状态: NORMALIZING
  [4/12] 当前状态: COMPILING
  [5/12] 当前状态: REPLAYING
  [6/12] 当前状态: REVIEW
✅ 任务执行完成

步骤 6: 测试总结
-----------------------------------

📊 测试结果汇总：

  O2OA 系统:
    - 系统状态: ✅ 运行中
    - 认证 API: ✅ 正常
    - 应用列表 API: ✅ 正常
    - 流程列表 API: ✅ 正常
    - 任务列表 API: ✅ 正常

  OA_agent 系统:
    - API 服务: ✅ 运行中
    - Web 服务: ✅ 运行中
    - Bootstrap 任务: ✅ 已创建

步骤 7: 下一步操作
-----------------------------------

1️⃣  访问初始化中心查看任务详情：
   http://localhost:3000/bootstrap

2️⃣  如果任务状态为 REVIEW，点击「发布到流程库」

3️⃣  访问对话工作台测试自然语言交互：
   http://localhost:3000/chat

4️⃣  测试对话示例：
   - 我要报销差旅费
   - 查看我的申请进度
   - 我要请假三天

✅ 测试完成！
```

---

### 步骤 4: 访问初始化中心（2 分钟）

**操作**:

```bash
# 打开初始化中心
open http://localhost:3000/bootstrap
```

**在初始化中心**:
1. 查看任务列表
2. 找到刚创建的任务（任务 ID 以 `abc123...` 开头）
3. 点击「查看详情」
4. 查看任务执行情况：
   - 发现的应用数量
   - 发现的流程数量
   - 解析的字段数量
   - OCL 兼容性级别
5. 如果任务状态为 `REVIEW`，点击「发布到流程库」
6. 等待发布完成（状态变为 `PUBLISHED`）

---

### 步骤 5: 测试对话工作台（5 分钟）

**操作**:

```bash
# 打开对话工作台
open http://localhost:3000/chat
```

**测试对话 1: 发起报销申请**
```
用户: 我要报销差旅费

助手: 好的，请告诉我以下信息：
      - 报销金额
      - 出差日期
      - 出差地点
      - 费用明细

用户: 金额1000元，3月1日到3月3日，北京出差，交通费500，住宿费300，餐费200

助手: 已为您创建差旅费报销申请
      申请编号：EXP-2024-00001
      当前状态：待部门经理审批

      您可以随时询问"查看我的申请进度"来查询最新状态。
```

**测试对话 2: 查询进度**
```
用户: 查看我的申请进度

助手: 您有以下申请：

      1. 差旅费报销 - EXP-2024-00001
         状态：待部门经理审批
         提交时间：2024-03-04 12:30:00

      2. 请假申请 - LEAVE-2024-00001
         状态：已完成
         提交时间：2024-03-01 09:00:00
```

**测试对话 3: 请假申请**
```
用户: 我要请假三天

助手: 好的，请告诉我：
      - 请假类型（年假/病假/事假）
      - 开始日期
      - 结束日期
      - 请假原因

用户: 年假，3月10日到3月12日，家里有事

助手: 已为您创建请假申请
      申请编号：LEAVE-2024-00002
      当前状态：待部门经理审批
```

---

### 步骤 6: 验证 O2OA 中的数据（3 分钟）

**操作**:

1. 打开 O2OA 系统：
   ```bash
   open http://localhost/x_desktop/index.html
   ```

2. 登录后，进入「待办任务」或「我的申请」

3. 验证：
   - ✅ 能看到通过对话工作台提交的申请
   - ✅ 申请数据完整（标题、金额、日期等）
   - ✅ 申请状态正确（待审批）

4. 测试审批流程：
   - 在 O2OA 中审批申请
   - 回到对话工作台查询进度
   - 验证状态是否同步更新

---

## 📊 测试验收标准

### 必须通过（P0）
- [ ] O2OA API 全部可用
- [ ] OA_agent 系统成功启动
- [ ] Bootstrap 任务成功完成
- [ ] 至少发现 1 个流程
- [ ] 流程成功发布到流程库

### 应该通过（P1）
- [ ] 对话工作台能识别用户意图
- [ ] 申请成功提交到 O2OA
- [ ] 能查询到申请状态
- [ ] O2OA 中能看到提交的申请

### 可以通过（P2）
- [ ] 移动端适配正常
- [ ] 审批状态实时同步
- [ ] 支持多种流程类型

---

## 🐛 故障排查

### 问题 1: 无法获取 O2OA Token

**症状**: 浏览器控制台返回 `null` 或报错

**原因**: 未登录或 token 存储位置不同

**解决**:
```javascript
// 尝试其他方式获取 token
localStorage.getItem('x-token')
sessionStorage.getItem('x-token')
document.cookie.match(/x-token=([^;]+)/)?.[1]

// 或者查看所有 localStorage
Object.keys(localStorage).forEach(key => {
  console.log(key, localStorage.getItem(key))
})
```

### 问题 2: Docker 启动失败

**症状**: `pnpm docker:up` 报错

**原因**: Docker 未运行或端口被占用

**解决**:
```bash
# 检查 Docker 状态
docker ps

# 检查端口占用
lsof -ti:5432  # PostgreSQL
lsof -ti:6379  # Redis
lsof -ti:9000  # MinIO

# 停止占用端口的进程
kill -9 $(lsof -ti:5432)

# 重新启动
pnpm docker:up
```

### 问题 3: 数据库迁移失败

**症状**: `pnpm db:migrate` 报错

**原因**: PostgreSQL 未完全启动

**解决**:
```bash
# 等待 PostgreSQL 启动
sleep 10

# 检查 PostgreSQL 状态
docker logs uniflow-postgres

# 重试迁移
pnpm db:migrate
```

### 问题 4: Bootstrap 任务失败

**症状**: 任务状态变为 `FAILED`

**原因**: O2OA API 不可访问或认证失败

**解决**:
1. 检查 O2OA 系统状态
2. 验证 token 有效性
3. 查看任务详情中的错误信息
4. 查看 API 日志：
   ```bash
   cd /Users/liuxingwei/project/myproject/OA_agent/apps/api
   tail -f logs/app.log
   ```

### 问题 5: 对话工作台无响应

**症状**: 发送消息后无回复

**原因**: LLM 配置错误或流程未发布

**解决**:
1. 检查 `.env` 文件中的 LLM 配置：
   ```bash
   cat /Users/liuxingwei/project/myproject/OA_agent/.env | grep LLM
   ```

2. 确认流程已发布：
   ```bash
   curl http://localhost:3001/api/v1/process-library/list
   ```

3. 查看 API 日志：
   ```bash
   tail -f /Users/liuxingwei/project/myproject/OA_agent/apps/api/logs/app.log
   ```

---

## 📞 需要帮助？

### 查看日志
```bash
# API 日志
tail -f /Users/liuxingwei/project/myproject/OA_agent/apps/api/logs/app.log

# Docker 日志
docker logs -f uniflow-postgres
docker logs -f uniflow-redis
docker logs -f uniflow-minio
```

### 重启服务
```bash
# 停止所有服务
cd /Users/liuxingwei/project/myproject/OA_agent
pnpm docker:down
pkill -f "next dev"
pkill -f "nest start"

# 重新启动
pnpm docker:up
sleep 10
pnpm db:migrate
pnpm dev
```

### 清理数据
```bash
# 清理 Docker 数据
pnpm docker:down -v

# 重新初始化
pnpm docker:up
sleep 10
pnpm db:migrate
pnpm db:seed  # 如果有种子数据
```

---

## 🎉 成功标志

当你看到以下结果时，说明集成测试成功：

1. ✅ 初始化中心显示任务状态为 `PUBLISHED`
2. ✅ 流程库中有从 O2OA 发现的流程
3. ✅ 对话工作台能正常对话
4. ✅ 申请成功提交到 O2OA
5. ✅ O2OA 中能看到提交的申请
6. ✅ 能查询到申请状态

---

## 📝 下一步

测试成功后，你可以：

1. **添加更多流程**: 在 O2OA 中创建新流程，重新运行 Bootstrap
2. **优化对话**: 调整 AI 助手的提示词，提高识别准确率
3. **移动端测试**: 使用 `mobile-live-test.html` 测试移动端
4. **性能优化**: 监控 API 响应时间，优化数据库查询
5. **部署生产**: 配置生产环境，部署到服务器

---

**文档版本**: v1.0.0
**最后更新**: 2026-03-04
**预计完成时间**: 30 分钟
**当前状态**: ⏳ 等待执行步骤 1（获取 O2OA Token）
