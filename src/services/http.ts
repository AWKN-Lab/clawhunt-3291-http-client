// 统一请求客户端（#3291，基于 fetch）。
//
// 行为（按任务书，B 级复用 #2080 的重试判定与 401 流程；运行环境与错误模型不同）：
// - 基础地址读运行时配置 apiBase；
// - 自动附加 Authorization: Bearer <token>、每个请求唯一的 X-Request-Id（UUID v4）、
//   当前空间 X-Site-Id；X-Request-Id 由库自动生成，调用方传入同名 header 也会被覆盖；
// - 默认超时 15 秒（AbortController），超时抛 TimeoutError；
// - GET 请求可标记 cancelOnNavigate，路由切换时自动取消（抛 code=CANCELLED 的 ApiError）；
// - 统一解析响应体 { code, message, detail, data }：HTTP 2xx 且 code=0 返回 data，
//   否则抛 ApiError（status、code、message、detail、requestId）；
// - HTTP 401 时调登录态模块 refreshAuth() 后重放原请求一次，第二次仍 401 则清登录态并回首页；
// - 网络错误与 502、503、504 仅对 GET 最多重试 2 次（退避 300ms、600ms，即 300ms × 2^n），
//   POST、PUT、DELETE 不重试；HTTP 500 不重试；
//   重试决策只看 HTTP 状态码与网络错误，业务 code 不参与：HTTP 200 配业务码 500 不重试，
//   HTTP 503 配业务码 0 或字符串业务码仍重试；
// - 全局处理：403 调 onForbidden（“无权限”提示，不跳转）；422 调 onValidationError
//  （detail 转成的字段错误映射）；5xx 调 onServerError（提示里带 requestId，可复制）；
//   silent 模式下不调这些回调；
// - 断网横幅不在这里做：状态与订阅见 src/network.ts。

import { getApiBase, getSiteId, DEFAULT_TIMEOUT_MS, MAX_RETRIES, RETRY_DELAYS_MS } from '../config.js';
import { getToken, refreshAuth, clearLogin, goHome } from '../auth.js';
import { ApiError, TimeoutError, getErrorMessage, extractFieldErrors } from '../errors.js';
import { registerNavigable } from '../navigation.js';
import { getGlobalHandlers } from '../handlers.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  url: string;
  method?: HttpMethod;
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  silent?: boolean;
  cancelOnNavigate?: boolean;
  /** TanStack Query 等外部取消信号；与超时控制器合并。 */
  signal?: AbortSignal;
}

export interface ApiResponseBody {
  code?: number | string;
  message?: string;
  detail?: unknown;
  data?: unknown;
}

/** 生成 UUID v4（优先 crypto.randomUUID，不可用时回退到 Math.random 实现）。 */
export function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 退避等待实现：默认真延时；测试可注入记录型延时，避免真睡 300ms+600ms。
let delayImpl: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 测试用：注入自定义延时实现。 */
export function __setDelayImpl(fn: (ms: number) => Promise<void>): void {
  delayImpl = fn;
}

/** 测试用：恢复默认延时实现。 */
export function __resetDelayImpl(): void {
  delayImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 是否可重试：只看网络错误与 HTTP 状态码，业务 code 不参与决策。
 * - fetch 抛错的网络错误（code='NETWORK'，无 status）：可重试；
 * - HTTP 502 / 503 / 504：可重试；
 * - HTTP 500、其他 4xx、HTTP 200 配业务码 500：不重试；
 * - 超时（TimeoutError）：不重试；
 * - 导航取消（code='CANCELLED'）：不重试。
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) {
    return false;
  }
  if (err instanceof ApiError) {
    if (err.status === undefined && err.code === 'NETWORK') {
      return true;
    }
    return err.status === 502 || err.status === 503 || err.status === 504;
  }
  return false;
}

interface SingleCallResult {
  status: number;
  body: ApiResponseBody | null;
}

/** 单次 fetch 调用（不含重试 / 401 重放），把结果归一为 SingleCallResult。 */
async function fetchOnce(options: RequestOptions, requestId: string): Promise<SingleCallResult> {
  const token = getToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(options.headers || {}),
    // 自动生成的 X-Request-Id 永远最后写入：调用方传入同名 header 也会被覆盖，
    // 每次请求唯一追踪 ID 不可被调用方改写。
    'X-Request-Id': requestId,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const siteId = getSiteId();
  if (siteId) {
    headers['X-Site-Id'] = siteId;
  }

  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);
  const signals: AbortSignal[] = [timeoutController.signal];
  if (options.signal) {
    signals.push(options.signal);
    // 外部 signal 已取消：直接记为取消（abort 事件不会再触发）。
    if (options.signal.aborted) {
      cancelled = true;
    }
  }
  const combined = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  let unregisterNav: (() => void) | undefined;
  if (options.cancelOnNavigate) {
    unregisterNav = registerNavigable(timeoutController);
  }
  const onExternalAbort = (): void => {
    if (!timedOut) {
      cancelled = true;
    }
  };
  if (options.signal) {
    options.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(getApiBase() + options.url, {
      method: options.method || 'GET',
      headers,
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: combined,
    });
    let body: ApiResponseBody | null = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text) as ApiResponseBody;
      } catch {
        body = null;
      }
    }
    return { status: res.status, body };
  } catch (err) {
    if (timedOut) {
      throw new TimeoutError(requestId, timeoutMs);
    }
    if (cancelled || timeoutController.signal.aborted) {
      // 导航取消或外部 signal 取消（非超时）。
      throw new ApiError('CANCELLED', getErrorMessage('CANCELLED'), requestId);
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('CANCELLED', getErrorMessage('CANCELLED'), requestId);
    }
    throw new ApiError('NETWORK', getErrorMessage('NETWORK'), requestId);
  } finally {
    clearTimeout(timer);
    unregisterNav?.();
    if (options.signal) {
      options.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function request<T>(options: RequestOptions): Promise<T> {
  const method = options.method || 'GET';
  const silent = options.silent ?? false;
  let replayed = false;
  let retryCount = 0;

  for (;;) {
    const requestId = uuidv4();
    try {
      const { status, body } = await fetchOnce(options, requestId);
      const code = body && body.code !== undefined ? body.code : status;
      const message =
        (body && body.message) || getErrorMessage(status === 200 ? code : status);
      const detail = body ? body.detail : undefined;

      if (status === 401) {
        throw new ApiError(401, message, requestId, 401, detail);
      }
      if (status >= 200 && status < 300 && code === 0) {
        return (body ? body.data : undefined) as T;
      }
      if (status >= 200 && status < 300) {
        // 业务错误：status 带上真实的 HTTP 状态码（2xx），重试决策不看业务 code。
        throw new ApiError(code, message, requestId, status, detail);
      }
      throw new ApiError(code, message, requestId, status, detail);
    } catch (err) {
      if (!(err instanceof ApiError) && !(err instanceof TimeoutError)) {
        throw err;
      }

      // 超时不重试、不调全局回调，直接抛。
      if (err instanceof TimeoutError) {
        throw err;
      }

      // 401：先刷新一次后重放；第二次仍 401 则清登录态并回首页。
      if (err.code === 401) {
        if (!replayed) {
          replayed = true;
          await refreshAuth();
          continue;
        }
        clearLogin();
        goHome();
        throw err;
      }

      // 网络错误与 502、503、504：仅 GET 最多重试 2 次（退避 300ms、600ms）。
      // 重试依据只看 HTTP 状态码与网络错误，业务 code 不参与决策。
      if (isRetryable(err) && method === 'GET' && retryCount < MAX_RETRIES) {
        await delayImpl(RETRY_DELAYS_MS[retryCount]);
        retryCount += 1;
        continue;
      }

      // 全局处理（silent 时不调）：403 弹“无权限”不跳转；422 转字段错误映射；
      // 5xx 弹错并带 requestId（可复制）。
      if (!silent) {
        const h = getGlobalHandlers();
        if (err.status === 403) {
          h.onForbidden(err);
        } else if (err.status === 422) {
          h.onValidationError(extractFieldErrors(err.detail), err);
        } else if (err.status !== undefined && err.status >= 500) {
          h.onServerError(err);
        }
      }
      throw err;
    }
  }
}
