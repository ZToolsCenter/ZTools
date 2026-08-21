export type AiRequestStatus = 'idle' | 'sending' | 'receiving'

export interface AiRequestStatusChange {
  pluginName: string
  pluginPath: string
  status: AiRequestStatus
}

/**
 * 获取当前插件应展示的 AI 请求状态。
 * @param statusesByPluginPath 按插件路径保存的请求状态
 * @param pluginPath 当前显示插件的路径；未显示插件时为空
 * @returns 当前插件的请求状态；没有匹配插件时返回 idle
 */
export function resolveVisibleAiRequestStatus(
  statusesByPluginPath: Readonly<Record<string, AiRequestStatus>>,
  pluginPath?: string | null
): AiRequestStatus {
  if (!pluginPath) return 'idle'
  return statusesByPluginPath[pluginPath] ?? 'idle'
}
