import { extractAcronym } from '../../utils/common'
import { getWindowsRootScanPaths, getWindowsScanPaths } from '../../utils/systemPaths'
import { WindowsShortcutScanner, type WindowsShortcutInfo } from '../native/index'
import type { Command } from './types'

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
 * - 递归扫描目录中的快捷方式（Programs 子树 / 桌面）。
 *   处理子目录时跳过 SDK、示例、文档等开发相关文件夹。
 * - 扁平扫描 Start Menu 根。
 *   仅处理本层文件，不下钻 Programs 子目录，避免重复索引。
 *
 * TS 层保留最终的名称过滤、图标协议封装、首字母缩写和去重，避免业务侧行为变化。
 */

// 检查是否应该跳过该快捷方式（仅按名称过滤）
export function shouldSkipShortcut(name: string): boolean {
  return SKIP_NAME_PATTERN.test(name)
}

// 生成图标 URL
export function getIconUrl(appPath: string): string {
  // 将绝对路径编码为 URL
  return `ztools-icon://${encodeURIComponent(appPath)}`
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

export async function scanApplications(): Promise<Command[]> {
  try {
    // 获取 Windows 扫描路径（开始菜单 + 桌面）
    const scanPaths = getWindowsScanPaths()
    // 获取 Start Menu 根路径
    const rootScanPaths = getWindowsRootScanPaths()

    // 原生模块负责递归扫描 Programs + 桌面，并扁平扫描 Start Menu 根
    // 同时在原生模块中处理 desktop.ini 本地化名称、MUI 资源、.url 和 .lnk
    const nativeEntries = WindowsShortcutScanner.scan(scanPaths, rootScanPaths, SKIP_FOLDERS)
    const apps = nativeEntries
      .map((entry) => toCommand(entry))
      .filter((entry): entry is Command & { _dedupeTarget?: string } => entry !== null)

    const deduplicatedApps = deduplicateCommands(apps)

    console.log(
      `[Scanner] native 扫描完成: ${nativeEntries.length} 个条目 -> ${deduplicatedApps.length} 个应用`
    )

    return deduplicatedApps
  } catch (error) {
    console.error('[Scanner] native Windows 应用扫描失败:', error)
    return []
  }
}
