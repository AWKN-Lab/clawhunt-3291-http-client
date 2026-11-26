// @vitest-environment jsdom
// TanStack Query 集成测试（#3291 任务书：staleTime 30 秒、重试策略一致、useApiQuery、useApiMutation）。
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRuntimeConfig, setRuntimeConfig } from '../src/config.js';
import { ApiError } from '../src/errors.js';
import {
  STALE_TIME_MS,
  createApiQueryClient,
  isQueryRetryable,
  useApiMutation,
  useApiQuery,
} from '../src/query.js';
import { setToken } from '../src/auth.js';
import { createFetchStub, httpErrorBody, okBody } from './fetch-stub.js';

function wrapperWith(client: ReturnType<typeof createApiQueryClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('createApiQueryClient 默认配置', () => {
  it('staleTime 30 秒', () => {
    expect(STALE_TIME_MS).toBe(30000);
    const client = createApiQueryClient();
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30000);
  });

  it('重试判定：网络错误与 502/503/504 可重试；500 与业务错误不可重试', () => {
    expect(isQueryRetryable(new ApiError('NETWORK', 'x', 'r1'))).toBe(true);
    expect(isQueryRetryable(new ApiError(503, 'x', 'r2', 503))).toBe(true);
    expect(isQueryRetryable(new ApiError(502, 'x', 'r3', 502))).toBe(true);
    expect(isQueryRetryable(new ApiError(504, 'x', 'r4', 504))).toBe(true);
    expect(isQueryRetryable(new ApiError(500, 'x', 'r5', 500))).toBe(false);
    expect(isQueryRetryable(new ApiError(40001, 'x', 'r6', 200))).toBe(false);
  });

  it('retryDelay：attempt 0 → 300ms，attempt 1 → 600ms', () => {
    const client = createApiQueryClient();
    const retryDelay = client.getDefaultOptions().queries?.retryDelay;
    expect(typeof retryDelay).toBe('function');
    if (typeof retryDelay === 'function') {
      expect(retryDelay(0, new Error('x'))).toBe(300);
      expect(retryDelay(1, new Error('x'))).toBe(600);
    }
  });

  it('retry：failureCount < 2 且可重试时才重试', () => {
    const client = createApiQueryClient();
    const retry = client.getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe('function');
    const netErr = new ApiError('NETWORK', 'x', 'r1');
    if (typeof retry === 'function') {
      expect(retry(0, netErr)).toBe(true);
      expect(retry(1, netErr)).toBe(true);
      expect(retry(2, netErr)).toBe(false);
      expect(retry(0, new ApiError(500, 'x', 'r2', 500))).toBe(false);
    }
  });
});

describe('useApiQuery / useApiMutation', () => {
  beforeEach(() => {
    setRuntimeConfig({ apiBase: 'https://api.example.invalid' });
    setToken('token-demo');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetRuntimeConfig();
    setToken(null);
  });

  it('useApiQuery 成功：返回 data', async () => {
    const { fn } = createFetchStub([okBody([{ id: 's1', name: '演示空间' }])]);
    vi.stubGlobal('fetch', fn);
    const client = createApiQueryClient();
    const { result } = renderHook(() => useApiQuery('/api/spaces'), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 's1', name: '演示空间' }]);
  });

  it('useApiQuery 失败：error 是 ApiError（500 不重试，直接失败）', async () => {
    const { fn } = createFetchStub([httpErrorBody(500, 500, '服务器开小差')]);
    vi.stubGlobal('fetch', fn);
    const client = createApiQueryClient();
    const { result } = renderHook(() => useApiQuery('/api/spaces'), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(500);
  });

  it('useApiMutation 成功：POST 带 JSON 体，返回 data', async () => {
    const { calls, fn } = createFetchStub([okBody({ id: 'lead-1' })]);
    vi.stubGlobal('fetch', fn);
    const client = createApiQueryClient();
    const { result } = renderHook(() => useApiMutation('/api/leads', 'POST'), {
      wrapper: wrapperWith(client),
    });
    result.current.mutate({ companyName: '演示企业', contactName: '张三' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 'lead-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      companyName: '演示企业',
      contactName: '张三',
    });
  });
});
