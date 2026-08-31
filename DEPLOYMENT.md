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
New-NetFirewallRule -DisplayName 'ChatGPT Replica LAN 5173' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Private
```

测试结束后可删除该规则：

```powershell
Remove-NetFirewallRule -DisplayName 'ChatGPT Replica LAN 5173'
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
