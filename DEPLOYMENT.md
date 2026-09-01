# 部署指南

前端所有账号、设置、历史记录和对话请求都使用同源 `/api/*`。推荐只公开一个
HTTPS 域名，由反向代理提供 `dist/` 静态文件并把 `/api/*` 转发到仅监听
`127.0.0.1:8787` 的 Python bridge。

## 局域网试运行

```powershell
npm run dev:lan
```

该命令默认：

- Vite 监听 `0.0.0.0:5173`，供局域网设备访问。
- Python bridge 仍只监听 `127.0.0.1:8787`，由 Vite 同源代理 `/api/*`。
- 不启用 Python 自动重载，避免清空仅保存在进程内存中的 Session。

启动输出会列出可访问地址。也可以手动查看：

```powershell
Get-NetIPConfiguration | Where-Object IPv4Address |
  Select-Object -ExpandProperty IPv4Address
```

然后从同一局域网的另一台设备打开：

```text
http://<本机局域网IP>:5173
http://<本机局域网IP>:5173/api/health/ready
```

局域网 IP 通常由路由器动态分配，重新联网后可能变化；以启动输出为准。

如果其他设备连接超时，请先确认 Windows 网络配置为“专用网络”。仍被防火墙阻止时，
可在管理员 PowerShell 中只放行专用网络的前端端口：

```powershell
New-NetFirewallRule -DisplayName 'ChatGPT Mirror Site LAN 5173' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Private
```

测试结束后可删除该规则：

```powershell
Remove-NetFirewallRule -DisplayName 'ChatGPT Mirror Site LAN 5173'
```

### 自定义监听端口

```powershell
$env:CHATGPT_WEB_HOST = '0.0.0.0'
$env:CHATGPT_WEB_PORT = '5173'
$env:CHATGPT_BRIDGE_HOST = '127.0.0.1'
$env:CHATGPT_BRIDGE_PORT = '8787'
npm run dev:lan
```

只有确实需要让其他程序直接访问 bridge 时，才把
`CHATGPT_BRIDGE_HOST` 改为 `0.0.0.0`；浏览器页面不需要这样做。

## 公网部署

### Hostless 单服务部署（推荐）

仓库根目录提供 `Dockerfile`、`hostless.yaml` 和 `deploy/container-entrypoint.sh`：

- 使用 Node 24 构建 Vite 前端。
- 在运行时保留 Node 24 和 Python 3.11，满足 bridge 的协议运行依赖。
- 由 Caddy 在平台注入的 `PORT` 上提供 `dist/`，并把 `/api/*` 转发到容器内仅监听回环地址的单 worker Python bridge。
- 在 Hostless 控制台固定单副本，并把 CPU / 内存保持在账号共享免费额度内，避免进程内 Session、Cookie jar 和会话映射被分散到不同实例。
- 使用 `/api/health/live` 做平台滚动部署的 HTTP 存活检查；上线后再用 `/api/health/ready` 验证本地运行依赖。

在 [Hostless](https://www.hostless.cloud/apps) 使用 GitHub 登录，创建 App 时选择：

```text
Repository: ansujuner/chatgpt-mirror-site
Branch: main
Build system: Docker
Dockerfile: ./Dockerfile
```

`hostless.yaml` 已声明 Docker 构建、单副本资源和健康检查。不要再创建 worker 或数据库；Hostless 免费的 `1 vCPU / 1 GiB` 是账号共享总额，不是每个资源各一份。

首次部署可以依靠同源 Host 和可信 Caddy 转发自动计算外部 HTTPS Origin。应用获得 `*.hostless.app` 域名后，在 Hostless 的 Environment Variables 中补充以下非秘密配置并重新部署：

```text
CHATGPT_AUTH_COOKIE_SECURE=true
CHATGPT_AUTH_COOKIE_SAMESITE=strict
CHATGPT_AUTH_VERIFY_TLS=true
CHATGPT_BRIDGE_VERIFY_TLS=true
CHATGPT_BRIDGE_TRUSTED_PROXY_IPS=127.0.0.1
CHATGPT_BRIDGE_PUBLIC_ORIGIN=https://<app>.hostless.app
CHATGPT_BRIDGE_ALLOWED_ORIGINS=https://<app>.hostless.app
CHATGPT_BRIDGE_ALLOWED_HOSTS=<app>.hostless.app,127.0.0.1,localhost
```

部署成功后依次检查：

```text
https://<app>.hostless.app/api/health/live
https://<app>.hostless.app/api/health/ready
https://<app>.hostless.app/api/auth/session
```

前两个地址应返回 JSON；Session 摘要接口在未登录时也应返回 JSON，而不能是静态站的 HTML 404/405。随后还必须实际验证一次匿名请求、Session 登录和 SSE 流式对话，因为云端出口是否被上游接受、平台代理是否逐块转发 SSE 只能由运行时行为确认。

Hostless 的应用磁盘是临时盘；容器重启或重新部署会清空内存 Session、对话绑定，并可能清空本地 SQLite 设置。不要把 Session、Cookie、access token 或长期密钥写入 `hostless.yaml`、Docker build argument、`.env` 提交或 GitHub Actions。

### Render 单服务部署

仓库根目录提供 `Dockerfile`、`render.yaml` 和 `deploy/container-entrypoint.sh`。它们会：

- 使用 Node 24 构建 Vite 前端。
- 在运行时保留 Node 24 和 Python 3.11，满足 bridge 的协议运行依赖。
- 由 Caddy 在 Render 注入的 `PORT` 上提供 `dist/`，并把 `/api/*` 转发到容器内仅监听回环地址的单 worker Python bridge。
- 根据 Render 的 `RENDER_EXTERNAL_URL` 设置浏览器可见 HTTPS Origin，并使用 Secure、SameSite=Strict 的 HttpOnly Session Cookie。

点击 README 中的 **Deploy to Render**，登录 Render 并审核 Blueprint 后即可创建免费单实例服务。部署成功后先检查：

```text
https://<service>.onrender.com/api/health/live
https://<service>.onrender.com/api/health/ready
https://<service>.onrender.com/api/auth/session
```

前两个地址应返回 JSON；Session 摘要接口在未登录时也应返回 JSON，而不能是静态站的 HTML 404/405。免费实例休眠、容器重启或重新部署会清空内存中的 Session 和对话绑定。

添加 Render 自定义域名后，必须把以下变量改成浏览器实际访问的唯一规范域名，然后重新部署：

```text
CHATGPT_BRIDGE_PUBLIC_ORIGIN=https://chat.example.com
CHATGPT_BRIDGE_ALLOWED_ORIGINS=https://chat.example.com
CHATGPT_BRIDGE_ALLOWED_HOSTS=chat.example.com
```

不要把 Session、Cookie、access token 或任何长期密钥写入 Blueprint、Docker build argument 或 GitHub Actions。

GitHub Pages 不支持 Python 后端，不能用于完整版本。仓库中的 GitHub Actions 只执行前后端测试和生产构建；真正的常驻进程由 Render 从 `ansujuner/chatgpt-mirror-site` 的 `main` 分支构建。首次创建 Blueprint 时必须在 Render 登录并连接 GitHub，之后只有 GitHub CI 通过的提交才会自动部署。

公网容器构建会设置 `VITE_HOSTED_SESSION_ONLY=true`。这是有意的：当前第三方 OAuth 使用固定 loopback 回调 `http://localhost:1455/auth/callback`，该地址在公网浏览器中指向访问者自己的电脑，而不是 Render 容器。托管版因此只提供 Session 登录；不要通过删除 loopback 校验来伪装成已支持公网 OAuth。

免费实例适合验证但不是无状态限制之外的生产保证：空闲休眠、重启或重新部署都会清空内存 Session、对话映射、历史游标和本地 SQLite 设置。若需要长期在线和持久化，需要升级运行实例，并把状态迁移到持久磁盘或外部数据库；仅添加磁盘也不会自动持久化当前的内存 Session。

### 1. 构建前端

```powershell
npm ci
python -m pip install -r server/requirements.txt
npm run build
```

构建产物位于 `dist/`。

### 2. 启动单进程 bridge

以下是同域 HTTPS 反向代理的推荐配置边界：

```powershell
$env:CHATGPT_BRIDGE_HOST = '127.0.0.1'
$env:CHATGPT_BRIDGE_PORT = '8787'
$env:CHATGPT_BRIDGE_PUBLIC_ORIGIN = 'https://chat.example.com'
$env:CHATGPT_BRIDGE_ALLOWED_ORIGINS = 'https://chat.example.com'
$env:CHATGPT_BRIDGE_ALLOWED_HOSTS = 'chat.example.com,127.0.0.1'
$env:CHATGPT_BRIDGE_TRUSTED_PROXY_IPS = '127.0.0.1'
$env:CHATGPT_AUTH_COOKIE_SECURE = 'true'
$env:CHATGPT_AUTH_COOKIE_SAMESITE = 'strict'
python -m server
```

不要把 `CHATGPT_BRIDGE_TRUSTED_PROXY_IPS` 设置为 `*`。如果反向代理在容器或另一台
主机上，只填写它实际连接 bridge 时使用的 IP 或网段。

当前 Session、对话绑定和凭据注册表保存在单个 Python 进程内存中，因此只能使用
一个 worker。重启 bridge 会让所有浏览器重新验证 Session；在增加共享 Session 存储
或负载均衡粘性会话前，不要启动多个 bridge 副本。

### 3. 配置 HTTPS 反向代理

`deploy/Caddyfile.example` 可直接作为入口模板。修改域名和 `dist` 的绝对路径后启动
Caddy。它会：

- 自动终止 HTTPS。
- 提供前端静态文件和 SPA fallback。
- 将 `/api/*` 转发到 `127.0.0.1:8787`。
- 关闭响应缓冲，保持 SSE 对话流实时输出。

不要直接把 Vite 开发服务器用于公网生产环境，也不要绕过 HTTPS 传输 Session。

## 健康检查

```text
GET /api/health/live   # 进程存活，不检查运行依赖
GET /api/health/ready  # Node/协议依赖就绪状态；未就绪返回 503
GET /api/health        # ready 的兼容别名
```

## 分离前后端域名

推荐同域部署。如果必须让 `https://chat.example.com` 直连
`https://api.example.com`：

- `CHATGPT_BRIDGE_ALLOWED_ORIGINS` 必须精确包含前端 Origin，禁止 `*`。
- 设置 `CHATGPT_AUTH_COOKIE_SAMESITE=none`，此模式会强制 Secure Cookie。
- 前端请求必须保留 `credentials: include`。
- `CHATGPT_BRIDGE_ALLOWED_HOSTS` 应只包含实际 API Host。
