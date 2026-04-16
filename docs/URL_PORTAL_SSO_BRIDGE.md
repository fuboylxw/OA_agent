# URL 模式：Portal 登录后桥接到下游 OA 业务页

本文档说明如何把 URL 模式配置成**通用、可插拔**的方式，而不是把某个流程写死在代码里。

## 1. 适用场景

适用于这种链路：

1. 用户先在门户/统一认证平台登录
2. 门户本身有登录态，但下游 OA 还没有业务会话
3. 门户接口能返回一个下游 OA 的 SSO 跳转地址
4. 只要把这个 SSO 地址里的 `tourl` 改成目标业务页，就能进入指定流程页面
5. 页面加载后，再通过 URL 模式的 `preflight + networkSubmit` 走下层网络提交

对 XPU 来说，关键桥接点是：

- 门户首页：`https://sz.xpu.edu.cn/`
- OA 信息接口：`https://sz.xpu.edu.cn/gate/lobby/api/oa/info`
- 返回字段：`coordinateUrl` / `workUrl`

## 2. 最终逻辑

URL 模式的最终执行逻辑是：

```text
门户登录态
-> 打开 portalUrl
-> 捕获 oaInfoUrl
-> 读取 coordinateUrl/workUrl
-> 把 tourl 改成目标业务 URL
-> 访问改写后的 SSO URL，激活 OA 会话
-> 打开目标业务页
-> preflight 提取 token/隐藏字段/请求载荷
-> networkSubmit 由服务端发起保存或提交
```

这条链路已经在 XPU 请假流程上实测通过。

实测记录：

- `apps/api/.logs/xpu-inspect/verify-xpu-frontend-direct-url-1776259097400.json`

## 3. 配置点

### 3.1 `platform.portalSsoBridge`

示例：

```json
{
  "platform": {
    "entryUrl": "https://sz.xpu.edu.cn/#/home?component=thirdScreen",
    "jumpUrlTemplate": "https://oa2023.xpu.edu.cn/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true",
    "portalSsoBridge": {
      "enabled": true,
      "mode": "oa_info",
      "portalUrl": "https://sz.xpu.edu.cn/#/home?component=thirdScreen",
      "oaInfoUrl": "https://sz.xpu.edu.cn/gate/lobby/api/oa/info",
      "sourcePath": "coordinateUrl",
      "targetPathTemplate": "/seeyon/collaboration/collaboration.do?method=newColl&from=templateNewColl&templateId=-4191060420802230640&showTab=true",
      "required": true
    }
  }
}
```

字段说明：

- `portalUrl`：先打开哪个门户页面，用它来触发 OA 信息接口
- `oaInfoUrl`：门户里返回 OA SSO 地址的接口
- `sourcePath`：从响应里取哪一个字段，比如 `coordinateUrl`
- `targetPathTemplate`：真正想进入的业务页
- `required`：
  - `true`：桥接失败直接报错
  - `false`：桥接失败时退回原始 `jumpUrl`

### 3.2 `runtime.preflight`

这里负责：

- 打开业务页后填入表单字段
- 触发“保存待发”或其他非最终提交动作
- 截获真正的表单提交请求
- 提取 token、隐藏字段、payload

当前已经支持通用内建插件：

- `capture_form_submit`

### 3.3 `runtime.networkSubmit`

这里负责：

- 复用桥接后的 OA 会话
- 直接用服务端请求提交或保存
- 不再依赖前端 DOM 点击完成最终提交

## 4. 如何新增别的流程

不要改后端代码，直接复制一份配置文件即可。

仓库里已经提供了样例：

- `apps/api/scripts/config-examples/xpu-leave-url-bridge.json`

你只需要改这些内容：

1. `processCode`
2. `processName`
3. `processCategory`
4. `platform.jumpUrlTemplate`
5. `platform.portalSsoBridge.targetPathTemplate`
6. `runtime.preflight.steps[0].options.fieldMappings`
7. `runtime.preflight.steps[0].options.trigger`
8. `runtime.networkSubmit.url/body/responseMapping`

也就是：

- **页面入口**换成你的流程
- **字段映射**换成你的表单
- **网络提交规则**换成你的保存/提交接口

## 5. 如何把配置写进流程模板

新增了一个通用脚本：

- `apps/api/scripts/upsert-url-process-template.ts`

用法：

```bash
corepack pnpm --dir apps/api exec tsx scripts/upsert-url-process-template.ts \
  --config scripts/config-examples/xpu-leave-url-bridge.json \
  --dry-run
```

正式写入：

```bash
corepack pnpm --dir apps/api exec tsx scripts/upsert-url-process-template.ts \
  --config scripts/config-examples/xpu-leave-url-bridge.json
```

可选参数：

- `--tenant-id`
- `--connector-id`
- `--remote-process-id`
- `--oa-vendor`

说明：

- 如果数据库里已经有同 `processCode` 的模板，就更新
- 如果没有，就会新建；这时需要提供 `remoteProcessId`
- 如果不传 `connectorId`，脚本会尝试按 `oaVendor` 自动找唯一连接器

## 6. XPU 当前结论

### 可行

- `portal -> oa/info -> 改写 sso tourl -> 进入业务页`

### 不建议直接依赖

- `portal 登录后直接裸访问业务 URL`
- `先访问 oa2023 根路径再裸跳业务 URL`
- `只靠 UniFlow 前端 OAuth 回调去建立 OA 会话`

原因是这些方式在自动化里不稳定，不能保证一定拿到下游 OA 业务会话。
