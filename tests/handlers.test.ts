// 全局处理回调测试（#3291 任务书：403、422、5xx；silent 抑制）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRuntimeConfig, __resetRuntimeConfig } from '../src/config.js';
import { setToken } from '../src/auth.js';
import { ApiError } from '../src/errors.js';
import { __resetGlobalHandlers, setGlobalHandlers } from '../src/handlers.js';
import { request } from '../src/services/http.js';
import { createFetchStub, httpErrorBody } from './fetch-stub.js';

describe('全局处理回调', () => {
  beforeEach(() => {
    setRuntimeConfig({ apiBase: 'https://api.example.invalid' });
    setToken('token-demo');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetRuntimeConfig();
    setToken(null);
    __resetGlobalHandlers();
  });

  it('403：调 onForbidden（“无权限”提示，不跳转）；错误照常抛出', async () => {
    const forbidden: ApiError[] = [];
    setGlobalHandlers({ onForbidden: (err) => forbidden.push(err) });
    const { fn } = createFetchStub([httpErrorBody(403, 403, '没有权限')]);
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/spaces' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect(forbidden).toHaveLength(1);
    expect(forbidden[0].status).toBe(403);
  });

  it('422：调 onValidationError，带 detail 转成的字段错误映射', async () => {
    const received: Array<Record<string, string>> = [];
    setGlobalHandlers({ onValidationError: (fields) => received.push(fields) });
    const { fn } = createFetchStub([
      httpErrorBody(422, 422, '提交内容不符合要求', {
        companyName: '必填',
        phone: '格式不对',
      }),
    ]);
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/leads', method: 'POST', data: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect(received).toEqual([{ companyName: '必填', phone: '格式不对' }]);
  });

  it('5xx：调 onServerError，带 requestId（“复制请求 ID”按钮的来源）', async () => {
    const received: ApiError[] = [];
    setGlobalHandlers({ onServerError: (err) => received.push(err) });
    const { fn } = createFetchStub([httpErrorBody(500, 500, '服务器开小差')]);
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/spaces' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(received).toHaveLength(1);
    expect(received[0].requestId).toBe((err as ApiError).requestId);
    expect(received[0].requestId).toBeTruthy();
  });

  it('silent 模式下不调任何全局回调（错误照常抛出）', async () => {
    let called = 0;
    setGlobalHandlers({
      onForbidden: () => {
        called += 1;
      },
      onValidationError: () => {
        called += 1;
      },
      onServerError: () => {
        called += 1;
      },
    });
    const stub1 = createFetchStub([httpErrorBody(403, 403, '没有权限')]);
    vi.stubGlobal('fetch', stub1.fn);
    await expect(request({ url: '/api/spaces', silent: true })).rejects.toBeInstanceOf(ApiError);

    const stub2 = createFetchStub([httpErrorBody(500, 500, '服务器开小差')]);
    vi.stubGlobal('fetch', stub2.fn);
    await expect(request({ url: '/api/spaces', silent: true })).rejects.toBeInstanceOf(ApiError);

    expect(called).toBe(0);
  });
});
