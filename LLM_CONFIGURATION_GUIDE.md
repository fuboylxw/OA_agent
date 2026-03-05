# LLM 配置指南

本文档说明如何配置和使用不同的大语言模型（LLM）提供商。

---

## 支持的 LLM 提供商

系统支持以下 LLM 提供商：

1. **OpenAI** - GPT-3.5, GPT-4, GPT-4 Turbo
2. **Anthropic** - Claude 3 (Opus, Sonnet, Haiku)
3. **Azure OpenAI** - Azure 托管的 OpenAI 模型
4. **Ollama** - 本地运行的开源模型（Llama 2, Mistral 等）

---

## 配置方法

### 1. OpenAI 配置

```bash
# .env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4-turbo-preview
```

**支持的模型**:
- `gpt-4-turbo-preview` - GPT-4 Turbo (推荐)
- `gpt-4` - GPT-4
- `gpt-3.5-turbo` - GPT-3.5 Turbo (更快、更便宜)

**获取 API Key**:
1. 访问 https://platform.openai.com/api-keys
2. 创建新的 API Key
3. 复制并粘贴到 `.env` 文件

---

### 2. Anthropic (Claude) 配置

```bash
# .env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

**支持的模型**:
- `claude-3-5-sonnet-20241022` - Claude 3.5 Sonnet (推荐)
- `claude-3-opus-20240229` - Claude 3 Opus (最强)
- `claude-3-sonnet-20240229` - Claude 3 Sonnet
- `claude-3-haiku-20240307` - Claude 3 Haiku (最快)

**获取 API Key**:
1. 访问 https://console.anthropic.com/
2. 创建新的 API Key
3. 复制并粘贴到 `.env` 文件

---

### 3. Azure OpenAI 配置

```bash
# .env
LLM_PROVIDER=azure-openai
AZURE_OPENAI_API_KEY=your-azure-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4
```

**配置步骤**:
1. 在 Azure Portal 创建 OpenAI 资源
2. 部署模型（如 GPT-4）
3. 获取 API Key 和 Endpoint
4. 将部署名称填入 `AZURE_OPENAI_DEPLOYMENT`

---

### 4. Ollama (本地模型) 配置

```bash
# .env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2
```

**安装 Ollama**:
```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# 启动 Ollama
ollama serve

# 下载模型
ollama pull llama2
ollama pull mistral
ollama pull qwen
```

**支持的模型**:
- `llama2` - Meta Llama 2
- `mistral` - Mistral 7B
- `qwen` - 通义千问
- `deepseek-coder` - DeepSeek Coder
- 更多模型: https://ollama.com/library

---

## 通用配置参数

```bash
# 是否使用 LLM 进行意图识别（false 则使用规则匹配）
USE_LLM_FOR_INTENT=true

# 温度参数（0.0-1.0，越高越随机）
LLM_TEMPERATURE=0.7

# 最大生成 token 数
LLM_MAX_TOKENS=2000
```

---

## 使用示例

### 示例 1: 使用 OpenAI GPT-4

```bash
# .env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4-turbo-preview
USE_LLM_FOR_INTENT=true
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=2000
```

### 示例 2: 使用 Claude 3.5 Sonnet

```bash
# .env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxx
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
USE_LLM_FOR_INTENT=true
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=2000
```

### 示例 3: 使用本地 Ollama

```bash
# .env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2
USE_LLM_FOR_INTENT=true
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=2000
```

### 示例 4: 使用规则匹配（不调用 LLM）

```bash
# .env
USE_LLM_FOR_INTENT=false
```

---

## 测试 LLM 配置

### 1. 测试 OpenAI

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4-turbo-preview",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 2. 测试 Anthropic

```bash
curl https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 1024
  }'
```

### 3. 测试 Ollama

```bash
curl http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama2",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

### 4. 测试 Chat 接口

```bash
curl -X POST http://localhost:3001/api/v1/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "我要报销差旅费1000元",
    "userId": "e228391e-81b2-401c-8381-995be98b3866"
  }'
```

---

## 性能对比

| 提供商 | 模型 | 速度 | 成本 | 质量 | 推荐场景 |
|--------|------|------|------|------|----------|
| OpenAI | GPT-4 Turbo | 快 | 中 | 高 | 生产环境 |
| OpenAI | GPT-3.5 Turbo | 很快 | 低 | 中 | 高并发场景 |
| Anthropic | Claude 3.5 Sonnet | 快 | 中 | 很高 | 复杂任务 |
| Anthropic | Claude 3 Haiku | 很快 | 低 | 中 | 简单任务 |
| Ollama | Llama 2 | 中 | 免费 | 中 | 本地开发 |
| Ollama | Mistral | 快 | 免费 | 中 | 本地开发 |

---

## 成本估算

### OpenAI 定价 (2024)

| 模型 | 输入 (per 1M tokens) | 输出 (per 1M tokens) |
|------|---------------------|---------------------|
| GPT-4 Turbo | $10 | $30 |
| GPT-4 | $30 | $60 |
| GPT-3.5 Turbo | $0.50 | $1.50 |

### Anthropic 定价 (2024)

| 模型 | 输入 (per 1M tokens) | 输出 (per 1M tokens) |
|------|---------------------|---------------------|
| Claude 3.5 Sonnet | $3 | $15 |
| Claude 3 Opus | $15 | $75 |
| Claude 3 Sonnet | $3 | $15 |
| Claude 3 Haiku | $0.25 | $1.25 |

**估算示例**:
- 每次对话约 500 tokens (输入) + 200 tokens (输出)
- 使用 GPT-4 Turbo: $0.011 per 对话
- 使用 Claude 3.5 Sonnet: $0.0045 per 对话
- 使用 GPT-3.5 Turbo: $0.0005 per 对话

---

## 故障排查

### 问题 1: API Key 无效

**错误**: `401 Unauthorized` 或 `Invalid API Key`

**解决**:
1. 检查 API Key 是否正确
2. 确认 API Key 有足够的配额
3. 检查 API Key 是否过期

### 问题 2: 连接超时

**错误**: `ETIMEDOUT` 或 `Connection timeout`

**解决**:
1. 检查网络连接
2. 检查防火墙设置
3. 尝试使用代理
4. 增加超时时间（在代码中设置）

### 问题 3: 模型不存在

**错误**: `Model not found` 或 `Invalid model`

**解决**:
1. 检查模型名称是否正确
2. 确认账户有权限访问该模型
3. 对于 Azure，检查部署名称是否正确

### 问题 4: Ollama 无法连接

**错误**: `ECONNREFUSED` 或 `Connection refused`

**解决**:
1. 确认 Ollama 服务已启动: `ollama serve`
2. 检查端口是否正确（默认 11434）
3. 确认模型已下载: `ollama list`

### 问题 5: LLM 响应格式错误

**错误**: `JSON parse error` 或 `Invalid response format`

**解决**:
1. 系统会自动回退到规则匹配
2. 检查日志中的错误信息
3. 调整 prompt 或温度参数
4. 考虑使用更稳定的模型

---

## 最佳实践

### 1. 开发环境

```bash
# 使用本地 Ollama 或规则匹配，节省成本
LLM_PROVIDER=ollama
OLLAMA_MODEL=llama2
# 或
USE_LLM_FOR_INTENT=false
```

### 2. 测试环境

```bash
# 使用 GPT-3.5 Turbo 或 Claude Haiku，平衡成本和质量
LLM_PROVIDER=openai
OPENAI_MODEL=gpt-3.5-turbo
```

### 3. 生产环境

```bash
# 使用 GPT-4 Turbo 或 Claude 3.5 Sonnet，保证质量
LLM_PROVIDER=openai
OPENAI_MODEL=gpt-4-turbo-preview
# 或
LLM_PROVIDER=anthropic
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

### 4. 高并发场景

```bash
# 使用更快的模型，设置合理的超时
LLM_PROVIDER=openai
OPENAI_MODEL=gpt-3.5-turbo
LLM_MAX_TOKENS=1000
```

### 5. 降低成本

- 使用 GPT-3.5 Turbo 或 Claude Haiku
- 减少 `LLM_MAX_TOKENS`
- 优化 prompt 长度
- 对简单任务使用规则匹配
- 实现缓存机制

---

## 环境变量完整示例

```bash
# Database
DATABASE_URL="postgresql://uniflow:uniflow123@localhost:5432/uniflow_oa?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=uniflow-attachments

# API
API_PORT=3001
API_HOST=0.0.0.0

# Worker
WORKER_CONCURRENCY=5

# Web
NEXT_PUBLIC_API_URL=http://localhost:3001

# JWT
JWT_SECRET=your-secret-key-change-in-production

# LLM Configuration
LLM_PROVIDER=openai
USE_LLM_FOR_INTENT=true

# OpenAI
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4-turbo-preview

# LLM Parameters
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=2000

# Tenant
DEFAULT_TENANT_ID=7c46b0e8-3e9c-4d79-8ff1-19481d11c8fe
```

---

## 相关文档

- [OpenAI API 文档](https://platform.openai.com/docs/api-reference)
- [Anthropic API 文档](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- [Azure OpenAI 文档](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [Ollama 文档](https://github.com/ollama/ollama)

---

**最后更新**: 2026-03-03
**版本**: 1.0
