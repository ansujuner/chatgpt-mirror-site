# ChatGPT 镜像站

一个用 React + Vite 实现的 ChatGPT 镜像站，包含未登录界面，以及根据当前 Session 自动切换的 Free、Plus、Pro 响应式首页。项目接入本地 Python bridge：未登录请求使用匿名 Web Mobile 协议；Session 登录后使用该账号的认证会话协议。前端不保存上游 Cookie、access token、Sentinel、Turnstile 或 PoW 令牌。

公网静态演示：<https://ansujuner.github.io/>。GitHub Pages 版本使用匿名 Mock 对话；Session 登录、真实历史记录、账号设置和上游聊天仍需要部署 Python bridge，且不会把任何 Session 或令牌写入静态站点。

完整同源版本可以使用仓库根目录的 `render.yaml` 和 `Dockerfile` 部署到 Render：

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ansujuner/ansujuner.github.io)

Render 服务会在同一个 HTTPS Origin 提供前端和 `/api/*`，因此 Session 登录、HttpOnly Cookie、Codex 额度及设置接口可以按生产边界工作。首次免费实例休眠或每次重新部署都会清空仅存于进程内存的 Session，需要重新登录。

## 功能

- Free / Plus / Pro 三种账号首页（桌面 / 移动端）与未登录界面
- 根据账号权益动态加载模型、默认模型、禁用能力和套餐展示
- Free 的升级入口，以及 Plus / Pro 的模型、思考强度和 Work 模式界面
- Session 登录、切换、断开和账号级会话隔离，以及真实历史对话列表、详情和续聊
- Markdown / GFM 渲染、代码块和外部链接
- 真实匿名 / 认证请求、SSE 返回与停止生成
- 基于不透明本地会话 ID 的多轮上下文；上游 conversation id 不暴露给浏览器
- Session Cookie 的服务端内存保存、短期 access token 刷新和失效清理
- 认证账号图片 / 文件上传、处理与正式消息引用（默认 10 个、单个 25 MiB、合计 50 MiB）
- 可显式切换回纯本地 mock 模式

## 运行

需要 Node.js 20+、Python 3.11+ 和系统可执行的 `node` 命令。

```powershell
npm install
python -m pip install -r server/requirements.txt
npm run dev
```

`npm run dev` 同时启动：

- Vite：`http://localhost:5173`
- 本地 account bridge：`http://127.0.0.1:8787`

为了不在修改 Python 文件时清空仅保存在后端内存中的 Session，account bridge
默认不开启 Uvicorn 自动重载。只在确实需要调试后端时显式启用：

```powershell
$env:CHATGPT_DEV_RELOAD = '1'
npm run dev
```

启用后，每次后端 reload 都需要重新验证 Session。

### 局域网与公网部署

局域网测试直接运行 `npm run dev:lan`；该命令只公开前端端口，Python bridge
默认仍保持在回环地址。完整的局域网验证、防火墙、HTTPS 反向代理、Cookie、Origin
白名单和健康检查配置见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
```

## 请求流程

### 未登录

服务端不复用 HAR 中过期的静态请求头，而是每轮动态执行：

1. 读取根页中的 Worker、Document Affinity 和 OAI Session ID。
2. 调用 Sentinel prepare，在本地运行 Turnstile DX VM 并求解 PoW。
3. 调用 Sentinel finalize 获取单轮 requirements grant。
4. 获取新 Conduit token，再向 `conversation/updates` 发送提示。
5. 检查 DPU 内部 `complete` / `failed` 状态，提取回答并转成 OpenAI-compatible SSE。

上游可能在 HTTP 200 内返回 DPU 失败状态，桥接会识别该状态并为每次重试刷新 requirements 和 conduit，默认最多 3 次。

### Session 登录后

1. 服务端从 `HttpOnly` 本地句柄解析内存中的账号凭据，并在需要时刷新短期 access token。
2. 调用认证 Sentinel prepare / finalize，并完成 Turnstile / PoW 要求。
3. 调用认证 conversation prepare，再提交账号会话请求。
4. 解码 compact SSE v1（同时兼容 legacy SSE），保存 parent message 和 conversation state。
5. 将结果转换成前端使用的 OpenAI-compatible SSE；认证失败不会静默回退到 guest。

带附件时，服务端会先创建上游文件条目，再按返回策略完成 Azure/AWS 单次上传、
Estuary 表单上传或 Azure block multipart，等待 `process_upload_stream` 完成后才把
清洗后的文件引用写入正式 user message。签名上传 URL、上游文件 ID 和凭据不会返回浏览器；
未登录请求携带附件会明确返回 403，而不是静默忽略。

## API

```http
POST /api/chat/completions
Content-Type: application/json
Accept: text/event-stream
X-Conversation-Id: <续轮时使用响应头中的值>
```

```json
{
  "model": "gpt-5-6-thinking",
  "messages": [{"role": "user", "content": "你好"}],
  "reasoning_effort": "extended",
  "service_tier": "priority",
  "stream": true
}
```

首轮响应会同时返回 `X-Conversation-Id` 和 `X-Chat-Conversation-Id`；续轮只需回传其一。会话映射只存在当前 bridge 进程内存中。

## 开发命令

```powershell
npm run lint
npm run typecheck
npm run build
npm run bridge       # 只启动 Python bridge
npm run dev:web      # 只启动 Vite
```

如只需测试界面，复制 `.env.example` 为 `.env.local` 并设置 `VITE_CHAT_API_MODE=mock`。

## 主要目录

```text
src/                         React 前端
src/free-home/               当前免费账号首页组件与像素级样式
server/app.py                FastAPI / SSE 适配层
server/account_settings.py   按账号持久化本地设置、严格校验与 revision
server/upstream_settings.py  ChatGPT 设置端点适配、capability 与动态 catalog
server/model_preferences.py  普通 Chat 模型与思考强度偏好桥接
server/auth_session.py       Session 验证、套餐识别、Token 刷新与能力快照
server/authenticated_protocol.py
                             认证 Sentinel、会话提交、SSE v1 解码与续聊
server/authenticated_files.py
                             认证文件上传、处理流与消息引用映射
server/protocol.py           匿名协议、PoW、DPU 解析与重试
server/protocol_turnstile_vm.mjs
                             Turnstile DX 本地执行器
artifacts/                   抓包、报告与验证 POC
reference-captures/free-account-2026-08-31/
                             当前构建资源、运行时结构和下载校验
qa/capture-local-home.mjs    桌面 / 移动端 CDP 截图与布局校验
```

## Session 登录接口

Session 只会发到本机 Python bridge，并保存在当前进程内存中；浏览器仅得到随机的
`HttpOnly` 本地会话句柄。服务端不会把上游 Cookie、access token 或 session token
写入日志、磁盘、`localStorage`，也不会在 API 响应中返回这些值。

支持输入完整 Cookie header、`Bearer <access token>`、裸 session cookie 值，或从
chatgpt.com 上游 `/api/auth/session` 复制的 Session JSON（不是本项目同名的只读摘要接口）。完整 Cookie header 最稳定；上游 Cookie 名称
可能随版本变化。

```http
POST /api/auth/session-login
Content-Type: application/json

{"session":"Cookie: <name>=<value>; ..."}
```

```http
GET /api/auth/session
GET /api/account/runtime
POST /api/auth/logout
DELETE /api/auth/session
```

### Google / Apple / 电话 / Email / Session 登录

登录页使用 OpenAI 官方托管的 browser OAuth/PKCE。Google 和 Apple 通过官方
`connection` 直接进入对应提供商；Email 需要邮箱 `loginHint`，电话需要 E.164
格式（例如 `+8613800138000`）。密码、短信验证码和第三方凭据始终只提交给
`auth.openai.com`，本地接口不接收这些字段。

登录弹窗和通用登录页同时提供第五个“使用 Session 登录”入口。Session 只通过
`POST /api/auth/session-login` 提交，随后前端必须再调用 `GET /api/auth/session`
二次确认 HttpOnly 本地会话中的账号和套餐后才切换界面；原始 Session 不进入网址、
`localStorage`、`sessionStorage` 或前端日志。

```http
POST /api/auth/login/start
Content-Type: application/json

{"provider":"google","callbackPath":"/"}
{"provider":"email","callbackPath":"/","loginHint":"name@example.com"}
{"provider":"phone","callbackPath":"/","loginHint":"+8613800138000"}
```

成功创建流程后返回一次性的 `flowId` 和 `authorizationUrl`。浏览器完成官方授权
时会回到固定的 `http://localhost:1455/auth/callback`。本地 loopback listener 禁用
访问日志，直接把授权码放入当前进程的短期内存流程；授权码和 state 不会进入
Vite/Uvicorn URL 或日志。主窗口轮询：

```http
GET  /api/auth/login/<flowId>/status
POST /api/auth/login/<flowId>/complete
Content-Type: application/json

{}

DELETE /api/auth/login/<flowId>
```

`complete` 在收到回调前返回 `202 pending`；收到后只允许一次 PKCE code exchange，
并通过 `/backend-api/me` 和 accounts/check 验证账号及所选工作区。验证成功才创建现有
`replica_account_session` HttpOnly Cookie。OAuth access/refresh/id token、PKCE verifier
和 authorization code 均只保存在服务进程内存中，永不返回浏览器或写入磁盘。
每个 flow 另有独立、最小 Path、SameSite=Strict 的 HttpOnly 绑定 Cookie；因此访问日志中的
`flowId` 本身不能完成或劫持登录，成功后 flow 与绑定 Cookie 会一次性销毁。
本机端口 `1455` 必须可用；被其他程序占用时 start 会明确返回 503。

### 账户设置接口

设置页只通过本地 bridge 访问当前 `replica_account_session` 所绑定的账号：

```http
GET /api/account/settings

PATCH /api/account/settings
Content-Type: application/json

{
  "changes": {
    "general": {"theme": "dark"},
    "notifications": {"<catalog-category-id>": "both"},
    "voice": {"language": "zh-CN", "model": "live", "name": "<catalog-voice-id>"}
  },
  "revision": 3
}
```

`GET` 会把账号级本地设置与当前 ChatGPT Web 设置合并，返回 `settings`、本地
`revision`、`updatedAt`、逐路径的 `capabilities`、动态 `options`，以及可选的
`warnings`。前端只有在对应 `capabilities[path].writable === true` 时才启用真实写入控件；
不能把静态默认值当作账号状态。`PATCH` 是部分更新，`revision` 用于本地设置的乐观并发控制；
冲突返回 409，前端重新 `GET` 后再提交。上游专属设置不会仅为了制造 revision 而写入本地数据库。

设置写入要求已登录、同源请求、`application/json`，请求体上限为 32 KiB。上游 401 会清除
失效的本地登录和 Cookie；403、功能不可用或需要独立流程的错误不会销毁仍有效的 Session。

设置来源不是同一种：

| 类型 | 当前实现 |
| --- | --- |
| 本地镜像站设置 | 主题、用量图表的显示筛选和键盘快捷键，按账号摘要键保存到本地 SQLite。 |
| 本地并同步上游 | 界面语言保留本地值，同时写入账号 locale。 |
| 可直接同步的 ChatGPT 设置 | 对比度、强调色、听写、个性化、动态通知、语音、数据控制、云浏览器默认权限、部分高级安全项和构建者姓名显示等；是否可写以实时 capability 为准。 |
| 必须使用独立流程 | 自动充值、敏感内容保护、Authenticator/SMS MFA，以及账单、付款方式、取消套餐、密码/通行密钥、活跃会话、存储管理、账号删除、数据导出/删除、家长控制和受信任联系人等。镜像站目前不会伪造成功，也不会把这些操作改成本地布尔值。 |

通知类别不是硬编码清单。bridge 从当前账号的
`/backend-api/notifications/settings` 读取类别、展示文本和实际存在的 `push` / `email`
通道，只向浏览器返回经过清洗的 `id`、`label`、`description`、`channels`。写入前会重新读取
catalog，并使用上游返回的 option name 构造通知 PATCH；未知类别或不存在的通道不会发送。

语音列表同样从 `/backend-api/settings/voices` 动态读取，并随语音语言及模式刷新。浏览器只会收到
`id`、`label`、`description`，不会收到预览 URL、增益、颜色或上游额外字段。选择语音时，bridge
先应用语言/模式，再用刷新后的 catalog 验证 voice id 后写入；catalog 不可用时，界面可显示静态
占位选项，但相关写入控件保持禁用。这些 `/backend-api/*` 路径是 ChatGPT Web 当前使用的内部协议，
不是稳定的公开 API。

### Chat 模型偏好与 Work 隔离

普通 Chat 页最后使用的模型和思考强度由独立接口管理，不混入通用设置 PATCH：

```http
GET /api/account/model-preference

PATCH /api/account/model-preference
Content-Type: application/json

{"modelSlug":"<runtime-model-slug>","thinkingEffort":"extended"}
```

`thinkingEffort` 可省略；允许值为 `min`、`standard`、`extended`、`xhigh`、`max`。
该接口只读取 `/backend-api/settings/user` 中普通 Chat 的
`last_used_model_config.slugs.web/default` 与 `juices.web/default`，写入使用
`/backend-api/settings/user_last_used_model_config`。它不读写 Work/TPP 的选择，也不保存
`service_tier`。

Chat 与 Work 的运行时模型来源也保持隔离：Chat 模型来自 `/backend-api/models`，Work 模型来自
`/backend-api/tpp/models/`，两者由 `GET /api/account/runtime` 分别作为 `runtime.chat` 和
`runtime.work` 返回。切换 Work 只更新 Work 界面的选择并使用 Work runtime 模型发送消息；不会把
Work 的模型或滑动条值写进普通 Chat 的 model-preference。切回 Chat 时仍使用 Chat 自己的偏好。

### 历史对话接口

登录后，前端通过本地桥接接口读取当前账号的真实历史记录：

```http
GET /api/conversations?cursor=<opaque-cursor>&limit=28
GET /api/conversations/<opaque-history-id>
```

列表接口返回经过白名单清洗的 `id`、`title`、`createdAt`、`updatedAt` 和
`nextCursor`。详情接口返回同样经过清洗的对话摘要、可见的 user / assistant
消息，以及一个 `continuationId`。将该 `continuationId` 放入现有聊天接口的
`X-Conversation-Id` 请求头即可从真实 `current_node` 继续对话。

浏览器看到的 `hist-*`、`hcur-*`、`msg-*` 和 `authconv-*` 均为随机本地句柄；
上游 conversation id、message id、`current_node`、项目 ID、Cookie、access token
及上游签名请求头不会写入响应。列表支持上游 offset/limit 分页；详情支持当前
paginated conversation/messages 协议，并为仍使用 full-conversation 协议的账号
保留兼容路径。上游 401 只刷新一次；403 不会销毁仍然有效的本地登录。切换账号、
退出、Session 过期或淘汰时，会同时清理历史绑定和凭据会话。

### Codex 实时额度接口

```http
GET /api/codex/analytics
```

该接口要求浏览器已经通过主页面完成 Session 授权，并携带本地不透明的
`replica_account_session` `HttpOnly` Cookie。前端不会直接保存或向该接口提交上游
Cookie / access token；后端根据本地会话句柄读取当前账号在进程内存中的凭据，再请求当前 ChatGPT Web 协议：

```text
GET https://chatgpt.com/backend-api/wham/usage
GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
GET https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown
```

工作区账号的近 30 天明细会改用
`/backend-api/wham/usage/daily-workspace-user-token-usage-breakdown`。请求包含
`start_date`、`end_date` 与 `group_by=day`，响应只白名单保留真实 credits、模型和产品界面分组；
不会把 credits 冒充 Token 数量。

`usage.summary.rangeCredits` 是这 30 天内已使用的内部额度，前端可再切成 7 天或自定义范围。
`usage.summary.apiEquivalentUsd`、每日 bucket、模型和界面的同名字段按当前标准速率
`25 credits ≈ US$1` 给出名义 API 等价估算，并在 `usage.pricing` 中携带计价日期、方法和
[官方 ChatGPT credit rate card](https://help.openai.com/en/articles/11481834) /
[官方 API pricing](https://developers.openai.com/api/docs/pricing) 来源。该金额不是 API 账单或现金价值；
明细端点没有 input / cached input / output Token 数，Fast / priority、长上下文和工具调用也会造成偏差。

额度窗口按响应中的 `limit_window_seconds` 识别，而不是依赖 `primary_window` / `secondary_window`
的固定顺序：Plus 常见的 `18000` 秒对应 5 小时窗口，`604800` 秒对应周窗口。剩余百分比按
`clamp(round(100 - used_percent), 0, 100)` 计算。

本地接口只返回经过白名单清洗的套餐、限额状态、窗口用量 / 重置时间、credits、个人工作区
spend control、可用重置次数和日用量；不会透传
access token、Cookie、用户 ID、账号 ID、邮箱或上游原始响应中的其他身份字段。该 WHAM 地址是
ChatGPT Web 当前使用的内部端点，并非稳定的公开 API；上游结构变化时需要同步更新适配层。
缺失百分比、可用额度或可选明细接口失败时，字段保持 `null` / `availability: "unavailable"`，
绝不会用 `0` 或 `100` 伪造“额度用完”。401 只刷新一次 Cookie 支持的短期 Token；缓存绑定到当前
本地 Session/账号，默认 30 秒，不会跨账号复用。

登录成功只返回经过验证的公开账号摘要，例如：

```json
{
  "authenticated": true,
  "user": {
    "id": "account-id",
    "userId": "user-id",
    "name": "name",
    "email": "name@example.test",
    "initials": "N",
    "plan": "free",
    "planLabel": "免费版"
  }
}
```

`GET /api/account/runtime` 返回经过白名单清洗的模型、默认模型、套餐能力和禁用功能，
前端据此更新 Free / Plus / Pro 界面。Session 登录后的聊天走认证账号协议并支持续聊；
历史列表和详情实时读取当前登录账号的上游数据，只向浏览器返回经过清洗的本地 DTO
与不透明续聊句柄，不落盘或伪造历史内容。
