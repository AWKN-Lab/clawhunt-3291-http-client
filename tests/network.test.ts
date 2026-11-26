// 离线状态测试（#3291 任务书：断网时顶部显示离线横幅，恢复后自动消失）。
// 横幅是 UI 接线；这里测状态与订阅。
import { describe, expect, it } from 'vitest';
import {
  __resetNetworkStatus,
  isOnline,
  setOnlineStatus,
  subscribeOnlineStatus,
} from '../src/network.js';

describe('离线状态', () => {
  it('默认在线（Node 环境无 navigator，返回 true）', () => {
    __resetNetworkStatus();
    expect(isOnline()).toBe(true);
  });

  it('setOnlineStatus(false) 后 isOnline() 为 false，并通知订阅者', () => {
    __resetNetworkStatus();
    const seen: boolean[] = [];
    const off = subscribeOnlineStatus((online) => seen.push(online));
    setOnlineStatus(false);
    expect(isOnline()).toBe(false);
    expect(seen).toEqual([false]);
    setOnlineStatus(true);
    expect(isOnline()).toBe(true);
    expect(seen).toEqual([false, true]);
    off();
    setOnlineStatus(false);
    expect(seen).toEqual([false, true]);
    __resetNetworkStatus();
  });

  it('取消订阅后不再收到通知', () => {
    __resetNetworkStatus();
    let count = 0;
    const off = subscribeOnlineStatus(() => {
      count += 1;
    });
    off();
    setOnlineStatus(false);
    expect(count).toBe(0);
    __resetNetworkStatus();
  });
});
