// 登录模块桩（本单先用桩函数，真实实现见 README 对接点）。
// 职责：token 存取、401 时的刷新流程、清除登录态、回到首页。
// 真实实现替换本文件即可，request() 只依赖这几个导出。
// 复用基线：#2080 的 services/auth.ts（同类桩，33 个单测已验证）。

let token: string | null = null;

/** 测试 / 登录流程用：写入 token。真实实现改为从登录接口返回后写入。 */
export function setToken(next: string | null): void {
  token = next;
}

/** 取当前 token；未登录时返回 null（request() 此时不附加 Authorization）。 */
export function getToken(): string | null {
  return token;
}

/**
 * 401 刷新流程：本单为桩。
 * 默认直接成功；真实实现应调登录态模块刷新 token 后 setToken。
 * 接入方用 setRefreshHandler 注入真实刷新函数；测试用它模拟刷新成功 / 失败。
 */
let refreshHandler: () => Promise<void> = () => Promise.resolve();

export function setRefreshHandler(fn: () => Promise<void>): void {
  refreshHandler = fn;
}

/** 401 时由 request() 调用：刷新登录态。 */
export function refreshAuth(): Promise<void> {
  return refreshHandler();
}

/** 测试用：恢复默认刷新桩。 */
export function __resetRefreshHandler(): void {
  refreshHandler = () => Promise.resolve();
}

/** 清除登录态：清 token。 */
export function clearLogin(): void {
  token = null;
}

/**
 * 回到首页：本单为桩（工作台用路由跳转，接入方通过 setGoHomeHandler 注入）。
 * 默认空操作；测试用 setGoHomeHandler 计数。
 */
let goHomeHandler: () => void = () => undefined;

export function setGoHomeHandler(fn: () => void): void {
  goHomeHandler = fn;
}

export function goHome(): void {
  goHomeHandler();
}

/** 测试用：恢复默认回首页桩。 */
export function __resetGoHomeHandler(): void {
  goHomeHandler = () => undefined;
}
