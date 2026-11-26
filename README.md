# clawhunt-3291-http-client

会员空间平台 · 工作台外壳：HTTP 请求层（错误码归一、请求追踪、超时与重试）。

最小可验证样品：统一请求客户端（fetch）+ 错误归一 + TanStack Query 封装 +
`pnpm gen:api` 类型生成。全部数据均为虚构，未接真实后端，未用买方真实历史文本。

## 快速开始

```bash
./setup.sh        # 一键自测：安装 → typecheck → Vitest → gen:api 校验 → MANIFEST 核验
```

或手动：

```bash
pnpm install      # 本机 pnpm 失败时回退 npm ci（见 setup.sh）
pnpm typecheck
pnpm test         # vitest run
pnpm gen:api      # 从 examples/openapi.json 生成 src/generated/api.ts
pnpm gen:api:check
```

## 结构

- `src/services/http.ts`：统一请求客户端 `request<T>`（fetch、AbortController 超时 15 秒、
  仅 GET 重试 2 次、退避 300ms × 2^n、401 刷新一次后重放、cancelOnNavigate）。
- `src/errors.ts`：`ApiError`（status/code/message/detail/requestId）、`TimeoutError`、
  错误文案表（17 条 + CANCELLED）、422 字段错误映射 `extractFieldErrors`。
- `src/config.ts`：运行时配置（apiBase、X-Site-Id）与常量（超时 15 秒、重试 2 次、
  退避 [300, 600]、staleTime 30 秒）。
- `src/auth.ts`：登录态模块（token 存取、`refreshAuth` 刷新桩、`clearLogin`、`goHome`）。
- `src/navigation.ts`：路由切换通知（cancelOnNavigate 的取消信号源）。
- `src/network.ts`：在线状态（订阅 + window online/offline 事件绑定）。
- `src/handlers.ts`：全局处理回调（403 / 422 / 5xx，silent 时不触发）。
- `src/query.ts`：TanStack Query 封装（staleTime 30 秒、重试策略与请求层一致、
  `useApiQuery`、`useApiMutation`）。
- `src/generated/api.ts`：`pnpm gen:api` 生成的类型（源自 `examples/openapi.json`）。
- `examples/openapi.json`：示例 OpenAPI schema（虚构空间 / 线索接口，3 个操作）。
- `scripts/verify-gen-api.mjs`：gen:api 校验（重新生成并逐字节比对）。
- `scripts/mutation-check.mjs`：变异自证（MAX_RETRIES 2→1 应变红，恢复后全绿）。
- `tests/`：Vitest 测试（fetch 桩，不真实联网）。
- `evidence/`：原始运行日志（Vitest、变异、自测；数字变了重跑存新日志，不改旧日志）。
- `MANIFEST`：SHA256 清单（`sha256sum -c` 全过；不含自身与 evidence 日志）。

## 行为要点（任务书原文落点）

- 基础地址读运行时配置 `apiBase`；自动附加 `Authorization`、每请求唯一 `X-Request-Id`
  （UUID v4，调用方不可覆盖）、当前空间 `X-Site-Id`。
- 默认超时 15 秒（AbortController），超时抛 `TimeoutError`，不重试。
- 重试仅对 GET 的网络错误与 502、503、504，最多 2 次，退避 300ms、600ms；
  POST、PUT、DELETE 不自动重试；HTTP 500 不重试；业务 code 不参与重试决策。
- 错误归一为 `ApiError`（status、code、message、detail、requestId），
  后端错误体约定 `{code, message, detail}`。
- 401 交给登录态模块刷新一次后重放；第二次仍 401 则清登录态并回首页。
  **本轮刷新流程是桩**（`src/auth.ts` 的 `refreshAuth`，默认直接 resolve；
  像 #2080 的 relogin stub 一样，标注清楚，未接真实登录模块）。
- 403 触发 `onForbidden`（宿主应用弹“无权限”提示，不跳转）；
  422 触发 `onValidationError`（detail 转字段错误映射 `{字段名: 提示}`）；
  5xx 触发 `onServerError`（宿主应用弹错，`requestId` 可复制）。
  回调默认是空操作，由宿主应用注入真实提示 UI；`silent: true` 时不触发。
- 断网：`src/network.ts` 提供在线状态订阅与 window 事件绑定，宿主据此显示/隐藏
  顶部离线横幅；**横幅 UI 本身不在本样品内**（由宿主页面接线）。
- TanStack Query：默认 `staleTime` 30 秒；重试策略与请求层一致
  （failureCount < 2 且网络错误/502/503/504 才重试；退避 300ms、600ms）。

## 复用说明

B 级改写复用 #2080 交付仓（`AWKN-Lab/clawhunt-2080-miniprogram-request`，main 580318fe）
的请求层逻辑：鉴权头、X-Request-Id、401 重放一次、仅 GET 重试、超时、错误码映射。
改动：wx.request → fetch、AbortController 超时 15 秒、ApiError（status/code/message/
detail/requestId）、422 字段映射、TanStack Query 封装、gen:api 脚本（新增）。
运行环境与错误模型不同，未盲目照抄，只复用了经得起测试的逻辑。

## 证据

见 `ACCEPTANCE-EVIDENCE.md`：每个任务书要点对应的测试名、真实输出、文件路径。
