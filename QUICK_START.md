# 🚀 UniFlow OA Copilot - 快速开始指南

## 5分钟快速启动

### 前置要求
- Node.js >= 20
- pnpm >= 8
- Docker Desktop (已启动)

---

## 方式1：一键启动（推荐）⭐

```bash
cd OA_agent
./setup.sh
```

等待安装完成后：

```bash
pnpm dev
```

访问：
- 前端: http://localhost:3000
- API: http://localhost:3001
- API文档: http://localhost:3001/api/docs

---

## 方式2：Docker一键启动 🐳

```bash
cd OA_agent
docker compose up --build
```

等待所有服务启动完成（约2-3分钟）

访问：
- 前端: http://localhost:3000
- API: http://localhost:3001

---

## 方式3：手动启动（开发模式）

### 步骤1：安装依赖
```bash
cd OA_agent
pnpm install
```

### 步骤2：配置环境
```bash
cp .env.example .env
# 编辑 .env 文件（可选，默认配置即可使用）
```

### 步骤3：启动基础设施
```bash
docker compose up -d postgres redis minio
```

### 步骤4：数据库迁移
```bash
cd apps/api
pnpm prisma migrate deploy
pnpm prisma generate
```

### 步骤5：种子数据
```bash
pnpm prisma db seed
```

### 步骤6：构建项目
```bash
cd ../..
pnpm build
```

### 步骤7：启动服务
```bash
pnpm dev
```

---

## 验证安装

### 检查服务状态

```bash
# 检查API健康状态
curl http://localhost:3001/health

# 应该返回：
# {"status":"ok","timestamp":"...","service":"uniflow-oa-api"}
```

### 运行验证脚本

```bash
./verify.sh
```

### 运行Bootstrap烟雾测试

```bash
pnpm bootstrap:smoke
```

---

## 第一次使用

### 1. 访问前端
打开浏览器访问: http://localhost:3000

### 2. 登录
- 用户名: `admin`
- 密码: 任意（Mock认证）

### 3. 创建Bootstrap任务
1. 点击"初始化中心"
2. 点击"创建初始化任务"
3. 输入OpenAPI URL: `http://localhost:8080/openapi.json`
4. 点击"创建"
5. 等待任务完成（约30秒）
6. 查看OCL报告
7. 点击"发布"

### 4. 使用对话助手
1. 点击"对话工作台"
2. 输入: "我要报销差旅费1000元"
3. 按照提示填写信息
4. 确认提交

### 5. 查看我的申请
1. 点击"我的申请"
2. 查看提交记录
3. 点击"查看"查看详情

---

## 常见问题

### Q: 端口被占用怎么办？
A: 修改 `.env` 文件中的端口配置：
```bash
API_PORT=3002
WEB_PORT=3001
```

### Q: Docker服务启动失败？
A: 检查Docker是否运行：
```bash
docker info
```

### Q: 数据库连接失败？
A: 检查PostgreSQL是否启动：
```bash
docker compose ps postgres
docker compose logs postgres
```

### Q: 依赖安装失败？
A: 清理缓存重新安装：
```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

---

## 下一步

### 学习资源
- 📚 [完整文档](./README.md)
- 🏗️ [架构文档](./docs/ARCHITECTURE.md)
- 🔧 [开发指南](./docs/DEVELOPMENT.md)
- 🐛 [故障排查](./docs/TROUBLESHOOTING.md)
- 🚀 [部署指南](./DEPLOYMENT.md)

### 探索功能
1. **Bootstrap Center** - 接入新的OA系统
2. **对话助手** - 自然语言发起申请
3. **流程库** - 浏览可用流程
4. **权限管理** - 配置权限策略
5. **审计日志** - 查看操作记录

### 自定义开发
1. 添加新的Agent
2. 创建自定义规则
3. 扩展OA适配器
4. 定制前端页面

---

## 获取帮助

- 📖 查看文档: `docs/` 目录
- 🐛 报告问题: GitHub Issues
- 💬 技术支持: support@uniflow.example.com

---

**祝您使用愉快！** 🎉
