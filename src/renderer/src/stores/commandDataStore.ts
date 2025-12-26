import Fuse from 'fuse.js'
import { defineStore } from 'pinia'
import { pinyin } from 'pinyin-pro'
import { ref } from 'vue'
import arrowBackwardIcon from '../assets/image/arrow-backward.png'
import baiduLogoIcon from '../assets/image/baidu-logo.png'
import settingsFillIcon from '../assets/image/settings-fill.png'

// 正则匹配指令
interface RegexCmd {
  type: 'regex'
  minLength: number
  match: string
  label: string
}

// Over 匹配指令
interface OverCmd {
  type: 'over'
  label: string
  exclude?: string // 排除的正则表达式字符串
  minLength?: number // 最少字符数
  maxLength?: number // 最多字符数，默认 10000
}

// Img 匹配指令
interface ImgCmd {
  type: 'img'
  label: string
}

// Files 匹配指令
interface FilesCmd {
  type: 'files'
  label: string
  fileType?: 'file' | 'directory' // 文件类型
  extensions?: string[] // 文件扩展名
  match?: string // 匹配文件(夹)名称的正则表达式字符串
  minLength?: number // 最少文件数
  maxLength?: number // 最多文件数
}

// 匹配指令联合类型
type MatchCmd = RegexCmd | OverCmd | ImgCmd | FilesCmd

// 指令类型枚举
export type CommandType =
  | 'direct' // 直接启动（app + system-setting）
  | 'plugin' // 插件功能
  | 'builtin' // 内置功能

// 子类型（用于区分 direct 类型的具体来源）
export type CommandSubType =
  | 'app' // 系统应用
  | 'system-setting' // 系统设置

// Command 接口（原 App 接口）
export interface Command {
  name: string
  path: string // 纯路径（应用路径 或 插件根目录路径）
  icon?: string
  pinyin?: string
  pinyinAbbr?: string
  type: CommandType // 指令类型
  subType?: CommandSubType // 子类型（用于区分 direct 类型）
  featureCode?: string // 插件功能代码（用于启动时指定功能）
  pluginExplain?: string // 插件功能说明
  matchCmd?: MatchCmd // 匹配指令配置（regex 或 over 或 img 或 files）
  cmdType?: 'text' | 'regex' | 'over' | 'img' | 'files' // cmd类型
  matches?: MatchInfo[] // 搜索匹配信息（用于高亮显示）
  // 系统设置字段（新增）
  settingUri?: string // ms-settings URI
  category?: string // 分类（用于分组显示）
  confirmDialog?: any // 确认对话框配置
}

interface MatchInfo {
  indices: Array<[number, number]>
  value: string
  key: string
}

export interface SearchResult extends Command {
  matches?: MatchInfo[]
}

interface HistoryItem extends Command {
  lastUsed: number // 时间戳
  useCount: number // 使用次数
}

const HISTORY_DOC_ID = 'command-history'
const PINNED_DOC_ID = 'pinned-commands'

export const useCommandDataStore = defineStore('commandData', () => {
  // ===== 特殊指令配置表 =====
  // 支持三种匹配方式：
  // 1. 通过 path 精确匹配（如 'special:last-match'）
  // 2. 通过 path 前缀匹配（如 'prefix:baidu-search:'）
  // 3. 通过 subType 匹配（如 'subType:system-setting'）
  const specialCommands: Record<string, Partial<Command>> = {
    'special:last-match': {
      name: '上次匹配',
      icon: arrowBackwardIcon,
      type: 'builtin',
      cmdType: 'text'
    },
    'prefix:baidu-search:': {
      name: '百度搜索',
      icon: baiduLogoIcon,
      type: 'builtin'
    },
    'subType:system-setting': {
      icon: settingsFillIcon
    }
  }

  /**
   * 应用特殊指令配置
   * @param command 原始指令
   * @returns 应用了特殊配置的指令
   */
  function applySpecialConfig(command: Command): Command {
    // 1. 优先通过 path 精确匹配
    const pathConfig = specialCommands[command.path]
    if (pathConfig) {
      return { ...command, ...pathConfig }
    }

    // 2. 通过 path 前缀匹配
    for (const [key, config] of Object.entries(specialCommands)) {
      if (key.startsWith('prefix:')) {
        const prefix = key.substring(7) // 去掉 'prefix:' 前缀
        if (command.path?.startsWith(prefix)) {
          return { ...command, ...config }
        }
      }
    }

    // 3. 通过 subType 匹配
    if (command.subType) {
      const subTypeKey = `subType:${command.subType}`
      const subTypeConfig = specialCommands[subTypeKey]
      if (subTypeConfig) {
        return { ...command, ...subTypeConfig }
      }
    }

    return command
  }

  // 历史记录
  const history = ref<HistoryItem[]>([])
  // 固定指令
  const pinnedCommands = ref<Command[]>([])
  // 指令列表（用于搜索）
  const commands = ref<Command[]>([]) // 用于 Fuse 模糊搜索的指令列表
  const regexCommands = ref<Command[]>([]) // 只用正则匹配的指令列表
  const loading = ref(false)
  const fuse = ref<Fuse<Command> | null>(null)
  // 是否已初始化
  const isInitialized = ref(false)
  // 标记是否是本地触发的更新（用于避免重复加载）
  let isLocalPinnedUpdate = false

  // 从数据库加载所有数据（仅在初始化时调用一次）
  async function initializeData(): Promise<void> {
    if (isInitialized.value) {
      return
    }

    try {
      // 先加载指令列表，再加载历史记录和固定列表（历史记录清理需要依赖指令列表）
      await loadCommands()
      await Promise.all([loadHistoryData(), loadPinnedData()])

      // 监听后端历史记录变化事件
      window.ztools.onHistoryChanged(() => {
        console.log('收到历史记录变化通知，重新加载')
        loadHistoryData()
      })

      // 监听指令列表变化事件（应用文件夹变化时触发）
      window.ztools.onAppsChanged(() => {
        console.log('收到指令列表变化通知，重新加载')
        loadCommands()
      })

      // 监听固定列表变化事件
      window.ztools.onPinnedChanged(() => {
        // 如果是本地触发的更新，忽略此事件，避免重复加载
        if (isLocalPinnedUpdate) {
          console.log('忽略自己触发的固定列表变化通知')
          isLocalPinnedUpdate = false
          return
        }
        console.log('收到固定列表变化通知，重新加载')
        loadPinnedData()
      })

      isInitialized.value = true
      console.log('指令数据初始化完成')
    } catch (error) {
      console.error('初始化指令数据失败:', error)
      history.value = []
      pinnedCommands.value = []
      commands.value = []
      regexCommands.value = []
      isInitialized.value = true
    }
  }

  // 加载历史记录数据
  async function loadHistoryData(): Promise<void> {
    try {
      const data = await window.ztools.dbGet(HISTORY_DOC_ID)

      if (data && Array.isArray(data)) {
        // 创建当前所有指令的 path Set（用于验证历史记录是否仍然有效）
        const currentCommandPaths = new Set(commands.value.map((cmd) => cmd.path))

        console.log(`当前指令列表数量: ${commands.value.length}`)
        console.log(`历史记录数量: ${data.length}`)

        let needsSave = false

        // 过滤掉已卸载的插件、无效的指令，并清理系统设置的旧图标路径
        const filteredData = data
          .filter((item: any) => {
            // 特殊指令不检查，直接保留
            if (item.path === 'special:last-match') {
              return true
            }

            // 检查所有类型的历史记录（包括插件、应用、系统设置等）
            // 如果在当前指令列表中找不到，就清理掉
            if (!currentCommandPaths.has(item.path)) {
              console.log(
                `清理无效指令的历史记录: ${item.name} (type: ${item.type}, path: ${item.path})`
              )
              needsSave = true
              return false
            }

            return true
          })
          .map((item: any) => {
            const cleanedItem = { ...item }

            // 1. 迁移旧的系统设置数据格式：type: "system-setting" -> type: "direct", subType: "system-setting"
            if (item.type === 'system-setting') {
              needsSave = true
              cleanedItem.type = 'direct'
              cleanedItem.subType = 'system-setting'
              console.log(`迁移系统设置数据格式: ${item.name}`)
            }

            // 2. 清理系统设置和特殊指令的旧图标路径
            if (
              (cleanedItem.type === 'direct' && cleanedItem.subType === 'system-setting') ||
              cleanedItem.path?.startsWith('special:')
            ) {
              if (cleanedItem.icon) {
                needsSave = true
                delete cleanedItem.icon
                console.log(`清理历史记录中的旧图标: ${item.name}`)
              }
            }

            return cleanedItem
          })

        // 直接赋值，避免先清空再设置导致的闪烁
        history.value = filteredData

        // 数据迁移已完成，不再需要保存
        // needsSave 标记仅用于记录迁移日志
        if (needsSave) {
          console.log('检测到需要迁移的旧数据格式，已在前端处理')
          console.log('注意：历史记录的修改应该通过后端 API 完成，前端不直接保存')
        }
      } else {
        history.value = []
      }
    } catch (error) {
      console.error('加载历史记录失败:', error)
      history.value = []
    }
  }

  // 加载固定列表数据
  async function loadPinnedData(): Promise<void> {
    try {
      const [data, plugins] = await Promise.all([
        window.ztools.dbGet(PINNED_DOC_ID),
        window.ztools.getPlugins()
      ])

      if (data && Array.isArray(data)) {
        // 获取所有已安装插件的路径 Set
        const installedPluginPaths = new Set(plugins.map((p: any) => p.path))

        // 过滤掉已卸载的插件
        const filteredData = data.filter((item: any) => {
          if (item.type === 'plugin') {
            return installedPluginPaths.has(item.path)
          }
          return true
        })

        pinnedCommands.value = filteredData
      } else {
        pinnedCommands.value = []
      }
    } catch (error) {
      console.error('加载固定列表失败:', error)
      pinnedCommands.value = []
    }
  }

  // 重新加载历史记录和固定列表（用于插件卸载后刷新）
  async function reloadUserData(): Promise<void> {
    await Promise.all([loadHistoryData(), loadPinnedData()])
    console.log('已刷新历史记录和固定列表')
  }

  // 加载指令列表
  async function loadCommands(): Promise<void> {
    loading.value = true
    try {
      const rawApps = await window.ztools.getApps()
      const plugins = await window.ztools.getPlugins()

      // 处理本地应用指令
      const appItems = rawApps.map((app) => ({
        ...app,
        type: 'direct' as const,
        subType: 'app' as const,
        pinyin: pinyin(app.name, { toneType: 'none', type: 'string' })
          .replace(/\s+/g, '')
          .toLowerCase(),
        pinyinAbbr: pinyin(app.name, { pattern: 'first', toneType: 'none', type: 'string' })
          .replace(/\s+/g, '')
          .toLowerCase()
      }))

      // 处理插件：每个 cmd 转换为一个独立指令
      const pluginItems: Command[] = [] // 普通插件指令
      const regexItems: Command[] = [] // 正则匹配指令

      for (const plugin of plugins) {
        if (plugin.features && Array.isArray(plugin.features) && plugin.features.length > 0) {
          // 1. 插件名称本身作为一个指令（不关联具体 feature）
          let defaultFeatureCode: string | undefined = undefined
          // 如果插件没有指定 main，则默认启动第一个非匹配指令的功能
          if (!plugin.main && plugin.features) {
            for (const feature of plugin.features) {
              if (feature.cmds && Array.isArray(feature.cmds)) {
                // 查找是否存在字符串类型的指令（即普通文本指令）
                const hasTextCmd = feature.cmds.some((cmd: any) => typeof cmd === 'string')
                if (hasTextCmd) {
                  defaultFeatureCode = feature.code
                  break
                }
              }
            }
          }

          pluginItems.push({
            name: plugin.name,
            path: plugin.path,
            icon: plugin.logo,
            type: 'plugin',
            featureCode: defaultFeatureCode,
            pinyin: pinyin(plugin.name, { toneType: 'none', type: 'string' })
              .replace(/\s+/g, '')
              .toLowerCase(),
            pinyinAbbr: pinyin(plugin.name, { pattern: 'first', toneType: 'none', type: 'string' })
              .replace(/\s+/g, '')
              .toLowerCase()
          })

          // 2. 每个 feature 的每个 cmd 都作为独立的指令
          for (const feature of plugin.features) {
            if (feature.cmds && Array.isArray(feature.cmds)) {
              // 优先使用 feature 的 icon，如果没有则使用 plugin 的 logo
              const featureIcon = feature.icon || plugin.logo

              for (const cmd of feature.cmds) {
                // cmd 可能是字符串（功能指令）或对象（匹配指令）
                const isMatchCmd =
                  typeof cmd === 'object' &&
                  ['regex', 'over', 'img', 'files', 'window'].includes(cmd.type)
                const cmdName = isMatchCmd ? cmd.label : cmd

                if (isMatchCmd) {
                  // 匹配指令项（regex、over、img、files、window）：也需要拼音搜索
                  regexItems.push({
                    name: cmdName,
                    path: plugin.path,
                    icon: featureIcon,
                    type: 'plugin',
                    featureCode: feature.code,
                    pluginExplain: feature.explain,
                    matchCmd: cmd,
                    cmdType: cmd.type, // 标记匹配类型
                    pinyin: pinyin(cmdName, { toneType: 'none', type: 'string' })
                      .replace(/\s+/g, '')
                      .toLowerCase(),
                    pinyinAbbr: pinyin(cmdName, {
                      pattern: 'first',
                      toneType: 'none',
                      type: 'string'
                    })
                      .replace(/\s+/g, '')
                      .toLowerCase()
                  })
                } else {
                  // 功能指令（文本类型）
                  pluginItems.push({
                    name: cmdName,
                    path: plugin.path,
                    icon: featureIcon,
                    type: 'plugin',
                    featureCode: feature.code,
                    pluginExplain: feature.explain,
                    cmdType: 'text', // 标记为文本类型
                    pinyin: pinyin(cmdName, { toneType: 'none', type: 'string' })
                      .replace(/\s+/g, '')
                      .toLowerCase(),
                    pinyinAbbr: pinyin(cmdName, {
                      pattern: 'first',
                      toneType: 'none',
                      type: 'string'
                    })
                      .replace(/\s+/g, '')
                      .toLowerCase()
                  })
                }
              }
            }
          }
        }
      }

      // 3. 加载系统设置（仅 Windows 平台）
      let settingCommands: Command[] = []
      try {
        const isWindows = await window.ztools.isWindows()
        if (isWindows) {
          const settings = await window.ztools.getSystemSettings()
          settingCommands = settings.map((s: any) => ({
            name: s.name,
            path: s.uri,
            icon: settingsFillIcon, // 使用前端统一图标
            type: 'direct' as const,
            subType: 'system-setting' as const,
            settingUri: s.uri,
            category: s.category,
            confirmDialog: s.confirmDialog, // 传递确认对话框配置
            pinyin: pinyin(s.name, { toneType: 'none', type: 'string' })
              .replace(/\s+/g, '')
              .toLowerCase(),
            pinyinAbbr: pinyin(s.name, { pattern: 'first', toneType: 'none', type: 'string' })
              .replace(/\s+/g, '')
              .toLowerCase()
          }))
        }
      } catch (error) {
        console.error('加载系统设置失败:', error)
      }

      // 合并所有指令
      commands.value = [...appItems, ...pluginItems, ...settingCommands]
      regexCommands.value = regexItems

      console.log(
        `加载了 ${appItems.length} 个应用指令, ${pluginItems.length} 个插件指令, ${settingCommands.length} 个系统设置指令, ${regexItems.length} 个匹配指令`
      )

      // 初始化 Fuse.js 搜索引擎
      fuse.value = new Fuse(commands.value, {
        keys: [
          { name: 'name', weight: 2 }, // 名称权重最高
          { name: 'pinyin', weight: 1.5 }, // 拼音
          { name: 'pinyinAbbr', weight: 1 } // 拼音首字母
        ],
        threshold: 0, // 严格模式
        ignoreLocation: true,
        includeScore: true,
        includeMatches: true // 包含匹配信息
      })
    } catch (error) {
      console.error('加载指令失败:', error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 计算匹配分数（用于排序）
   * @param text 被匹配的文本
   * @param query 搜索关键词
   * @param matches 匹配信息
   * @returns 分数（越高越好）
   */
  function calculateMatchScore(text: string, query: string, matches?: MatchInfo[]): number {
    if (!matches || matches.length === 0) return 0

    let score = 0
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()

    // 1. 完全匹配（最高优先级）
    if (lowerText === lowerQuery) {
      return 10000
    }

    // 2. 前缀匹配（次高优先级）
    if (lowerText.startsWith(lowerQuery)) {
      score += 5000
    }

    // 3. 连续匹配检测
    const consecutiveMatch = lowerText.includes(lowerQuery)
    if (consecutiveMatch) {
      score += 2000
      // 连续匹配位置越靠前，分数越高
      const position = lowerText.indexOf(lowerQuery)
      score += Math.max(0, 500 - position * 10)
    }

    // 4. 匹配长度占比（匹配越多，分数越高）
    const matchRatio = query.length / text.length
    score += matchRatio * 100

    // 5. 匹配位置（越靠前越好）
    if (matches.length > 0 && matches[0].indices && matches[0].indices.length > 0) {
      const firstMatchPosition = matches[0].indices[0][0]
      score += Math.max(0, 100 - firstMatchPosition)
    }

    return score
  }

  // 搜索
  function search(
    query: string,
    commandList?: SearchResult[]
  ): { bestMatches: SearchResult[]; regexMatches: SearchResult[] } {
    // 如果没有指定搜索范围，使用全局指令
    const searchTarget = commandList || commands.value

    if (!query || !fuse.value) {
      return {
        bestMatches: searchTarget.filter((cmd) => cmd.type === 'direct' && cmd.subType === 'app'), // 无搜索时只显示应用
        regexMatches: []
      }
    }

    // 1. Fuse.js 模糊搜索
    // 如果指定了搜索范围，创建临时 Fuse 实例
    const searchFuse = commandList
      ? new Fuse(commandList, {
          keys: [
            { name: 'name', weight: 2 },
            { name: 'pinyin', weight: 1.5 },
            { name: 'pinyinAbbr', weight: 1 }
          ],
          threshold: 0,
          ignoreLocation: true,
          includeScore: true,
          includeMatches: true
        })
      : fuse.value

    const fuseResults = searchFuse.search(query)
    const bestMatches = fuseResults
      .map((r) => ({
        ...r.item,
        matches: r.matches as MatchInfo[],
        _score: r.score || 0
      }))
      .sort((a, b) => {
        // 自定义排序：优先连续匹配
        const scoreA = calculateMatchScore(a.name, query, a.matches)
        const scoreB = calculateMatchScore(b.name, query, b.matches)
        return scoreB - scoreA // 分数高的排前面
      })

    // 2. 匹配指令匹配（从 regexCommands 中查找，包括 regex 和 over 类型）
    const regexMatches: SearchResult[] = []
    for (const cmd of regexCommands.value) {
      if (cmd.matchCmd) {
        if (cmd.matchCmd.type === 'regex') {
          // Regex 类型匹配
          // 检查用户输入长度是否满足最小要求
          if (query.length < cmd.matchCmd.minLength) {
            continue
          }

          try {
            // 提取正则表达式（去掉两边的斜杠和标志）
            const regexStr = cmd.matchCmd.match.replace(/^\/|\/[gimuy]*$/g, '')
            const regex = new RegExp(regexStr)

            // 测试用户输入是否匹配
            if (regex.test(query)) {
              regexMatches.push(cmd)
            }
          } catch (error) {
            console.error(`正则表达式 ${cmd.matchCmd.match} 解析失败:`, error)
          }
        } else if (cmd.matchCmd.type === 'over') {
          // Over 类型匹配
          const minLength = cmd.matchCmd.minLength ?? 1
          const maxLength = cmd.matchCmd.maxLength ?? 10000

          // 检查长度是否满足要求
          if (query.length < minLength || query.length > maxLength) {
            continue
          }

          // 检查是否被排除
          if (cmd.matchCmd.exclude) {
            try {
              const excludeRegexStr = cmd.matchCmd.exclude.replace(/^\/|\/[gimuy]*$/g, '')
              const excludeRegex = new RegExp(excludeRegexStr)

              // 如果匹配到排除规则，跳过
              if (excludeRegex.test(query)) {
                continue
              }
            } catch (error) {
              console.error(`排除正则表达式 ${cmd.matchCmd.exclude} 解析失败:`, error)
            }
          }

          // 通过所有检查，添加到匹配结果
          regexMatches.push(cmd)
        }
      }
    }

    // 应用特殊指令配置（确保图标等属性正确）
    const processedBestMatches = bestMatches.map((cmd) => applySpecialConfig(cmd))
    const processedRegexMatches = regexMatches.map((cmd) => applySpecialConfig(cmd))

    // 如果指定了搜索范围（用于粘贴内容的二次搜索），不需要 regexMatches
    if (commandList) {
      return { bestMatches: processedBestMatches, regexMatches: [] }
    }

    // 分别返回模糊匹配和正则匹配结果
    return { bestMatches: processedBestMatches, regexMatches: processedRegexMatches }
  }

  // 搜索支持图片的指令
  function searchImageCommands(): SearchResult[] {
    const result = regexCommands.value.filter((cmd) => cmd.matchCmd?.type === 'img')
    console.log('searchImageCommands:', {
      total: regexCommands.value.length,
      imgCommands: result.length,
      allTypes: regexCommands.value.map((c) => c.matchCmd?.type)
    })
    // 应用特殊指令配置
    return result.map((cmd) => applySpecialConfig(cmd))
  }

  // 搜索支持文本的指令（根据文本长度过滤）
  function searchTextCommands(pastedText?: string): SearchResult[] {
    if (!pastedText) {
      return []
    }

    const result = regexCommands.value.filter((cmd) => {
      if (cmd.matchCmd?.type !== 'over') {
        return false
      }

      const textLength = pastedText.length
      const minLength = cmd.matchCmd.minLength ?? 1
      const maxLength = cmd.matchCmd.maxLength ?? 10000

      return textLength >= minLength && textLength <= maxLength
    })

    console.log('searchTextCommands:', {
      total: regexCommands.value.length,
      textLength: pastedText.length,
      overCommands: regexCommands.value.filter((c) => c.matchCmd?.type === 'over').length,
      matched: result.length,
      allTypes: regexCommands.value.map((c) => c.matchCmd?.type)
    })

    // 应用特殊指令配置
    return result.map((cmd) => applySpecialConfig(cmd))
  }

  // 搜索支持文件的指令（根据配置属性过滤）
  function searchFileCommands(
    pastedFiles?: Array<{ path: string; name: string; isDirectory: boolean }>
  ): SearchResult[] {
    if (!pastedFiles || pastedFiles.length === 0) {
      return []
    }

    const filesCommandsList = regexCommands.value.filter((c) => c.matchCmd?.type === 'files')

    const result = filesCommandsList.filter((cmd) => {
      const filesCmd = cmd.matchCmd as FilesCmd

      // 1. 检查文件数量是否满足要求
      const fileCount = pastedFiles.length
      const minLength = filesCmd.minLength ?? 1
      const maxLength = filesCmd.maxLength ?? 10000

      console.log(`检查指令 "${cmd.name}":`, {
        fileCount,
        minLength,
        maxLength,
        countCheck: fileCount >= minLength && fileCount <= maxLength
      })

      if (fileCount < minLength || fileCount > maxLength) {
        console.log(`❌ 指令 "${cmd.name}" 文件数量不符合`)
        return false
      }

      // 2. 检查每个文件是否满足条件
      const allFilesMatch = pastedFiles.every((file) => {
        console.log(`检查文件 "${file.name}":`, {
          isDirectory: file.isDirectory,
          fileType: filesCmd.fileType,
          extensions: filesCmd.extensions,
          match: filesCmd.match
        })

        // 2.1 检查文件类型（file 或 directory）
        if (filesCmd.fileType) {
          if (filesCmd.fileType === 'file' && file.isDirectory) {
            console.log(`❌ 文件 "${file.name}" 类型不匹配：需要文件但是文件夹`)
            return false
          }
          if (filesCmd.fileType === 'directory' && !file.isDirectory) {
            console.log(`❌ 文件 "${file.name}" 类型不匹配：需要文件夹但是文件`)
            return false
          }
        }

        // 2.2 检查文件扩展名（只对文件有效，不检查文件夹）
        if (filesCmd.extensions && !file.isDirectory) {
          const ext = file.name.split('.').pop()?.toLowerCase()
          const allowedExts = filesCmd.extensions.map((e) => e.toLowerCase())
          console.log(`检查扩展名: ${ext}, 允许的: [${allowedExts.join(', ')}]`)
          if (!ext || !allowedExts.includes(ext)) {
            console.log(`❌ 文件 "${file.name}" 扩展名不匹配`)
            return false
          }
        }

        // 2.3 检查正则表达式匹配
        if (filesCmd.match) {
          try {
            const matchStr = filesCmd.match.replace(/^\/|\/[gimuy]*$/g, '')
            const regex = new RegExp(matchStr)
            const testResult = regex.test(file.name)
            console.log(`检查正则匹配: ${matchStr}, 结果: ${testResult}`)
            if (!testResult) {
              console.log(`❌ 文件 "${file.name}" 正则不匹配`)
              return false
            }
          } catch (error) {
            console.error(`正则表达式 ${filesCmd.match} 解析失败:`, error)
            return false
          }
        }

        console.log(`✅ 文件 "${file.name}" 通过所有检查`)
        return true
      })

      if (allFilesMatch) {
        console.log(`✅ 指令 "${cmd.name}" 匹配成功`)
      } else {
        console.log(`❌ 指令 "${cmd.name}" 部分文件不匹配`)
      }

      return allFilesMatch
    })

    console.log('searchFileCommands:', {
      total: regexCommands.value.length,
      fileCount: pastedFiles.length,
      filesCommands: regexCommands.value.filter((c) => c.matchCmd?.type === 'files').length,
      matched: result.length,
      allTypes: regexCommands.value.map((c) => c.matchCmd?.type),
      pastedFiles: pastedFiles.map((f) => ({ name: f.name, isDir: f.isDirectory }))
    })

    // 应用特殊指令配置
    return result.map((cmd) => applySpecialConfig(cmd))
  }

  // 在指定的指令列表中搜索（用于粘贴内容后的二次搜索）
  // 统一使用 search 函数，只是传入不同的指令列表
  function searchInCommands(commandList: SearchResult[], query: string): SearchResult[] {
    if (!query || commandList.length === 0) {
      return commandList
    }

    // 使用统一的 search 函数
    const result = search(query, commandList)
    return result.bestMatches
  }

  // ==================== 历史记录相关 ====================

  // 获取最近使用（自动同步最新数据）
  function getRecentCommands(limit?: number): Command[] {
    // 同步历史记录数据，确保使用最新的路径和图标
    const syncedHistory = history.value.map((historyItem) => {
      // 尝试从当前列表中找到
      const currentCommand = commands.value.find(
        (app) =>
          app.name === historyItem.name &&
          app.type === historyItem.type &&
          app.subType === historyItem.subType &&
          app.featureCode === historyItem.featureCode
      )

      // 如果找到了最新数据，使用最新的；否则使用历史记录
      const command = currentCommand || historyItem

      // 应用特殊指令配置（统一处理）
      return applySpecialConfig(command)
    })

    if (limit) {
      return syncedHistory.slice(0, limit)
    }
    return syncedHistory
  }

  // 从历史记录中删除指定指令（通过后端 API）
  async function removeFromHistory(commandPath: string, featureCode?: string): Promise<void> {
    await window.ztools.removeFromHistory(commandPath, featureCode)
    // 后端会发送 history-changed 事件，触发重新加载
  }

  // ==================== 固定应用相关 ====================

  // 保存固定列表到数据库
  async function savePinned(): Promise<void> {
    try {
      const cleanData = pinnedCommands.value.map((cmd) => ({
        name: cmd.name,
        path: cmd.path,
        icon: cmd.icon,
        type: cmd.type,
        featureCode: cmd.featureCode, // 保存 featureCode
        pluginExplain: cmd.pluginExplain // 保存插件说明
      }))

      await window.ztools.dbPut(PINNED_DOC_ID, cleanData)
    } catch (error) {
      console.error('保存固定列表失败:', error)
    }
  }

  // 检查指令是否已固定
  function isPinned(commandPath: string, featureCode?: string): boolean {
    return pinnedCommands.value.some((cmd) => {
      // 对于插件，需要同时匹配 path 和 featureCode
      if (cmd.type === 'plugin' && featureCode !== undefined) {
        return cmd.path === commandPath && cmd.featureCode === featureCode
      }
      return cmd.path === commandPath
    })
  }

  // 固定指令
  async function pinCommand(command: Command): Promise<void> {
    // 将 Vue 响应式对象转换为纯对象，避免 IPC 传递时的克隆错误
    const plainCommand = JSON.parse(JSON.stringify(command))
    await window.ztools.pinApp(plainCommand)
    // 后端会发送 pinned-changed 事件，触发重新加载
  }

  // 取消固定
  async function unpinCommand(commandPath: string, featureCode?: string): Promise<void> {
    await window.ztools.unpinApp(commandPath, featureCode)
    // 后端会发送 pinned-changed 事件，触发重新加载
  }

  // 获取固定列表（自动同步最新数据）
  function getPinnedCommands(): Command[] {
    // 同步固定列表的数据，确保使用最新的路径和图标
    return pinnedCommands.value.map((pinnedItem) => {
      // 尝试从当前列表中找到
      const currentCommand = commands.value.find(
        (cmd) =>
          cmd.name === pinnedItem.name &&
          cmd.type === pinnedItem.type &&
          cmd.subType === pinnedItem.subType &&
          cmd.featureCode === pinnedItem.featureCode
      )

      // 如果找到了最新数据，使用最新的；否则使用固定列表中的
      return currentCommand || pinnedItem
    })
  }

  // 更新固定列表顺序
  async function updatePinnedOrder(newOrder: Command[]): Promise<void> {
    // 乐观更新：立即更新本地状态，避免等待后端导致的延迟和闪动
    pinnedCommands.value = newOrder

    // 标记这是本地触发的更新
    isLocalPinnedUpdate = true

    // 异步保存到后端，不等待完成
    // 将 Vue 响应式对象数组转换为纯对象数组，避免 IPC 传递时的克隆错误
    const plainOrder = JSON.parse(JSON.stringify(newOrder))
    window.ztools.updatePinnedOrder(plainOrder).catch((error) => {
      console.error('保存固定列表顺序失败:', error)
      // 如果保存失败，重置标志并重新从后端加载数据
      isLocalPinnedUpdate = false
      loadPinnedData()
    })
    // 注意：不需要等待 pinned-changed 事件，因为本地已经更新了
  }

  // 清空固定列表
  async function clearPinned(): Promise<void> {
    pinnedCommands.value = []
    await savePinned()
  }

  return {
    // 状态
    history,
    pinnedCommands,
    commands,
    regexCommands,
    loading,
    isInitialized,

    // 初始化
    initializeData,

    // 指令和搜索相关
    loadCommands,
    search,
    searchInCommands,
    searchImageCommands,
    searchTextCommands,
    searchFileCommands,
    reloadUserData,
    applySpecialConfig, // 导出特殊配置应用函数

    // 指令历史记录方法（添加由后端处理）
    getRecentCommands,
    removeFromHistory,

    // 固定指令方法
    isPinned,
    pinCommand,
    unpinCommand,
    getPinnedCommands,
    updatePinnedOrder,
    clearPinned
  }
})
