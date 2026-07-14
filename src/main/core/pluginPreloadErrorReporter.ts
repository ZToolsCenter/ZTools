/**
 * 插件 preload 错误报告边界。
 *
 * Electron 会异步报告 preload 中的未捕获异常，因此普通 loadURL 异常处理无法覆盖
 * 原生模块 ABI、平台或架构不兼容。该模块只接收插件声明的 preload 错误，避免把
 * ZTools 公共 preload 的异常错误归因到插件。
 */
import { Notification } from 'electron'
import path from 'node:path'

/** 能够订阅 Electron preload 错误的最小接口。 */
interface PreloadErrorSource {
  on(
    event: 'preload-error',
    listener: (event: unknown, preloadPath: string, error: Error) => void
  ): unknown
}

/** 注册 preload 错误报告器所需的运行上下文。 */
interface PluginPreloadErrorReporterOptions {
  webContents: PreloadErrorSource
  pluginName: string
  preloadPath: string
  notify?: (message: string) => void
}

/**
 * 显示插件加载失败通知。
 *
 * 使用系统通知是因为错误可能发生在后台预加载或独立窗口中，此时主窗口不一定可见。
 */
function showPluginLoadErrorNotification(message: string): void {
  new Notification({
    title: 'ZTools 插件加载失败',
    body: message
  }).show()
}

/**
 * 规范化 preload 路径用于事件归属判断。
 *
 * Windows 文件系统通常不区分大小写，比较时需要消除盘符和路径字符大小写差异。
 */
function normalizePreloadPath(preloadPath: string): string {
  const normalized = path.resolve(preloadPath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * 为插件 WebContents 注册 preload 错误报告。
 *
 * 只报告与插件声明路径完全一致的事件；原始 Error 会完整写入日志，用户通知保留
 * 原始 message，便于识别 Electron ABI、操作系统或 CPU 架构不兼容。
 */
export function registerPluginPreloadErrorReporter(
  options: PluginPreloadErrorReporterOptions
): void {
  const expectedPreloadPath = normalizePreloadPath(options.preloadPath)
  const notify = options.notify ?? showPluginLoadErrorNotification

  options.webContents.on('preload-error', (_event, preloadPath, error) => {
    if (normalizePreloadPath(preloadPath) !== expectedPreloadPath) return

    console.error(
      '[Plugin] 插件 preload 执行失败:',
      {
        pluginName: options.pluginName,
        preloadPath
      },
      error
    )
    notify(`插件 ${options.pluginName} 预加载失败：${error.message}`)
  })
}
