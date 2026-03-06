# API文档解析智能体 - 部署指南

## 部署架构

```
┌─────────────────────────────────────────────────────────┐
│                     Load Balancer                        │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
│  API Server  │  │ API Server  │  │ API Server  │
│   (NestJS)   │  │  (NestJS)   │  │  (NestJS)   │
└───────┬──────┘  └──────┬──────┘  └──────┬──────┘
        │                │                 │
        └─────────────────┼─────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
│  PostgreSQL  │  │    Redis    │  │   MinIO     │
│   (Primary)  │  │   (Cache)   │  │  (Storage)  │
└──────────────┘  └─────────────┘  └─────────────┘
        │
┌───────▼──────┐
│  PostgreSQL  │
│  (Replica)   │
└──────────────┘
```

---

## Docker部署

### 1. Dockerfile

创建 `apps/api/Dockerfile`：

```dockerfile
# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/*/package.json ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build application
RUN pnpm --filter @oa-agent/api build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/*/package.json ./packages/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built application
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

# Generate Prisma Client
RUN cd apps/api && npx prisma generate

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create directories
RUN mkdir -p /data/documents && \
    chown -R nodejs:nodejs /data

USER nodejs

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
```

### 2. docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/oa_agent
      - REDIS_URL=redis://redis:6379
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - LLM_MODEL=claude-opus-4-6
      - PARSE_CONFIDENCE_THRESHOLD=0.8
      - DOCUMENT_STORAGE_PATH=/data/documents
    volumes:
      - documents:/data/documents
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=oa_agent
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
    volumes:
      - minio_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

volumes:
  postgres_data:
  redis_data:
  minio_data:
  documents:
```

### 3. 启动服务

```bash
# 设置环境变量
export ANTHROPIC_API_KEY=sk-ant-xxx

# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f api

# 检查服务状态
docker-compose ps

# 停止服务
docker-compose down

# 停止并删除数据
docker-compose down -v
```

---

## Kubernetes部署

### 1. ConfigMap

创建 `k8s/configmap.yaml`：

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: oa-agent-config
  namespace: oa-agent
data:
  NODE_ENV: "production"
  LLM_MODEL: "claude-opus-4-6"
  LLM_MAX_TOKENS: "16000"
  LLM_TEMPERATURE: "0.2"
  PARSE_CONFIDENCE_THRESHOLD: "0.8"
  PARSE_TIMEOUT_MS: "300000"
  PARSE_MAX_CONCURRENT: "3"
  PARSE_CACHE_TTL: "86400"
  DOCUMENT_MAX_SIZE_MB: "10"
  DOCUMENT_STORAGE_PATH: "/data/documents"
  LINK_FETCH_TIMEOUT_MS: "5000"
  LOG_LEVEL: "info"
```

### 2. Secret

创建 `k8s/secret.yaml`：

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: oa-agent-secret
  namespace: oa-agent
type: Opaque
stringData:
  ANTHROPIC_API_KEY: "sk-ant-xxx"
  DATABASE_URL: "postgresql://user:password@postgres:5432/oa_agent"
  REDIS_URL: "redis://redis:6379"
  REDIS_PASSWORD: ""
```

### 3. Deployment

创建 `k8s/deployment.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oa-agent-api
  namespace: oa-agent
spec:
  replicas: 3
  selector:
    matchLabels:
      app: oa-agent-api
  template:
    metadata:
      labels:
        app: oa-agent-api
    spec:
      containers:
      - name: api
        image: oa-agent/api:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: oa-agent-config
        - secretRef:
            name: oa-agent-secret
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /api/v1/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /api/v1/health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        volumeMounts:
        - name: documents
          mountPath: /data/documents
      volumes:
      - name: documents
        persistentVolumeClaim:
          claimName: oa-agent-documents-pvc
```

### 4. Service

创建 `k8s/service.yaml`：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: oa-agent-api
  namespace: oa-agent
spec:
  selector:
    app: oa-agent-api
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: ClusterIP
```

### 5. Ingress

创建 `k8s/ingress.yaml`：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: oa-agent-ingress
  namespace: oa-agent
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - api.oa-agent.example.com
    secretName: oa-agent-tls
  rules:
  - host: api.oa-agent.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: oa-agent-api
            port:
              number: 80
```

### 6. PersistentVolumeClaim

创建 `k8s/pvc.yaml`：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: oa-agent-documents-pvc
  namespace: oa-agent
spec:
  accessModes:
  - ReadWriteMany
  resources:
    requests:
      storage: 50Gi
  storageClassName: standard
```

### 7. 部署到Kubernetes

```bash
# 创建命名空间
kubectl create namespace oa-agent

# 应用配置
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml

# 查看部署状态
kubectl get pods -n oa-agent
kubectl get svc -n oa-agent
kubectl get ingress -n oa-agent

# 查看日志
kubectl logs -f deployment/oa-agent-api -n oa-agent

# 扩容
kubectl scale deployment/oa-agent-api --replicas=5 -n oa-agent

# 滚动更新
kubectl set image deployment/oa-agent-api api=oa-agent/api:v2.0.0 -n oa-agent

# 回滚
kubectl rollout undo deployment/oa-agent-api -n oa-agent
```

---

## 数据库迁移

### 1. 初始化数据库

```bash
# 进入API容器
docker exec -it oa-agent-api sh

# 运行迁移
cd apps/api
npx prisma migrate deploy

# 生成Prisma Client
npx prisma generate

# 查看迁移状态
npx prisma migrate status
```

### 2. 创建新迁移

```bash
# 开发环境
cd apps/api
npx prisma migrate dev --name add_parse_job_tables

# 生产环境
npx prisma migrate deploy
```

### 3. 数据库备份

```bash
# 备份
docker exec oa-agent-postgres pg_dump -U postgres oa_agent > backup.sql

# 恢复
docker exec -i oa-agent-postgres psql -U postgres oa_agent < backup.sql
```

---

## 监控和日志

### 1. 健康检查

```bash
# 基础健康检查
curl http://localhost:3000/api/v1/health

# 详细健康检查
curl http://localhost:3000/api/v1/health/detailed
```

### 2. 日志收集

使用ELK Stack或Loki：

```yaml
# docker-compose.yml 添加日志驱动
services:
  api:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 3. 性能监控

使用Prometheus + Grafana：

```yaml
# k8s/servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: oa-agent-api
  namespace: oa-agent
spec:
  selector:
    matchLabels:
      app: oa-agent-api
  endpoints:
  - port: metrics
    interval: 30s
```

---

## 性能优化

### 1. 数据库优化

```sql
-- 创建索引
CREATE INDEX idx_parse_job_status ON "ParseJob"(status);
CREATE INDEX idx_parse_job_bootstrap ON "ParseJob"(bootstrap_job_id);
CREATE INDEX idx_parse_job_hash ON "ParseJob"(document_hash);
CREATE INDEX idx_extracted_process_parse ON "ExtractedProcess"(parse_job_id);
CREATE INDEX idx_extracted_process_code ON "ExtractedProcess"(process_code);

-- 分析表
ANALYZE "ParseJob";
ANALYZE "ExtractedProcess";
ANALYZE "ProcessTemplate";
```

### 2. Redis缓存

```typescript
// 缓存解析结果
await redis.setex(
  `parse:${documentHash}`,
  86400, // 24小时
  JSON.stringify(result)
);

// 缓存过滤结果
await redis.setex(
  `filter:${documentHash}`,
  3600, // 1小时
  JSON.stringify(filterResult)
);
```

### 3. 连接池配置

```typescript
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")

  // 连接池配置
  connection_limit = 20
  pool_timeout = 10
}
```

---

## 安全加固

### 1. 网络安全

```yaml
# k8s/networkpolicy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: oa-agent-api-policy
  namespace: oa-agent
spec:
  podSelector:
    matchLabels:
      app: oa-agent-api
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - protocol: TCP
      port: 3000
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgres
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - podSelector:
        matchLabels:
          app: redis
    ports:
    - protocol: TCP
      port: 6379
```

### 2. 密钥管理

使用Kubernetes Secrets或外部密钥管理服务：

```bash
# 使用kubectl创建secret
kubectl create secret generic oa-agent-secret \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-xxx \
  --from-literal=DATABASE_URL=postgresql://... \
  -n oa-agent

# 使用Sealed Secrets
kubeseal --format=yaml < secret.yaml > sealed-secret.yaml
kubectl apply -f sealed-secret.yaml
```

### 3. RBAC配置

```yaml
# k8s/rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: oa-agent-api
  namespace: oa-agent
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: oa-agent-api-role
  namespace: oa-agent
rules:
- apiGroups: [""]
  resources: ["configmaps", "secrets"]
  verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: oa-agent-api-rolebinding
  namespace: oa-agent
subjects:
- kind: ServiceAccount
  name: oa-agent-api
roleRef:
  kind: Role
  name: oa-agent-api-role
  apiGroup: rbac.authorization.k8s.io
```

---

## 故障排查

### 1. 常见问题

**问题1: 容器启动失败**
```bash
# 查看日志
docker logs oa-agent-api

# 检查配置
docker exec oa-agent-api env | grep ANTHROPIC

# 进入容器调试
docker exec -it oa-agent-api sh
```

**问题2: 数据库连接失败**
```bash
# 测试连接
docker exec oa-agent-api psql $DATABASE_URL -c "SELECT 1"

# 检查网络
docker network inspect oa-agent_default
```

**问题3: Redis连接失败**
```bash
# 测试连接
docker exec oa-agent-api redis-cli -u $REDIS_URL ping
```

### 2. 性能问题

```bash
# 查看资源使用
docker stats oa-agent-api

# 查看慢查询
docker exec oa-agent-postgres psql -U postgres -c "SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10"

# 查看Redis内存
docker exec oa-agent-redis redis-cli INFO memory
```

---

## 备份和恢复

### 1. 数据库备份

```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"

# 备份数据库
docker exec oa-agent-postgres pg_dump -U postgres oa_agent | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# 保留最近7天的备份
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +7 -delete

echo "Backup completed: db_$DATE.sql.gz"
```

### 2. 文档备份

```bash
#!/bin/bash
# backup-documents.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"

# 备份文档
tar -czf $BACKUP_DIR/documents_$DATE.tar.gz /data/documents

# 保留最近30天的备份
find $BACKUP_DIR -name "documents_*.tar.gz" -mtime +30 -delete

echo "Documents backup completed: documents_$DATE.tar.gz"
```

### 3. 自动备份

```yaml
# k8s/cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: oa-agent-backup
  namespace: oa-agent
spec:
  schedule: "0 2 * * *"  # 每天凌晨2点
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: postgres:16-alpine
            command:
            - /bin/sh
            - -c
            - |
              pg_dump $DATABASE_URL | gzip > /backups/db_$(date +%Y%m%d).sql.gz
            envFrom:
            - secretRef:
                name: oa-agent-secret
            volumeMounts:
            - name: backups
              mountPath: /backups
          restartPolicy: OnFailure
          volumes:
          - name: backups
            persistentVolumeClaim:
              claimName: oa-agent-backups-pvc
```

---

## 部署检查清单

部署前确认：

- [ ] 所有环境变量已正确配置
- [ ] 数据库迁移已完成
- [ ] Redis连接正常
- [ ] MinIO/S3存储配置正确
- [ ] 健康检查端点正常
- [ ] 日志收集配置完成
- [ ] 监控告警配置完成
- [ ] 备份策略已实施
- [ ] 安全策略已配置
- [ ] 负载测试已通过

---

**部署完成！** 🚀

系统已准备好投入生产使用。