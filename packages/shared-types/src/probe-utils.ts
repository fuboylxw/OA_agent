/**
 * 公共的端点探测工具函数
 * 被 bootstrap processor 和 GenericHttpAdapter 共用
 */

export type ProbeStatus =
  | 'reachable'
  | 'unreachable'
  | 'auth_failed'
  | 'not_found'
  | 'server_error'
  | 'unknown';

/**
 * 根据 HTTP 状态码分类端点状态
 */
export function classifyProbeStatus(
  statusCode: number,
): {
  status: ProbeStatus;
  statusCode: number;
} {
  let status: ProbeStatus;

  if (statusCode >= 200 && statusCode < 400) {
    status = 'reachable';
  } else if (statusCode === 401 || statusCode === 403) {
    status = 'auth_failed';
  } else if (statusCode === 404) {
    status = 'not_found';
  } else if (statusCode === 405) {
    // 方法不允许，但端点可能存在
    status = 'reachable';
  } else if (statusCode >= 500) {
    status = 'server_error';
  } else {
    status = 'unknown';
  }

  return { status, statusCode };
}

/**
 * 从嵌套对象中按 dot-path 提取值
 */
export function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * 将 baseUrl 和相对路径拼接为完整 URL
 * 如果 path 已经是完整 URL 则直接返回
 */
export function buildFullUrl(baseUrl: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
