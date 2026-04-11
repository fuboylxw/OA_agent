# 统一认证 OAuth2 接入与单端口部署

本文档基于仓库根目录下的 [统一认证.docx](/root/BPM_Agent/统一认证.docx) 整理，适用于当前 UniFlow 项目。

## 1. 回调地址填哪个

这个项目已经改成前端页面接收统一认证回调，再由后端换取 `access_token` 并签发本系统会话。

统一认证平台需要登记的回调地址是：

- 推荐反向代理到 80/443 时：
  - `http://202.200.206.250/login/callback`
  - 或 `https://你的域名/login/callback`
- 如果你直接开放前端 3000 端口：
  - `http://202.200.206.250:3000/login/callback`

注意：

- 平台登记的回调地址必须和环境变量 `AUTH_OAUTH2_REDIRECT_URI` 完全一致。
- 如果 PC 和 WAP 都走同一个前端地址，可以都填同一个 `/login/callback`。
- 统一认证退出回跳地址建议填登录页：
  - `http://202.200.206.250/login`
  - 或 `https://你的域名/login`

## 2. 当前项目里的 OAuth2 流程

按照文档里的标准流程，项目现在的登录链路是：

1. 浏览器访问 `/api/v1/auth/oauth2/start`
2. 后端重定向到统一认证 `/auth2/oauth/authorize`
3. 统一认证回调到 `/login/callback?code=...&state=...`
4. 前端回调页把 `code/state` 发给 `/api/v1/auth/oauth2/exchange`
5. 后端调用统一认证：
   - `/auth2/oauth/token`
   - `/auth2/api/v1/getUserInfo`
6. 后端为当前用户签发本系统 `auth_session`
7. 前端写入登录态并进入系统首页

这意味着：

- 不再使用本地用户名密码页面登录
- 后端本地账号密码登录接口已禁用
- 浏览器只需要访问前端一个端口
- 后端 `3001` 不需要对外开放
- 访问受保护页面时，未登录用户会直接跳到 `/api/v1/auth/oauth2/start`，不再先停留在 `/login`
- 如果手工访问 `/login`，页面也会自动发起统一认证跳转

## 3. 必填环境变量

在服务器 `.env` 里至少配置这些值：

```env
AUTH_MODE=oauth2
NEXT_PUBLIC_AUTH_MODE=oauth2
NEXT_PUBLIC_AUTH_PROVIDER_NAME=统一认证

PUBLIC_WEB_BASE_URL=http://202.200.206.250
AUTH_OAUTH2_REDIRECT_URI=http://202.200.206.250/login/callback

AUTH_OAUTH2_BASE_URL=https://sz.xpu.edu.cn
AUTH_OAUTH2_CLIENT_ID=平台分配的APPID
AUTH_OAUTH2_CLIENT_SECRET=平台分配的SECRET
AUTH_OAUTH2_SCOPE=client

# 前端走同源，保持为空即可
NEXT_PUBLIC_API_URL=

# Next.js 服务端转发 API 时走内网地址
INTERNAL_API_ORIGIN=http://api:3001
```

如果你使用域名和 HTTPS，把上面的 `PUBLIC_WEB_BASE_URL` 和 `AUTH_OAUTH2_REDIRECT_URI` 改成域名版本。

## 4. 单端口对外方案

### 方案 A：直接只开放前端 3000 端口

适合先跑通：

```env
WEB_BIND_HOST=0.0.0.0
WEB_PORT=3000
```

此时外部访问地址是：

- `http://202.200.206.250:3000`

回调地址就是：

- `http://202.200.206.250:3000/login/callback`

### 方案 B：推荐，用 Nginx 只开放 80/443

项目内的 `docker-compose.yml` 仍然让 `api` 只监听 `127.0.0.1:3001`，`web` 监听 `127.0.0.1:3000`。  
Nginx 对外开放 `80/443`，再把所有请求转发给 `web:3000` 即可。

因为 `web` 已经内置了对 `/api/v1` 和 `/api/docs` 的服务端转发，所以 Nginx 不需要再单独暴露后端端口。

对应回调地址：

- `http://202.200.206.250/login/callback`
- 或 `https://你的域名/login/callback`

## 4.1 关于“自动同意授权”

应用侧只能控制“何时跳到统一认证”，不能跨域替统一认证页面点击“同意授权”。

如果你希望用户在统一认证登录完成后不再看到授权确认页，必须由统一认证平台侧配置，例如：

- 把当前应用配置为受信任应用
- 让该 `client_id` 对申请的 `scope` 走免确认策略
- 或让统一认证平台本身支持并开启自动授权

当前项目代码和仓库内提供的接入文档里，都没有可由本系统单方面开启的“自动同意授权”参数。

## 5. Nginx 示例

示例文件见：

- [deploy/nginx/uniflow-single-port.conf](/root/BPM_Agent/deploy/nginx/uniflow-single-port.conf)

核心思路就是只把公网流量交给前端服务：

```nginx
server {
    listen 80;
    server_name 202.200.206.250;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 6. 用户和角色怎么映射

统一认证返回用户后，系统会：

1. 优先在默认租户里按 `username`
2. 或 `oaUserId`
3. 或邮箱

查找现有用户。

如果找到了，就沿用原来的角色。  
如果没找到，就自动创建一个新用户，默认角色是 `user`。

如果你希望某些统一认证用户直接拥有管理员权限，可以配置：

```env
AUTH_OAUTH2_ADMIN_USERNAMES=zhangsan,admin
AUTH_OAUTH2_ADMIN_USER_IDS=20230001
AUTH_OAUTH2_FLOW_MANAGER_USERNAMES=lisi
AUTH_OAUTH2_FLOW_MANAGER_USER_IDS=20230002
```

### 已存在账号和首次登录账号的区别

- 如果统一认证账号已经在本地 `users` 表里存在，系统会沿用该账号已有的 `roles`
- 如果统一认证账号是第一次登录，系统会自动创建本地用户，默认角色是 `user`
- 只有命中上面的环境变量映射时，首次创建用户才会自动补 `flow_manager` 或 `admin`

### 登录后权限从哪里来

- 统一认证负责“你是谁”
- 本系统本地 `users.roles` 负责“你能做什么”
- 登录成功后，后端会把 `userId`、`tenantId`、`roles`、`username`、`displayName` 一起签进本系统 `auth_session`
- 前端通过 `/api/v1/auth/me` 获取当前会话对应的账号和角色，并据此控制菜单、页面和接口访问

### 如果要给指定账号管理员权限

1. 对于“首次登录、还没在本地建档”的账号，直接配置：

```env
AUTH_OAUTH2_ADMIN_USERNAMES=zhangsan,admin
AUTH_OAUTH2_ADMIN_USER_IDS=20230001
```

2. 对于“已经在本地存在”的账号，直接更新数据库 `users.roles`，然后让该用户重新登录。

PostgreSQL 示例：

```sql
UPDATE users
SET roles = '["admin","flow_manager","user"]'::jsonb
WHERE username = 'zhangsan';
```

## 7. 你现在最该填的值

如果你准备按“服务器 IP + Nginx + 单端口”部署，给统一认证平台的回调地址就填：

```text
http://202.200.206.250/login/callback
```

如果你暂时不配 Nginx，只直接开放前端 3000 端口，就填：

```text
http://202.200.206.250:3000/login/callback
```
