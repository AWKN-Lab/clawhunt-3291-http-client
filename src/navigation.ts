// 路由切换取消（#3291 任务书：GET 请求可标记 cancelOnNavigate，路由切换时自动取消）。
//
// 标记了 cancelOnNavigate 的在途请求把自己的超时控制器登记到这里；
// 路由切换时调 notifyNavigation()，全部取消。控制器只在请求在途期间登记，
// 请求结束（成功 / 失败 / 超时）即注销，不会泄漏。

const controllers = new Set<AbortController>();

/** 登记一个在途请求的控制器；返回注销函数，请求结束时调用。 */
export function registerNavigable(controller: AbortController): () => void {
  controllers.add(controller);
  return () => {
    controllers.delete(controller);
  };
}

/** 路由切换时调用：取消全部已登记的在途请求。 */
export function notifyNavigation(): void {
  for (const c of [...controllers]) {
    c.abort();
  }
  controllers.clear();
}

/** 测试用：当前登记的在途请求数。 */
export function __pendingNavigableCount(): number {
  return controllers.size;
}
