import fs from 'fs'
import path from 'path'
import { extractAcronym } from '../../utils/common'
import { getWindowsScanPaths } from '../../utils/systemPaths'
import { toZToolsIconUrl } from '../../common/iconUtils'
import type { WindowsShortcutInfo } from '../native/index'
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
export const SKIP_NAME_PATTERN =
  /^uninstall|^卸载|卸载$|website|网站|帮助|help|readme|read me|文档|manual|license|documentation/i

// ========== 辅助函数 ==========

export function shouldSkipShortcut(name: string): boolean {
  return SKIP_NAME_PATTERN.test(name)
}

export function getIconUrl(appPath: string): string {
  return toZToolsIconUrl(appPath)
}

/**
 * 将 .lnk 文件路径转换为 WindowsShortcutInfo 结构。
 * path 设为 .lnk 文件路径（Launcher 可直接通过 Shell 打开），
 * icon 同样指向 .lnk，图标协议层会通过 Windows Shell 提取目标图标。
 */
function lnkToEntry(lnkPath: string): WindowsShortcutInfo {
  return {
    name: path.basename(lnkPath, '.lnk'),
    path: lnkPath,
    icon: lnkPath,
    sourceType: 'lnk'
  }
}

function toCommand(entry: WindowsShortcutInfo): (Command & { _dedupeTarget?: string }) | null {
  if (!entry.name || !entry.path) {
    return null
  }

  if (shouldSkipShortcut(entry.name)) {
    return null
  }

  return {
    name: entry.name,
    path: entry.path,
    icon: getIconUrl(entry.icon || entry.path),
    acronym: extractAcronym(entry.name),
    _dedupeTarget: entry.targetPath || undefined
  }
}

export function deduplicateCommands(apps: (Command & { _dedupeTarget?: string })[]): Command[] {
  const uniqueApps = new Map<string, Command>()
  apps.forEach((app) => {
    const dedupeTarget = app._dedupeTarget || app.path
    const dedupeKey = `${app.name.toLowerCase()}|${dedupeTarget.toLowerCase()}`
    if (!uniqueApps.has(dedupeKey)) {
      const { _dedupeTarget, ...cleanApp } = app
      uniqueApps.set(dedupeKey, cleanApp)
    }
  })
  return Array.from(uniqueApps.values())
}

/**
 * 递归收集 dir 下所有 .lnk 文件路径。
 * 跳过 SKIP_FOLDERS 中列出的子目录名称（不区分大小写）。
 */
function collectLnkFiles(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = path.join(dir, name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      if (!SKIP_FOLDERS.includes(name.toLowerCase())) {
        collectLnkFiles(full, out)
      }
    } else if (name.toLowerCase().endsWith('.lnk')) {
      out.push(full)
    }
  }
}

/**
 * Windows 应用扫描。
 *
 * 使用 fs.readdirSync 递归收集开始菜单和桌面的 .lnk 文件，
 * 不调用 ztools_native.node，规避 #592 中原生模块在以下条件下
 * 导致进程崩溃（exit code 3221225477 / 0xC0000005）的问题：
 * - Windows 桌面文件夹被重定向到含非 ASCII 字符的路径（如 OneDrive/桌面）
 * - uiohook-napi 全局键盘钩子已在 DoubleTapManager 中启动
 *
 * 由于崩溃属于 OS 级 Access Violation，try/catch 无法捕获，
 * 即使在隔离子进程中调用也会导致子进程直接退出、无法返回结果。
 *
 * 相比原生实现的已知差异：
 * - 不解析 .url 文件（开始菜单中的 URL 快捷方式不显示）
 * - 不读取 desktop.ini 本地化名称（显示英文快捷方式文件名）
 * - 不解析 .lnk 目标路径（dedupeTarget 为空，依赖文件名去重）
 */
export async function scanApplications(): Promise<Command[]> {
  try {
    const scanPaths = getWindowsScanPaths()
    if (scanPaths.length === 0) return []

    const lnkPaths: string[] = []
    for (const sp of scanPaths) {
      collectLnkFiles(sp, lnkPaths)
    }

    const entries = lnkPaths.map(lnkToEntry)
    const apps = entries
      .map((entry) => toCommand(entry))
      .filter((entry): entry is Command & { _dedupeTarget?: string } => entry !== null)

    const deduplicatedApps = deduplicateCommands(apps)

    console.log(
      `[Scanner] fs scan: ${lnkPaths.length} lnk -> ${deduplicatedApps.length} apps`
    )

    return deduplicatedApps
  } catch (error) {
    console.error('[Scanner] Windows app scan failed:', error)
    return []
  }
}
