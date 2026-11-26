// 核心请求客户端测试（#3291 任务书逐项对照）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRuntimeConfig,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  setRuntimeConfig,
} from '../src/config.js';
import {
  __resetGoHomeHandler,
  __resetRefreshHandler,
  clearLogin,
  getToken,
  setGoHomeHandler,
  setRefreshHandler,
  setToken,
} from '../src/auth.js';
import { ApiError, TimeoutError } from '../src/errors.js';
import { __resetGlobalHandlers, setGlobalHandlers } from '../src/handlers.js';
import { __pendingNavigableCount, notifyNavigation } from '../src/navigation.js';
import {
  __resetDelayImpl,
  __setDelayImpl,
  isRetryable,
  request,
} from '../src/services/http.js';
import {
  bizErrorBody,
  createFetchStub,
  createPendingFetchStub,
  httpErrorBody,
  okBody,
} from './fetch-stub.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('request() 基础：信封、鉴权头、追踪头', () => {
  beforeEach(() => {
    setRuntimeConfig({ apiBase: 'https://api.example.invalid', siteId: 'site-demo' });
    setToken('token-demo');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetRuntimeConfig();
    setToken(null);
    __resetDelayImpl();
    __resetGlobalHandlers();
    __resetRefreshHandler();
    __resetGoHomeHandler();
  });

  it('成功：HTTP 200 + code 0 返回 data', async () => {
    const { fn } = createFetchStub([okBody({ id: 's1', name: '演示空间' })]);
    vi.stubGlobal('fetch', fn);
    const data = await request<{ id: string; name: string }>({ url: '/api/spaces/s1' });
    expect(data).toEqual({ id: 's1', name: '演示空间' });
  });

  it('自动附加 Authorization、X-Request-Id（UUID v4）、X-Site-Id', async () => {
    const { calls, fn } = createFetchStub([okBody({})]);
    vi.stubGlobal('fetch', fn);
    await request({ url: '/api/spaces' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.invalid/api/spaces');
    expect(calls[0].headers.Authorization).toBe('Bearer token-demo');
    expect(calls[0].headers['X-Request-Id']).toMatch(UUID_RE);
    expect(calls[0].headers['X-Site-Id']).toBe('site-demo');
  });

  it('调用方传入的 X-Request-Id 会被库自动生成的覆盖（每次请求唯一追踪 ID 不可改写）', async () => {
    const { calls, fn } = createFetchStub([okBody({})]);
    vi.stubGlobal('fetch', fn);
    await request({ url: '/api/spaces', headers: { 'X-Request-Id': 'caller-id' } });
    expect(calls[0].headers['X-Request-Id']).not.toBe('caller-id');
    expect(calls[0].headers['X-Request-Id']).toMatch(UUID_RE);
  });

  it('未登录时不附加 Authorization', async () => {
    setToken(null);
    const { calls, fn } = createFetchStub([okBody({})]);
    vi.stubGlobal('fetch', fn);
    await request({ url: '/api/spaces' });
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('未配置 siteId 时不发 X-Site-Id', async () => {
    setRuntimeConfig({ siteId: undefined });
    const { calls, fn } = createFetchStub([okBody({})]);
    vi.stubGlobal('fetch', fn);
    await request({ url: '/api/spaces' });
    expect(calls[0].headers['X-Site-Id']).toBeUndefined();
  });

  it('业务错误：HTTP 200 + 非 0 业务码抛 ApiError，带 status、code、detail', async () => {
    const { fn } = createFetchStub([
      bizErrorBody(40001, '业务校验失败', { field: 'x' }),
    ]);
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/leads', method: 'POST', data: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.code).toBe(40001);
    expect(apiErr.status).toBe(200);
    expect(apiErr.message).toBe('业务校验失败');
    expect(apiErr.detail).toEqual({ field: 'x' });
    expect(apiErr.requestId).toMatch(UUID_RE);
  });

  it('HTTP 错误：404 抛 ApiError，status 404，code 取错误体 code', async () => {
    const { fn } = createFetchStub([httpErrorBody(404, 'NOT_FOUND', '空间不存在')]);
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/spaces/nope' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.code).toBe('NOT_FOUND');
    expect(apiErr.message).toBe('空间不存在');
  });

  it('非 JSON 响应体：HTTP 200 无信封时抛 ApiError（信封是约定，见 README）', async () => {
    const { fn } = createFetchStub([{ status: 200, body: 'not json' }]);
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/spaces' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(200);
  });

  it('HTTP 200 配业务码 500 不重试（重试决策不看业务 code）', async () => {
    const { calls, fn } = createFetchStub([bizErrorBody(500, '业务 500')]);
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/spaces' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });

  it('isRetryable：网络错误与 502/503/504 可重试；500、超时、取消不可重试', () => {
    expect(isRetryable(new ApiError('NETWORK', 'x', 'r1'))).toBe(true);
    expect(isRetryable(new ApiError(503, 'x', 'r2', 503))).toBe(true);
    expect(isRetryable(new ApiError(502, 'x', 'r3', 502))).toBe(true);
    expect(isRetryable(new ApiError(504, 'x', 'r4', 504))).toBe(true);
    expect(isRetryable(new ApiError(500, 'x', 'r5', 500))).toBe(false);
    expect(isRetryable(new ApiError(404, 'x', 'r6', 404))).toBe(false);
    expect(isRetryable(new TimeoutError('r7', 15000))).toBe(false);
    expect(isRetryable(new ApiError('CANCELLED', 'x', 'r8'))).toBe(false);
  });
});

describe('request() 重试：仅 GET、网络错误与 502/503/504、最多 2 次、退避 300ms×2^n', () => {
  beforeEach(() => {
    setRuntimeConfig({ apiBase: 'https://api.example.invalid' });
    setToken('token-demo');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetRuntimeConfig();
    setToken(null);
    __resetDelayImpl();
    __resetGlobalHandlers();
    __resetRefreshHandler();
    __resetGoHomeHandler();
  });

  it('GET 网络错误重试 2 次后抛错；退避记录为 [300, 600]；共发 3 次', async () => {
    const delays: number[] = [];
    __setDelayImpl(async (ms) => {
      delays.push(ms);
    });
    const netErr = new TypeError('fetch failed');
    const { calls, fn } = createFetchStub([netErr, netErr, netErr]);
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/spaces' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NETWORK');
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([300, 600]);
    expect(RETRY_DELAYS_MS).toEqual([300, 600]);
    expect(MAX_RETRIES).toBe(2);
  });

  it('GET 503 两次后成功：第 3 次返回即返回 data', async () => {
    const delays: number[] = [];
    __setDelayImpl(async (ms) => {
      delays.push(ms);
    });
    const { calls, fn } = createFetchStub([
      httpErrorBody(503, 503, '服务暂时不可用'),
      httpErrorBody(503, 503, '服务暂时不可用'),
      okBody([{ id: 's1' }]),
    ]);
    vi.stubGlobal('fetch', fn);
    const data = await request({ url: '/api/spaces' });
    expect(data).toEqual([{ id: 's1' }]);
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([300, 600]);
  });

  it('GET 502、504 各重试；HTTP 500 不重试', async () => {
    const { calls, fn } = createFetchStub([
      httpErrorBody(502, 502, '网关异常'),
      okBody({ ok: true }),
    ]);
    vi.stubGlobal('fetch', fn);
    await expect(request({ url: '/api/spaces' })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);

    const stub2 = createFetchStub([httpErrorBody(504, 504, '网关超时'), okBody({ ok: true })]);
    vi.stubGlobal('fetch', stub2.fn);
    await expect(request({ url: '/api/spaces' })).resolves.toEqual({ ok: true });
    expect(stub2.calls).toHaveLength(2);

    const stub3 = createFetchStub([httpErrorBody(500, 500, '服务器开小差')]);
    vi.stubGlobal('fetch', stub3.fn);
    await expect(request({ url: '/api/spaces' })).rejects.toBeInstanceOf(ApiError);
    expect(stub3.calls).toHaveLength(1);
  });

  it('POST 网络错误不重试；POST 503 不重试', async () => {
    const netErr = new TypeError('fetch failed');
    const stub1 = createFetchStub([netErr]);
    vi.stubGlobal('fetch', stub1.fn);
    await expect(
      request({ url: '/api/leads', method: 'POST', data: { a: 1 } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(stub1.calls).toHaveLength(1);

    const stub2 = createFetchStub([httpErrorBody(503, 503, '服务暂时不可用')]);
    vi.stubGlobal('fetch', stub2.fn);
    await expect(
      request({ url: '/api/leads', method: 'POST', data: { a: 1 } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(stub2.calls).toHaveLength(1);
  });

  it('PUT、DELETE 网络错误不重试', async () => {
    const netErr = new TypeError('fetch failed');
    for (const method of ['PUT', 'DELETE'] as const) {
      const stub = createFetchStub([netErr]);
      vi.stubGlobal('fetch', stub.fn);
      await expect(request({ url: '/api/leads/1', method })).rejects.toBeInstanceOf(ApiError);
      expect(stub.calls).toHaveLength(1);
    }
  });

  it('HTTP 503 配业务码 0 仍重试（业务码不参与重试决策）', async () => {
    const { calls, fn } = createFetchStub([
      { status: 503, body: { code: 0, message: 'ok', data: null } },
      okBody({ ok: true }),
    ]);
    vi.stubGlobal('fetch', fn);
    await expect(request({ url: '/api/spaces' })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });
});

describe('request() 401：刷新一次后重放，第二次仍 401 则清登录态并回首页', () => {
  beforeEach(() => {
    setRuntimeConfig({ apiBase: 'https://api.example.invalid' });
    setToken('token-old');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetRuntimeConfig();
    setToken(null);
    __resetDelayImpl();
    __resetGlobalHandlers();
    __resetRefreshHandler();
    __resetGoHomeHandler();
  });

  it('401 后刷新一次、重放成功，返回 data', async () => {
    let refreshCount = 0;
    setRefreshHandler(async () => {
      refreshCount += 1;
      setToken('token-new');
    });
    const { calls, fn } = createFetchStub([
      httpErrorBody(401, 401, '登录已过期'),
      okBody({ id: 's1' }),
    ]);
    vi.stubGlobal('fetch', fn);
    const data = await request({ url: '/api/spaces/s1' });
    expect(data).toEqual({ id: 's1' });
    expect(refreshCount).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.Authorization).toBe('Bearer token-new');
  });

  it('第二次仍 401：清登录态、回首页、抛错（只刷新一次）', async () => {
    let refreshCount = 0;
    let goHomeCount = 0;
    setRefreshHandler(async () => {
      refreshCount += 1;
    });
    setGoHomeHandler(() => {
      goHomeCount += 1;
    });
    const { fn } = createFetchStub([
      httpErrorBody(401, 401, '登录已过期'),
      httpErrorBody(401, 401, '登录已过期'),
    ]);
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/spaces/s1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(401);
    expect(refreshCount).toBe(1);
    expect(getToken()).toBeNull();
    expect(goHomeCount).toBe(1);
  });
});

describe('request() 超时与取消', () => {
  beforeEach(() => {
    setRuntimeConfig({ apiBase: 'https://api.example.invalid' });
    setToken('token-demo');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetRuntimeConfig();
    setToken(null);
    __resetDelayImpl();
    __resetGlobalHandlers();
    __resetRefreshHandler();
    __resetGoHomeHandler();
  });

  it('默认超时 15 秒（DEFAULT_TIMEOUT_MS = 15000）', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(15000);
  });

  it('超时抛 TimeoutError（用 50ms 短超时快速验证，不等 15 秒）', async () => {
    const { fn } = createPendingFetchStub();
    vi.stubGlobal('fetch', fn);
    const err = await request({ url: '/api/spaces', timeout: 50 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    const tErr = err as TimeoutError;
    expect(tErr.code).toBe('TIMEOUT');
    expect(tErr.timeoutMs).toBe(50);
    expect(tErr.requestId).toMatch(UUID_RE);
  });

  it('超时不重试（只发 1 次）', async () => {
    const { calls, fn } = createPendingFetchStub();
    vi.stubGlobal('fetch', fn);
    await expect(request({ url: '/api/spaces', timeout: 30 })).rejects.toBeInstanceOf(
      TimeoutError,
    );
    expect(calls).toHaveLength(1);
  });

  it('cancelOnNavigate：路由切换时取消在途请求，抛 CANCELLED', async () => {
    const { calls, fn } = createPendingFetchStub();
    vi.stubGlobal('fetch', fn);
    const pending = request({ url: '/api/spaces', cancelOnNavigate: true });
    setTimeout(() => notifyNavigation(), 20);
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('CANCELLED');
    expect(calls).toHaveLength(1);
    expect(__pendingNavigableCount()).toBe(0);
  });

  it('未标记 cancelOnNavigate 的请求不受路由切换影响（仍在途）', async () => {
    const { fn } = createPendingFetchStub();
    vi.stubGlobal('fetch', fn);
    const pending = request({ url: '/api/spaces', timeout: 200 });
    setTimeout(() => notifyNavigation(), 20);
    // 200ms 后应为超时而非取消。
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it('请求结束即注销导航登记（成功后登记数为 0）', async () => {
    const { fn } = createFetchStub([okBody({})]);
    vi.stubGlobal('fetch', fn);
    await request({ url: '/api/spaces', cancelOnNavigate: true });
    expect(__pendingNavigableCount()).toBe(0);
  });
});
