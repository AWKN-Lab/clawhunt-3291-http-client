# ACCEPTANCE-EVIDENCE.md

#3291 最小样品验收证据。每个任务书要点 → 测试名 → 真实输出 → 文件路径。
全部测试用可控 fetch 桩，不真实联网；数据全部虚构。

## 运行结果总览

- Vitest：`./node_modules/.bin/vitest run` → **7 个文件，54/54 通过，Duration 3.68s**，
  退出码 0。原始日志：`evidence/vitest-20261126-ac4.log`（AC4 整改后重跑；上一轮日志
  `evidence/vitest-20261126.log` 为 53/53，保留为历史）。
- typecheck：`./node_modules/.bin/tsc --noEmit -p tsconfig.json` → 无报错，退出码 0。
- gen:api：`pnpm gen:api`（openapi-typescript 7.13.0）从 `examples/openapi.json`
  生成 `src/generated/api.ts`（3 个操作：listSpaces / getSpace / createLead）；
  校验 `node scripts/verify-gen-api.mjs` → OK，退出码 0。
  原始日志：`evidence/gen-api-check-20261126.log`。
- 变异自证：`node scripts/mutation-check.mjs` → **PASS**。
  A 相原配置 53/53（退出 0）；B 相临时副本 MAX_RETRIES 2→1，**4 失败 / 49 通过**
  （退出 1）；C 相恢复原配置 53/53（退出 0）；仓库内 `src/config.ts` SHA256 变异前后
  一致（`4af5f1d03a6400c9b98b31d3a93038d1147663d9d8fc91fed0c016f6f1b501db`）。
  有效日志：`evidence/mutation-check-20261126-rerun.log`。
  （第一份日志 `evidence/mutation-check-20261126.log` 为历史记录：B 相 5 红，
  其中 gen-api 一项是变异脚本临时副本未拷 `examples/` 导致的文件缺失红，非真实变异敏感；
  已修脚本并重跑存新日志，旧日志未改写。）
- MANIFEST：`sha256sum -c MANIFEST` 全过（30 项；不含 MANIFEST 自身与
  evidence/*.log——MANIFEST 无法校验自己，日志每次运行都会再生）。
- 一键自测：`./setup.sh` → **退出码 0**，安装、typecheck、Vitest、gen:api 校验、
  MANIFEST 核验全部通过；本次运行（AC4 整改后）Vitest 54/54（7 个文件，Duration 3.74s）。
  原始日志：`evidence/selftest-setup-sh-20261126.log`。
  **如实记录：**本次运行中 `pnpm install` 失败，setup.sh 按设计回退 `npm ci`（119 个包，7 秒）
  后继续并全过；pnpm install 在本机时好时坏，回退路径是设计内行为，不是绕过。
  上一轮自测日志存为 `evidence/selftest-setup-sh-20261126-r1.log`（历史记录，未改写）。
  另有一份失败日志 `evidence/selftest-setup-sh-20261126-fail1.log`（历史记录）：
  首次运行因 setup.sh 用 `node` 直接执行 `.bin/tsc`（shell 包装脚本）报 SyntaxError，
  已修为真实 JS 入口（`node_modules/typescript/bin/tsc`、`node_modules/vitest/vitest.mjs`），
  重跑存新日志，旧日志未改写。
- CI：推送后补运行号（见下「CI」一节）。

## 逐点证据

### 1. 基础地址读运行时配置 apiBase；自动附加 Authorization、X-Request-Id（UUID v4）、X-Site-Id

- 测试：`tests/http.test.ts` > `request() 基础行为` > 「成功解包：HTTP 200 + code 0 → data」、
  「自动附加 Authorization、X-Request-Id（UUID v4）、X-Site-Id」、
  「X-Request-Id 调用方不可覆盖（每次唯一）」、
  「无 token 时不发 Authorization；未配 siteId 时不发 X-Site-Id」。
- 输出：4 项全部通过（见 vitest 日志）。
- 文件：`src/services/http.ts`（fetchOnce）、`src/config.ts`（setRuntimeConfig）、
  `src/auth.ts`（getToken）。

### 2. 默认超时 15 秒（AbortController），超时抛 TimeoutError

- 测试：`tests/http.test.ts` > `request() 超时与取消` > 「默认超时 15 秒」、
  「超时 50ms → 抛 TimeoutError 且不重试」；`tests/config.test.ts` > 「默认超时 15 秒」。
- 输出：3 项全部通过。超时测试用 `createPendingFetchStub`（挂起桩）+ 短超时注入，
  不真实等 15 秒；默认值由常量断言覆盖。
- 文件：`src/services/http.ts`（AbortController + `__setDelayImpl` 测试注入点）、
  `src/config.ts`（DEFAULT_TIMEOUT_MS = 15000）、`src/errors.ts`（TimeoutError）。

### 3. GET 可标记 cancelOnNavigate，路由切换时自动取消

- 测试：`tests/http.test.ts` > `request() 超时与取消` >
  「cancelOnNavigate：路由切换取消请求，抛 CANCELLED」「未标记 cancelOnNavigate 的请求不受路由切换影响」、
  「取消后注册清理干净」。
- 输出：3 项全部通过。
- 文件：`src/services/http.ts`（registerNavigable）、`src/navigation.ts`（notifyNavigation）。

### 4. 重试：仅 GET 的网络错误与 502、503、504，最多 2 次，退避 300ms × 2^n

- 测试：`tests/http.test.ts` > `request() 重试：仅 GET、网络错误与 502/503/504、最多 2 次、退避 300ms×2^n`
  （6 项）：「GET 网络错误重试 2 次后抛错；退避记录为 [300, 600]；共发 3 次」、
  「GET 503 两次后成功：第 3 次返回即返回 data」、「GET 502、504 各重试；HTTP 500 不重试」、
  「POST、PUT、DELETE 不重试」、「HTTP 503 配业务码 0 仍重试（业务码不参与重试决策）」、
  「HTTP 200 配业务码 500 不重试」。
- 测试：`tests/config.test.ts` > 「最多重试 2 次」「退避间隔 300ms × 2^n：[300, 600]」。
- 输出：8 项全部通过；退避实测记录 `[300, 600]`。
- 文件：`src/services/http.ts`（isRetryable + request 循环）、`src/config.ts`
  （MAX_RETRIES = 2、RETRY_DELAYS_MS = [300, 600]）。

### 5. POST、PUT、DELETE 不自动重试

- 测试：同第 4 点「POST、PUT、DELETE 不重试」（各方法 503 均只发 1 次）。
- 输出：通过。
- 文件：`src/services/http.ts`（重试条件含 `method === 'GET'`）。

### 6. 错误归一为 ApiError（status、code、message、detail、requestId），后端错误体 {code, message, detail}

- 测试：`tests/http.test.ts` > 「业务错误：HTTP 200 + code 非 0 → 抛 ApiError」、
  「HTTP 404 → ApiError（status=404）」、「非 JSON 响应体 → ApiError（code=HTTP_STATUS）」；
  `tests/errors.test.ts` > 「ApiError 字段齐全」「错误文案表 ≥8 条且每条有中文提示」
  （实际 17 条 + CANCELLED）。
- 输出：全部通过。
- 文件：`src/errors.ts`（ApiError、ERROR_MESSAGES、getErrorMessage）、`src/services/http.ts`
  （fetchOnce 解析）。

### 7. 401 交给登录态模块刷新一次后重放；第二次仍 401 则清登录态并回首页

- 测试：`tests/http.test.ts` > `request() 401 处理` >
  「401 刷新一次后重放：第二次返回成功」「第二次仍 401：清登录态 + 回首页 + 抛错」。
- 输出：2 项全部通过。
- 文件：`src/services/http.ts`（401 分支）、`src/auth.ts`（refreshAuth / clearLogin / goHome）。
- **诚实说明：本轮刷新流程是桩。**`refreshAuth` 默认直接 resolve，可注入真实刷新函数
  （`setRefreshHandler`）；`goHome` 默认空操作，可注入（`setGoHomeHandler`）。
  未接真实登录模块，像 #2080 的 relogin stub 一样标注清楚。

### 8. 403 弹“无权限”提示且不跳转

- 测试：`tests/handlers.test.ts` > 「403 → onForbidden」「silent 时不触发任何回调」。
- 输出：2 项全部通过。
- 文件：`src/handlers.ts`（onForbidden 回调）、`src/services/http.ts`（403 分支）。
- **诚实说明：**回调默认是空操作，由宿主应用注入真实提示 UI；本样品只验证“触发回调且
  不导航”（request 内无任何跳转代码）。

### 9. 422 把 detail 转成字段错误映射 {字段名: 提示}，供表单显示

- 测试：`tests/handlers.test.ts` > 「422 → onValidationError，detail 转字段错误映射」；
  `tests/errors.test.ts` > 「extractFieldErrors：对象 detail / 数组 detail / 其他形状」。
- 输出：全部通过。
- 文件：`src/errors.ts`（extractFieldErrors）、`src/handlers.ts`、`src/services/http.ts`
  （422 分支）。
- **诚实说明：**映射逻辑真实；表单显示由宿主应用按映射渲染，本样品不含表单 UI。

### 10. 5xx 弹错误提示并提供“复制请求 ID”按钮

- 测试：`tests/handlers.test.ts` > 「5xx → onServerError，携带 requestId」；
  `tests/errors.test.ts` > 「copyRequestIdText：返回可复制的请求 ID 文本」。
- 输出：2 项全部通过。
- 文件：`src/handlers.ts`（onServerError 回调）、`src/errors.ts`（copyRequestIdText）、
  `src/services/http.ts`（5xx 分支）。
- **诚实说明：**回调携带 `requestId` 供宿主应用弹错并提供复制按钮；按钮 UI 本身由宿主实现。

### 11. 断网时顶部显示离线横幅，恢复后自动消失

- 测试：`tests/network.test.ts` > 「默认在线」「setOnlineStatus 通知订阅者」、
  「取消订阅后不再收到通知」。
- 输出：3 项全部通过。
- 文件：`src/network.ts`（isOnline / setOnlineStatus / subscribeOnlineStatus /
  bindWindowOnlineEvents）。
- **诚实说明：**本样品提供在线状态订阅 + window online/offline 事件绑定（真实逻辑，
  有测试）；**横幅 UI 本身不在本样品内**，由宿主页面据订阅状态显示/隐藏。
  request() 断网时不阻塞请求（任务书只要求横幅）。

### 12. TanStack Query：默认 staleTime 30 秒、重试策略一致、useApiQuery、useApiMutation

- 测试：`tests/query.test.tsx` > `createApiQueryClient 默认配置` >
  「staleTime 30 秒」「重试判定：网络错误与 502/503/504 可重试；500 与业务错误不可重试」、
  「retryDelay：attempt 0 → 300ms，attempt 1 → 600ms」、
  「retry：failureCount < 2 且可重试时才重试」；
  `useApiQuery / useApiMutation` > 「useApiQuery 成功：返回 data」、
  「useApiQuery 失败：error 是 ApiError（500 不重试，直接失败）」、
  「useApiMutation 成功：POST 带 JSON 体，返回 data」。
- 输出：7 项全部通过。
- 文件：`src/query.ts`（createApiQueryClient、useApiQuery、useApiMutation、isQueryRetryable）、
  `src/config.ts`（STALE_TIME_MS = 30000）。
- **诚实说明：**封装未接真实页面与真实后端；useApiQuery/useApiMutation 用 fetch 桩验证。

### 13. pnpm gen:api：openapi-typescript 从 OpenAPI JSON 生成类型，示例 schema 演示

- 测试：`tests/gen-api.test.ts` > 「examples/openapi.json 是合法的 OpenAPI 3 文档，含 3 个操作」、
  「src/generated/api.ts 已生成，含 paths 与示例 schema 类型」。
- 输出：2 项全部通过；生成命令 `pnpm gen:api` 真实跑过（openapi-typescript 7.13.0，
  64ms）；校验脚本 `scripts/verify-gen-api.mjs` 逐字节比对通过。
- 文件：`scripts/gen-api.*`（见 package.json scripts：gen:api / gen:api:check）、
  `examples/openapi.json`（虚构空间/线索接口）、`src/generated/api.ts`。

### 14. AC4：连续 100 个请求的 X-Request-Id 互不相同（任务书原文）

- 任务书原文（`task-3291-cli-show-20261126.json`，acceptance_criteria 第 4 条）：
  「连续 100 个请求的 X-Request-Id 互不相同（测试断言）」。
- 测试：`tests/http.test.ts` > `AC4：连续 100 个请求的 X-Request-Id 互不相同` >
  「连续发 100 个请求，100 个 X-Request-Id 全不相同且均为 UUID v4」。
- 输出：通过（verbose 运行显示该项 4ms）。测试走真实的 `request()` 调用路径，
  用现有 fetch 桩（`createFetchStub`，100 个 `okBody` 响应队列），不真实联网；
  收集 100 次请求头里的 X-Request-Id，断言 `new Set(ids).size === 100` 且每个值
  均匹配 UUID v4 正则。
- 文件：`tests/http.test.ts`（新增 describe 块，AC4 整改提交）。
- 说明：上一轮样品只有“每次唯一”的单次断言，没有 100 次连续断言，是 FORGE 对照
  任务书原文自查发现的缺口；本次只加测试，未改任何实现逻辑。

## 未验证项（诚实说明）

1. 401 刷新流程是桩（见第 7 点）：未接真实登录模块；刷新失败、token 失效边界只在桩层面验证。
2. 未接真实后端：全部请求走 fetch 桩；真实 apiBase、真实 401/5xx 响应未验证。
3. TanStack 封装未接真实页面：useApiQuery/useApiMutation 只在测试渲染器里验证。
4. 403/422/5xx 的提示 UI 与离线横幅 UI 由宿主应用实现，本样品只验证回调触发与状态订阅。
5. gen:api 只验证了示例 schema；真实业务 OpenAPI 文档未接入。
6. Alembic 迁移：本样品是纯前端请求层，无需迁移（无数据库表变更）。
7. CI：待推送后补运行号与结果。

## CI

- 工作流：`.github/workflows/ci.yml`（Node 24：安装 → typecheck → Vitest → gen:api 校验 →
  MANIFEST 核验）。
- 首次运行：**run 45760537639，job `check`，completed / success**，
  head `f97d705d`，https://github.com/AWKN-Lab/clawhunt-3291-http-client/actions/runs/45760537639。
  （CI 通过后，本文件补记运行号，MANIFEST 同步更新，见第二次提交。）
- 第二次运行：**run 45760676099，completed / success**，head `15106f7a`。
- AC4 整改提交：推送后补 run 号与结果（待 CI 在新 HEAD 上跑完 success 后再补记，见后续提交）。
