import { app } from 'electron'
import fsSync from 'fs'
import fs from 'fs/promises'
import path from 'path'
import plist from 'simple-plist'
import { extractAcronym } from '../../utils/common'
import { getMacApplicationPaths } from '../../utils/systemPaths'
import { Command } from './types'
import { pLimit } from './utils'

interface LocalizedAppMetadata {
  name: string
  aliases?: string[]
}

/**
 * 清理从应用元数据读取的名称。
 * @param values 尚未校验的名称和别名。
 * @returns 按原始顺序去重后的非空名称。
 */
function uniqueNonEmpty(values: unknown[]): string[] {
  const names = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
  return [...new Set(names)]
}

// 缓存系统语言对应的 lproj 目录名列表
let _lprojNames: string[] | null = null
// 缓存系统语言对应的 loctable key 列表
let _loctableKeys: string[] | null = null

// 将 BCP 47 语言标签转换为 macOS lproj 目录名候选列表
// 例如: "zh-Hans-CN" → ["zh-Hans", "zh-Hans_CN", "zh_CN"]
//       "en-CN"      → ["en_CN", "en"]
//       "ja-JP"      → ["ja", "Japanese", "ja_JP"]
export function bcp47ToLprojNames(tag: string): string[] {
  const candidates: string[] = []
  // BCP 47 格式: language[-Script][-Region]
  const parts = tag.split('-')
  const lang = parts[0]
  let script: string | undefined
  let region: string | undefined

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (p.length === 4 && p[0] === p[0].toUpperCase()) {
      script = p // e.g., "Hans", "Hant"
    } else if (p.length === 2 && p === p.toUpperCase()) {
      region = p // e.g., "CN", "TW", "US"
    }
  }

  // 中文需要 script 信息来区分简繁体
  if (lang === 'zh' && script) {
    candidates.push(`zh-${script}`) // zh-Hans, zh-Hant
    if (region) {
      candidates.push(`zh-${script}_${region}`) // zh-Hans_CN
      candidates.push(`zh_${region}`) // zh_CN
    } else if (script === 'Hans') {
      candidates.push('zh_CN')
      candidates.push('zh_SG')
    } else if (script === 'Hant') {
      candidates.push('zh_TW')
      candidates.push('zh_HK')
    }
  }

  // 常见语言的传统 lproj 名称映射
  const legacyNames: Record<string, string> = {
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    it: 'Italian',
    pt: 'Portuguese',
    nl: 'Dutch',
    sv: 'Swedish',
    da: 'Danish',
    fi: 'Finnish',
    nb: 'Norwegian',
    pl: 'Polish',
    ru: 'Russian',
    en: 'English'
  }

  if (region) {
    candidates.push(`${lang}_${region}`) // en_US, ja_JP
  }
  candidates.push(lang) // en, ja, zh
  if (legacyNames[lang]) {
    candidates.push(legacyNames[lang]) // Japanese, English
  }

  return candidates
}

export function bcp47ToLoctableKeys(tag: string): string[] {
  const candidates: string[] = []
  const parts = tag.split('-')
  const lang = parts[0]
  let script: string | undefined
  let region: string | undefined

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (p.length === 4 && p[0] === p[0].toUpperCase()) {
      script = p
    } else if (p.length === 2 && p === p.toUpperCase()) {
      region = p
    }
  }

  if (lang === 'zh' && script) {
    if (region) {
      candidates.push(`zh_${region}`)
    }

    if (script === 'Hans') {
      candidates.push('zh_CN', 'zh_SG')
    } else if (script === 'Hant') {
      candidates.push('zh_TW', 'zh_HK')
    }
  } else if (region) {
    candidates.push(`${lang}_${region}`)
  }

  candidates.push(lang)
  return [...new Set(candidates)]
}

// 获取系统语言对应的 lproj 目录名候选列表
function getLocaleLprojNames(): string[] {
  if (_lprojNames) return _lprojNames

  // 使用 getPreferredSystemLanguages() 获取准确的系统语言偏好
  // app.getLocale() 在某些情况下返回不准确（如系统中文但返回 en-US）
  const preferredLangs = app.getPreferredSystemLanguages()

  const candidates: string[] = []
  for (const lang of preferredLangs) {
    candidates.push(...bcp47ToLprojNames(lang))
  }

  _lprojNames = [...new Set(candidates)]
  return _lprojNames
}

// 获取系统语言对应的 loctable key 候选列表
// loctable 使用的 key 格式与 lproj 不同，如 "zh_CN"、"en"、"ja"
function getLocaleLoctableKeys(): string[] {
  if (_loctableKeys) return _loctableKeys

  const preferredLangs = app.getPreferredSystemLanguages()
  const candidates: string[] = []

  for (const tag of preferredLangs) {
    candidates.push(...bcp47ToLoctableKeys(tag))
  }

  _loctableKeys = [...new Set(candidates)]
  return _loctableKeys
}

function extractLocalizedAliases(data?: Record<string, string> | null, name?: string): string[] {
  if (!data) return []

  const aliases = Object.entries(data)
    .filter(([key, value]) => key.startsWith('APP_NAME_SYNONYM_') && typeof value === 'string')
    .map(([, value]) => value.trim())
    .filter(Boolean)

  return [...new Set(aliases.filter((alias) => alias !== name))]
}

// 解析 .strings 文件内容
// 支持两种格式：
//   "key" = "value";  （key 有引号）
//   key = "value";    （key 无引号，如 Chromium 系应用）
function parseStringsContent(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const regex = /(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_]\w*))\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const key = match[1] ?? match[2]
    result[key] = match[3]
  }
  return result
}

// 读取 .strings 文件（支持 binary plist、XML plist 和 UTF-16 文本三种格式）
async function readStringsFile(filePath: string): Promise<Record<string, string> | null> {
  // 先尝试 simple-plist（支持 binary plist 和 XML plist）
  try {
    const data: any = await new Promise((resolve, reject) => {
      plist.readFile(filePath, (err: any, result: any) => {
        if (err) reject(err)
        else resolve(result)
      })
    })
    if (data) return data
  } catch {
    // simple-plist 无法解析，可能是 UTF-16 文本格式
  }

  // 回退：手动读取并解析文本格式的 .strings 文件
  try {
    const buf = await fs.readFile(filePath)
    let content: string

    // 检测 BOM 判断编码
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      content = buf.toString('utf16le') // UTF-16 LE
    } else if (buf[0] === 0xfe && buf[1] === 0xff) {
      content = buf.swap16().toString('utf16le') // UTF-16 BE
    } else {
      content = buf.toString('utf8')
    }

    return parseStringsContent(content)
  } catch {
    return null
  }
}

/**
 * 从 .lproj 目录读取首选语言的应用名称。
 * @param resourcesPath 包含本地化资源的目录。
 * @returns 本地化名称及其别名，找不到时返回 null。
 */
async function getLocalizedMetadataFromLproj(
  resourcesPath: string
): Promise<LocalizedAppMetadata | null> {
  const lprojNames = getLocaleLprojNames()

  // 当前语言没有可用名称时继续尝试其余系统首选语言。
  for (const lprojName of lprojNames) {
    const stringsPath = path.join(resourcesPath, `${lprojName}.lproj`, 'InfoPlist.strings')
    try {
      if (!fsSync.existsSync(stringsPath)) continue

      const data = await readStringsFile(stringsPath)
      const name = data?.CFBundleDisplayName || data?.CFBundleName
      if (name) {
        return {
          name,
          aliases: extractLocalizedAliases(data, name)
        }
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * 从 macOS 应用的 InfoPlist.loctable 读取首选语言的名称。
 * @param resourcesPath 包含本地化资源的目录。
 * @returns 本地化名称及其别名，找不到时返回 null。
 */
async function getLocalizedMetadataFromLoctable(
  resourcesPath: string
): Promise<LocalizedAppMetadata | null> {
  // 大多数第三方应用没有 loctable，先检查资源是否存在。
  const loctablePath = path.join(resourcesPath, 'InfoPlist.loctable')
  if (!fsSync.existsSync(loctablePath)) return null

  try {
    const data: any = await new Promise((resolve, reject) => {
      plist.readFile(loctablePath, (err: any, result: any) => {
        if (err) reject(err)
        else resolve(result)
      })
    })

    const keys = getLocaleLoctableKeys()
    for (const key of keys) {
      const entry = data?.[key]
      const name = entry?.CFBundleDisplayName || entry?.CFBundleName
      if (name) {
        return {
          name,
          aliases: extractLocalizedAliases(entry, name)
        }
      }
    }
  } catch {
    // ignore
  }

  return null
}

/**
 * 依次从 .lproj 和 loctable 读取应用的本地化名称。
 * @param resourcesPath 包含本地化资源的目录。
 * @returns 本地化名称及其别名，找不到时返回 null。
 */
async function getLocalizedMetadata(resourcesPath: string): Promise<LocalizedAppMetadata | null> {
  return (
    (await getLocalizedMetadataFromLproj(resourcesPath)) ??
    (await getLocalizedMetadataFromLoctable(resourcesPath))
  )
}

/**
 * 读取 Info.plist 中的默认显示名和内部名称。
 * @param plistPath 应用包的 Info.plist 路径。
 * @returns 可用的包名称，读取失败时返回空数组。
 */
async function getBundleNames(plistPath: string): Promise<string[]> {
  try {
    const data = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      plist.readFile<Record<string, unknown>>(plistPath, (err, result) => {
        if (err) reject(err)
        else resolve(result)
      })
    })

    return uniqueNonEmpty([data?.CFBundleDisplayName, data?.CFBundleName])
  } catch {
    // 外层应用缺少包名称时，调用方会使用文件名。
    return []
  }
}

/**
 * 读取外层应用显示名，并收集用于搜索的包名称。
 * @param appPath 用于启动的外层 .app 路径。
 * @returns 显示名称和可搜索别名。
 */
async function getAppDisplayInfo(appPath: string): Promise<LocalizedAppMetadata> {
  const contentsPath = path.join(appPath, 'Contents')
  const fileName = path.basename(appPath, '.app').trim()
  const bundleNames = await getBundleNames(path.join(contentsPath, 'Info.plist'))
  const localizedMetadata = await getLocalizedMetadata(path.join(contentsPath, 'Resources'))
  const name = localizedMetadata?.name || bundleNames[0] || fileName
  const aliases: Array<string | undefined> = [
    ...bundleNames,
    fileName,
    ...(localizedMetadata?.aliases ?? [])
  ]

  // 将 iOS 应用的内层名称用于搜索，保持外层应用名称与历史记录兼容。
  const wrappedBundlePath = path.join(appPath, 'WrappedBundle')
  const wrappedPlistPath = path.join(wrappedBundlePath, 'Info.plist')
  if (fsSync.existsSync(wrappedPlistPath)) {
    const wrappedMetadata = await getLocalizedMetadata(wrappedBundlePath)
    aliases.push(
      wrappedMetadata?.name,
      ...(wrappedMetadata?.aliases ?? []),
      ...(await getBundleNames(wrappedPlistPath))
    )
  }

  return { name, aliases: uniqueNonEmpty(aliases).filter((alias) => alias !== name) }
}

// 递归收集目录下的 .app bundle
// - 遇到 .app 目录：收集，不再深入（避免把 *.app 内部的 helper 子 app 扫进来）
// - 遇到普通目录且 depth > 0：下钻一层
//   这样可覆盖浏览器 PWA（~/Applications/Chrome Apps.localized/*.app、
//   Edge Apps.localized 等）以及 /Applications/Microsoft Office/*.app 这类嵌套应用
// - 符号链接：readdir 不跟随，指向目录的链接 isDirectory() 为 false，需用 stat 解析真实类型，
//   否则像 /Applications/Safari.app 这类被链接的应用会被漏扫
async function collectAppBundles(dir: string, depth: number, out: string[]): Promise<void> {
  let entries: fsSync.Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    // 解析真实类型：符号链接用 stat 跟随判断是否指向目录
    let isDirectory = entry.isDirectory()
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = (await fs.stat(fullPath)).isDirectory()
      } catch {
        continue // 断链 / 无权限，跳过
      }
    }
    if (!isDirectory) continue

    if (entry.name.endsWith('.app')) {
      out.push(fullPath)
      continue
    }

    if (depth > 0) {
      await collectAppBundles(fullPath, depth - 1, out)
    }
  }
}

export async function scanApplications(): Promise<Command[]> {
  try {
    console.time('[Scanner] 扫描应用')

    // 扫描常用应用目录（与 AppWatcher 监听路径共用同一数据源）
    // Utilities 是 /System/Applications 的直接子目录，depth=1 已自动覆盖，无需显式列出
    const searchPaths = getMacApplicationPaths()

    const collected: string[] = []

    // 读取所有应用路径（下钻一层以覆盖浏览器 PWA 等嵌套在子目录中的 .app）
    for (const searchPath of searchPaths) {
      await collectAppBundles(searchPath, 1, collected)
    }

    // 不同搜索路径可能扫到同一 .app（如 /System/Applications/Utilities 既被显式列出
    // 又会从 /System/Applications 下钻命中），按路径去重
    const allAppPaths = [...new Set(collected)]

    console.log(`[Scanner] 找到 ${allAppPaths.length} 个应用`)

    // 创建任务数组,使用并发控制
    const tasks = allAppPaths.map((appPath) => async () => {
      try {
        const { name, aliases } = await getAppDisplayInfo(appPath)
        const acronymSource = [name, ...(aliases || [])].find(
          (value) => extractAcronym(value) !== ''
        )

        // 应用程序直接使用 .app 路径交给原生层提取图标
        const iconUrl = `ztools-icon://${encodeURIComponent(appPath)}`

        return {
          name,
          path: appPath,
          icon: iconUrl,
          aliases,
          acronym: acronymSource ? extractAcronym(acronymSource) : ''
        }
      } catch {
        const name = path.basename(appPath, '.app')
        return {
          name,
          path: appPath,
          icon: `ztools-icon://${encodeURIComponent(appPath)}`,
          acronym: extractAcronym(name)
        }
      }
    })

    // 限制并发数为 50
    const apps = await pLimit(tasks, 50)

    console.timeEnd('[Scanner] 扫描应用')
    console.log(`[Scanner] 成功加载 ${apps.length} 个应用`)

    return apps
  } catch (error) {
    console.error('[Scanner] 扫描应用失败:', error)
    return []
  }
}
