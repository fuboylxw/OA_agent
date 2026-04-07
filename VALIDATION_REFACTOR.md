`# 验证流程重构总结

## 改动概述

本次重构解决了三个核心问题：
1. **验证太浅**：从"URL 存在性探测"升级为"接口功能深度验证"
2. **认证验证重复**：消除了 AUTH_PROBING、VALIDATING、EndpointValidatorService 三处的重复认证检测
3. **探测代码重复**：统一了 bootstrap processor 和 GenericHttpAdapter 的探测实现

## 改动文件清单

### 新增文件

1. **`apps/api/src/modules/common/probe-utils.ts`**
   - 公共的探测工具函数
   - `classifyProbeStatus()`: 根据 HTTP 状态码分类端点状态
   - `getNestedValue()`: 从嵌套对象中提取值
   - 被 bootstrap processor 和 GenericHttpAdapter 共用

### 修改文件

2. **`apps/worker/src/processors/bootstrap.processor.ts`**
   - **VALIDATING 阶段完全重写**，实现三级深度验证：
     - Level 1: 参数结构验证（发空 body，分析错误信息）
     - Level 2: 真实提交验证（用测试数据，验证接口作用和响应结构）
     - Level 3: 查询和撤回验证（用真实 submissionId）
   - **删除**：`probeEndpoint()`, `classifyProbeStatus()` 方法（改为深度验证）
   - **简化**：`buildAuthHeaders()` 不再重复登录，直接使用 AUTH_PROBING 的结果
   - **新增方法**：
     - `validateProcess()`: 验证单个流程
     - `validateParamStructure()`: Level 1 参数结构验证
     - `extractFieldsFromError()`: 从错误信息中提取字段名
     - `validateRealSubmit()`: Level 2 真实提交验证
     - `buildTestData()`, `getTestValue()`: 构造测试数据
     - `verifyResponseStructure()`: 验证响应结构
     - `verifyPurpose()`: 验证接口作用
     - `extractKeywords()`: 提取流程名称关键词
     - `extractSubmissionId()`: 从响应中提取 submissionId
     - `validateQuery()`: Level 3 查询验证
     - `validateCancel()`: Level 3 撤回验证
     - `loginForCookie()`: Cookie auth 预登录

3. **`apps/api/src/modules/adapter-runtime/generic-http-adapter.ts`**
   - **导入公共工具**：`import { classifyProbeStatus, type ProbeStatus } from '../common/probe-utils'`
   - **删除**：私有的 `classifyProbeStatus()` 方法
   - **修改**：`probeEndpoint()` 使用公共的 `classifyProbeStatus()`

4. **`apps/api/src/modules/api-parse/endpoint-validator.service.ts`**
   - **删除**：Level 2 认证检测（62-93 行）
   - **新增参数**：`validate(connectorId: string, skipProbe = true)`
   - **默认行为**：skipProbe=true，跳过端点探测（因为 bootstrap 已经做过深度验证）
   - **手动触发**：skipProbe=false，强制重新探测（运行时手动触发）

5. **`apps/api/src/modules/api-parse/api-parse.service.ts`**
   - **Stage 3 验证**：改为 `autoValidate === true` 才执行（之前是 `!== false`）
   - **调用方式**：`validate(connectorId, false)` 强制探测

## 新的验证流程

### Bootstrap 流水线

```
DISCOVERING    → 获取文档内容
PARSING        → LLM 识别流程、字段、端点
AUTH_PROBING   → 探测认证方式（一次性，结果写入 authConfig）
VALIDATING     → 深度验证（新）
                 ├ Level 1: 空 body → 参数结构比对
                 ├ Level 2: 测试数据 → 真实提交 + 响应验证
                 └ Level 3: 用真实 ID → 查询 + 撤回验证
NORMALIZING    → 创建 RemoteProcess / ProcessTemplate
COMPILING      → 生成 MCPTool + Connector + 发布
```

### Level 1: 参数结构验证

- 向 submit 端点发送空 body 的 POST 请求
- 利用 OA 系统返回的 400 参数校验错误信息，反推实际需要的字段
- 与 LLM 解析出的字段做交叉比对，计算匹配度
- **判定标准**：
  - 匹配度 >= 50%：通过，进入 Level 2
  - 匹配度 < 50%：标记为"参数结构不匹配"，该流程被剔除

### Level 2: 真实提交验证

- 根据 LLM 解析的字段定义，构造最小化测试数据（只填必填字段）
- 向 submit 端点发起真实 POST 请求
- **验证三件事**：
  1. **接口作用确认**：响应内容中是否包含与流程名称相关的关键词
  2. **响应结构确认**：responseMapping 中定义的关键字段是否存在
  3. **提交是否成功**：HTTP 200 且能提取到 submissionId

### Level 3: 关联端点验证

- 如果 Level 2 提交成功并拿到了 submissionId：
  - **query 端点**：用 submissionId 发 GET 请求，验证能否查到记录
  - **cancel 端点**：用 submissionId 发撤回请求，验证能否成功撤回（同时清理测试数据）

### 测试数据构造规则

```typescript
text      → `[TEST]字段名`
number    → 1
date      → '2025-01-01'
datetime  → '2025-01-01T00:00:00Z'
boolean   → true
array     → []
object    → {}
```

## 验证结果存储

每个流程的验证结果写入 `BootstrapReport.evidence`：

```json
{
  "type": "deep_validation",
  "description": "Deep validated 3 processes: 2 passed, 1 partial, 0 failed",
  "passed": 2,
  "partial": 1,
  "failed": 0,
  "details": [
    {
      "processCode": "LEAVE_REQUEST",
      "overall": "passed",
      "paramStructure": {
        "confidence": 0.85,
        "discoveredFields": ["leave_type", "start_date", "end_date", "reason"],
        "expectedFields": ["leave_type", "start_date", "end_date", "reason"],
        "missingFields": [],
        "extraFields": []
      },
      "submit": {
        "success": true,
        "submissionId": "xxx",
        "statusCode": 200,
        "responseStructureValid": true,
        "purposeMatch": true
      },
      "query": {
        "success": true,
        "statusFound": true
      },
      "cancel": {
        "success": true
      }
    }
  ]
}
```

## 认证验证去重

| 阶段 | 之前 | 之后 |
|------|------|------|
| AUTH_PROBING | 探测认证方式，确认凭证有效 | **保持不变** |
| VALIDATING (bootstrap) | 用同样的 authConfig 构建 headers 再逐端点探测 | **直接使用 AUTH_PROBING 的结果**，不再重复验证认证 |
| EndpointValidatorService | Level 2 找第一个 GET 端点测认证 | **删除 Level 2**，默认跳过探测 |

## 探测代码统一

- **公共实现**：`apps/api/src/modules/common/probe-utils.ts`
- **使用方**：
  - `GenericHttpAdapter.probeEndpoint()` 调用 `classifyProbeStatus()`
  - bootstrap processor 不再需要 `probeEndpoint()`（改为深度验证）

## 向后兼容性

- **EndpointValidatorService.validate()** 新增 `skipProbe` 参数，默认 `true`
- **现有调用方**：
  - `api-parse.service.ts`: 改为 `validate(connectorId, false)` 强制探测
  - 其他调用方如果不传参数，默认跳过探测（向后兼容）

## 优势

1. **验证深度**：从"URL 存在"提升到"接口真的能用"
2. **消除重复**：认证只验证一次，探测逻辑统一实现
3. **代码复用**：公共的 `classifyProbeStatus()` 被多处共用
4. **可追溯**：每个流程的验证结果详细记录到 BootstrapReport
5. **容错性**：参数结构验证失败不会阻塞整个流程，只过滤掉有问题的流程

## 注意事项

1. **测试数据清理**：如果流程没有 cancel 端点，Level 2 提交的测试数据会留在 OA 系统中。这是可接受的——bootstrap 是一次性操作，留一条测试数据影响不大。
2. **路径参数**：Level 3 的查询和撤回验证会用真实的 submissionId 替换路径参数 `{id}` 或 `{submissionId}`
3. **Cookie auth**：如果是 cookie 认证，会在验证开始前预先登录获取 session，避免每个请求都登录一次

## 测试建议

1. 测试 bootstrap 流程，确认 VALIDATING 阶段能正确验证流程
2. 测试不同认证方式（apikey, basic, oauth2, cookie）
3. 测试参数结构不匹配的情况（Level 1 失败）
4. 测试提交失败的情况（Level 2 失败）
5. 测试没有 cancel 端点的情况（Level 3 部分成功）
6. 测试 EndpointValidatorService 的手动触发（skipProbe=false）
