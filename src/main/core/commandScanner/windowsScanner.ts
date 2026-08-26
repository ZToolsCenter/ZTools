import { extractAcronym } from '../../utils/common'
import { getWindowsFlatScanPaths, getWindowsRecursiveScanPaths } from '../../utils/systemPaths'
import { toZToolsIconUrl } from '../../common/iconUtils'
import { WindowsShortcutScanner, type WindowsShortcutInfo } from '../native/index'
import type { ApplicationScanResult, Command } from './types'
import { pLimit } from './utils'

// ========== 配置 ==========

// 要跳过的文件夹名称
export const SKIP_FOLDERS = [
  'sdk',
  'doc',
  'docs',
  'samples',
  'sample',
  'examples',
  'example',
  'demos',
  'demo',
  'documentation'
]

// 要跳过的快捷方式名称关键词（不区分大小写）
// 仅按名称过滤，不按目标类型/路径/扩展名过滤
// 因为扫描范围仅限开始菜单和桌面，这些位置的快捷方式都是有意放置的
export const SKIP_NAME_PATTERN =
  /^uninstall|^卸载|卸载$|website|网站|帮助|help|readme|read me|文档|manual|license|documentation/i

// ========== 辅助函数 ==========

interface WindowsScanSource {
  path: string
  recursive: boolean
}

interface WindowsScanSourceResult {
  source: WindowsScanSource
  entries: WindowsShortcutInfo[]
  error?: unknown
}

/**
 * Windows 扫描实现说明：
 *
 * 原 TS 实现里的这些步骤现在都已迁移到原生模块：
 * - 解析 desktop.ini 中的 [LocalizedFileNames] 段。
 *   desktop.ini 通常是 UTF-16LE 编码（带 BOM），部分为 UTF-8。
 *   条目值可能是纯文本或 MUI 引用（@dll,-id）。
 * - 批量解析 MUI 资源字符串（如 @%SystemRoot%\system32\shell32.dll,-22067）。
 *   通过 Win32 API 解析 Windows 系统快捷方式的本地化显示名称。
 * - 解析 .url 文件，提取 URL 和 IconFile 字段。
 *   跳过普通网页链接（http/https），保留其他应用协议（如 steam://）。
 * - 处理单个快捷方式 entry（.url / .lnk）：解析、过滤、入列。
 *   递归与扁平扫描共用，仅处理文件 entry；目录的下钻 / 跳过由原生模块决定。
 * - 从 Start Menu 根目录递归扫描全部子树。
 *   处理子目录时跳过 SDK、示例、文档等开发相关文件夹。
 * - 扁平扫描用户桌面和公共桌面。
 *   仅处理本层文件，避免遍历桌面中的大型工程目录。
 *
 * TS 层保留最终的名称过滤、图标协议封装、首字母缩写和去重，避免业务侧行为变化。
 */

// 检查是否应该跳过该快捷方式（仅按名称过滤）
export function shouldSkipShortcut(name: string): boolean {
  return SKIP_NAME_PATTERN.test(name)
}

/**
 * 将 Windows 应用图标源路径转换为动态图标协议 URL。
 *
 * @param appPath 用于提取图标的快捷方式、可执行文件或图片路径。
 * @returns 编码后的 ztools-icon URL。
 */
export function getIconUrl(appPath: string): string {
  return toZToolsIconUrl(appPath)
}

/**
 * 将原生模块扫描结果转换为 Command。
 *
 * desktop.ini 本地化名称、MUI 解析、.url 解析、.lnk 目标解析已迁移到原生模块实现；
 * TS 层只保留名称过滤、图标协议封装、首字母缩写和去重字段整理。
 */
function toCommand(entry: WindowsShortcutInfo): (Command & { _dedupeTarget?: string }) | null {
  if (!entry.name || !entry.path) {
    return null
  }

  if (shouldSkipShortcut(entry.name)) {
    return null
  }

  // 始终使用原生模块返回的启动路径：
  // - .lnk：使用快捷方式路径，Windows Shell API 能正确处理参数、工作目录等
  // - .url 或 .lnk 指向 .url：使用应用协议链接（已在原生模块跳过 http/https）
  // 图标使用原生模块返回的 icon 源路径，再封装成 ztools-icon:// 协议
  return {
    name: entry.name,
    path: entry.path,
    icon: getIconUrl(entry.icon || entry.path),
    acronym: extractAcronym(entry.name),
    _dedupeTarget: entry.targetPath || undefined
  }
}

/**
 * 将未知异常转换为可持久记录的错误文本。
 *
 * @param error 捕获到的任意异常值。
 * @returns 适合日志和扫描结果的错误文本。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 在独立 runner 中扫描单个 Windows 来源，限制失败只影响该来源。
 *
 * @param source 扫描路径及是否递归的配置。
 * @returns 当前来源扫描出的原生快捷方式条目。
 * @throws runner 启动失败、native 异常、进程退出或超时时抛出。
 */
async function scanSource(source: WindowsScanSource): Promise<WindowsShortcutInfo[]> {
  const recursivePaths = source.recursive ? [source.path] : []
  const flatPaths = source.recursive ? [] : [source.path]
  return WindowsShortcutScanner.scan(recursivePaths, flatPaths, SKIP_FOLDERS)
}

/**
 * 扫描单个来源并把失败转换为结构化结果，避免并发池提前终止。
 *
 * @param source 扫描路径及递归配置。
 * @returns 当前来源的条目或失败原因。
 */
async function scanSourceSafely(source: WindowsScanSource): Promise<WindowsScanSourceResult> {
  try {
    return { source, entries: await scanSource(source) }
  } catch (error) {
    return { source, entries: [], error }
  }
}

/**
 * 去重：按名称+目标路径的组合去重（允许不同名但同目标的应用共存）
 * 对于 .lnk 快捷方式，使用 _dedupeTarget（目标路径）而非 .lnk 路径去重
 * 这样同名同目标但位于不同目录（用户/系统开始菜单）的快捷方式只保留一个
 */
export function deduplicateCommands(apps: (Command & { _dedupeTarget?: string })[]): Command[] {
  const uniqueApps = new Map<string, Command>()
  apps.forEach((app) => {
    // 优先使用 _dedupeTarget（快捷方式的目标路径）去重，降级为 path
    const dedupeTarget = app._dedupeTarget || app.path
    const dedupeKey = `${app.name.toLowerCase()}|${dedupeTarget.toLowerCase()}`
    if (!uniqueApps.has(dedupeKey)) {
      // 清除内部去重字段，不泄漏到外部
      const { _dedupeTarget, ...cleanApp } = app
      uniqueApps.set(dedupeKey, cleanApp)
    }
  })
  return Array.from(uniqueApps.values())
}

/**
 * 扫描 Windows 快捷方式并转换为去重后的应用命令。
 *
 * @returns 扫描出的应用、完整性标记和失败来源摘要。
 */
export async function scanApplications(): Promise<ApplicationScanResult> {
  try {
    // 每个来源使用独立 runner，单个目录超时或崩溃时仍保留其他来源结果。
    const sources: WindowsScanSource[] = [
      ...getWindowsRecursiveScanPaths().map((path) => ({ path, recursive: true })),
      ...getWindowsFlatScanPaths().map((path) => ({ path, recursive: false }))
    ]
    const sourceResults = await pLimit(
      sources.map((source) => () => scanSourceSafely(source)),
      2
    )
    const nativeEntries: WindowsShortcutInfo[] = []
    const errors: string[] = []

    // 汇总成功来源；失败来源只记录诊断，不丢弃其他 runner 的结果。
    sourceResults.forEach((result) => {
      if (!result.error) {
        nativeEntries.push(...result.entries)
        return
      }

      const { source } = result
      const message = `${source.recursive ? 'recursive' : 'flat'}:${source.path}: ${getErrorMessage(result.error)}`
      errors.push(message)
      console.error(`[Scanner] Windows 来源扫描失败，已跳过 ${source.path}:`, result.error)
    })

    const apps: (Command & { _dedupeTarget?: string })[] = []
    for (const entry of nativeEntries) {
      try {
        // 业务字段转换失败只跳过当前快捷方式，不影响其他已解析条目。
        const command = toCommand(entry)
        if (command) apps.push(command)
      } catch (error) {
        console.error(`[Scanner] Windows 快捷方式转换失败，已跳过 ${entry.path}:`, error)
      }
    }

    const deduplicatedApps = deduplicateCommands(apps)

    console.log(
      `[Scanner] native 扫描完成: ${nativeEntries.length} 个条目 -> ${deduplicatedApps.length} 个应用`
    )

    return {
      apps: deduplicatedApps,
      complete: errors.length === 0,
      errors
    }
  } catch (error) {
    console.error('[Scanner] native Windows 应用扫描失败:', error)
    return { apps: [], complete: false, errors: [getErrorMessage(error)] }
  }
}
