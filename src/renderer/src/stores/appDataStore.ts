import { defineStore } from 'pinia'
import { ref } from 'vue'
import Fuse from 'fuse.js'
import { pinyin } from 'pinyin-pro'

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

// 匹配指令联合类型
type MatchCmd = RegexCmd | OverCmd

export interface App {
  name: string
  path: string // 纯路径（应用路径 或 插件根目录路径）
  icon?: string
  pinyin?: string
  pinyinAbbr?: string
  type?: 'app' | 'plugin' // 区分应用和插件
  featureCode?: string // 插件功能代码（用于启动时指定功能）
  pluginExplain?: string // 插件功能说明
  matchCmd?: MatchCmd // 匹配指令配置（regex 或 over）
  cmdType?: 'text' | 'regex' | 'over' // cmd类型：text=字符串，regex=正则表达式，over=任意文本匹配
}

interface MatchInfo {
  indices: Array<[number, number]>
  value: string
  key: string
}

export interface SearchResult extends App {
  matches?: MatchInfo[]
}

interface HistoryItem extends App {
  lastUsed: number // 时间戳
  useCount: number // 使用次数
}

const HISTORY_DOC_ID = 'app-history'
const PINNED_DOC_ID = 'pinned-apps'

export const useAppDataStore = defineStore('appData', () => {
  // 历史记录
  const history = ref<HistoryItem[]>([])
  // 固定应用
  const pinnedApps = ref<App[]>([])
  // 应用和插件列表（用于搜索）
  const apps = ref<App[]>([]) // 用于 Fuse 模糊搜索的应用列表
  const regexApps = ref<App[]>([]) // 只用正则匹配的应用列表
  const loading = ref(false)
  const fuse = ref<Fuse<App> | null>(null)
  // 是否已初始化
  const isInitialized = ref(false)

  // 从数据库加载所有数据（仅在初始化时调用一次）
  async function initializeData(): Promise<void> {
    if (isInitialized.value) {
      return
    }

    try {
      // 并行加载历史记录、固定列表和应用列表
      await Promise.all([loadHistoryData(), loadPinnedData(), loadApps()])

      isInitialized.value = true
      console.log('应用数据初始化完成')
    } catch (error) {
      console.error('初始化应用数据失败:', error)
      history.value = []
      pinnedApps.value = []
      apps.value = []
      regexApps.value = []
      isInitialized.value = true
    }
  }

  // 加载历史记录数据
  async function loadHistoryData(): Promise<void> {
    try {
      const data = await window.ztools.dbGet(HISTORY_DOC_ID)
      if (data && Array.isArray(data)) {
        history.value = data
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
      const data = await window.ztools.dbGet(PINNED_DOC_ID)
      if (data && Array.isArray(data)) {
        pinnedApps.value = data
      } else {
        pinnedApps.value = []
      }
    } catch (error) {
      console.error('加载固定列表失败:', error)
      pinnedApps.value = []
    }
  }

  // 重新加载历史记录和固定列表（用于插件卸载后刷新）
  async function reloadUserData(): Promise<void> {
    await Promise.all([loadHistoryData(), loadPinnedData()])
    console.log('已刷新历史记录和固定列表')
  }

  // 加载应用列表
  async function loadApps(): Promise<void> {
    loading.value = true
    try {
      const rawApps = await window.ztools.getApps()
      const plugins = await window.ztools.getPlugins()

      // 处理本地应用
      const appItems = rawApps.map((app) => ({
        ...app,
        type: 'app' as const,
        pinyin: pinyin(app.name, { toneType: 'none', type: 'string' })
          .replace(/\s+/g, '')
          .toLowerCase(),
        pinyinAbbr: pinyin(app.name, { pattern: 'first', toneType: 'none', type: 'string' })
          .replace(/\s+/g, '')
          .toLowerCase()
      }))

      // 处理插件：每个 cmd 转换为一个独立搜索项
      const pluginItems: App[] = [] // 普通插件搜索项
      const regexItems: App[] = [] // 正则匹配搜索项

      for (const plugin of plugins) {
        if (plugin.features && Array.isArray(plugin.features) && plugin.features.length > 0) {
          // 1. 插件名称本身作为一个搜索项（不关联具体 feature）
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

          // 2. 每个 feature 的每个 cmd 都作为独立的搜索项
          for (const feature of plugin.features) {
            if (feature.cmds && Array.isArray(feature.cmds)) {
              for (const cmd of feature.cmds) {
                // cmd 可能是字符串、正则配置对象或 over 配置对象
                const isMatchCmd =
                  typeof cmd === 'object' && (cmd.type === 'regex' || cmd.type === 'over')
                const cmdName = isMatchCmd ? cmd.label : cmd

                if (isMatchCmd) {
                  // 匹配指令项（regex 或 over）：不需要拼音搜索
                  regexItems.push({
                    name: cmdName,
                    path: plugin.path,
                    icon: plugin.logo,
                    type: 'plugin',
                    featureCode: feature.code,
                    pluginExplain: feature.explain,
                    matchCmd: cmd,
                    cmdType: cmd.type // 标记为 regex 或 over 类型
                  })
                } else {
                  // 功能指令
                  pluginItems.push({
                    name: cmdName,
                    path: plugin.path,
                    icon: plugin.logo,
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

      apps.value = [...appItems, ...pluginItems]
      regexApps.value = regexItems

      console.log(
        `加载了 ${appItems.length} 个应用, ${pluginItems.length} 个插件功能, ${regexItems.length} 个正则匹配插件`
      )

      // 初始化 Fuse.js 搜索引擎
      fuse.value = new Fuse(apps.value, {
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
      console.error('加载应用失败:', error)
    } finally {
      loading.value = false
    }
  }

  // 搜索
  function search(query: string): { bestMatches: SearchResult[]; regexMatches: SearchResult[] } {
    if (!query || !fuse.value) {
      return {
        bestMatches: apps.value.filter((app) => app.type === 'app'), // 无搜索时只显示应用
        regexMatches: []
      }
    }

    // 1. Fuse.js 模糊搜索
    const fuseResults = fuse.value.search(query)
    console.log('fuseResults', fuseResults)
    const bestMatches = fuseResults.map((r) => ({
      ...r.item,
      matches: r.matches as MatchInfo[]
    }))

    // 2. 匹配指令匹配（从 regexApps 中查找，包括 regex 和 over 类型）
    const regexMatches: SearchResult[] = []
    for (const app of regexApps.value) {
      if (app.matchCmd) {
        if (app.matchCmd.type === 'regex') {
          // Regex 类型匹配
          // 检查用户输入长度是否满足最小要求
          if (query.length < app.matchCmd.minLength) {
            continue
          }

          try {
            // 提取正则表达式（去掉两边的斜杠和标志）
            const regexStr = app.matchCmd.match.replace(/^\/|\/[gimuy]*$/g, '')
            const regex = new RegExp(regexStr)

            // 测试用户输入是否匹配
            if (regex.test(query)) {
              regexMatches.push(app)
            }
          } catch (error) {
            console.error(`正则表达式 ${app.matchCmd.match} 解析失败:`, error)
          }
        } else if (app.matchCmd.type === 'over') {
          // Over 类型匹配
          const minLength = app.matchCmd.minLength ?? 1
          const maxLength = app.matchCmd.maxLength ?? 10000

          // 检查长度是否满足要求
          if (query.length < minLength || query.length > maxLength) {
            continue
          }

          // 检查是否被排除
          if (app.matchCmd.exclude) {
            try {
              const excludeRegexStr = app.matchCmd.exclude.replace(/^\/|\/[gimuy]*$/g, '')
              const excludeRegex = new RegExp(excludeRegexStr)

              // 如果匹配到排除规则，跳过
              if (excludeRegex.test(query)) {
                continue
              }
            } catch (error) {
              console.error(`排除正则表达式 ${app.matchCmd.exclude} 解析失败:`, error)
            }
          }

          // 通过所有检查，添加到匹配结果
          regexMatches.push(app)
        }
      }
    }

    // 分别返回模糊匹配和正则匹配结果
    return { bestMatches, regexMatches }
  }

  // ==================== 历史记录相关 ====================

  // 保存历史记录到数据库
  async function saveHistory(): Promise<void> {
    try {
      const cleanData = history.value.map((item) => ({
        name: item.name,
        path: item.path,
        icon: item.icon,
        type: item.type,
        featureCode: item.featureCode, // 保存 featureCode
        pluginExplain: item.pluginExplain, // 保存插件说明
        lastUsed: item.lastUsed,
        useCount: item.useCount
      }))

      await window.ztools.dbPut(HISTORY_DOC_ID, cleanData)
    } catch (error) {
      console.error('保存历史记录失败:', error)
    }
  }

  // 添加或更新历史记录
  async function addToHistory(app: App): Promise<void> {
    const now = Date.now()
    // 对于插件，需要同时匹配 path 和 featureCode
    const existingIndex = history.value.findIndex((item) => {
      if (item.type === 'plugin' && app.type === 'plugin') {
        return item.path === app.path && item.featureCode === app.featureCode
      }
      return item.path === app.path
    })

    if (existingIndex >= 0) {
      // 已存在,更新使用时间和次数
      history.value[existingIndex].lastUsed = now
      history.value[existingIndex].useCount++
    } else {
      // 新记录
      history.value.push({
        name: app.name,
        path: app.path,
        icon: app.icon,
        pinyin: app.pinyin,
        pinyinAbbr: app.pinyinAbbr,
        type: app.type,
        featureCode: app.featureCode, // 保存 featureCode
        pluginExplain: app.pluginExplain, // 保存插件说明
        lastUsed: now,
        useCount: 1
      })
    }

    // 按最近使用时间排序
    history.value.sort((a, b) => b.lastUsed - a.lastUsed)

    await saveHistory()
  }

  // 获取最近使用的应用
  function getRecentApps(limit?: number): App[] {
    if (limit) {
      return history.value.slice(0, limit)
    }
    return history.value
  }

  // 从历史记录中删除指定应用
  async function removeFromHistory(appPath: string, featureCode?: string): Promise<void> {
    history.value = history.value.filter((item) => {
      // 对于插件，需要同时匹配 path 和 featureCode
      if (item.type === 'plugin' && featureCode !== undefined) {
        return !(item.path === appPath && item.featureCode === featureCode)
      }
      return item.path !== appPath
    })
    await saveHistory()
  }

  // 清空历史记录
  async function clearHistory(): Promise<void> {
    history.value = []
    await saveHistory()
  }

  // ==================== 固定应用相关 ====================

  // 保存固定列表到数据库
  async function savePinned(): Promise<void> {
    try {
      const cleanData = pinnedApps.value.map((app) => ({
        name: app.name,
        path: app.path,
        icon: app.icon,
        type: app.type,
        featureCode: app.featureCode, // 保存 featureCode
        pluginExplain: app.pluginExplain // 保存插件说明
      }))

      await window.ztools.dbPut(PINNED_DOC_ID, cleanData)
    } catch (error) {
      console.error('保存固定列表失败:', error)
    }
  }

  // 检查应用是否已固定
  function isPinned(appPath: string, featureCode?: string): boolean {
    return pinnedApps.value.some((app) => {
      // 对于插件，需要同时匹配 path 和 featureCode
      if (app.type === 'plugin' && featureCode !== undefined) {
        return app.path === appPath && app.featureCode === featureCode
      }
      return app.path === appPath
    })
  }

  // 固定应用
  async function pinApp(app: App): Promise<void> {
    if (isPinned(app.path, app.featureCode)) {
      return // 已经固定了
    }

    pinnedApps.value.push(app)
    await savePinned()
  }

  // 取消固定
  async function unpinApp(appPath: string, featureCode?: string): Promise<void> {
    pinnedApps.value = pinnedApps.value.filter((app) => {
      // 对于插件，需要同时匹配 path 和 featureCode
      if (app.type === 'plugin' && featureCode !== undefined) {
        return !(app.path === appPath && app.featureCode === featureCode)
      }
      return app.path !== appPath
    })
    await savePinned()
  }

  // 获取固定列表
  function getPinnedApps(): App[] {
    return pinnedApps.value
  }

  // 更新固定列表顺序
  async function updatePinnedOrder(newOrder: App[]): Promise<void> {
    pinnedApps.value = newOrder
    await savePinned()
  }

  // 清空固定列表
  async function clearPinned(): Promise<void> {
    pinnedApps.value = []
    await savePinned()
  }

  return {
    // 状态
    history,
    pinnedApps,
    apps,
    loading,
    isInitialized,

    // 初始化
    initializeData,

    // 应用和搜索相关
    loadApps,
    search,
    reloadUserData,

    // 历史记录方法
    addToHistory,
    getRecentApps,
    removeFromHistory,
    clearHistory,

    // 固定应用方法
    isPinned,
    pinApp,
    unpinApp,
    getPinnedApps,
    updatePinnedOrder,
    clearPinned
  }
})
