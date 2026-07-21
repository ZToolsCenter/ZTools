const { app, shell } = require('electron')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')

const nativeAddon = require('../resources/lib/win/ztools_native.node')

const SKIP_FOLDERS = [
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

const SKIP_NAME_PATTERN =
  /^uninstall|^卸载|卸载$|website|网站|帮助|help|readme|read me|文档|manual|license|documentation/i

function getWindowsScanPaths() {
  return [
    path.join('C:', 'ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    app.getPath('desktop'),
    path.join('C:', 'Users', 'Public', 'Desktop')
  ]
}

function getWindowsRootScanPaths() {
  return getWindowsScanPaths()
    .filter((p) => p.endsWith(`${path.sep}Programs`))
    .map(path.dirname)
}

function getIconUrl(appPath) {
  return `ztools-icon://${encodeURIComponent(appPath)}`
}

function extractAcronym(name) {
  const words = name.split(/\s+/).filter((word) => word.length > 0)
  if (words.length > 1) {
    return words.map((word) => word[0].toLowerCase()).join('')
  }

  const capitals = name.match(/[A-Z]/g)
  if (capitals && capitals.length > 1) {
    return capitals.map((char) => char.toLowerCase()).join('')
  }

  return ''
}

function shouldSkipShortcut(name) {
  return SKIP_NAME_PATTERN.test(name)
}

async function parseDesktopIni(dirPath) {
  const entries = new Map()
  const iniPath = path.join(dirPath, 'desktop.ini')

  try {
    const buf = await fs.readFile(iniPath)
    const content =
      buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
        ? buf.toString('utf16le')
        : buf.toString('utf8')

    let inSection = false
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '[LocalizedFileNames]') {
        inSection = true
        continue
      }
      if (trimmed.startsWith('[')) {
        inSection = false
        continue
      }
      if (inSection && trimmed.includes('=')) {
        const eqIdx = trimmed.indexOf('=')
        const fileName = trimmed.slice(0, eqIdx)
        const value = trimmed.slice(eqIdx + 1)
        if (fileName && value) {
          entries.set(fileName, value)
        }
      }
    }
  } catch {
    // desktop.ini 不存在或不可读是正常情况。
  }

  return entries
}

function resolveMuiStrings(muiRefs) {
  if (muiRefs.length === 0) return new Map()
  return new Map(Object.entries(nativeAddon.resolveMuiStrings(muiRefs)))
}

async function getLegacyLocalizedDisplayNames(dirPaths) {
  const nameMap = new Map()
  const pendingMui = new Map()

  async function scanDir(dirPath) {
    const iniEntries = await parseDesktopIni(dirPath)

    for (const [fileName, value] of iniEntries) {
      const fullPath = path.join(dirPath, fileName)
      if (value.startsWith('@')) {
        const filePaths = pendingMui.get(value) || []
        filePaths.push(fullPath)
        pendingMui.set(value, filePaths)
      } else {
        nameMap.set(fullPath.toLowerCase(), value)
      }
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await scanDir(path.join(dirPath, entry.name))
        }
      }
    } catch {
      // 与生产扫描器保持一致：不可读目录直接忽略。
    }
  }

  for (const dirPath of dirPaths) {
    await scanDir(dirPath)
  }

  const resolved = resolveMuiStrings(Array.from(pendingMui.keys()))
  for (const [ref, localizedName] of resolved) {
    for (const filePath of pendingMui.get(ref) || []) {
      nameMap.set(filePath.toLowerCase(), localizedName)
    }
  }

  return nameMap
}

async function parseUrlFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    let url = ''
    let iconFile = ''

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('URL=')) {
        url = trimmed.slice(4)
      } else if (trimmed.startsWith('IconFile=')) {
        iconFile = trimmed.slice(9)
      }
    }

    if (!url) return null

    const lowerUrl = url.toLowerCase()
    if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
      return null
    }

    return { url, iconFile }
  } catch {
    return null
  }
}

async function processLegacyShortcutEntry(dirPath, entry, apps, displayNameMap) {
  const fullPath = path.join(dirPath, entry.name)
  const ext = path.extname(entry.name).toLowerCase()

  if (ext === '.url') {
    const urlInfo = await parseUrlFile(fullPath)
    if (!urlInfo) return

    const appName = displayNameMap.get(fullPath.toLowerCase()) || path.basename(entry.name, '.url')
    if (shouldSkipShortcut(appName)) return

    apps.push({
      name: appName,
      path: urlInfo.url,
      icon: getIconUrl(urlInfo.iconFile || fullPath),
      acronym: extractAcronym(appName)
    })
    return
  }

  if (ext !== '.lnk') return

  const appName = displayNameMap.get(fullPath.toLowerCase()) || path.basename(entry.name, '.lnk')
  let shortcutDetails = null
  try {
    shortcutDetails = shell.readShortcutLink(fullPath)
  } catch {
    // Electron 无法解析目标时，沿用快捷方式本身。
  }

  const targetPath = shortcutDetails?.target?.trim() || ''
  if (targetPath.toLowerCase().endsWith('.url')) {
    const urlInfo = await parseUrlFile(targetPath)
    if (!urlInfo) return
    if (shouldSkipShortcut(appName)) return

    apps.push({
      name: appName,
      path: urlInfo.url,
      icon: getIconUrl(urlInfo.iconFile || fullPath),
      acronym: extractAcronym(appName)
    })
    return
  }

  if (shouldSkipShortcut(appName)) return

  apps.push({
    name: appName,
    path: fullPath,
    icon: getIconUrl(fullPath),
    acronym: extractAcronym(appName),
    _dedupeTarget: targetPath || undefined
  })
}

async function scanLegacyDirectory(dirPath, apps, displayNameMap) {
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_FOLDERS.includes(entry.name.toLowerCase())) {
        await scanLegacyDirectory(path.join(dirPath, entry.name), apps, displayNameMap)
      }
      continue
    }

    await processLegacyShortcutEntry(dirPath, entry, apps, displayNameMap)
  }
}

async function scanLegacyDirectoryFlat(dirPath, apps, displayNameMap) {
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      await processLegacyShortcutEntry(dirPath, entry, apps, displayNameMap)
    }
  }
}

function deduplicateCommands(apps) {
  const uniqueApps = new Map()
  for (const appInfo of apps) {
    const dedupeTarget = appInfo._dedupeTarget || appInfo.path
    const dedupeKey = `${appInfo.name.toLowerCase()}|${dedupeTarget.toLowerCase()}`
    if (!uniqueApps.has(dedupeKey)) {
      const { _dedupeTarget, ...cleanApp } = appInfo
      uniqueApps.set(dedupeKey, cleanApp)
    }
  }
  return Array.from(uniqueApps.values())
}

async function scanLegacyApplications(scanPaths, rootScanPaths) {
  const apps = []
  const displayNameMap = await getLegacyLocalizedDisplayNames(scanPaths)

  for (const menuPath of scanPaths) {
    await scanLegacyDirectory(menuPath, apps, displayNameMap)
  }

  for (const rootPath of rootScanPaths) {
    await scanLegacyDirectoryFlat(rootPath, apps, displayNameMap)
  }

  return deduplicateCommands(apps)
}

function nativeEntryToCommand(entry) {
  if (!entry.name || !entry.path || shouldSkipShortcut(entry.name)) {
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

function scanNativeApplications(scanPaths, rootScanPaths) {
  const nativeEntries = nativeAddon.scanWindowsShortcuts(scanPaths, rootScanPaths, SKIP_FOLDERS)
  const apps = nativeEntries.map(nativeEntryToCommand).filter(Boolean)
  return deduplicateCommands(apps)
}

function commandKey(command) {
  return `${command.name.toLowerCase()}|${command.path.toLowerCase()}`
}

function compareCommandSets(legacyApps, nativeApps) {
  const legacyMap = new Map(legacyApps.map((command) => [commandKey(command), command]))
  const nativeMap = new Map(nativeApps.map((command) => [commandKey(command), command]))

  const missingInNative = []
  const extraInNative = []
  const fieldMismatches = []

  for (const [key, legacyCommand] of legacyMap) {
    const nativeCommand = nativeMap.get(key)
    if (!nativeCommand) {
      missingInNative.push(legacyCommand)
      continue
    }

    for (const field of ['name', 'path', 'icon', 'acronym']) {
      if ((legacyCommand[field] || '') !== (nativeCommand[field] || '')) {
        fieldMismatches.push({
          key,
          field,
          legacy: legacyCommand[field] || '',
          native: nativeCommand[field] || ''
        })
      }
    }
  }

  for (const [key, nativeCommand] of nativeMap) {
    if (!legacyMap.has(key)) {
      extraInNative.push(nativeCommand)
    }
  }

  return { missingInNative, extraInNative, fieldMismatches }
}

function printSample(title, rows) {
  if (rows.length === 0) return
  console.error(`\n${title} (${rows.length}, first 10):`)
  for (const row of rows.slice(0, 10)) {
    console.error(JSON.stringify(row, null, 2))
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[ScannerCompare] 已跳过：Windows 扫描器仅在 Windows 下运行')
    return
  }

  await app.whenReady()

  const scanPaths = getWindowsScanPaths()
  const rootScanPaths = getWindowsRootScanPaths()

  const legacyStart = performance.now()
  const legacyApps = await scanLegacyApplications(scanPaths, rootScanPaths)
  const legacyMs = performance.now() - legacyStart

  const nativeStart = performance.now()
  const nativeApps = scanNativeApplications(scanPaths, rootScanPaths)
  const nativeMs = performance.now() - nativeStart

  const diff = compareCommandSets(legacyApps, nativeApps)

  console.log(
    `[ScannerCompare] 旧 TS=${legacyApps.length} 个应用 ${legacyMs.toFixed(0)}ms, native=${nativeApps.length} 个应用 ${nativeMs.toFixed(0)}ms`
  )

  printSample('native 缺失项', diff.missingInNative)
  printSample('native 额外项', diff.extraInNative)
  printSample('字段不一致项', diff.fieldMismatches)

  const failed =
    diff.missingInNative.length > 0 ||
    diff.extraInNative.length > 0 ||
    diff.fieldMismatches.length > 0

  if (failed) {
    throw new Error(
      `Windows 扫描器结果不一致: native缺失=${diff.missingInNative.length}, native额外=${diff.extraInNative.length}, 字段不一致=${diff.fieldMismatches.length}`
    )
  }

  console.log('[ScannerCompare] native 扫描结果与旧 TS 扫描结果一致')
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
