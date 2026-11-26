// 运行时配置与重试常量（#3291 最小样品）。
//
// 变异自证的靶点就是这里的 MAX_RETRIES：把它改小，依赖重试次数的测试必须变红。

/** 默认超时 15 秒（任务书）。 */
export const DEFAULT_TIMEOUT_MS = 15000;

/** 最多重试 2 次（任务书：仅 GET 的网络错误与 502、503、504）。 */
export const MAX_RETRIES = 2;

/** 退避间隔：300ms × 2^n。第 1 次重试前等 300ms，第 2 次重试前等 600ms。 */
export const RETRY_DELAYS_MS: number[] = [300, 600];

/** TanStack Query 默认 staleTime 30 秒（任务书）。 */
export const STALE_TIME_MS = 30000;

export interface RuntimeConfig {
  /** 基础地址，由接入方在运行时配置，如 https://api.example.invalid。 */
  apiBase: string;
  /** 当前空间 ID，随每个请求以 X-Site-Id 发出；未配置时不发该头。 */
  siteId?: string;
}

let runtimeConfig: RuntimeConfig = { apiBase: '' };

export function setRuntimeConfig(next: Partial<RuntimeConfig>): void {
  runtimeConfig = { ...runtimeConfig, ...next };
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig;
}

export function getApiBase(): string {
  return runtimeConfig.apiBase;
}

export function getSiteId(): string | undefined {
  return runtimeConfig.siteId;
}

/** 测试用：恢复默认配置。 */
export function __resetRuntimeConfig(): void {
  runtimeConfig = { apiBase: '' };
}
