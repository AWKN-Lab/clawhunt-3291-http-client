// 错误模型（#3291 任务书）。
//
// ApiError 是归一后的业务错误：{ status, code, message, detail, requestId }，
// status 是 HTTP 状态码，code 是后端错误体里的业务码，detail 是后端 detail 原样。
// 超时是独立的 TimeoutError（任务书要求“超时抛 TimeoutError”）。
// 错误码到中文提示的映射表复用 #2080（同类实现，33 个单测已验证）并扩展。

export class ApiError extends Error {
  /** 本次请求的 HTTP 状态码（网络错误时为 undefined）。 */
  status?: number;
  /** 业务码（后端错误体里的 code；无错误体时用 HTTP 状态码）。 */
  code: string | number;
  /** 后端错误体里的 detail 原样（422 时是字段错误来源）。 */
  detail?: unknown;
  /** 本次请求的 X-Request-Id：5xx 提示里的“复制请求 ID”按钮复制的就是它。 */
  requestId: string;

  constructor(
    code: string | number,
    message: string,
    requestId: string,
    status?: number,
    detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.requestId = requestId;
    this.status = status;
    this.detail = detail;
  }
}

export class TimeoutError extends Error {
  code = 'TIMEOUT' as const;
  requestId: string;
  timeoutMs: number;

  constructor(requestId: string, timeoutMs: number) {
    super(`请求超时（${timeoutMs}ms），请稍后重试。`);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
    this.requestId = requestId;
    this.timeoutMs = timeoutMs;
  }
}

// 错误码到中文提示的映射表。键为业务 code 或 HTTP 状态码（字符串形式）；
// TIMEOUT / NETWORK / CANCELLED 为本地错误码。每条都有中文提示。
export const ERROR_MESSAGES: Record<string, string> = {
  '400': '请求参数有误，请检查后重试。',
  '401': '登录已过期，请重新登录。',
  '403': '没有权限执行该操作。',
  '404': '请求的资源不存在。',
  '405': '请求方法不被允许。',
  '408': '请求超时，请稍后重试。',
  '409': '数据冲突，请刷新后重试。',
  '413': '上传内容过大，请压缩后重试。',
  '422': '提交内容不符合要求，请检查后重试。',
  '429': '操作太频繁，请稍后再试。',
  '500': '服务器开小差了，请稍后重试。',
  '502': '网关异常，请稍后重试。',
  '503': '服务暂时不可用，请稍后重试。',
  '504': '网关超时，请稍后重试。',
  NETWORK: '网络断开，请检查网络后重试。',
  TIMEOUT: '请求超时，请稍后重试。',
  CANCELLED: '请求已取消。',
  UNKNOWN: '未知错误，请稍后重试。',
};

export const ERROR_CODE_KEYS: string[] = Object.keys(ERROR_MESSAGES);

/** 按错误码取中文提示；未登记的码返回通用提示。 */
export function getErrorMessage(code: string | number): string {
  const key = String(code);
  return ERROR_MESSAGES[key] || ERROR_MESSAGES.UNKNOWN;
}

/**
 * 422：把后端 detail 转成字段错误映射 {字段名: 提示}，供表单显示。
 * detail 是对象时直接取字符串值；是 [{field, message}] 数组时逐项转；
 * 其他形状返回空映射（不抛错，由表单走通用提示）。
 */
export function extractFieldErrors(detail: unknown): Record<string, string> {
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
      if (typeof v === 'string') {
        out[k] = v;
      }
    }
    return out;
  }
  if (Array.isArray(detail)) {
    const out: Record<string, string> = {};
    for (const item of detail) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { field?: unknown }).field === 'string' &&
        typeof (item as { message?: unknown }).message === 'string'
      ) {
        out[(item as { field: string }).field] = (item as { message: string }).message;
      }
    }
    return out;
  }
  return {};
}

/** 5xx 错误提示里“复制请求 ID”按钮要复制的文本。 */
export function copyRequestIdText(requestId: string): string {
  return `请求 ID：${requestId}`;
}
