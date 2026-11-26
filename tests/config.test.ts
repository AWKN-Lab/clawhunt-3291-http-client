// 配置常量测试（#3291 任务书数值：超时 15 秒、重试 2 次、退避 300ms×2^n、staleTime 30 秒）。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  STALE_TIME_MS,
} from '../src/config.js';

describe('配置常量', () => {
  it('默认超时 15 秒', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(15000);
  });

  it('最多重试 2 次', () => {
    expect(MAX_RETRIES).toBe(2);
  });

  it('退避间隔 300ms × 2^n：[300, 600]', () => {
    expect(RETRY_DELAYS_MS).toEqual([300, 600]);
    expect(RETRY_DELAYS_MS[0]).toBe(300);
    expect(RETRY_DELAYS_MS[1]).toBe(300 * 2);
  });

  it('TanStack 默认 staleTime 30 秒', () => {
    expect(STALE_TIME_MS).toBe(30000);
  });
});
