# SQKAM Branch — 自定义功能说明

> 最后更新: 2026-05-20
> 当前基准: `sqkam` 已合并至 `origin/main` commit `2d1ca153`
> 最新 main: `origin/main` commit `2d1ca153`
> 同步状态: 2026-05-20 已执行 `git fetch origin main` 和 `git merge origin/main`；本次 `makefile` 有冲突，已合并保留 sqkam 的 build/docker/launchd 目标，并接入 main 的 dev compose/reset-setup 目标。
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

- 令牌过期策略：开启 `expired_from_first_call` 后，`expired_time` 从第一次成功 API 调用开始计算
- 在请求成功（HTTP < 400）后自动更新数据库中的 `expired_time`
- 前端编辑令牌时可切换"过期时间"和"首次调用后生效"两种模式
- 开启此模式时，`expired_duration` 设置有效时长（秒），提供一天/一周/一个月快捷按钮

### 4. API Key Token 用量限制 (Token Count Limit)

- `used_token_count` 记录 API Key 已消耗 Token 总数（prompt + completion）
- `token_count_limit` 设置单个 API Key 的 Token 总量上限，0 表示不限制
- 消耗日志记录阶段会累加 `used_token_count`，即使消费日志关闭也会执行
- 超过 `token_count_limit` 后，令牌会按耗尽逻辑处理
- 前端令牌列表展示 Token 用量，并提供重置已用 Token 数的入口

### 5. 前端 Dashboard Token 图表

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

### 6. 构建系统增强

**`makefile`:** 新增 `build`、`build-backend`、`docker-image`、`docker`、`clean` 目标

### 7. Docker 相关修改

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
- Token 结构体中的自定义字段：`RateLimitEnabled`, `RateLimitTotal`, `RateLimitSuccess`, `RateLimitPeriod`, `ExpiredFromFirstCall`, `ExpiredDuration`, `UsedTokenCount`, `TokenCountLimit`
- `Update()` 中限流字段的 `Select` 列表
- `IncrementTokenUsedCount` 函数
- `ResetTokenUsedTokenCount` 函数
- `SetTokenExpiredTime` 函数
- `CacheDeleteToken` 函数（导出）

#### `middleware/auth.go`
- `SetupContextForToken` 中设置限流、首次调用过期、Token 用量限制相关 Context Key

#### `middleware/token-rate-limit.go`
- **完整文件**（这是新增文件，不在 main 中）

#### `router/relay-router.go`
- `TokenRateLimit()` 中间件注册（relay-v1 和 relay-gemini）

#### `router/api-router.go`
- `GET /:id/rate-limit-status` 路由
- `POST /batch/rate-limit-status` 路由
- `POST /:id/reset_used_count` 路由

### 前端文件合并注意事项

sqkam 分支的前端基于 `web/classic/`（React 18 + Semi Design），**不是** `web/default/`（React 19 + shadcn）。

在合并 main 时：
1. **`web/classic/`** 中的前端变更需要保留（EditTokenModal 限流面板、Dashboard Token 图表等）
2. **`web/default/`** 中的同类功能如需保持同步，需要额外移植（sqkam 未修改 `web/default/`）
3. **i18n 翻译文件**：sqkam 的 i18n 修改已全部包含在 main 的翻译文件中（main 的翻译更完整），合并时直接用 main 的版本
4. 2026-05-20 确认最新 `origin/main` 已在 `sqkam` 中，无新增冲突。

### 冲突高发区域

| 文件 | 冲突风险 | 原因 |
|------|----------|------|
| `model/token.go` | **高** | Token 结构体和 Update() 方法 |
| `controller/token.go` | **高** | 新增的限流 API 端点 |
| `middleware/token-rate-limit.go` | **低** | 仅 sqkam 有（不存在的文件不会冲突） |
| `router/relay-router.go` | **中** | 中间件注册顺序 |
| `router/api-router.go` | **中** | API 路由注册 |
| `web/classic/.../EditTokenModal.jsx` | **高** | 前端 Token 编辑表单 |
| `web/classic/.../useDashboardCharts.jsx` | **中** | Dashboard 图表规格 |

---

## 快速验证清单

合并 main 后，用以下命令验证功能完整性：

```bash
# 后端
rg -n "RateLimitEnabled|RateLimitTotal|RateLimitSuccess|RateLimitPeriod|ExpiredFromFirstCall|ExpiredDuration|UsedTokenCount|TokenCountLimit" model/token.go
rg -c "GetTokenRateLimitStatus" controller/token.go  # 应 >= 2
test -f middleware/token-rate-limit.go        # 应存在
rg -c "TokenRateLimit" router/relay-router.go # 应 >= 2

# 前端
rg -c "rate_limit" web/classic/src/components/table/tokens/modals/EditTokenModal.jsx  # 应 >= 18
rg -c "spec_token" web/classic/src/hooks/dashboard/useDashboardCharts.jsx  # 应 >= 4
test -f web/classic/src/helpers/token.js     # 应存在
```
