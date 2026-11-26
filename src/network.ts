// 离线横幅状态（#3291 任务书：断网时顶部显示离线横幅，恢复后自动消失）。
//
// 横幅本身是 UI 接线（工作台按订阅状态渲染），本模块只给状态与订阅：
// 浏览器里读 navigator.onLine 并监听 online/offline 事件；
// Node / 测试环境没有 window，用 setOnlineStatus 驱动。
// request() 不因离线拦截请求——任务书只要求横幅提示，未要求离线拦截。

export type OnlineListener = (online: boolean) => void;

const listeners = new Set<OnlineListener>();
let onlineOverride: boolean | null = null;
let windowBound = false;

/** 当前是否在线。 */
export function isOnline(): boolean {
  if (onlineOverride !== null) {
    return onlineOverride;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

/** 设置在线状态并通知全部订阅者（测试与 window 事件都走这里）。 */
export function setOnlineStatus(online: boolean): void {
  onlineOverride = online;
  for (const fn of [...listeners]) {
    fn(online);
  }
}

/** 订阅在线状态变化；返回取消订阅函数。 */
export function subscribeOnlineStatus(fn: OnlineListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 浏览器用：把 window 的 online/offline 事件接到本模块（只绑定一次）。 */
export function bindWindowOnlineEvents(): void {
  if (windowBound || typeof window === 'undefined') {
    return;
  }
  windowBound = true;
  window.addEventListener('online', () => setOnlineStatus(true));
  window.addEventListener('offline', () => setOnlineStatus(false));
}

/** 测试用：恢复默认（清覆盖值与监听）。 */
export function __resetNetworkStatus(): void {
  onlineOverride = null;
  listeners.clear();
  windowBound = false;
}
