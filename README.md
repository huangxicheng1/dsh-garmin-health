# Garmin 健康面板 · DeepSeek Harness 插件

左侧面板列表里的 Garmin Connect 看板（和「插件 / 上下文洞察 / MCP 连接器」同一列）：
心率、HRV、Body Battery / 压力、睡眠结构、步数、训练负荷、最近运动。
服务端直接调用 Garmin Connect REST API，**不走 MCP**，复用本机已有的 Garmin token，
因此可以定时刷新、自定义图表、离线缓存。

```
┌────────────────────────── Browser (Client) ──────────────────────────┐
│ sidebar.panellist  ── 左栏入口「Garmin 健康」（图标行）                 │
│ main (key)         ── 整页看板（自绘 SVG 图表）                        │
│ settings.section   ── 设置页：token / 间隔 / 中国区 / 范围 / 卡片 / 主色 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ fetch('/api/dsh-garmin/data?days=7')
┌───────────────────────────────▼──────────── Host (Node) ─────────────┐
│ ctx.connection.fetch  ── /api/dsh-garmin/data · /settings            │
│ Garmin API client     ── DI token + Bearer，401 自动 refresh          │
│ ~/.dsh/garmin-cache   ── 按 source×date 缓存，增量刷新                 │
│ poller                ── 默认 5 分钟预热缓存                          │
└─────────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
garmin-health/
├─ package.json              # main / exports / dsh.bundle.patch / dsh.client
├─ cordis.patch.yml          # insert 一行 garmin-health，挂载 Host 插件
├─ icon.svg                  # 插件图标（原始绘制）
├─ locale/
│  ├─ zh.json                # Plugin Manager 标题与描述
│  └─ en.json
├─ lib/
│  ├─ index.js               # Host：token 读取/续期、Garmin API、归一化、缓存、定时器、HTTP 路由
│  └─ client.js              # Client：ModuleLoader 包，左栏入口 + 整页看板 + 设置页
└─ scripts/
   └─ smoke.mjs              # 用真实 token 跑一次端到端取数（不打印 token）
```

## 关键实现

### Token（只在服务端）

- 读取顺序：配置 `tokenPath` → `$GARMINTOKENS` → `~/.garminconnect/garmin_tokens.json`。
- 支持 garminconnect 当前的 DI 格式：`di_token` / `di_refresh_token` / `di_client_id`。
- JWT `exp` 提前 15 分钟视为过期，用 `POST https://diauth.<domain>/di-oauth2-service/oauth/token`
  （`grant_type=refresh_token`）续期；刷新结果只保存在进程内存，**不回写**你的 token 文件。
- 请求头与服务端走 Garmin APP 通道：`GCM-Android-5.23`、`X-Garmin-User-Agent`、`X-App-Ver`、
  `X-GCExperience: GC5`、`Authorization: Bearer …`。
- 401 时自动刷新并重试一次；刷新失败返回 `auth.state = expired` 与中文重登提示，不会静默失败。
- 中国区：`garmin.cn` / `connectapi.garmin.cn` / `diauth.garmin.cn`；`.com` 刷新遇到
  `invalid_grant … doesn't exist in DB` 时自动改用 `.cn` 并标记 `region: garmin.cn`。

### 指标与端点

| 面板卡片 | 端点 |
|---|---|
| 24 小时心率 | `/wellness-service/wellness/dailyHeartRate/{displayName}?date=` |
| HRV | `/hrv-service/hrv/{date}`、`/hrv-service/hrv/daily/{start}/{end}` |
| 压力 | `/wellness-service/wellness/dailyStress/{date}` |
| Body Battery | `/wellness-service/wellness/bodyBattery/reports/daily?startDate&endDate` |
| 睡眠 | `/wellness-service/wellness/dailySleepData?date&nonSleepBufferMinutes=60` |
| 步数 | `/usersummary-service/stats/steps/daily/{start}/{end}` |
| 每日摘要（静息心率/目标） | `/usersummary-service/v2/dailysummaries?startDate&endDate` |
| 训练状态 / 负荷 | `/metrics-service/metrics/trainingstatus/aggregated/{date}`、`…/weekly/{displayName}` |
| 最近运动 | `/activitylist-service/activities/search/activities?start=0&limit=8` |

任一指标失败只影响自己的卡片，错误写进响应里的 `warnings`；鉴权失败才整体中止。

### 缓存与刷新

- 目录：`~/.dsh/garmin-cache/<kind>-<domain>-<date>.json`（原子写，失败忽略）。
- TTL：今天的数据 = 轮询间隔；历史数据 = 6 小时；`force=1`（面板「刷新」）绕过 TTL。
- 请求失败时回退到上一次成功的缓存（`stale` 标记）。
- Host 每 `pollMinutes` 分钟预热默认范围；Client 自己按同一间隔静默刷新当前范围。

### 路由

```
GET  /api/dsh-garmin/data?days=1|7|30[&force=1]   → 归一化 JSON
GET  /api/dsh-garmin/settings                    → { settings, cacheDir }
POST /api/dsh-garmin/settings                    → 保存并立即生效
```

注册在 `ctx.get('connection').fetch`，继承浏览器登录态；路径必须精确为 `/api/...`（否则 Host 会报
`invalid exact Fetch route`）。响应不含 token，只含派生指标。

## 安装

### 从 GitHub 装到另一台电脑（推荐）

```powershell
# 1. 装进 desktop profile（Electron 托管的 profile 目录）
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add github:huangxicheng1/dsh-garmin-health

# 2. 让 profile 选中这个 bundle：编辑 profiles\desktop\cordis.patch.yml，末尾追加
# - id: garmin-health
#   name: 'dsh-garmin-health'
#   config:
#     pollMinutes: 5
#     chinaRegion: true
#     defaultDays: 7
#     tokenPath: '%LOCALAPPDATA%/dsh-plugin-garmin-connect/accounts'   # 按需

# 3. 重启 DSH（Electron 主进程会重新 compose profile）
```

`%LOCALAPPDATA%` / `${VAR}` / `~` 都会被展开，所以配置不用写死用户名。

### 本机（开发时）

托管安装做的是同样的事（profile 里 `pnpm add` + 记一条 bundle 选择），
用 `plugin_manager` 能避免手改 `package.json` 与 Electron 的 profile 失配：

```jsonc
// plugin_manager action=install_bundle, target=<插件目录或 git spec>
```

**本地目录安装的等价步骤**：

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add "D:\deepseek\Garmin\garmin-health"
# 然后同上，追加 patch 行并重启
```

> 运行中的 Host 也可以 `plugin_manager action=set_plugin target=include:garmin-health enabled=false` 再 `enabled=true`
> 热重载，无需重启；Client 代码会随插件重载自动更新。

## 使用

1. 左侧栏「插件 / 插件市场 / 自动化任务…」那一列里点 **Garmin 健康**，主区域就切换成看板。
2. 顶部徽章：今日步数、静息心率、睡眠评分、Body Battery、训练状态、HRV 均值。
3. 时间范围：今天 / 近 7 天 / 近 30 天；「刷新」强制拉取。
4. 设置 → **Garmin 健康**：token 文件、轮询间隔、中国区账号、默认范围、显示哪些卡片、主题色（跟随主题或四种强调色）。

## 账号与登录

插件本身不登录，它读的是**已有的 token 文件**。支持三种格式，按文件内容自动识别：

| 来源 | 文件 | 形状 |
|---|---|---|
| python-garminconnect / garmin_mcp | `~/.garminconnect/garmin_tokens.json` | `{ di_token, di_refresh_token, di_client_id }` |
| dsh-plugin-garmin-connect | `%LOCALAPPDATA%\dsh-plugin-garmin-connect\accounts\*.session.json` | `{ kind, clientId, tokens: { accessToken, refreshToken, accessExpiresAtMs } }` |
| garth 旧格式 | 任意 `*.json` | `{ oauth2_token: { access_token, refresh_token, expires_at } }` |

`tokenPath` 可以是**文件**，也可以是**目录**：给目录时优先 `garmin_tokens.json`，否则取最新写入的 `*.session.json`，
这样另一个插件自己刷新 token 后，这里能直接读到新值（本插件不回写 token 文件）。

默认 `tokenPath` 指向 `dsh-plugin-garmin-connect` 的 accounts 目录，所以面板显示的是那个插件已登录账号的数据；
如果那个账号没有设备数据、而你的 `garmin_mcp` token 才有数据，把设置页「Token 文件」留空（回到 `~/.garminconnect`），
或者直接填你自己的 token 路径即可。

> 一个账号可能没有任何已注册设备（Garmin 侧返回空数组），这时面板会显示「已连接，但账号里还没有数据」——
> 换到有设备数据的账号，或在手机 Garmin Connect 同步一次即可。

要换账号登录，取决于你用哪条认证链：

- **garmin_mcp**：装好后运行 `garmin-mcp-auth --is-cn`（国内账号），或 `GARMIN_MCP_IS_CN` 环境变量；
  交互完成后 token 写到 `~/.garminconnect`。
- **dsh-plugin-garmin-connect**：在该插件的账号设置里重新授权，session 文件会更新到上面那个目录。

## 安全

- token 只在 Host 进程读取，只用于出站请求；HTTP 响应、日志、Client 代码都不含 token。
- 缓存与 `settings.json` 写入 `~/.dsh/garmin-cache/`，文件模式 `0600`。
- 路由挂在连接层的认证之后，未登录请求返回 401。

## 排错

| 现象 | 处理 |
|---|---|
| 「需要重新登录 Garmin」 | 终端运行 `garmin-mcp-auth --force-reauth`，再点刷新 |
| 提示账号属于中国区 | 设置里打开「Garmin 中国区账号」，或重新登录 |
| 「已连接，但账号里还没有数据」 | 该 token 对应账号在 Garmin 侧没有已同步设备；在手机 Garmin Connect 同步，或对真正有数据的账号重新登录 |
| 面板里 401 | 刷新页面重新建立浏览器会话 |
| 想换 token 文件 | 设置页「Token 文件」填文件或目录；或 `cordis.patch.yml` 的 `config.tokenPath` |

## 已验证 / 未验证

- 已验证（本机 desktop profile，插件 `fiberPhase: active`）：
  - token 读取、过期 token 自动续期（`exp: 2026-10-18` → 刷新成功）；
  - 中国区自动识别：`.com` 刷新返回 `invalid_grant … doesn't exist in DB` → 自动切到 `garmin.cn` 成功；
  - 账号切换：`tokenPath` 指向 `dsh-plugin-garmin-connect` 的 session 目录后，读到该账号的真实数据
    （心率 50 点、步数 228/3180、Body Battery 62、训练状态 DETRAINING、8 条运动、7 天负荷），缓存同步重建；
  - 各端点取数与归一化、缓存落盘（删掉缓存文件后重载插件，10 秒内被重建）；
  - `/api/dsh-garmin/*` 路由注册成功（未登录返回 401，不再报 `invalid exact Fetch route`）；
  - Client 侧 `main`（key=`garmin-health`）、`sidebar.panellist`（id=`garmin-health`）、
    `settings.section` 三处注册均为 active。
- 未验证 / 已知空数据：
  - 图表的实际像素渲染仍需你在页面上确认（本会话没有浏览器控制能力）；
  - 睡眠与 HRV 两张卡片为空：该账号的设备不上报这两类数据（最近一次运动在 9 月）。
