# OA智能助手模块 - 部署指南

## 目录

1. [环境准备](#环境准备)
2. [配置说明](#配置说明)
3. [数据库设置](#数据库设置)
4. [服务部署](#服务部署)
5. [监控和日志](#监控和日志)
6. [故障排查](#故障排查)
7. [性能调优](#性能调优)
8. [安全加固](#安全加固)

## 环境准备

### 系统要求

- **操作系统**: Linux (Ubuntu 20.04+, CentOS 8+) 或 macOS
- **Node.js**: >= 18.0.0
- **PostgreSQL**: >= 14.0
- **Redis**: >= 6.0 (可选，用于缓存)
- **内存**: >= 4GB
- **磁盘**: >= 20GB

### 安装依赖

```bash
# 安装 Node.js (使用 nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# 安装 pnpm
npm install -g pnpm

# 安装 PostgreSQL
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib

# CentOS/RHEL
sudo yum install postgresql-server postgresql-contrib

# macOS
brew install postgresql

# 安装 Redis (可选)
# Ubuntu/Debian
sudo apt-get install redis-server

# CentOS/RHEL
sudo yum install redis

# macOS
brew install redis
```

## 配置说明

### 环境变量配置

创建 `.env` 文件：

```bash
# 数据库配置
DATABASE_URL="postgresql://username:password@localhost:5432/oa_agent?schema=public"

# Redis配置 (可选)
REDIS_URL="redis://localhost:6379"
REDIS_PASSWORD=""

# LLM配置
USE_LLM_FOR_INTENT=true
LLM_API_KEY=your-api-key-here
LLM_MODEL=gpt-4
LLM_BASE_URL=https://api.openai.com/v1
LLM_TIMEOUT_MS=30000

# 应用配置
NODE_ENV=production
PORT=3001
DEFAULT_TENANT_ID=default-tenant

# 会话配置
SESSION_EXPIRATION_DAYS=30
MAX_CONVERSATION_HISTORY=50
MAX_COLLECTION_ROUNDS=20
COLLECTION_TIMEOUT_MS=300000

# MCP配置
MCP_TIMEOUT_MS=30000
MCP_MAX_RETRIES=3

# 日志配置
LOG_LEVEL=info
LOG_FILE_PATH=/var/log/oa-agent/assistant.log

# 安全配置
JWT_SECRET=your-jwt-secret-here
ENCRYPTION_KEY=your-encryption-key-here

# CORS配置
CORS_ORIGIN=https://your-domain.com
CORS_CREDENTIALS=true

# 限流配置
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# 监控配置
ENABLE_METRICS=true
METRICS_PORT=9090
```

### 生产环境配置

创建 `.env.production` 文件：

```bash
NODE_ENV=production
LOG_LEVEL=warn

# 使用生产数据库
DATABASE_URL="postgresql://prod_user:prod_password@prod-db-host:5432/oa_agent_prod"

# 使用生产Redis
REDIS_URL="redis://prod-redis-host:6379"

# 禁用调试功能
DEBUG=false
ENABLE_SWAGGER=false

# 启用性能监控
ENABLE_METRICS=true
ENABLE_TRACING=true
```

## 数据库设置

### 创建数据库

```bash
# 连接到PostgreSQL
sudo -u postgres psql

# 创建数据库和用户
CREATE DATABASE oa_agent;
CREATE USER oa_agent_user WITH ENCRYPTED PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE oa_agent TO oa_agent_user;

# 退出
\q
```

### 运行迁移

```bash
# 生成Prisma客户端
pnpm prisma generate

# 运行数据库迁移
pnpm prisma migrate deploy

# 查看迁移状态
pnpm prisma migrate status
```

### 数据库优化

```sql
-- 添加索引
CREATE INDEX idx_chat_session_user_tenant ON "ChatSession"("userId", "tenantId");
CREATE INDEX idx_chat_session_updated ON "ChatSession"("updatedAt");
CREATE INDEX idx_chat_message_session ON "ChatMessage"("sessionId");
CREATE INDEX idx_chat_message_created ON "ChatMessage"("createdAt");
CREATE INDEX idx_submission_user_tenant ON "Submission"("userId", "tenantId");
CREATE INDEX idx_submission_status ON "Submission"("status");
CREATE INDEX idx_audit_log_action ON "AuditLog"("action");
CREATE INDEX idx_audit_log_created ON "AuditLog"("createdAt");

-- 设置连接池
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET min_wal_size = '1GB';
ALTER SYSTEM SET max_wal_size = '4GB';

-- 重启PostgreSQL使配置生效
SELECT pg_reload_conf();
```

## 服务部署

### 使用 PM2 部署

```bash
# 安装 PM2
npm install -g pm2

# 构建项目
pnpm build

# 创建 PM2 配置文件
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'oa-agent-assistant',
    script: 'dist/main.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/var/log/oa-agent/error.log',
    out_file: '/var/log/oa-agent/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '1G',
    autorestart: true,
    watch: false,
  }]
};
EOF

# 启动服务
pm2 start ecosystem.config.js

# 保存PM2配置
pm2 save

# 设置开机自启
pm2 startup
```

### 使用 Docker 部署

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# 安装依赖
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 生成Prisma客户端
RUN pnpm prisma generate

# 构建应用
RUN pnpm build

# 生产镜像
FROM node:18-alpine

WORKDIR /app

# 安装生产依赖
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "dist/main.js"]
```

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: oa_agent
      POSTGRES_USER: oa_agent_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U oa_agent_user"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  assistant:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://oa_agent_user:${DB_PASSWORD}@postgres:5432/oa_agent
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      NODE_ENV: production
    ports:
      - "3001:3001"
    volumes:
      - ./logs:/var/log/oa-agent
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

部署命令：

```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f assistant

# 停止服务
docker-compose down
```

### 使用 Kubernetes 部署

创建 `k8s-deployment.yaml`：

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: assistant-config
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  PORT: "3001"

---
apiVersion: v1
kind: Secret
metadata:
  name: assistant-secrets
type: Opaque
stringData:
  DATABASE_URL: "postgresql://user:password@postgres:5432/oa_agent"
  LLM_API_KEY: "your-api-key"
  JWT_SECRET: "your-jwt-secret"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: assistant
spec:
  replicas: 3
  selector:
    matchLabels:
      app: assistant
  template:
    metadata:
      labels:
        app: assistant
    spec:
      containers:
      - name: assistant
        image: your-registry/oa-agent-assistant:latest
        ports:
        - containerPort: 3001
        envFrom:
        - configMapRef:
            name: assistant-config
        - secretRef:
            name: assistant-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: assistant-service
spec:
  selector:
    app: assistant
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3001
  type: LoadBalancer

---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: assistant-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: assistant
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

部署命令：

```bash
# 应用配置
kubectl apply -f k8s-deployment.yaml

# 查看部署状态
kubectl get deployments
kubectl get pods
kubectl get services

# 查看日志
kubectl logs -f deployment/assistant

# 扩缩容
kubectl scale deployment assistant --replicas=5
```

## 监控和日志

### 日志配置

创建日志目录：

```bash
sudo mkdir -p /var/log/oa-agent
sudo chown -R $USER:$USER /var/log/oa-agent
```

配置日志轮转 `/etc/logrotate.d/oa-agent`：

```
/var/log/oa-agent/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 oa-agent oa-agent
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### Prometheus 监控

安装 Prometheus 客户端：

```bash
pnpm add prom-client
```

添加监控端点：

```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const register = new Registry();

// 请求计数器
const httpRequestCounter = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// 请求延迟
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route'],
  registers: [register],
});

// 活跃会话数
const activeSessions = new Gauge({
  name: 'active_sessions_total',
  help: 'Number of active chat sessions',
  registers: [register],
});

// 导出指标
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Grafana 仪表板

创建 Grafana 仪表板配置：

```json
{
  "dashboard": {
    "title": "OA Assistant Metrics",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])"
          }
        ]
      },
      {
        "title": "Request Duration",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))"
          }
        ]
      },
      {
        "title": "Active Sessions",
        "targets": [
          {
            "expr": "active_sessions_total"
          }
        ]
      }
    ]
  }
}
```

## 故障排查

### 常见问题

#### 1. 数据库连接失败

```bash
# 检查数据库状态
sudo systemctl status postgresql

# 检查连接
psql -h localhost -U oa_agent_user -d oa_agent

# 查看日志
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

#### 2. 内存不足

```bash
# 查看内存使用
free -h

# 查看进程内存
ps aux --sort=-%mem | head

# 重启服务
pm2 restart oa-agent-assistant
```

#### 3. LLM API 调用失败

```bash
# 测试API连接
curl -X POST https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"test"}]}'

# 检查环境变量
echo $LLM_API_KEY
```

#### 4. 会话过期

```bash
# 清理过期会话
psql -h localhost -U oa_agent_user -d oa_agent -c "
DELETE FROM \"ChatSession\"
WHERE \"updatedAt\" < NOW() - INTERVAL '30 days';
"
```

### 日志分析

```bash
# 查看错误日志
grep ERROR /var/log/oa-agent/assistant.log

# 统计错误类型
grep ERROR /var/log/oa-agent/assistant.log | awk '{print $5}' | sort | uniq -c

# 查看最近的错误
tail -n 100 /var/log/oa-agent/assistant.log | grep ERROR

# 实时监控日志
tail -f /var/log/oa-agent/assistant.log | grep -E "ERROR|WARN"
```

## 性能调优

### Node.js 优化

```bash
# 增加内存限制
NODE_OPTIONS="--max-old-space-size=4096" node dist/main.js

# 启用性能分析
NODE_OPTIONS="--prof" node dist/main.js

# 分析性能数据
node --prof-process isolate-*.log > processed.txt
```

### 数据库优化

```sql
-- 分析查询性能
EXPLAIN ANALYZE SELECT * FROM "ChatSession" WHERE "userId" = 'user-id';

-- 更新统计信息
ANALYZE "ChatSession";
ANALYZE "ChatMessage";
ANALYZE "Submission";

-- 清理死元组
VACUUM ANALYZE;

-- 重建索引
REINDEX TABLE "ChatSession";
```

### Redis 缓存

```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// 缓存共享上下文
async function getSharedContext(userId: string) {
  const cacheKey = `shared_context:${userId}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const context = await loadSharedContext(userId);
  await redis.setex(cacheKey, 3600, JSON.stringify(context));

  return context;
}
```

### 连接池配置

```typescript
// Prisma连接池
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")

  // 连接池配置
  connection_limit = 20
  pool_timeout = 10
}
```

## 安全加固

### HTTPS 配置

使用 Nginx 作为反向代理：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### 防火墙配置

```bash
# 允许SSH
sudo ufw allow 22/tcp

# 允许HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 拒绝直接访问应用端口
sudo ufw deny 3001/tcp

# 启用防火墙
sudo ufw enable
```

### 限流配置

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 100, // 最多100个请求
  message: '请求过于频繁，请稍后再试',
});

app.use('/api/v1/assistant', limiter);
```

### 数据加密

```typescript
import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encrypted: string): string {
  const [ivHex, authTagHex, encryptedText] = encrypted.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

## 备份和恢复

### 数据库备份

```bash
# 创建备份脚本
cat > /usr/local/bin/backup-oa-agent.sh << 'EOF'
#!/bin/bash

BACKUP_DIR="/var/backups/oa-agent"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/oa_agent_$DATE.sql.gz"

mkdir -p $BACKUP_DIR

pg_dump -h localhost -U oa_agent_user oa_agent | gzip > $BACKUP_FILE

# 保留最近30天的备份
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE"
EOF

chmod +x /usr/local/bin/backup-oa-agent.sh

# 添加定时任务
crontab -e
# 每天凌晨2点备份
0 2 * * * /usr/local/bin/backup-oa-agent.sh
```

### 数据恢复

```bash
# 恢复数据库
gunzip -c /var/backups/oa-agent/oa_agent_20260305_020000.sql.gz | \
  psql -h localhost -U oa_agent_user oa_agent
```

## 更新和维护

### 滚动更新

```bash
# 拉取最新代码
git pull origin main

# 安装依赖
pnpm install

# 运行迁移
pnpm prisma migrate deploy

# 构建
pnpm build

# 重启服务（零停机）
pm2 reload oa-agent-assistant
```

### 健康检查

```bash
# 检查服务状态
curl http://localhost:3001/health

# 检查数据库连接
curl http://localhost:3001/health/db

# 检查Redis连接
curl http://localhost:3001/health/redis
```

## 总结

本部署指南涵盖了从环境准备到生产部署的完整流程。根据实际情况选择合适的部署方式，并做好监控、备份和安全加固工作。

如有问题，请参考故障排查章节或联系技术支持。
