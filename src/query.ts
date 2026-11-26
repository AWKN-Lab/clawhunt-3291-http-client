// TanStack Query 集成（#3291 任务书）。
//
// - 默认 staleTime 30 秒；
// - 重试策略与请求层一致：仅网络错误与 502、503、504 可重试，最多 2 次，
//   退避 300ms × 2^n（第 1 次重试前 300ms，第 2 次 600ms）；
// - 封装 useApiQuery、useApiMutation：queryFn / mutationFn 直接走 request()。
import {
  QueryClient,
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { MAX_RETRIES, RETRY_DELAYS_MS, STALE_TIME_MS } from './config.js';
import { ApiError } from './errors.js';
import { request } from './services/http.js';

export { STALE_TIME_MS };

/** TanStack 重试退避：与请求层同一组数值。 */
export const QUERY_RETRY_DELAYS_MS: number[] = RETRY_DELAYS_MS;

/**
 * Query 层是否可重试：与请求层 isRetryable 同一规则（网络错误或 502/503/504）。
 * 业务 code 不参与；HTTP 500 不重试。
 */
export function isQueryRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === undefined && error.code === 'NETWORK') {
      return true;
    }
    return error.status === 502 || error.status === 503 || error.status === 504;
  }
  return false;
}

/** 建一个带任务书默认配置的 QueryClient。 */
export function createApiQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        retry: (failureCount, error) => failureCount < MAX_RETRIES && isQueryRetryable(error),
        retryDelay: (attemptIndex) =>
          RETRY_DELAYS_MS[Math.min(attemptIndex, RETRY_DELAYS_MS.length - 1)],
      },
    },
  });
}

/**
 * GET 查询封装：queryKey 默认 [url]，queryFn 走 request()。
 * useQuery 的其他选项（enabled、select 等）照常用。
 */
export function useApiQuery<T>(
  url: string,
  options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'> & {
    queryKey?: unknown[];
  },
) {
  const { queryKey, ...rest } = options ?? {};
  return useQuery<T, ApiError>({
    queryKey: queryKey ?? [url],
    queryFn: () => request<T>({ url, method: 'GET' }),
    ...rest,
  });
}

/**
 * 变更封装：mutationFn 走 request()，data 即 mutation 变量（JSON 体）。
 * 用法：const m = useApiMutation<MyData>('/api/leads', 'POST'); m.mutate({ name: '...' })。
 */
export function useApiMutation<TData>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE' = 'POST',
  options?: Omit<UseMutationOptions<TData, ApiError, unknown>, 'mutationFn'>,
) {
  return useMutation<TData, ApiError, unknown>({
    mutationFn: (variables) => request<TData>({ url, method, data: variables }),
    ...options,
  });
}
