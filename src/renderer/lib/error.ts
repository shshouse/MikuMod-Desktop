/**
 * 统一错误文案：只取 Error.message，其余退回 fallback
 */
export function getErrorMessage(error: unknown, fallback = "未知错误"): string {
  return error instanceof Error && error.message ? error.message : fallback
}
