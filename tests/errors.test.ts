// 错误模型测试（#3291 任务书：ApiError 字段、错误码映射、422 字段映射）。
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  ERROR_CODE_KEYS,
  ERROR_MESSAGES,
  TimeoutError,
  copyRequestIdText,
  extractFieldErrors,
  getErrorMessage,
} from '../src/errors.js';

describe('ApiError', () => {
  it('字段齐全：status、code、message、detail、requestId', () => {
    const err = new ApiError(422, '提交内容不符合要求', 'req-1', 422, { name: '必填' });
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(422);
    expect(err.code).toBe(422);
    expect(err.message).toBe('提交内容不符合要求');
    expect(err.detail).toEqual({ name: '必填' });
    expect(err.requestId).toBe('req-1');
    expect(err instanceof Error).toBe(true);
  });

  it('网络错误：status 为 undefined，code 为 NETWORK', () => {
    const err = new ApiError('NETWORK', '网络断开', 'req-2');
    expect(err.status).toBeUndefined();
    expect(err.code).toBe('NETWORK');
  });
});

describe('TimeoutError', () => {
  it('字段齐全：code TIMEOUT、requestId、timeoutMs', () => {
    const err = new TimeoutError('req-3', 15000);
    expect(err.name).toBe('TimeoutError');
    expect(err.code).toBe('TIMEOUT');
    expect(err.requestId).toBe('req-3');
    expect(err.timeoutMs).toBe(15000);
    expect(err.message).toContain('15000');
  });
});

describe('错误码到中文提示', () => {
  it('至少 8 条，每条都有中文提示（任务书要求至少覆盖 401、403、404、409、422、429、500 + 断网）', () => {
    expect(ERROR_CODE_KEYS.length).toBeGreaterThanOrEqual(8);
    for (const key of ['401', '403', '404', '409', '422', '429', '500', 'NETWORK']) {
      expect(ERROR_MESSAGES[key]).toBeTruthy();
      expect(typeof ERROR_MESSAGES[key]).toBe('string');
    }
  });

  it('getErrorMessage：已知码返回对应提示，未知码返回通用提示', () => {
    expect(getErrorMessage(403)).toBe('没有权限执行该操作。');
    expect(getErrorMessage('NETWORK')).toBe('网络断开，请检查网络后重试。');
    expect(getErrorMessage(99999)).toBe('未知错误，请稍后重试。');
  });
});

describe('422 字段错误映射 extractFieldErrors', () => {
  it('detail 是对象：直接取字符串值', () => {
    expect(extractFieldErrors({ name: '必填', phone: '格式不对' })).toEqual({
      name: '必填',
      phone: '格式不对',
    });
  });

  it('detail 是 [{field, message}] 数组：逐项转映射', () => {
    expect(
      extractFieldErrors([
        { field: 'name', message: '必填' },
        { field: 'phone', message: '格式不对' },
      ]),
    ).toEqual({ name: '必填', phone: '格式不对' });
  });

  it('detail 是其他形状：返回空映射，不抛错', () => {
    expect(extractFieldErrors('一段文字')).toEqual({});
    expect(extractFieldErrors(null)).toEqual({});
    expect(extractFieldErrors(undefined)).toEqual({});
  });
});

describe('复制请求 ID', () => {
  it('copyRequestIdText 包含 requestId', () => {
    const text = copyRequestIdText('abc-123');
    expect(text).toContain('abc-123');
  });
});
