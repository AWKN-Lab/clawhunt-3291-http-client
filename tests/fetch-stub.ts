// fetch 桩（测试支持）：可控的 fetch 替代品，不真实联网。
import { vi } from 'vitest';

export interface StubCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface StubResponse {
  status: number;
  /** 对象 → JSON 字符串；字符串 → 原文；null/undefined → 空体。 */
  body: unknown;
}

/**
 * 构造一个 fetch 桩：按顺序返回给定的响应（或抛错）。返回 { calls, fn }。
 * fn 用 vi.fn 包了一层，可直接 vi.stubGlobal('fetch', fn)。
 */
export function createFetchStub(sequence: Array<StubResponse | Error>): {
  calls: StubCall[];
  fn: typeof fetch;
} {
  const calls: StubCall[] = [];
  const queue = [...sequence];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({
      url,
      method: (init?.method as string) || 'GET',
      headers,
      body: init?.body as string | undefined,
      signal: init?.signal as AbortSignal | undefined,
    });
    const signal = init?.signal as AbortSignal | undefined;
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const next = queue.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (!next) {
      throw new Error('fetch stub: 响应队列已空');
    }
    const text =
      next.body === null || next.body === undefined
        ? ''
        : typeof next.body === 'string'
          ? next.body
          : JSON.stringify(next.body);
    return { status: next.status, text: async () => text } as Response;
  });
  return { calls, fn };
}

/**
 * 构造一个永远挂起的 fetch 桩：请求不返回，直到 signal 取消才以 AbortError 拒绝。
 * 用于超时与取消测试。返回 { calls, fn }。
 */
export function createPendingFetchStub(): { calls: StubCall[]; fn: typeof fetch } {
  const calls: StubCall[] = [];
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({
      url,
      method: (init?.method as string) || 'GET',
      headers,
      body: init?.body as string | undefined,
      signal: init?.signal as AbortSignal | undefined,
    });
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (!signal) {
        return; // 无 signal：永远挂起。
      }
      if (signal.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        },
        { once: true },
      );
    });
  });
  return { calls, fn };
}

/** 成功信封：HTTP 200 + { code: 0, message, data }。 */
export function okBody(data: unknown, message = 'ok'): StubResponse {
  return { status: 200, body: { code: 0, message, data } };
}

/** 业务错误信封：HTTP 200 + { code, message, detail }。 */
export function bizErrorBody(
  code: number | string,
  message = '业务错误',
  detail?: unknown,
): StubResponse {
  return { status: 200, body: { code, message, detail } };
}

/** HTTP 错误：指定状态码 + { code, message, detail }。 */
export function httpErrorBody(
  status: number,
  code: number | string,
  message = 'HTTP 错误',
  detail?: unknown,
): StubResponse {
  return { status, body: { code, message, detail } };
}
