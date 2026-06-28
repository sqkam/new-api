# SQKAM Branch — 自定义功能说明

> 最后更新: 2026-06-28（首次调用过期：未调用时强制 expired_time=-1）
> 当前基准: `sqkam` 已合并至 `origin/main` commit `d10fc762`
> 最新 main: `origin/main` commit `d10fc762`
> 同步状态: 2026-06-27 已执行 `git fetch origin main` 和 `git merge origin/main`；冲突文件为 `docker-compose.yml`、`makefile`、`web/classic/bun.lock`。`docker-compose.yml` 保留 sqkam 精简版（SQLite + redis + `sqkam/new-api` 镜像 + IPv6 网络）；`makefile` 保留 sqkam 的 build/docker 目标与 `sqkam/new-api` 镜像名，接入 main 的共享 `web` workspace 安装方式；`web/classic/bun.lock` 按 main 删除（已迁移到共享 `web/bun.lock`）。
> 历史状态: `sqkamold` 的提交已完整并入 `sqkam`，本地 `sqkamold` 分支已删除。

---

## 功能总览

sqkam 分支在原有项目基础上新增了以下功能，**在后续合并 main 或其他分支时，请确保这些功能被保留**。

### 1. API Key 级限流 (Token Rate Limiting)

**核心文件:**

| 文件 | 说明 |
|------|------|
| `middleware/token-rate-limit.go` | **新增** — 每令牌（per-token）限流中间件 |
| `model/token.go` | 新增限流、首次调用过期、Token 用量限制相关字段 |
| `router/relay-router.go` | relay-v1 和 relay-gemini 路由注册了 `TokenRateLimit()` 中间件 |

**Token 模型新增字段（需在后续数据库迁移中保留）:**

| 字段 | 类型 | 说明 |
|------|------|------|
| `rate_limit_enabled` | bool | 是否启用限流 |
| `rate_limit_total` | int | 周期内总请求次数限制（0=不限制） |
| `rate_limit_success` | int | 周期内成功请求次数限制（0=不限制） |
| `rate_limit_period` | int | 限流周期（秒） |
| `expired_from_first_call` | bool | 过期时间从首次调用起算 |
| `expired_duration` | int | 首次调用后有效时长（秒） |
| `first_call_time` | int64 | 首次成功调用时间戳，0=未激活（2026-06-28 新增） |
| `used_token_count` | int | 已使用 Token 总数（prompt + completion） |
| `token_count_limit` | int | Token 使用总量限制（0=不限制） |

**限流中间件特性:**
- 支持 **Redis** 和 **内存** 两种模式（自动切换）
- 同时统计 `total`（总请求）和 `success`（成功请求）两个维度的限流
- 限流超限时返回 HTTP 429，JSON body 包含 `limit`/`remaining`/`reset_at` 信息
- **注意**: `common/constants.go` 中可能有限流相关常量，合并时检查

### 2. 限流信息展示 (Rate Limit Status)

**新增 API 端点:**

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/token/:id/rate-limit-status` | GET | 查询单令牌的当前限流使用情况 |
| `/api/token/batch/rate-limit-status` | POST | 批量查询令牌限流状态 |

**前端文件（位于 `web/classic/src/`）:**

| 文件 | 说明 |
|------|------|
| `components/table/tokens/modals/EditTokenModal.jsx` | 新增"限流设置"面板（总调用次数、成功次数、周期快捷设置） |
| `components/table/tokens/TokensColumnDefs.jsx` | 令牌列表新增限流/用量列 |
| `helpers/token.js` | **新增** — 令牌相关工具函数（147 行） |
| `hooks/tokens/useTokensData.jsx` | 获取并展示令牌限流数据 |

### 3. 首次调用开始算过期时间 (Expire From First Call)

- **`first_call_time` 是令牌的基础属性**：无论是否开启 `expired_from_first_call`，只要令牌首次成功调用（HTTP < 400）就记录时间戳（0=未调用过）。这样用户后续从"固定过期时间"切换到"首次调用过期"时，已有锚点可直接复用，无需等待下一次调用
- **首次调用时间记录独立中间件** `RecordFirstCallTime`（`middleware/first-call-time.go`）：挂在所有 relay 路由的 `TokenAuth` 之后，**不依赖限流开关或首次调用过期开关**，对所有令牌无条件执行
- 开启 `expired_from_first_call` 后，`expired_time` 从 `first_call_time + expired_duration` 计算
- 首次成功调用时：
  - 若开启 `expired_from_first_call` 且 `expired_duration>0`：原子写入 `first_call_time=now` + `expired_time=now+expired_duration`（`SetTokenFirstCallAndExpiration`）
  - 否则：只写 `first_call_time=now`（`SetTokenFirstCallTime`），`expired_time` 不动
- 后续成功调用检测到 `first_call_time>0` 直接返回，两个字段都不再变动
- **续费/切换逻辑**（`UpdateToken`）：
  - 开启 `expired_from_first_call` 且令牌已被调用过（`first_call_time>0`）+ `expired_duration>0` → 重算 `expired_time = first_call_time + expired_duration`（覆盖续费和模式切换两种场景）
  - 开启 `expired_from_first_call` 但令牌未被调用过（`first_call_time==0`）→ **强制 `expired_time = -1`（永不过期）**，忽略表单残留的过期时间，等首次成功调用时由 `RecordFirstCallTime` 激活
  - 关闭 `expired_from_first_call` → `expired_time` 用表单填写的时间戳（固定过期模式）
- `first_call_time` 永远不被客户端输入覆盖（`UpdateToken` 不赋值，`Update()` Select 列表包含但不接受外部值）
- 前端编辑令牌时可切换"过期时间"和"首次调用后生效"两种模式
- 开启此模式时，`expired_duration` 设置有效时长（秒），提供一天/一周/一个月快捷按钮

**关键文件与函数（2026-06-28 重构后）:**
- `middleware/first-call-time.go` — **新增**，`RecordFirstCallTime()` 独立中间件，无条件记录首次调用时间，开启首次调用过期时一并激活 `expired_time`
- `model.SetTokenFirstCallAndExpiration(tokenId, firstCallTime, expiredTime)` — 同时写两个字段
- `model.SetTokenFirstCallTime(tokenId, firstCallTime)` — **新增**，只写 `first_call_time`，不动 `expired_time`
- `controller.UpdateToken` — 续费/模式切换重算逻辑
- `middleware.SetupContextForToken` — 把 `first_call_time` 写入 context
- `middleware/token-rate-limit.go` — 已移除 `handleFirstCallExpiration`（职责转移到 `RecordFirstCallTime`），限流中间件只做限流计数

**路由注册（`RecordFirstCallTime` 挂载点）:**
- `router/relay-router.go`: `relayV1Router`、`relayGeminiRouter`、`relaySunoRouter`、`relayMjRouter`（均挂在 `TokenAuth` 之后）
- `router/video-router.go`: `videoV1Router`、`klingV1Router`、`jimengOfficialGroup`

### 4. API Key Token 用量限制 (Token Count Limit)

- `used_token_count` 记录 API Key 已消耗 Token 总数（prompt + completion）
- `token_count_limit` 设置单个 API Key 的 Token 总量上限，0 表示不限制
- 消耗日志记录阶段会累加 `used_token_count`，即使消费日志关闭也会执行
- 超过 `token_count_limit` 后，令牌会按耗尽逻辑处理
- 前端令牌列表展示 Token 用量，并提供重置已用 Token 数的入口

### 5. 编辑令牌字段透传（防配置清零）

**问题背景:** 2026-06-28 修复。前端 `web/default/` 的 API Key 编辑表单（`api-keys-mutate-drawer.tsx`）没有 `rate_limit_*` / `token_count_limit` / `expired_from_first_call` / `expired_duration` 的 UI 控件，但后端 `UpdateToken` 无条件用前端传值覆盖这些字段 → 编辑一次就会把限流/数量限制/首次调用配置全部清零。

**修复方案（前端透传，不补 UI）:**

| 文件 | 说明 |
|------|------|
| `web/default/src/features/keys/types.ts` | `apiKeySchema` 和 `ApiKeyFormData` 补全 `rate_limit_*` / `token_count_limit` / `expired_from_first_call` / `expired_duration` / `first_call_time` 可选字段（用于透传） |
| `web/default/src/features/keys/components/api-keys-mutate-drawer.tsx` | 用 `fetchedTokenRef` 缓存 `getApiKey` 拿到的完整 DB 数据；`onSubmit` 编辑分支把透传字段从缓存合并回 payload，确保原值回传不被零值覆盖 |

**行为:** 编辑令牌任意字段时，限流配置、Token 数量限制、首次调用过期配置全部保留；`first_call_time` 后端永远保留不覆盖。

**注意:** 这是 `web/default/`（React 19 + shadcn）的修复。`web/classic/`（React 18 + Semi Design）的 `EditTokenModal.jsx` 本身有完整的限流/首次调用 UI，不受此问题影响。

### 6. 前端 Dashboard Token 图表

**新增图表（位于 Dashboard 调用趋势 Tab 右侧）:**

| 图表 | 说明 |
|------|------|
| Token 消耗趋势（堆叠柱状图） | 按模型展示 Token 消耗随时间变化 |
| Token 消耗排行（柱状图） | 各模型 Token 消耗量排行（前 N + 其他） |

**涉及文件:**

| 文件 | 说明 |
|------|------|
| `web/classic/src/hooks/dashboard/useDashboardCharts.jsx` | 新增 `spec_token_line` / `spec_token_rank_bar` 图表规格 |
| `web/classic/src/components/dashboard/ChartsPanel.jsx` | 新增"Token消耗趋势"/"Token消耗排行"两个 Tab |
| `web/classic/src/components/dashboard/index.jsx` | 透传 `spec_token_line` / `spec_token_rank_bar` |
| `web/classic/src/helpers/dashboard.jsx` | 聚合数据增加 `tokens` 字段 |

### 7. 构建系统增强

**`makefile`:** 新增 `build`、`build-backend`、`docker-image`、`container-image`、`docker`、`clean` 目标

#### `container-image` 目标（macOS Container 构建）

使用 macOS 原生 `container` CLI（而非 Docker）构建并推送镜像，适用于在 macOS 上无 Docker Desktop 环境下发布到 Docker Hub。

```bash
make container-image
# 等价于:
# container build --platform linux/amd64 . -t sqkam/new-api
# container image push sqkam/new-api
```

**依赖:**
- macOS 26+ 内置的 `container` CLI（`/usr/local/bin/container`）
- 已执行 `container registry login docker.io -u <user>` 登录 Docker Hub

**与 `docker-image` 的区别:**

| 目标 | 工具 | 构建引擎 | 适用场景 |
|------|------|----------|----------|
| `docker-image` | `docker` | Docker Desktop / daemon | Linux/CI 环境，已有 Docker |
| `container-image` | `container` | macOS 原生容器框架 | macOS 无 Docker Desktop，利用系统原生容器 |

两者产物一致（均推送至 `$(DOCKER_IMAGE)` = `sqkam/new-api`），共享 `PLATFORM` 变量控制目标架构。

### 8. Docker 相关修改

**`Dockerfile`:** 使用多阶段构建（合并后已采用 main 的版本）
**`docker-compose.yml`:** 配置调整

---

## 后续合并 main 的注意事项

### 需要保留的代码片段

#### `controller/token.go`
- `GetTokenRateLimitStatus` 函数
- `BatchGetTokenRateLimitStatus` 函数
- `ResetTokenUsedCount` 函数
- `AddToken` 中新增的限流字段赋值

#### `model/token.go`
- Token 结构体中的自定义字段：`RateLimitEnabled`, `RateLimitTotal`, `RateLimitSuccess`, `RateLimitPeriod`, `ExpiredFromFirstCall`, `ExpiredDuration`, `FirstCallTime`, `UsedTokenCount`, `TokenCountLimit`
- `Update()` 中限流字段的 `Select` 列表（含 `first_call_time`）
- `IncrementTokenUsedCount` 函数
- `ResetTokenUsedTokenCount` 函数
- `SetTokenFirstCallAndExpiration` 函数（原 `SetTokenExpiredTime`，2026-06-28 改名并增加 `first_call_time` 写入）
- `SetTokenFirstCallTime` 函数（2026-06-28 新增，只写 `first_call_time` 不动 `expired_time`）
- `CacheDeleteToken` 函数（导出）

#### `controller/token.go`
- `UpdateToken` 中首次调用过期重算逻辑：开启 `ExpiredFromFirstCall` 时，已调用过（`FirstCallTime>0` + `ExpiredDuration>0`）则 `ExpiredTime = FirstCallTime + ExpiredDuration`；未调用过则强制 `ExpiredTime = -1`；关闭时用表单值

#### `middleware/auth.go`
- `SetupContextForToken` 中设置限流、首次调用过期、Token 用量限制相关 Context Key（含 `token_first_call_time`）

#### `middleware/first-call-time.go`
- **完整文件**（2026-06-28 新增，不在 main 中）— `RecordFirstCallTime()` 独立中间件，无条件记录首次调用时间，开启首次调用过期时一并激活 `expired_time`

#### `middleware/token-rate-limit.go`
- **完整文件**（这是新增文件，不在 main 中）
- 注意：`handleFirstCallExpiration` 已于 2026-06-28 移除，职责转移到 `RecordFirstCallTime`；此文件现在只做限流计数

#### `router/relay-router.go`
- `TokenRateLimit()` 中间件注册（relay-v1 和 relay-gemini）
- `RecordFirstCallTime()` 中间件注册（relay-v1、relay-gemini、relay-suno、relay-mj，均挂在 `TokenAuth` 之后）

#### `router/video-router.go`
- `RecordFirstCallTime()` 中间件注册（video-v1、kling、jimeng，均挂在 `TokenAuth` 之后）

#### `router/api-router.go`
- `GET /:id/rate-limit-status` 路由
- `POST /batch/rate-limit-status` 路由
- `POST /:id/reset_used_count` 路由

### 前端文件合并注意事项

sqkam 分支的前端基于 `web/classic/`（React 18 + Semi Design），**不是** `web/default/`（React 19 + shadcn）。

在合并 main 时：
1. **`web/classic/`** 中的前端变更需要保留（EditTokenModal 限流面板、Dashboard Token 图表等）
2. **`web/default/`** 中的字段透传修复（2026-06-28）需要保留：`features/keys/types.ts` 的 `apiKeySchema`/`ApiKeyFormData` 透传字段、`features/keys/components/api-keys-mutate-drawer.tsx` 的 `fetchedTokenRef` 与 `onSubmit` 合并逻辑
3. **i18n 翻译文件**：sqkam 的 i18n 修改已全部包含在 main 的翻译文件中（main 的翻译更完整），合并时直接用 main 的版本
4. 2026-05-20 确认最新 `origin/main` 已在 `sqkam` 中，无新增冲突。

### 冲突高发区域

| 文件 | 冲突风险 | 原因 |
|------|----------|------|
| `model/token.go` | **高** | Token 结构体和 Update() 方法 |
| `controller/token.go` | **高** | 新增的限流 API 端点、UpdateToken 续费/模式切换重算 |
| `middleware/token-rate-limit.go` | **低** | 仅 sqkam 有（不存在的文件不会冲突） |
| `middleware/first-call-time.go` | **低** | 仅 sqkam 有（2026-06-28 新增） |
| `middleware/auth.go` | **中** | `SetupContextForToken` 的 Context Key |
| `router/relay-router.go` | **中** | 中间件注册顺序（含 `RecordFirstCallTime`） |
| `router/video-router.go` | **中** | `RecordFirstCallTime` 注册（2026-06-28 新增） |
| `router/api-router.go` | **中** | API 路由注册 |
| `web/classic/.../EditTokenModal.jsx` | **高** | 前端 Token 编辑表单 |
| `web/classic/.../useDashboardCharts.jsx` | **中** | Dashboard 图表规格 |
| `web/default/src/features/keys/types.ts` | **中** | apiKeySchema 透传字段（2026-06-28） |
| `web/default/src/features/keys/components/api-keys-mutate-drawer.tsx` | **中** | fetchedTokenRef 透传逻辑（2026-06-28） |

---

## 快速验证清单

合并 main 后，用以下命令验证功能完整性：

```bash
# 后端
rg -n "RateLimitEnabled|RateLimitTotal|RateLimitSuccess|RateLimitPeriod|ExpiredFromFirstCall|ExpiredDuration|FirstCallTime|UsedTokenCount|TokenCountLimit" model/token.go
rg -c "GetTokenRateLimitStatus" controller/token.go  # 应 >= 2
rg -n "SetTokenFirstCallAndExpiration" model/token.go  # 应存在
rg -n "SetTokenFirstCallTime" model/token.go  # 应存在（2026-06-28 新增）
rg -n "token_first_call_time" middleware/auth.go  # 应存在
test -f middleware/first-call-time.go  # 应存在（2026-06-28 新增）
rg -c "RecordFirstCallTime" middleware/first-call-time.go  # 应 >= 1
rg -c "handleFirstCallExpiration" middleware/token-rate-limit.go  # 应 = 0（2026-06-28 已移除）
test -f middleware/token-rate-limit.go        # 应存在
rg -c "TokenRateLimit" router/relay-router.go # 应 >= 2
rg -c "RecordFirstCallTime" router/relay-router.go  # 应 >= 4（relay-v1/gemini/suno/mj）
rg -c "RecordFirstCallTime" router/video-router.go  # 应 >= 3（video/kling/jimeng）

# 前端
rg -c "rate_limit" web/classic/src/components/table/tokens/modals/EditTokenModal.jsx  # 应 >= 18
rg -c "spec_token" web/classic/src/hooks/dashboard/useDashboardCharts.jsx  # 应 >= 4
test -f web/classic/src/helpers/token.js     # 应存在
rg -c "fetchedTokenRef" web/default/src/features/keys/components/api-keys-mutate-drawer.tsx  # 应 >= 2（2026-06-28 后）
rg -c "rate_limit_enabled" web/default/src/features/keys/types.ts  # 应 >= 2（2026-06-28 后）
```
