# 验证流程改进总结

## 改进概述

在完成基础重构后，进一步优化了验证逻辑，消除了冗余代码，提升了验证的准确性和容错性。

## 改进清单

### 1. 消除冗余代码

#### 1.1 统一 `buildFullUrl` 函数

**问题**：
- `apps/worker/src/processors/bootstrap.processor.ts` 顶部定义了独立函数
- `apps/api/src/modules/adapter-runtime/generic-http-adapter.ts` 有私有方法（实际不存在）
- 多个其他文件也有重复实现

**改进**：
- 将 `buildFullUrl` 移到 `apps/api/src/modules/common/probe-utils.ts`
- bootstrap processor 引用公共函数
- 删除了 bootstrap processor 中的独立函数定义

#### 1.2 统一 `getNestedValue` 函数

**问题**：
- `apps/api/src/modules/common/probe-utils.ts` 有公共实现
- `apps/worker/src/processors/bootstrap.processor.ts` 有私有方法（完全相同）

**改进**：
- 删除 bootstrap processor 中的私有方法
- 引用公共的 `getNestedValue`
- 在 `verifyResponseStructure` 中使用公共函数

### 2. 降低验证阈值，提升容错性

#### 2.1 Level 1 参数结构验证阈值

**之前**：置信度 < 0.5 直接标记为 failed
**现在**：置信度 < 0.3 才标记为 failed

**原因**：
- OA 系统的错误信息格式可能不标准
- `extractFieldsFromError` 可能提取不到字段
- 降低阈值避免误判可用接口

#### 2.2 空 body 返回 200 的处理

**之前**：置信度 0.3，会被阈值 0.5 拦截
**现在**：置信度 0.6，刚好通过阈值 0.3

**原因**：
- 有些 OA 系统接口设计宽松，不校验参数
- 空 body 返回 200 不代表接口不可用
- 让它进入 Level 2 真实提交验证

### 3. 改进测试数据生成

#### 3.1 读取字段约束

**之前**：
```typescript
case 'string': return `[TEST]${param.description || param.name}`;
case 'number': return 1;
case 'date': return '2025-01-01';
```

**现在**：
```typescript
case 'string': {
  const maxLen = param.maxLength || param.max_length;
  const value = `[TEST]${label}`;
  return maxLen && value.length > maxLen ? value.substring(0, maxLen) : value;
}
case 'number': return param.min ?? param.minimum ?? 1;
case 'date': {
  // 默认用明天，兼容"未来日期"约束
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}
```

**改进点**：
- `string` 类型：检查 `maxLength` 约束，超长则截断
- `number` 类型：优先使用 `min` 值，避免低于最小值约束
- `date` 类型：使用明天日期，兼容"未来日期"约束

### 4. 细化 Level 2 提交失败的错误分类

#### 4.1 新增 `failureReason` 字段

**之前**：只有 `success: boolean`
**现在**：增加 `failureReason: 'param_error' | 'auth_failed' | 'not_found' | 'server_error' | 'network_error'`

#### 4.2 根据状态码细化判定

| 状态码 | failureReason | overall 判定 | 说明 |
|--------|--------------|-------------|------|
| 200-299 | - | passed | 提交成功 |
| 400 | param_error | **partial** | 接口存在但测试数据不符合要求 |
| 401/403 | auth_failed | failed | 认证失败 |
| 404 | not_found | failed | 接口不存在 |
| 5xx | server_error | failed | 服务器错误 |
| 网络异常 | network_error | failed | 网络不通 |

**关键改进**：
- 400 错误标记为 `partial` 而不是 `failed`
- 区分"接口不可用"和"测试数据有问题"

#### 4.3 修改 overall 判定逻辑

**之前**：
```typescript
overall: submitValidation.success ? 'passed' : 'partial'
```

**现在**：
```typescript
overall: submitValidation.success
  ? 'passed'
  : (submitValidation.failureReason === 'param_error' ? 'partial' : 'failed')
```

### 5. 优化 Cookie Session 管理

#### 5.1 添加 Cookie Session 缓存

**新增**：
```typescript
private cookieSessionCache: Map<string, { cookie: string; expiresAt: number }> = new Map();
```

#### 5.2 `loginForCookie` 使用缓存

**之前**：每次调用都登录
**现在**：
- 检查缓存，未过期则直接返回
- 缓存 key: `${baseUrl}:${username}`
- 缓存时长：1 小时

#### 5.3 `enrichWithLiveFormData` 复用缓存

**之前**：
```typescript
// 自己登录
const loginRes = await axios.post(loginUrl, { username, password });
const setCookies = loginRes.headers['set-cookie'];
const cookieHeader = setCookies.map(...).join('; ');
```

**现在**：
```typescript
// 复用 loginForCookie 的缓存逻辑
const cookieHeader = await this.loginForCookie(oaUrl, auth);
```

**效果**：
- DISCOVERY 阶段的 `enrichWithLiveFormData` 登录一次
- VALIDATING 阶段的 `loginForCookie` 直接使用缓存
- 避免重复登录

## 改进效果

### 容错性提升

1. **参数结构验证**：阈值从 0.5 降到 0.3，减少误判
2. **空 body 处理**：置信度从 0.3 提升到 0.6，让宽松接口通过验证
3. **测试数据生成**：读取约束，生成符合要求的数据，减少 400 错误

### 准确性提升

1. **错误分类**：区分"接口不可用"和"测试数据问题"
2. **400 错误处理**：标记为 `partial` 而不是 `failed`，保留可用接口

### 性能优化

1. **Cookie Session 缓存**：避免重复登录，减少网络请求
2. **缓存时长 1 小时**：覆盖整个 bootstrap 流程

### 代码质量

1. **消除冗余**：`buildFullUrl` 和 `getNestedValue` 统一为公共函数
2. **代码复用**：`enrichWithLiveFormData` 复用 `loginForCookie` 的缓存逻辑

## 验证结果示例

### 之前（严格模式）

```json
{
  "processCode": "LEAVE_REQUEST",
  "overall": "failed",
  "reason": "Parameter structure mismatch",
  "paramStructure": {
    "confidence": 0.4,  // < 0.5 阈值，直接失败
    "discoveredFields": ["leave_type", "start_date"],
    "expectedFields": ["leave_type", "start_date", "end_date", "reason"]
  }
}
```

### 现在（宽松模式）

```json
{
  "processCode": "LEAVE_REQUEST",
  "overall": "partial",
  "paramStructure": {
    "confidence": 0.4,  // >= 0.3 阈值，继续 Level 2
    "discoveredFields": ["leave_type", "start_date"],
    "expectedFields": ["leave_type", "start_date", "end_date", "reason"]
  },
  "submit": {
    "success": false,
    "statusCode": 400,
    "failureReason": "param_error",  // 明确标记为参数问题
    "error": "Field 'end_date' is required"
  }
}
```

**改进点**：
- 不会因为 Level 1 置信度低就直接失败
- Level 2 真实提交，发现是参数问题（400）
- 标记为 `partial` 而不是 `failed`
- 保留了这个流程，用户可以手动修正参数

## 测试建议

1. **测试低置信度场景**：OA 系统错误信息格式不标准，Level 1 置信度 0.3-0.5
2. **测试空 body 场景**：接口不校验参数，空 body 返回 200
3. **测试约束场景**：字段有 `maxLength`、`min` 等约束
4. **测试 400 错误**：测试数据不符合要求，返回 400
5. **测试 Cookie 缓存**：验证 DISCOVERY 和 VALIDATING 阶段只登录一次

## 后续优化建议

1. **参数约束推断**：如果 Level 2 返回 400，解析错误信息，推断缺失的约束
2. **自适应阈值**：根据 OA 系统类型动态调整置信度阈值
3. **测试数据优化**：根据字段名称推断合理的测试值（如 `email` 字段用 `test@example.com`）
4. **缓存持久化**：将 Cookie Session 缓存持久化到 Redis，跨进程共享
