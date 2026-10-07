import fs from 'fs/promises'
import type { Dirent } from 'fs'
import path from 'path'
import os from 'os'
import { pinyin as getPinyin } from 'pinyin-pro'
import { extractAcronym } from '../../utils/common'
import { getLinuxApplicationPaths } from '../../utils/systemPaths'
import { ApplicationScanResult, Command } from './types'
import { pLimit } from './utils'

// ============================================================
// XDG .desktop 文件解析器
// ============================================================

interface DesktopEntry {
  Name?: string
  GenericName?: string
  Comment?: string
  Exec?: string
  TryExec?: string
  Icon?: string
  NoDisplay?: string
  Hidden?: string
  Type?: string
  Terminal?: string
  DBusActivatable?: string
  OnlyShowIn?: string
  NotShowIn?: string
  // 本地化字段
  [key: string]: string | undefined
}

/**
 * 解析 .desktop 文件，返回 [Desktop Entry] 部分的键值对
 */
function parseDesktopFile(content: string): DesktopEntry {
  const result: DesktopEntry = {}
  let inDesktopEntry = false

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()

    if (line === '[Desktop Entry]') {
      inDesktopEntry = true
      continue
    }

    // 遇到下一个 section 停止解析
    if (line.startsWith('[') && line.endsWith(']') && inDesktopEntry) {
      break
    }

    if (!inDesktopEntry || !line || line.startsWith('#')) continue

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue

    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    result[key] = value
  }

  return result
}

/**
 * 按 XDG 规范解析语言优先级列表。
 * LANGUAGE 是冒号分隔的优先级列表，优先级高于 LC_ALL/LC_MESSAGES/LANG。
 */
function getLanguagePriorityList(): string[] {
  const raw =
    process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''

  const codes: string[] = []
  for (const item of raw.split(':')) {
    const code = item.split('.')[0].split('@')[0].trim() // 去掉 .UTF-8 与 @modifier
    // C/POSIX 表示未本地化，不参与 Name[xx] 匹配
    if (code && code !== 'C' && code !== 'POSIX') {
      codes.push(code)
    }
  }

  return codes
}

/**
 * 获取本地化的应用名称
 * 优先级：按 LANGUAGE 列表依次尝试 Name[lang_COUNTRY] > Name[lang]，最后回退 Name
 */
function getLocalizedName(entry: DesktopEntry): string {
  const candidates: string[] = []

  for (const code of getLanguagePriorityList()) {
    candidates.push(`Name[${code}]`)
    const base = code.split('_')[0]
    if (base && base !== code) {
      candidates.push(`Name[${base}]`) // Name[zh]
    }
  }
  candidates.push('Name') // 兜底

  for (const key of candidates) {
    const value = entry[key]
    if (value && value.trim()) {
      return value.trim()
    }
  }

  return entry['Name']?.trim() || ''
}

/**
 * 清理 Exec 字段中的 % 参数占位符（如 %f, %u, %F, %U ...）
 * 并提取实际可执行文件路径
 */
function cleanExecCommand(exec: string): string {
  return (
    exec
      // %% 表示字面量 %，其余 %x 占位符（%f %u %F %U %i %c %k）整体移除
      .replace(/%([%a-zA-Z])/g, (_match, char: string) => (char === '%' ? '%' : ''))
      .replace(/[ \t]+/g, ' ') // 合并多余空白（用 [ \t] 而非 \s，避免影响后续的引号解析）
      .trim()
  )
}

/**
 * .desktop 的布尔字段大小写不敏感（规范允许 `true` 与 `True`）。
 */
function isTrue(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true'
}

/**
 * 判断条目是否应在当前桌面环境下显示。
 * OnlyShowIn / NotShowIn 以分号分隔，与 XDG_CURRENT_DESKTOP（冒号分隔）比对。
 */
function isShownInCurrentDesktop(entry: DesktopEntry): boolean {
  const current = (process.env.XDG_CURRENT_DESKTOP || '')
    .split(':')
    .map((item) => item.trim())
    .filter(Boolean)

  // 无法判定当前桌面时不过滤，避免把应用全部误杀
  if (current.length === 0) return true

  const parseList = (value: string | undefined): string[] =>
    (value || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)

  const onlyShowIn = parseList(entry.OnlyShowIn)
  if (onlyShowIn.length > 0 && !onlyShowIn.some((desktop) => current.includes(desktop))) {
    return false
  }

  const notShowIn = parseList(entry.NotShowIn)
  if (notShowIn.length > 0 && notShowIn.some((desktop) => current.includes(desktop))) {
    return false
  }

  return true
}

/**
 * 检查命令是否存在于 PATH 中（TryExec 校验用）。
 */
async function isExecutableInPath(command: string): Promise<boolean> {
  if (!command) return false

  if (command.includes('/')) {
    try {
      await fs.access(command, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  const pathEnv = process.env.PATH || ''
  for (const dir of pathEnv.split(':').filter(Boolean)) {
    try {
      await fs.access(path.join(dir, command), fs.constants.X_OK)
      return true
    } catch {
      // 继续在后续目录中查找
    }
  }

  return false
}

// ============================================================
// 图标解析
// ============================================================

// XDG 图标主题搜索路径（按优先级排列）
function getIconSearchPaths(): string[] {
  const home = os.homedir()
  return [
    path.join(home, '.local/share/icons'),
    '/usr/share/icons',
    '/usr/share/pixmaps',
    path.join(home, '.icons'),
    '/usr/local/share/icons',
    '/usr/local/share/pixmaps'
  ]
}

const ICON_EXTENSIONS = ['.png', '.svg', '.xpm']
const ICON_PREFERRED_SIZES = ['256x256', '128x128', '64x64', '48x48', '32x32', 'scalable']

/**
 * 在 XDG 图标主题中查找图标文件路径
 * 如果找不到则返回 null
 */
async function findIconPath(iconName: string): Promise<string | null> {
  // 如果是绝对路径且存在，直接返回
  if (iconName.startsWith('/')) {
    try {
      await fs.access(iconName)
      return iconName
    } catch {
      // 忽略
    }
  }

  // 去除扩展名（.desktop 文件中有时会带扩展名）
  const baseName = iconName.replace(/\.(png|svg|xpm)$/, '')

  const searchPaths = getIconSearchPaths()

  for (const searchPath of searchPaths) {
    // 先检查各个主题目录下的常用尺寸
    try {
      const entries = await fs.readdir(searchPath, { withFileTypes: true })
      const themes = entries.filter((e) => e.isDirectory()).map((e) => e.name)
      for (const theme of ['hicolor', ...themes]) {
        for (const size of ICON_PREFERRED_SIZES) {
          for (const category of ['apps', 'applications']) {
            for (const ext of ICON_EXTENSIONS) {
              const iconPath = path.join(searchPath, theme, size, category, baseName + ext)
              try {
                await fs.access(iconPath)
                return iconPath
              } catch {
                // 忽略
              }
            }
          }
        }
      }
    } catch {
      // 目录不存在，跳过
    }

    // pixmaps 目录直接查找
    for (const ext of ICON_EXTENSIONS) {
      const iconPath = path.join(searchPath, baseName + ext)
      try {
        await fs.access(iconPath)
        return iconPath
      } catch {
        // 忽略
      }
    }
  }

  return null
}

// ============================================================
// 拼音首字母支持
// ============================================================

/**
 * 提取中文字符串的拼音首字母
 * 例如：「微信」→「wx」，「谷歌浏览器」→「gglq」
 */
function extractPinyinAcronym(name: string): string {
  let result = ''
  for (const char of name) {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      try {
        result += getPinyin(char, { pattern: 'first', toneType: 'none' })
      } catch {
        // 忽略
      }
    } else if (/[a-zA-Z]/.test(char)) {
      result += char.toLowerCase()
    }
  }
  return result
}

/**
 * 判断字符串是否包含中文字符
 */
function hasChinese(str: string): boolean {
  return /[\u4e00-\u9fa5]/.test(str)
}

// ============================================================
// 应用扫描入口
// ============================================================

/**
 * 按 XDG 优先级收集 .desktop 文件。
 *
 * 规范规定同一 desktop-file ID（文件名）出现在多个目录时排在前面的优先，
 * 否则用户覆盖安装的条目会和系统条目重复。
 */
async function collectDesktopFiles(dirs: string[]): Promise<{
  files: string[]
  readableDirs: number
}> {
  const byId = new Map<string, string>()
  let readableDirs = 0

  for (const dirPath of dirs) {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
      readableDirs++
    } catch {
      continue // 目录不存在或不可读，跳过
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.desktop')) continue
      // 先到先得：高优先级目录已经登记的 ID 不再被覆盖
      if (!byId.has(entry.name)) {
        byId.set(entry.name, path.join(dirPath, entry.name))
      }
    }
  }

  return { files: [...byId.values()], readableDirs }
}

/**
 * 将单个 .desktop 文件转换为 Command 对象
 * 如果应用不应显示（NoDisplay=true 等），返回 null
 */
async function parseDesktopFileToCommand(desktopPath: string): Promise<Command | null> {
  try {
    const content = await fs.readFile(desktopPath, 'utf-8')
    const entry = parseDesktopFile(content)

    // 过滤不应显示的条目
    if (
      entry.Type !== 'Application' ||
      isTrue(entry.NoDisplay) ||
      isTrue(entry.Hidden) ||
      !entry.Exec
    ) {
      return null
    }

    // 桌面环境限定（KDE/Unity 专属条目不应出现在 GNOME 下）
    if (!isShownInCurrentDesktop(entry)) return null

    // TryExec：规范规定它指向的可执行文件不存在时，该条目视为未安装
    if (entry.TryExec && !(await isExecutableInPath(entry.TryExec))) return null

    const name = getLocalizedName(entry)
    if (!name) return null

    const exec = cleanExecCommand(entry.Exec)
    if (!exec) return null

    // Terminal=true 直接 spawn 会起一个没有终端宿主的进程（静默消失），
    // DBusActivatable=true 规范要求走 D-Bus 激活；两者交给 gio launch 处理
    const needsDesktopLaunch = isTrue(entry.Terminal) || isTrue(entry.DBusActivatable)
    const launchPath = needsDesktopLaunch ? `gio launch "${desktopPath}"` : exec

    // 查找图标
    let iconUrl: string | undefined
    if (entry.Icon) {
      const iconPath = await findIconPath(entry.Icon)
      if (iconPath) {
        // 路径可能含空格或中文，需按 URL 规则编码
        iconUrl = `file://${encodeURI(iconPath)}`
      }
    }

    // 生成搜索别名（英文名 + GenericName + 拼音首字母）
    const aliases: string[] = []

    // 如果有英文原名（Name 字段与本地化名称不同），添加为搜索别名
    const rawEnglishName = entry['Name']?.trim()
    if (rawEnglishName && rawEnglishName !== name) {
      aliases.push(rawEnglishName)
    }

    // GenericName 是「网页浏览器」这类通用描述，用户常按它搜索
    const genericName = entry.GenericName?.trim()
    if (genericName && genericName !== name && !aliases.includes(genericName)) {
      aliases.push(genericName)
    }

    // 生成缩写：英文首字母缩写
    const acronym = extractAcronym(name) || (rawEnglishName ? extractAcronym(rawEnglishName) : '')

    // 如果名称包含中文，生成拼音首字母并加入 aliases
    if (hasChinese(name)) {
      const pinyinAcronym = extractPinyinAcronym(name)
      if (pinyinAcronym && pinyinAcronym !== acronym) {
        aliases.push(pinyinAcronym)
      }
    }

    return {
      name,
      path: launchPath,
      icon: iconUrl,
      aliases: aliases.length > 0 ? aliases : undefined,
      acronym: acronym || undefined
    }
  } catch {
    return null
  }
}

/**
 * 扫描 Linux 系统上安装的所有应用程序
 *
 * @returns 应用列表与扫描完整性（不完整时上层会保留旧缓存）。
 */
export async function scanApplications(): Promise<ApplicationScanResult> {
  const errors: string[] = []

  try {
    console.time('[LinuxScanner] 扫描应用')

    const searchPaths = getLinuxApplicationPaths()
    const { files: uniqueFiles, readableDirs } = await collectDesktopFiles(searchPaths)

    console.log(
      `[LinuxScanner] 在 ${readableDirs}/${searchPaths.length} 个目录中找到 ${uniqueFiles.length} 个 .desktop 文件`
    )

    // 并发解析（限制并发数）
    const tasks = uniqueFiles.map((filePath) => () => parseDesktopFileToCommand(filePath))
    const results = await pLimit(tasks, 30)

    // 过滤掉解析失败或不应显示的项
    const apps = results.filter((cmd): cmd is Command => cmd !== null)

    console.timeEnd('[LinuxScanner] 扫描应用')
    console.log(`[LinuxScanner] 成功加载 ${apps.length} 个应用`)

    // 一个目录都读不到属于环境异常
    if (readableDirs === 0) {
      errors.push('没有可读取的 XDG 应用目录')
      return { apps, complete: false, errors }
    }

    // 有 .desktop 却一个都没解析出来说明链路有问题，需报告不完整以免覆盖旧缓存
    if (uniqueFiles.length > 0 && apps.length === 0) {
      errors.push(`解析 ${uniqueFiles.length} 个 .desktop 文件后没有得到任何可用应用`)
      return { apps, complete: false, errors }
    }

    return { apps, complete: true, errors }
  } catch (error) {
    console.error('[LinuxScanner] 扫描应用失败:', error)
    return { apps: [], complete: false, errors: [String(error)] }
  }
}
