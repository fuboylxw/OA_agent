# API文档解析智能体 - 环境变量配置

## 环境变量说明

### LLM配置
```bash
# Anthropic API密钥（必填）
ANTHROPIC_API_KEY=sk-ant-api03-xxx

# LLM模型名称（默认：claude-opus-4-6）
LLM_MODEL=claude-opus-4-6

# 最大Token数（默认：16000）
LLM_MAX_TOKENS=16000

# 温度参数（默认：0.2，范围0-1）
# 较低的温度使输出更确定和一致
LLM_TEMPERATURE=0.2
```

### 解析配置
```bash
# 置信度阈值（默认：0.8，范围0-1）
# 低于此阈值的结果需要人工审核
PARSE_CONFIDENCE_THRESHOLD=0.8

# 解析超时时间（默认：300000ms = 5分钟）
PARSE_TIMEOUT_MS=300000

# 最大并发解析任务数（默认：3）
# 单个租户同时进行的解析任务数量限制
PARSE_MAX_CONCURRENT=3

# 解析结果缓存时间（默认：86400秒 = 24小时）
PARSE_CACHE_TTL=86400

# 是否默认启用非业务接口过滤（默认：true）
PARSE_FILTER_NON_BUSINESS_DEFAULT=true

# 是否默认启用用户链接解析（默认：true）
PARSE_INCLUDE_USER_LINKS_DEFAULT=true
```

### 文档配置
```bash
# 文档最大大小（默认：10MB）
DOCUMENT_MAX_SIZE_MB=10

# 文档存储路径（默认：/data/documents）
DOCUMENT_STORAGE_PATH=/data/documents

# 文档保留时间（默认：2592000秒 = 30天）
DOCUMENT_RETENTION_SECONDS=2592000
```

### 链接获取配置
```bash
# 链接获取超时时间（默认：5000ms = 5秒）
LINK_FETCH_TIMEOUT_MS=5000

# 链接获取最大重试次数（默认：2）
LINK_FETCH_MAX_RETRIES=2

# 链接获取并发数（默认：5）
LINK_FETCH_CONCURRENCY=5

# 是否验证SSL证书（默认：true）
LINK_FETCH_VERIFY_SSL=true
```

### 过滤配置
```bash
# 过滤LLM调用超时时间（默认：30000ms = 30秒）
FILTER_LLM_TIMEOUT_MS=30000

# 过滤结果缓存时间（默认：3600秒 = 1小时）
FILTER_CACHE_TTL=3600
```

### 数据库配置
```bash
# PostgreSQL连接字符串
DATABASE_URL=postgresql://user:password@localhost:5432/oa_agent

# 连接池大小（默认：10）
DATABASE_POOL_SIZE=10
```

### Redis配置
```bash
# Redis连接字符串
REDIS_URL=redis://localhost:6379

# Redis密码（如果需要）
REDIS_PASSWORD=

# Redis数据库编号（默认：0）
REDIS_DB=0
```

### 日志配置
```bash
# 日志级别（默认：info）
# 可选值：error, warn, info, debug, verbose
LOG_LEVEL=info

# 是否启用详细的解析日志（默认：false）
PARSE_VERBOSE_LOGGING=false

# 是否记录LLM请求和响应（默认：false）
# 注意：会记录完整的API请求，可能包含敏感信息
LOG_LLM_REQUESTS=false
```

### 监控配置
```bash
# 是否启用性能监控（默认：true）
ENABLE_PERFORMANCE_MONITORING=true

# 是否启用错误追踪（默认：true）
ENABLE_ERROR_TRACKING=true

# Sentry DSN（可选）
SENTRY_DSN=

# 监控数据上报间隔（默认：60000ms = 1分钟）
MONITORING_REPORT_INTERVAL_MS=60000
```

---

## 完整配置示例

### 开发环境 (.env.development)
```bash
# LLM配置
ANTHROPIC_API_KEY=sk-ant-api03-dev-xxx
LLM_MODEL=claude-opus-4-6
LLM_MAX_TOKENS=16000
LLM_TEMPERATURE=0.2

# 解析配置
PARSE_CONFIDENCE_THRESHOLD=0.7
PARSE_TIMEOUT_MS=300000
PARSE_MAX_CONCURRENT=5
PARSE_CACHE_TTL=3600
PARSE_FILTER_NON_BUSINESS_DEFAULT=true
PARSE_INCLUDE_USER_LINKS_DEFAULT=true

# 文档配置
DOCUMENT_MAX_SIZE_MB=10
DOCUMENT_STORAGE_PATH=/tmp/documents
DOCUMENT_RETENTION_SECONDS=86400

# 链接获取配置
LINK_FETCH_TIMEOUT_MS=5000
LINK_FETCH_MAX_RETRIES=2
LINK_FETCH_CONCURRENCY=5
LINK_FETCH_VERIFY_SSL=false

# 数据库配置
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/oa_agent_dev
DATABASE_POOL_SIZE=5

# Redis配置
REDIS_URL=redis://localhost:6379
REDIS_DB=0

# 日志配置
LOG_LEVEL=debug
PARSE_VERBOSE_LOGGING=true
LOG_LLM_REQUESTS=true

# 监控配置
ENABLE_PERFORMANCE_MONITORING=true
ENABLE_ERROR_TRACKING=true
```

### 生产环境 (.env.production)
```bash
# LLM配置
ANTHROPIC_API_KEY=sk-ant-api03-prod-xxx
LLM_MODEL=claude-opus-4-6
LLM_MAX_TOKENS=16000
LLM_TEMPERATURE=0.2

# 解析配置
PARSE_CONFIDENCE_THRESHOLD=0.8
PARSE_TIMEOUT_MS=300000
PARSE_MAX_CONCURRENT=3
PARSE_CACHE_TTL=86400
PARSE_FILTER_NON_BUSINESS_DEFAULT=true
PARSE_INCLUDE_USER_LINKS_DEFAULT=true

# 文档配置
DOCUMENT_MAX_SIZE_MB=10
DOCUMENT_STORAGE_PATH=/data/documents
DOCUMENT_RETENTION_SECONDS=2592000

# 链接获取配置
LINK_FETCH_TIMEOUT_MS=5000
LINK_FETCH_MAX_RETRIES=3
LINK_FETCH_CONCURRENCY=5
LINK_FETCH_VERIFY_SSL=true

# 数据库配置
DATABASE_URL=postgresql://oa_user:secure_password@db.example.com:5432/oa_agent_prod
DATABASE_POOL_SIZE=20

# Redis配置
REDIS_URL=redis://redis.example.com:6379
REDIS_PASSWORD=secure_redis_password
REDIS_DB=0

# 日志配置
LOG_LEVEL=info
PARSE_VERBOSE_LOGGING=false
LOG_LLM_REQUESTS=false

# 监控配置
ENABLE_PERFORMANCE_MONITORING=true
ENABLE_ERROR_TRACKING=true
SENTRY_DSN=https://xxx@sentry.io/xxx
MONITORING_REPORT_INTERVAL_MS=60000
```

### 测试环境 (.env.test)
```bash
# LLM配置
ANTHROPIC_API_KEY=sk-ant-api03-test-xxx
LLM_MODEL=claude-opus-4-6
LLM_MAX_TOKENS=8000
LLM_TEMPERATURE=0.2

# 解析配置
PARSE_CONFIDENCE_THRESHOLD=0.6
PARSE_TIMEOUT_MS=60000
PARSE_MAX_CONCURRENT=10
PARSE_CACHE_TTL=300
PARSE_FILTER_NON_BUSINESS_DEFAULT=true
PARSE_INCLUDE_USER_LINKS_DEFAULT=false

# 文档配置
DOCUMENT_MAX_SIZE_MB=5
DOCUMENT_STORAGE_PATH=/tmp/test-documents
DOCUMENT_RETENTION_SECONDS=3600

# 链接获取配置
LINK_FETCH_TIMEOUT_MS=2000
LINK_FETCH_MAX_RETRIES=1
LINK_FETCH_CONCURRENCY=3
LINK_FETCH_VERIFY_SSL=false

# 数据库配置
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/oa_agent_test
DATABASE_POOL_SIZE=5

# Redis配置
REDIS_URL=redis://localhost:6379
REDIS_DB=1

# 日志配置
LOG_LEVEL=error
PARSE_VERBOSE_LOGGING=false
LOG_LLM_REQUESTS=false

# 监控配置
ENABLE_PERFORMANCE_MONITORING=false
ENABLE_ERROR_TRACKING=false
```

---

## 配置优化建议

### 1. 性能优化

**高并发场景**：
```bash
PARSE_MAX_CONCURRENT=10
DATABASE_POOL_SIZE=50
LINK_FETCH_CONCURRENCY=10
```

**低资源场景**：
```bash
PARSE_MAX_CONCURRENT=1
DATABASE_POOL_SIZE=5
LINK_FETCH_CONCURRENCY=3
```

### 2. 成本优化

**降低LLM成本**：
```bash
LLM_MAX_TOKENS=8000
PARSE_CACHE_TTL=172800  # 48小时
FILTER_CACHE_TTL=7200   # 2小时
```

**提高准确率（增加成本）**：
```bash
LLM_MAX_TOKENS=32000
LLM_TEMPERATURE=0.1
PARSE_CONFIDENCE_THRESHOLD=0.9
```

### 3. 安全加固

**生产环境安全配置**：
```bash
LINK_FETCH_VERIFY_SSL=true
LOG_LLM_REQUESTS=false
PARSE_VERBOSE_LOGGING=false
DOCUMENT_RETENTION_SECONDS=604800  # 7天
```

### 4. 调试配置

**开发调试**：
```bash
LOG_LEVEL=debug
PARSE_VERBOSE_LOGGING=true
LOG_LLM_REQUESTS=true
PARSE_CONFIDENCE_THRESHOLD=0.5
```

---

## 配置验证

### 启动时验证
系统启动时会自动验证关键配置：

```typescript
// apps/api/src/config/validation.ts
export function validateConfig() {
  const required = [
    'ANTHROPIC_API_KEY',
    'DATABASE_URL',
    'REDIS_URL',
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // 验证数值范围
  const threshold = parseFloat(process.env.PARSE_CONFIDENCE_THRESHOLD || '0.8');
  if (threshold < 0 || threshold > 1) {
    throw new Error('PARSE_CONFIDENCE_THRESHOLD must be between 0 and 1');
  }

  const temperature = parseFloat(process.env.LLM_TEMPERATURE || '0.2');
  if (temperature < 0 || temperature > 1) {
    throw new Error('LLM_TEMPERATURE must be between 0 and 1');
  }

  console.log('✅ Configuration validated successfully');
}
```

### 运行时检查
```bash
# 检查配置
curl -X GET http://localhost:3000/api/v1/health/config

# 响应示例
{
  "status": "ok",
  "config": {
    "llmModel": "claude-opus-4-6",
    "parseConfidenceThreshold": 0.8,
    "parseMaxConcurrent": 3,
    "documentMaxSizeMB": 10,
    "linkFetchTimeoutMs": 5000
  }
}
```

---

## 常见问题

### Q1: ANTHROPIC_API_KEY在哪里获取？
A: 访问 https://console.anthropic.com/ 注册账号并创建API Key。

### Q2: 如何调整解析准确率？
A: 提高 `PARSE_CONFIDENCE_THRESHOLD` 和降低 `LLM_TEMPERATURE`。

### Q3: 如何提升解析速度？
A: 增加 `PARSE_MAX_CONCURRENT` 和 `LINK_FETCH_CONCURRENCY`。

### Q4: 如何减少LLM成本？
A: 降低 `LLM_MAX_TOKENS`，增加 `PARSE_CACHE_TTL`，启用过滤功能。

### Q5: 链接获取失败怎么办？
A: 检查 `LINK_FETCH_VERIFY_SSL` 设置，增加 `LINK_FETCH_TIMEOUT_MS` 和 `LINK_FETCH_MAX_RETRIES`。

---

## 监控指标

### 关键指标
```bash
# 解析成功率
parse_success_rate = success_count / total_count

# 平均解析时间
parse_avg_time = sum(parse_time) / count

# LLM Token消耗
llm_token_usage = sum(input_tokens + output_tokens)

# 缓存命中率
cache_hit_rate = cache_hits / total_requests

# 链接获取成功率
link_fetch_success_rate = success_count / total_count
```

### 告警阈值
```bash
# 解析成功率低于85%
parse_success_rate < 0.85

# 平均解析时间超过5分钟
parse_avg_time > 300000

# LLM API失败率超过5%
llm_api_failure_rate > 0.05

# 缓存命中率低于20%
cache_hit_rate < 0.20

# 链接获取成功率低于90%
link_fetch_success_rate < 0.90
```

---

## 配置最佳实践

### 1. 分层配置
- 基础配置：`.env`
- 环境特定：`.env.development`, `.env.production`
- 敏感信息：使用密钥管理服务（如AWS Secrets Manager）

### 2. 配置版本控制
- `.env.example` 提交到Git
- `.env` 添加到 `.gitignore`
- 使用环境变量注入（CI/CD）

### 3. 配置文档化
- 每个配置项添加注释
- 说明默认值和取值范围
- 提供配置示例

### 4. 配置验证
- 启动时验证必填项
- 验证数值范围
- 提供友好的错误提示

---

## 部署检查清单

部署前确认以下配置：

- [ ] `ANTHROPIC_API_KEY` 已设置且有效
- [ ] `DATABASE_URL` 连接正常
- [ ] `REDIS_URL` 连接正常
- [ ] `PARSE_CONFIDENCE_THRESHOLD` 设置合理（0.7-0.9）
- [ ] `PARSE_MAX_CONCURRENT` 根据资源设置
- [ ] `DOCUMENT_MAX_SIZE_MB` 根据需求设置
- [ ] `LINK_FETCH_VERIFY_SSL` 生产环境设为true
- [ ] `LOG_LEVEL` 生产环境设为info或warn
- [ ] `LOG_LLM_REQUESTS` 生产环境设为false
- [ ] 监控和告警已配置

---

**配置完成！** 🎉

现在可以根据不同环境使用相应的配置文件启动服务。