// 全局处理回调注册（#3291 任务书的全局处理部分）。
//
// 工作台把这些接到 toast / 横幅 / 字段错误 UI；默认全部是空操作，
// request() 只负责在正确的时机调用它们。silent 模式下不调用
// （与 #2080 的 silent 不自动 toast 同一语义）。
import type { ApiError } from './errors.js';

export interface GlobalHandlers {
  /** 403：弹出“无权限”提示且不跳转。 */
  onForbidden: (err: ApiError) => void;
  /** 422：detail 转成的字段错误映射，供表单显示。 */
  onValidationError: (fieldErrors: Record<string, string>, err: ApiError) => void;
  /** 5xx：弹出错误提示并提供“复制请求 ID”按钮（err.requestId）。 */
  onServerError: (err: ApiError) => void;
}

const defaults: GlobalHandlers = {
  onForbidden: () => undefined,
  onValidationError: () => undefined,
  onServerError: () => undefined,
};

let handlers: GlobalHandlers = { ...defaults };

export function setGlobalHandlers(next: Partial<GlobalHandlers>): void {
  handlers = { ...handlers, ...next };
}

export function getGlobalHandlers(): GlobalHandlers {
  return handlers;
}

/** 测试用：恢复默认（全部空操作）。 */
export function __resetGlobalHandlers(): void {
  handlers = { ...defaults };
}
