import Fuse from 'fuse.js'
import { defineStore } from 'pinia'
import { pinyin } from 'pinyin-pro'
import { ref } from 'vue'
import arrowBackwardIcon from '../assets/image/arrow-backward.png'
import settingsFillIcon from '../assets/image/settings-fill.png'
import {
  getCommandId as _getCommandId,
  applySpecialConfig as _applySpecialConfig,
  calculateMatchScore as _calculateMatchScore
} from './commandUtils'
import {
  COMMAND_ALIASES_KEY,
  getLegacyDirectAppCommandId,
  normalizeCommandAliases,
  type CommandAliasStore
} from '@shared/commandShared'
import {
  matchesFilesInput,
  matchesOverText,
  matchesRegexText,
  matchesWindowInput,
  parseMatchPattern,
  type FilesCmdLike,
  type OverCmdLike,
  type RegexCmdLike,
  type WindowCmdLike
} from '@shared/commandContextShared'
import {
  ENABLED_MAIN_PUSH_PLUGINS_KEY,
  isMainPushPluginEnabled,
  normalizeConfigList
} from '@shared/pluginSettings'

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

// Window 匹配指令
interface WindowCmd {
  type: 'window'
  label: string
  match: {
    app?: string[] // 匹配应用名称列表（如 ["Finder.app"]）
    title?: string // 匹配窗口标题的正则表达式字符串
    className?: string[]
  }
}

// 匹配指令联合类型
type MatchCmd = RegexCmd | OverCmd | ImgCmd | FilesCmd | WindowCmd

// 指令类型枚举
export type CommandType =
  | 'direct' // 直接启动（app + system-setting）
  | 'plugin' // 插件功能
  | 'builtin' // 内置功能

// 子类型（用于区分 direct 类型的具体来源）
export type CommandSubType =
  | 'app' // 系统应用
  | 'system-setting' // 系统设置
  | 'local-shortcut' // 本地启动项

// Command 接口（原 App 接口）
export interface Command {
  name: string
  path: string // 纯路径（应用路径 或 插件根目录路径）
  icon?: string
  pinyin?: string
  pinyinAbbr?: string
  acronym?: string // 英文首字母缩写（用于搜索）
  type: CommandType // 指令类型
  subType?: CommandSubType // 子类型（用于区分 direct 类型）
  featureCode?: string // 插件功能代码（用于启动时指定功能）
  pluginName?: string // 插件名称（仅插件类型有效）
  pluginTitle?: string // 插件标题（仅插件类型有效）
  pluginExplain?: string // 插件功能说明
  matchCmd?: MatchCmd // 匹配指令配置（regex 或 over 或 img 或 files 或 window）
  cmdType?: 'text' | 'regex' | 'over' | 'img' | 'files' | 'window' // cmd类型
  mainPush?: boolean // 是否为 mainPush 功能（搜索时动态查询插件获取结果）
  matches?: MatchInfo[] // 搜索匹配信息（用于高亮显示）
  matchType?: 'acronym' | 'name' | 'pinyin' | 'pinyinAbbr' // 匹配类型（用于高亮算法选择）
  // 系统设置字段（新增）
  settingUri?: string // ms-settings URI
  category?: string // 分类（用于分组显示）
  confirmDialog?: any // 确认对话框配置
  originalName?: string // 原始名称（用于 direct/app 旧版禁用键兼容）
  persistedName?: string // 持久化记录里的名称（用于历史/固定在 alias 删除后的删除与取消固定）
}

interface SearchResultScoreMeta {
  result: SearchResult
  scoreText: string
  scoreMatches: MatchInfo[]
}

/**
 * 安全生成 { pinyin, pinyinAbbr } 字段。
 *
 * 插件数据中指令名（cmdName / app.name 等）可能不是字符串（例如对象型 cmd 缺 type
 * 时 cmdName 会是整个对象），直接传入 pinyin() 会返回非字符串并让后续 .replace 崩溃，
 * 进而让整个 loadCommands 失败、搜索栏与历史全部空白。这里统一兜底：
 * 非字符串输入返回空串；pinyin/replace 抛错时也回退为空串，绝不向上抛。
 */
export function toPinyinFields(name: unknown): { pinyin: string; pinyinAbbr: string } {
  if (typeof name !== 'string' || name === '') {
    return { pinyin: '', pinyinAbbr: '' }
  }
  try {
    const full = pinyin(name, { toneType: 'none', type: 'string' })
      .replace(/\s+/g, '')
      .toLowerCase()
    const abbr = pinyin(name, { pattern: 'first', toneType: 'none', type: 'string' })
      .replace(/\s+/g, '')
      .toLowerCase()
    return { pinyin: full, pinyinAbbr: abbr }
  } catch {
    return { pinyin: '', pinyinAbbr: '' }
  }
}

/**
 * 匹配型指令的白名单 type。命中则按 match cmd 处理（取 cmd.label 作名字），
 * 否则视为文本型指令（cmd 本身即为名字）。
 */
const MATCH_CMD_TYPES = ['regex', 'over', 'img', 'files', 'window']

/**
 * 从一条 cmd 规整出 { isMatchCmd, cmdName }。
 *
 * 关键防御：当 cmd 是对象但 type 不在白名单（或缺 type）时，旧逻辑会让 cmdName =
 * 整个对象，再传给 pinyin() 会抛 "is not assignable to type string"。这里强制把
 * cmdName 收敛为字符串：对象型取 label（取不到回退空串），字符串型直接用。
 */
export function normalizeCmd(cmd: unknown): { isMatchCmd: boolean; cmdName: string } {
  if (typeof cmd === 'object' && cmd !== null) {
    const type = (cmd as { type?: unknown }).type
    const isMatchCmd = typeof type === 'string' && MATCH_CMD_TYPES.includes(type)
    const label = (cmd as { label?: unknown }).label
    return { isMatchCmd, cmdName: typeof label === 'string' ? label : '' }
  }
  return { isMatchCmd: false, cmdName: typeof cmd === 'string' ? cmd : '' }
}

// MainPush 功能信息
export interface MainPushFeature {
  /** 提供该 mainPush 功能的插件路径。 */
  pluginPath: string
  /** 提供该 mainPush 功能的插件名称。 */
  pluginName: string
  /** 插件 Logo。 */
  pluginLogo: string
  /** 功能编码。 */
  featureCode: string
  /** 功能说明。 */
  featureExplain: string
  /** 功能图标。 */
  featureIcon?: string
  /** 当前功能声明的 cmd 列表。 */
  cmds: any[]
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

interface RecommendationPin {
  path: string
  featureCode?: string
  name: string
  pluginName?: string
  type: CommandType
}

const HISTORY_DOC_ID = 'command-history'
const PINNED_DOC_ID = 'pinned-commands'
const RECOMMENDATION_PINS_DOC_ID = 'recommendation-pinned'

/**
 * 生成匹配推荐的稳定标识，插件路径变化时优先使用插件名和功能代码。
 * @param command 匹配推荐指令或其持久化记录
 * @returns 可用于去重、查找和排序的稳定标识
 */
export function getRecommendationPinKey(
  command: Pick<Command, 'path' | 'featureCode' | 'name' | 'pluginName' | 'type'>
): string {
  if (command.type === 'plugin') {
    return JSON.stringify([
      'plugin',
      command.pluginName || command.path,
      command.featureCode || command.name
    ])
  }
  return JSON.stringify([command.type, command.path, command.name])
}

export const useCommandDataStore = defineStore('commandData', () => {
  // ===== 特殊指令配置表 =====
  // 支持两种匹配方式：
  // 1. 通过 path 精确匹配（如 'special:last-match'）
  // 2. 通过 subType 匹配（如 'subType:system-setting'）
  const specialCommands: Record<string, Partial<Command>> = {
    'special:last-match': {
      name: '上次匹配',
      icon: arrowBackwardIcon,
      type: 'builtin',
      cmdType: 'text'
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
    return _applySpecialConfig(command, specialCommands)
  }

  // 历史记录
  const history = ref<HistoryItem[]>([])
  // 固定指令
  const pinnedCommands = ref<Command[]>([])
  // 指令列表（用于搜索）
  const commands = ref<Command[]>([]) // 用于 Fuse 模糊搜索的指令列表
  const regexCommands = ref<Command[]>([]) // 只用正则匹配的指令列表
  const mainPushFeatures = ref<MainPushFeature[]>([]) // mainPush 功能列表
  const rawAppsCache = ref<any[]>([])
  const enabledPluginsCache = ref<any[]>([])
  const systemSettingCommandsCache = ref<Command[]>([])
  const localShortcutCommandsCache = ref<Command[]>([])
  const loading = ref(false)
  const fuse = ref<Fuse<Command> | null>(null)
  let loadCommandsRequestId = 0
  // 是否已初始化
  const isInitialized = ref(false)
  // 标记是否是本地触发的更新（用于避免重复加载）
  let isLocalPinnedUpdate = false
  // 禁用指令列表
  const disabledCommands = ref<string[]>([])
  const DISABLED_COMMANDS_KEY = 'disable-commands'
  const disabledPluginPaths = ref<string[]>([])
  const enabledMainPushPluginNames = ref<string[]>([])

  function setDisabledPluginPaths(paths: unknown): void {
    disabledPluginPaths.value = Array.isArray(paths)
      ? paths.filter((item): item is string => typeof item === 'string')
      : []
  }

  function getEnabledPluginPaths(plugins: any[], disabledPaths?: string[]): Set<string> {
    const paths = disabledPaths ?? disabledPluginPaths.value
    const disabledPluginPathSet = new Set(paths)
    return new Set(
      plugins
        .filter((plugin: any) => !disabledPluginPathSet.has(plugin.path))
        .map((p: any) => p.path)
    )
  }
  // 搜索偏好记录（搜索词 -> 上次选中的指令标识）
  const searchPreference = ref<
    Record<string, { path: string; featureCode?: string; name: string }>
  >({})

  // 匹配推荐置顶序列（只影响推荐区，不影响主搜索框固定列表）
  const recommendationPins = ref<RecommendationPin[]>([])

  // 超级面板固定列表缓存
  const superPanelPinned = ref<any[]>([])

  /**
   * 从宿主同步超级面板固定列表缓存。
   */
  async function loadSuperPanelPinnedData(): Promise<void> {
    try {
      superPanelPinned.value = await window.ztools.getSuperPanelPinned()
    } catch {
      superPanelPinned.value = []
    }
  }

  /**
   * 判断某个指令是否已固定到超级面板。
   */
  function isPinnedToSuperPanel(app: any): boolean {
    return superPanelPinned.value.some((item) => {
      if (app.featureCode) {
        return item.path === app.path && item.featureCode === app.featureCode
      }
      return item.path === app.path && item.name === app.name
    })
  }

  // 生成指令唯一标识（与设置插件保持一致，direct/app 使用 path-based 稳定 ID）
  function getCommandId(cmd: Command): string {
    return _getCommandId(cmd)
  }

  /**
   * 基于当前指令列表，找到与历史记录或固定项对应的最新指令快照。
   *
   * - 插件指令：先按 name 精确匹配，再按插件身份 + featureCode 回退。
   * - direct/app：先按 path + name 精确匹配，再按 path 回退，使 alias 删除后自动回退原名。
   * - 其它类型：保持名称级精确匹配。
   */
  function findCurrentCommandMatch(storedCommand: Command): Command | undefined {
    if (storedCommand.type === 'plugin' && storedCommand.featureCode) {
      const isSamePlugin = (cmd: Command): boolean => {
        if (cmd.pluginName && storedCommand.pluginName) {
          return cmd.pluginName === storedCommand.pluginName
        }
        return cmd.path === storedCommand.path
      }

      const isPluginMatch = (cmd: Command): boolean =>
        cmd.type === 'plugin' && cmd.featureCode === storedCommand.featureCode && isSamePlugin(cmd)

      const nameMatch = commands.value.find(
        (cmd) => isPluginMatch(cmd) && cmd.name === storedCommand.name
      )
      if (nameMatch) return nameMatch

      return commands.value.find(isPluginMatch)
    }

    const isStoredDirectApp =
      (storedCommand.type as string) === 'app' ||
      (storedCommand.type === 'direct' && storedCommand.subType === 'app')

    if (isStoredDirectApp) {
      const exactMatch = commands.value.find(
        (cmd) =>
          cmd.type === 'direct' &&
          cmd.subType === 'app' &&
          cmd.path === storedCommand.path &&
          cmd.name === storedCommand.name
      )
      if (exactMatch) return exactMatch

      return commands.value.find(
        (cmd) => cmd.type === 'direct' && cmd.subType === 'app' && cmd.path === storedCommand.path
      )
    }

    return commands.value.find(
      (cmd) =>
        cmd.name === storedCommand.name &&
        cmd.type === storedCommand.type &&
        cmd.subType === storedCommand.subType &&
        cmd.featureCode === storedCommand.featureCode
    )
  }

  /**
   * direct/app 历史与固定支持两种旧数据形态：旧版可能写成 type: 'app'，新版为 type: 'direct' + subType: 'app'。
   */
  function isDirectAppRecord(command: Pick<Command, 'type' | 'subType'>): boolean {
    return (
      (command.type as string) === 'app' || (command.type === 'direct' && command.subType === 'app')
    )
  }

  /**
   * direct/app 历史与固定在回退到原名后，仍保留持久化时的旧名称，便于删除历史或取消固定时命中原记录。
   * persistedName 既兼容旧记录直接写在 name 上，也兼容拖拽排序后单独落盘的 persistedName 字段。
   */
  function attachPersistedName(
    currentCommand: Command | undefined,
    storedCommand: Command
  ): Command | undefined {
    if (!currentCommand) {
      return undefined
    }

    const persistedName = storedCommand.persistedName || storedCommand.name
    if (
      isDirectAppRecord(storedCommand) &&
      persistedName &&
      persistedName !== currentCommand.name
    ) {
      return {
        ...currentCommand,
        persistedName
      }
    }

    return currentCommand
  }

  /**
   * 基于 alias 文本构造一个可搜索的衍生指令。
   */
  function buildAliasSearchCommand(command: Command, alias: string, icon?: string): Command {
    return {
      ...command,
      name: alias,
      icon: icon || command.icon,
      originalName:
        command.type === 'direct' && command.subType === 'app'
          ? command.originalName || command.name
          : command.originalName,
      pinyin: pinyin(alias, { toneType: 'none', type: 'string' }).replace(/\s+/g, '').toLowerCase(),
      pinyinAbbr: pinyin(alias, { pattern: 'first', toneType: 'none', type: 'string' })
        .replace(/\s+/g, '')
        .toLowerCase()
    }
  }

  function getLaunchableAliasEntries(command: Command, aliasesMap: CommandAliasStore): Command[] {
    const cmdType = command.cmdType || 'text'
    const isPluginLaunchable = command.type === 'plugin' && ['text', 'window'].includes(cmdType)
    const isDirectAppLaunchable =
      command.type === 'direct' && command.subType === 'app' && cmdType === 'text'

    if (!isPluginLaunchable && !isDirectAppLaunchable) {
      return []
    }

    const aliasEntries = aliasesMap[getCommandId(command)]
    if (!aliasEntries?.length) {
      return []
    }

    return aliasEntries.map((entry) => buildAliasSearchCommand(command, entry.alias, entry.icon))
  }

  function expandDirectAppAliases(baseApp: Command, aliasesMap: CommandAliasStore): Command[] {
    const aliasCommands = getLaunchableAliasEntries(baseApp, aliasesMap)
    if (!aliasCommands.length) {
      return []
    }

    const seenNames = new Set<string>([
      baseApp.name.toLowerCase(),
      ...((baseApp as any).aliases || [])
        .filter((alias: unknown): alias is string => typeof alias === 'string')
        .map((alias) => alias.toLowerCase())
    ])

    const results: Command[] = []
    for (const aliasCommand of aliasCommands) {
      const normalizedAlias = aliasCommand.name.toLowerCase()
      if (seenNames.has(normalizedAlias)) {
        continue
      }
      seenNames.add(normalizedAlias)
      results.push(aliasCommand)
    }

    return results
  }

  async function loadCommandAliases(): Promise<CommandAliasStore> {
    try {
      const data = await window.ztools.dbGet(COMMAND_ALIASES_KEY)
      return normalizeCommandAliases(data)
    } catch (error) {
      console.error('加载指令别名失败:', error)
      return {}
    }
  }

  /**
   * 检查指令是否被禁用。
   * direct/app 额外兼容旧版 name-based 禁用键。
   */
  function isCommandDisabled(cmd: Command): boolean {
    const id = getCommandId(cmd)
    if (disabledCommands.value.includes(id)) {
      return true
    }

    if (cmd.type === 'direct' && cmd.subType === 'app') {
      return disabledCommands.value.includes(
        getLegacyDirectAppCommandId(cmd.originalName || cmd.name)
      )
    }

    return false
  }

  async function loadDisabledCommands(): Promise<void> {
    try {
      const data = await window.ztools.dbGet(DISABLED_COMMANDS_KEY)
      if (data && Array.isArray(data)) {
        disabledCommands.value = data
      }
    } catch (error) {
      console.error('加载禁用指令列表失败:', error)
    }
  }

  async function loadDisabledPlugins(): Promise<void> {
    try {
      const data = await window.ztools.getDisabledPlugins()
      setDisabledPluginPaths(data)
    } catch (error) {
      console.error('加载禁用插件列表失败:', error)
      disabledPluginPaths.value = []
    }
  }

  async function loadEnabledMainPushPlugins(): Promise<void> {
    try {
      const data = await window.ztools.dbGet(ENABLED_MAIN_PUSH_PLUGINS_KEY)
      enabledMainPushPluginNames.value = normalizeConfigList(data)
    } catch (error) {
      console.error('加载启用 mainPush 插件列表失败:', error)
      enabledMainPushPluginNames.value = []
    }
  }

  async function loadSearchPreference(): Promise<void> {
    try {
      const data = await window.ztools.dbGet('search-preference')
      if (data && typeof data === 'object') {
        searchPreference.value = data
      }
    } catch (error) {
      console.error('加载搜索偏好记录失败:', error)
    }
  }

  /**
   * 从数据库加载匹配推荐的置顶序列。
   * @returns 推荐置顶数据加载完成后结束的 Promise
   */
  async function loadRecommendationPins(): Promise<void> {
    try {
      const data = await window.ztools.dbGet(RECOMMENDATION_PINS_DOC_ID)
      if (!Array.isArray(data)) {
        recommendationPins.value = []
        return
      }

      // 只接受具备最小身份字段的记录，避免损坏数据影响推荐排序。
      recommendationPins.value = data.filter(
        (item): item is RecommendationPin =>
          typeof item?.path === 'string' &&
          typeof item?.name === 'string' &&
          typeof item?.type === 'string'
      )
    } catch (error) {
      console.error('加载匹配推荐置顶数据失败:', error)
      recommendationPins.value = []
    }
  }

  /**
   * 持久化当前匹配推荐置顶序列。
   * @returns 推荐置顶数据保存完成后结束的 Promise
   * @throws 数据库写入失败时抛出原始错误
   */
  async function saveRecommendationPins(): Promise<void> {
    await window.ztools.dbPut(
      RECOMMENDATION_PINS_DOC_ID,
      JSON.parse(JSON.stringify(recommendationPins.value))
    )
  }

  /**
   * 查找推荐指令在置顶序列中的位置。
   * @param command 推荐指令
   * @returns 推荐置顶索引，未置顶时返回 -1
   */
  function getRecommendationPinIndex(command: Command): number {
    const key = getRecommendationPinKey(command)
    return recommendationPins.value.findIndex((item) => getRecommendationPinKey(item) === key)
  }

  /**
   * 判断推荐指令是否已置顶。
   * @param command 推荐指令
   * @returns 是否已置顶
   */
  function isRecommendationPinned(command: Command): boolean {
    return getRecommendationPinIndex(command) >= 0
  }

  /**
   * 按用户设置的置顶序列排序推荐结果。
   * @param commands 当前搜索命中的推荐结果
   * @returns 置顶推荐排在前面的新数组
   */
  function sortRecommendations<T extends Command>(commands: T[]): T[] {
    const pinnedOrder = new Map(
      recommendationPins.value.map((item, index) => [getRecommendationPinKey(item), index])
    )

    return [...commands].sort((a, b) => {
      const indexA = pinnedOrder.get(getRecommendationPinKey(a))
      const indexB = pinnedOrder.get(getRecommendationPinKey(b))
      if (indexA === undefined && indexB === undefined) return 0
      if (indexA === undefined) return 1
      if (indexB === undefined) return -1
      return indexA - indexB
    })
  }

  /**
   * 将推荐指令加入置顶序列末尾。
   * @param command 推荐指令
   * @returns 保存完成后结束的 Promise
   * @throws 数据库写入失败时抛出原始错误
   */
  async function pinRecommendation(command: Command): Promise<void> {
    if (isRecommendationPinned(command)) return

    const previous = recommendationPins.value
    recommendationPins.value = [
      ...previous,
      {
        path: command.path,
        featureCode: command.featureCode,
        name: command.name,
        pluginName: command.pluginName,
        type: command.type
      }
    ]

    try {
      await saveRecommendationPins()
    } catch (error) {
      // 持久化失败时恢复内存顺序，避免界面显示与数据库不一致。
      recommendationPins.value = previous
      throw error
    }
  }

  /**
   * 从置顶序列中移除推荐指令。
   * @param command 推荐指令
   * @returns 保存完成后结束的 Promise
   * @throws 数据库写入失败时抛出原始错误
   */
  async function unpinRecommendation(command: Command): Promise<void> {
    const pinIndex = getRecommendationPinIndex(command)
    if (pinIndex < 0) return

    const previous = recommendationPins.value
    recommendationPins.value = previous.filter((_, index) => index !== pinIndex)

    try {
      await saveRecommendationPins()
    } catch (error) {
      // 持久化失败时回滚本地修改，避免下次搜索顺序产生漂移。
      recommendationPins.value = previous
      throw error
    }
  }

  /**
   * 将已置顶推荐移动到置顶序列第一位。
   * @param command 推荐指令
   * @returns 保存完成后结束的 Promise
   * @throws 数据库写入失败时抛出原始错误
   */
  async function moveRecommendationToFront(command: Command): Promise<void> {
    const pinIndex = getRecommendationPinIndex(command)
    if (pinIndex <= 0) return

    const previous = recommendationPins.value
    const nextOrder = [...previous]
    const [pin] = nextOrder.splice(pinIndex, 1)
    nextOrder.unshift(pin)
    recommendationPins.value = nextOrder

    try {
      await saveRecommendationPins()
    } catch (error) {
      // 持久化失败时回滚本地修改，确保置顶序列仍然可预测。
      recommendationPins.value = previous
      throw error
    }
  }

  // 保存搜索偏好（搜索词 -> 选中的指令）
  async function saveSearchPreference(
    query: string,
    command: { path: string; featureCode?: string; name: string }
  ): Promise<void> {
    const key = query.trim().toLowerCase()
    if (!key) return

    searchPreference.value[key] = {
      path: command.path,
      featureCode: command.featureCode,
      name: command.name
    }
    try {
      await window.ztools.dbPut(
        'search-preference',
        JSON.parse(JSON.stringify(searchPreference.value))
      )
    } catch (error) {
      console.error('保存搜索偏好失败:', error)
    }
  }

  // 从数据库加载所有数据（仅在初始化时调用一次）
  async function initializeData(): Promise<void> {
    if (isInitialized.value) {
      return
    }

    try {
      // 先加载禁用指令列表和指令列表，再加载历史记录和固定列表（历史记录清理需要依赖指令列表）
      await Promise.all([
        loadDisabledCommands(),
        loadDisabledPlugins(),
        loadEnabledMainPushPlugins()
      ])
      await loadCommands()
      await Promise.all([
        loadHistoryData(),
        loadPinnedData(),
        loadSearchPreference(),
        loadRecommendationPins(),
        loadSuperPanelPinnedData()
      ])

      // 监听后端历史记录变化事件
      window.ztools.onHistoryChanged(() => {
        loadHistoryData()
      })

      // 监听指令列表变化事件（应用文件夹变化、插件变化时触发）
      window.ztools.onAppsChanged(() => {
        loadCommands()
      })

      // 监听本地启动项变化事件（添加/删除/别名修改时触发，无需重新扫描系统应用）
      window.ztools.onLocalShortcutsChanged(() => {
        reloadLocalShortcuts()
      })

      // 监听固定列表变化事件
      window.ztools.onPinnedChanged(() => {
        // 如果是本地触发的更新，忽略此事件，避免重复加载
        if (isLocalPinnedUpdate) {
          isLocalPinnedUpdate = false
          return
        }
        loadPinnedData()
      })

      // 监听超级面板固定列表变化事件
      window.ztools.onSuperPanelPinnedChanged(() => {
        loadSuperPanelPinnedData()
      })

      // 监听禁用指令列表变化事件
      window.ztools.onDisabledCommandsChanged(() => {
        loadDisabledCommands()
      })

      // 监听指令别名变化事件，仅基于当前缓存重建 alias 展开，避免重复扫描系统应用。
      window.ztools.onCommandAliasesChanged(() => {
        reloadCommandAliases()
      })

      isInitialized.value = true
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

        // 过滤掉已卸载的插件、无效的指令，并清理系统设置的旧图标路径
        const filteredData = data
          .filter((item: any) => {
            // 特殊指令不检查，直接保留
            if (item.path === 'special:last-match') {
              return true
            }

            // 检查所有类型的历史记录（包括插件、应用、系统设置等）
            // 如果在当前指令列表中找不到，就清理掉
            if (!currentCommandPaths.has(item.path)) return false

            return true
          })
          .map((item: any) => {
            const cleanedItem = { ...item }

            // 1. 迁移旧的系统设置数据格式：type: "system-setting" -> type: "direct", subType: "system-setting"
            if (item.type === 'system-setting') {
              cleanedItem.type = 'direct'
              cleanedItem.subType = 'system-setting'
            }

            // 2. 清理系统设置和特殊指令的旧图标路径
            if (
              (cleanedItem.type === 'direct' && cleanedItem.subType === 'system-setting') ||
              cleanedItem.path?.startsWith('special:')
            ) {
              if (cleanedItem.icon) {
                delete cleanedItem.icon
              }
            }

            return cleanedItem
          })

        // 直接赋值，避免先清空再设置导致的闪烁
        history.value = filteredData
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
        window.ztools.getAllPlugins()
      ])

      if (data && Array.isArray(data)) {
        const enabledPluginPaths = getEnabledPluginPaths(plugins)

        // 过滤掉已卸载或已禁用的插件
        const filteredData = data.filter((item: any) => {
          if (item.type === 'plugin') {
            return enabledPluginPaths.has(item.path)
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
  }

  async function reloadPluginAvailabilityData(): Promise<void> {
    await Promise.all([reloadPluginCommands(), reloadUserData()])
  }

  /**
   * 仅重新加载插件相关指令，不重新获取系统应用。
   * 用于插件安装/卸载/启用/禁用等场景，避免触发系统应用扫描。
   */
  async function reloadPluginCommands(): Promise<void> {
    try {
      const [plugins, disabledPlugins, enabledMainPushPlugins, commandAliases] = await Promise.all([
        window.ztools.getAllPlugins(),
        window.ztools.getDisabledPlugins(),
        window.ztools.dbGet(ENABLED_MAIN_PUSH_PLUGINS_KEY),
        loadCommandAliases()
      ])
      setDisabledPluginPaths(disabledPlugins)
      enabledMainPushPluginNames.value = normalizeConfigList(enabledMainPushPlugins)
      const enabledPluginPaths = getEnabledPluginPaths(plugins)
      enabledPluginsCache.value = plugins.filter((plugin: any) =>
        enabledPluginPaths.has(plugin.path)
      )

      rebuildCommandCollections(commandAliases)
    } catch (error) {
      console.error('[PluginCommands] 重载插件指令失败:', error)
    }
  }

  async function reloadCommandAliases(): Promise<void> {
    try {
      const commandAliases = await loadCommandAliases()
      rebuildCommandCollections(commandAliases)
      console.log('[CommandAliases] 指令别名已更新')
    } catch (error) {
      console.error('[CommandAliases] 重载指令别名失败:', error)
    }
  }

  /**
   * 重建 Fuse.js 搜索索引。
   */
  function rebuildFuseIndex(): void {
    fuse.value = new Fuse(commands.value, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'pinyin', weight: 1.5 },
        { name: 'pinyinAbbr', weight: 1 },
        { name: 'acronym', weight: 1.5 },
        { name: 'aliases', weight: 1.5 } // 别名（英文原名、包名等）
      ],
      threshold: 0,
      ignoreLocation: true,
      includeScore: true,
      includeMatches: true
    })
  }

  /**
   * 从启用的插件列表构建插件指令、正则匹配指令和 mainPush 功能列表。
   */
  function buildPluginCommandItems(
    enabledPlugins: any[],
    commandAliases: CommandAliasStore
  ): { pluginItems: Command[]; regexItems: Command[]; mainPushItems: MainPushFeature[] } {
    const pluginItems: Command[] = []
    const regexItems: Command[] = []
    const mainPushItems: MainPushFeature[] = []

    for (const plugin of enabledPlugins) {
      if (!plugin.features || !Array.isArray(plugin.features) || plugin.features.length === 0) {
        continue
      }

      const hasPluginNameCmd = plugin.features.some((feature: any) =>
        feature.cmds?.some(
          (cmd: any) =>
            (typeof cmd === 'string' ? cmd : cmd.label) === (plugin.title ?? plugin.name)
        )
      )

      if (!hasPluginNameCmd) {
        let defaultFeatureCode: string | undefined = undefined
        let defaultFeatureExplain: string | undefined = undefined
        if (!plugin.main && plugin.features) {
          for (const feature of plugin.features) {
            if (feature.cmds && Array.isArray(feature.cmds)) {
              const hasTextCmd = feature.cmds.some((cmd: any) => typeof cmd === 'string')
              if (hasTextCmd) {
                defaultFeatureCode = feature.code
                defaultFeatureExplain = feature.explain
                break
              }
            }
          }
        }

        const pluginNamePy = toPinyinFields(plugin.name)
        pluginItems.push({
          name: plugin.title ?? plugin.name,
          path: plugin.path,
          icon: plugin.logo,
          type: 'plugin',
          featureCode: defaultFeatureCode,
          pluginName: plugin.name,
          pluginTitle: plugin.title,
          pluginExplain: defaultFeatureExplain || plugin.description,
          pinyin: pluginNamePy.pinyin,
          pinyinAbbr: pluginNamePy.pinyinAbbr
        })
      }

      for (const feature of plugin.features) {
        if (!feature.cmds || !Array.isArray(feature.cmds)) continue

        const featureIcon = feature.icon || plugin.logo
        const isMainPush =
          !!feature.mainPush &&
          isMainPushPluginEnabled(plugin.name, enabledMainPushPluginNames.value)

        if (isMainPush) {
          mainPushItems.push({
            pluginPath: plugin.path,
            pluginName: plugin.name,
            pluginLogo: plugin.logo || '',
            featureCode: feature.code,
            featureExplain: feature.explain || '',
            featureIcon: featureIcon,
            cmds: feature.cmds
          })
        }

        for (const cmd of feature.cmds) {
          // 单 cmd 隔离：任意一条指令解析异常（例如对象型 cmd 缺 type 导致 cmdName 是对象）
          // 不应让整个插件的其余指令、乃至全局搜索栏跟着崩溃。
          try {
            const { isMatchCmd, cmdName } = normalizeCmd(cmd)
            const py = toPinyinFields(cmdName)

            if (isMatchCmd) {
              const matchCommand: Command = {
                name: cmdName,
                path: plugin.path,
                icon: featureIcon,
                type: 'plugin',
                featureCode: feature.code,
                pluginName: plugin.name,
                pluginTitle: plugin.title,
                pluginExplain: feature.explain,
                matchCmd: cmd,
                cmdType: cmd.type,
                mainPush: isMainPush,
                pinyin: py.pinyin,
                pinyinAbbr: py.pinyinAbbr
              }

              regexItems.push(matchCommand)

              if (cmd.type === 'window') {
                pluginItems.push(...getLaunchableAliasEntries(matchCommand, commandAliases))
              }
            } else {
              const textCommand: Command = {
                name: cmdName,
                path: plugin.path,
                icon: featureIcon,
                type: 'plugin',
                featureCode: feature.code,
                pluginName: plugin.name,
                pluginTitle: plugin.title,
                pluginExplain: feature.explain,
                cmdType: 'text',
                mainPush: isMainPush,
                pinyin: py.pinyin,
                pinyinAbbr: py.pinyinAbbr
              }

              pluginItems.push(
                textCommand,
                ...getLaunchableAliasEntries(textCommand, commandAliases)
              )
            }
          } catch (error) {
            console.error('[CommandData] 构建插件指令失败，已跳过该指令:', {
              pluginName: plugin.name,
              featureCode: feature.code,
              cmd,
              error
            })
          }
        }
      }
    }

    return { pluginItems, regexItems, mainPushItems }
  }

  function buildAppCommandItems(rawApps: any[], commandAliases: CommandAliasStore): Command[] {
    return rawApps.flatMap((app) => {
      const extendedApp = app as any
      const basePy = toPinyinFields(app.name)
      const baseApp: Command = {
        ...app,
        type: extendedApp.type || ('direct' as const),
        subType: extendedApp.subType || ('app' as const),
        cmdType: 'text',
        originalName: app.name,
        pinyin: basePy.pinyin,
        pinyinAbbr: basePy.pinyinAbbr
      }
      const result: Command[] = [baseApp]
      if (extendedApp.aliases && Array.isArray(extendedApp.aliases)) {
        for (const alias of extendedApp.aliases) {
          if (alias && alias !== extendedApp.name) {
            const aliasPy = toPinyinFields(alias)
            result.push({
              ...baseApp,
              name: alias,
              pinyin: aliasPy.pinyin,
              pinyinAbbr: aliasPy.pinyinAbbr
            })
          }
        }
      }

      result.push(...expandDirectAppAliases(baseApp, commandAliases))

      return result
    })
  }

  function rebuildCommandCollections(commandAliases: CommandAliasStore): void {
    const appItems = buildAppCommandItems(rawAppsCache.value, commandAliases)
    const { pluginItems, regexItems, mainPushItems } = buildPluginCommandItems(
      enabledPluginsCache.value,
      commandAliases
    )

    commands.value = [
      ...appItems,
      ...pluginItems,
      ...systemSettingCommandsCache.value,
      ...localShortcutCommandsCache.value
    ]
    regexCommands.value = regexItems
    mainPushFeatures.value = mainPushItems

    rebuildFuseIndex()

    console.log(
      `加载了 ${appItems.length} 个应用指令, ${pluginItems.length} 个插件指令, ${systemSettingCommandsCache.value.length} 个系统设置指令, ${localShortcutCommandsCache.value.length} 个本地启动项, ${regexItems.length} 个匹配指令`
    )
  }

  // 加载指令列表
  async function loadCommands(): Promise<void> {
    const requestId = ++loadCommandsRequestId
    loading.value = true
    try {
      const [rawApps, plugins, disabledPlugins, enabledMainPushPlugins, commandAliases] =
        await Promise.all([
          window.ztools.getApps(),
          window.ztools.getAllPlugins(),
          window.ztools.getDisabledPlugins(),
          window.ztools.dbGet(ENABLED_MAIN_PUSH_PLUGINS_KEY),
          loadCommandAliases()
        ])

      let settingCommands: Command[] = []
      try {
        const isWindows = window.ztools.getPlatform() === 'win32'
        if (isWindows) {
          const settings = await window.ztools.getSystemSettings()
          settingCommands = settings.map((s: any) => ({
            name: s.name,
            path: s.uri,
            icon: settingsFillIcon,
            type: 'direct' as const,
            subType: 'system-setting' as const,
            settingUri: s.uri,
            category: s.category,
            confirmDialog: s.confirmDialog,
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

      let localShortcuts: Command[] = []
      try {
        const shortcuts = await window.ztools.localShortcuts.getAll()
        localShortcuts = shortcuts.map((s: any) => ({
          name: s.alias || s.name,
          path: s.path,
          icon: s.icon,
          type: 'direct' as const,
          subType: 'local-shortcut' as const,
          pinyin: s.pinyin || '',
          pinyinAbbr: s.pinyinAbbr || '',
          cmdType: 'text' as const
        }))
      } catch (error) {
        console.error('加载本地启动项失败:', error)
      }

      if (requestId !== loadCommandsRequestId) {
        return
      }

      setDisabledPluginPaths(disabledPlugins)
      enabledMainPushPluginNames.value = normalizeConfigList(enabledMainPushPlugins)
      rawAppsCache.value = rawApps
      const enabledPluginPaths = getEnabledPluginPaths(plugins)
      enabledPluginsCache.value = plugins.filter((plugin: any) =>
        enabledPluginPaths.has(plugin.path)
      )
      systemSettingCommandsCache.value = settingCommands
      localShortcutCommandsCache.value = localShortcuts

      rebuildCommandCollections(commandAliases)
    } catch (error) {
      console.error('加载指令失败:', error)
    } finally {
      if (requestId === loadCommandsRequestId) {
        loading.value = false
      }
    }
  }

  /**
   * 仅重新加载本地启动项并更新搜索索引，不重新扫描系统应用。
   */
  async function reloadLocalShortcuts(): Promise<void> {
    try {
      const shortcuts = await window.ztools.localShortcuts.getAll()
      localShortcutCommandsCache.value = shortcuts.map((s: any) => ({
        name: s.alias || s.name,
        path: s.path,
        icon: s.icon,
        type: 'direct' as const,
        subType: 'local-shortcut' as const,
        pinyin: s.pinyin || '',
        pinyinAbbr: s.pinyinAbbr || '',
        cmdType: 'text' as const
      }))

      rebuildCommandCollections(await loadCommandAliases())

      console.log(
        `[LocalShortcuts] 本地启动项已更新: ${localShortcutCommandsCache.value.length} 个`
      )
    } catch (error) {
      console.error('[LocalShortcuts] 重载本地启动项失败:', error)
    }
  }

  /**
   * 计算匹配分数（用于排序）
   * @param text 被匹配的文本
   * @param query 搜索关键词
   * @param matches 匹配信息
   * @param command 指令对象（可选，用于类型加权）
   * @returns 分数（越高越好）
   */
  function calculateMatchScore(
    text: string,
    query: string,
    matches?: MatchInfo[],
    command?: Command
  ): number {
    return _calculateMatchScore(text, query, matches, command)
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
    // 搜索词过长时跳过 Fuse.js（应用名/指令名通常很短，超长输入走模糊搜索无意义且浪费性能）
    const FUSE_MAX_QUERY_LENGTH = 32
    let bestMatches: SearchResult[] = []

    if (query.length <= FUSE_MAX_QUERY_LENGTH) {
      // 如果指定了搜索范围，创建临时 Fuse 实例
      const searchFuse = commandList
        ? new Fuse(commandList, {
            keys: [
              { name: 'name', weight: 2 },
              { name: 'pinyin', weight: 1.5 },
              { name: 'pinyinAbbr', weight: 1 },
              { name: 'acronym', weight: 1.5 }
            ],
            threshold: 0,
            ignoreLocation: true,
            includeScore: true,
            includeMatches: true
          })
        : fuse.value

      const fuseResults = searchFuse.search(query)
      const scoredMatches: SearchResultScoreMeta[] = fuseResults.map((r) => {
        const displayMatches = (r.matches || []) as MatchInfo[]

        // 检测匹配类型（用于前端高亮算法选择）
        let matchType: 'acronym' | 'name' | 'pinyin' | 'pinyinAbbr' | undefined
        if (displayMatches.length > 0) {
          // 优先级：acronym > name > pinyin > pinyinAbbr
          if (displayMatches.some((m) => m.key === 'acronym')) {
            matchType = 'acronym'
          } else if (displayMatches.some((m) => m.key === 'name')) {
            matchType = 'name'
          } else if (displayMatches.some((m) => m.key === 'pinyin')) {
            matchType = 'pinyin'
          } else if (displayMatches.some((m) => m.key === 'pinyinAbbr')) {
            matchType = 'pinyinAbbr'
          }
        }

        return {
          result: {
            ...r.item,
            matches: displayMatches,
            matchType
          },
          scoreText: r.item.name,
          scoreMatches: displayMatches
        }
      })
      bestMatches = scoredMatches
        .sort((a, b) => {
          // 自定义排序：优先连续匹配，系统应用权重略高
          const scoreA = calculateMatchScore(a.scoreText, query, a.scoreMatches, a.result)
          const scoreB = calculateMatchScore(b.scoreText, query, b.scoreMatches, b.result)
          return scoreB - scoreA // 分数高的排前面
        })
        .map((item) => item.result)

      // 搜索偏好置顶：将上次选中的指令移到第一位
      const prefKey = query.trim().toLowerCase()
      const pref = searchPreference.value[prefKey]
      if (pref) {
        const prefIndex = bestMatches.findIndex(
          (cmd) =>
            cmd.path === pref.path && cmd.featureCode === pref.featureCode && cmd.name === pref.name
        )
        if (prefIndex > 0) {
          const [preferred] = bestMatches.splice(prefIndex, 1)
          bestMatches.unshift(preferred)
        }
      }
    }

    // 2. 匹配指令匹配（从 regexCommands 中查找，包括 regex 和 over 类型）
    const regexMatches: SearchResult[] = []
    for (const cmd of regexCommands.value) {
      if (cmd.matchCmd) {
        if (
          cmd.matchCmd.type === 'regex' &&
          matchesRegexText(query, cmd.matchCmd as RegexCmdLike, { preserveFlags: false })
        ) {
          regexMatches.push(cmd)
        } else if (
          cmd.matchCmd.type === 'over' &&
          matchesOverText(query, cmd.matchCmd as OverCmdLike, {
            useExclude: true,
            preserveExcludeFlags: false
          })
        ) {
          regexMatches.push(cmd)
        }
      }
    }

    // 应用特殊指令配置（确保图标等属性正确）
    const processedBestMatches = bestMatches.filter((cmd) => !isCommandDisabled(cmd))
    const processedRegexMatches = regexMatches
      .filter((cmd) => !isCommandDisabled(cmd))
      .map((cmd) => applySpecialConfig(cmd))

    // 如果指定了搜索范围（用于粘贴内容的二次搜索），不需要 regexMatches
    if (commandList) {
      return { bestMatches: processedBestMatches, regexMatches: [] }
    }

    // 分别返回模糊匹配和正则匹配结果
    return { bestMatches: processedBestMatches, regexMatches: processedRegexMatches }
  }

  // 搜索支持图片的指令
  function searchImageCommands(): SearchResult[] {
    const result = regexCommands.value
      .filter((cmd) => cmd.matchCmd?.type === 'img')
      .filter((cmd) => !isCommandDisabled(cmd))
    // 应用特殊指令配置
    return result.map((cmd) => applySpecialConfig(cmd))
  }

  // 搜索支持文本的指令（根据文本长度过滤）
  function searchTextCommands(pastedText?: string): SearchResult[] {
    if (!pastedText) {
      return []
    }

    const result = regexCommands.value.filter((cmd) => {
      // 支持 over 类型
      if (cmd.matchCmd?.type === 'over') {
        return matchesOverText(pastedText, cmd.matchCmd as OverCmdLike)
      }

      // 支持 regex 类型
      if (cmd.matchCmd?.type === 'regex') {
        return matchesRegexText(pastedText, cmd.matchCmd as RegexCmdLike, {
          preserveFlags: true
        })
      }

      return false
    })

    // 应用特殊指令配置，过滤禁用指令
    return result.filter((cmd) => !isCommandDisabled(cmd)).map((cmd) => applySpecialConfig(cmd))
  }

  // 搜索支持文件的指令（根据配置属性过滤）
  function searchFileCommands(
    pastedFiles?: Array<{ path: string; name: string; isDirectory: boolean }>
  ): SearchResult[] {
    if (!pastedFiles || pastedFiles.length === 0) {
      return []
    }

    const filesCommandsList = regexCommands.value.filter((c) => c.matchCmd?.type === 'files')

    const result = filesCommandsList.filter((cmd) =>
      matchesFilesInput(pastedFiles, cmd.matchCmd as FilesCmdLike, {
        preserveFlags: true,
        allowPlainString: true
      })
    )

    // 应用特殊指令配置，过滤禁用指令
    return result.filter((cmd) => !isCommandDisabled(cmd)).map((cmd) => applySpecialConfig(cmd))
  }

  const windowTitleRegexCache = new Map<string, RegExp | null>()

  // 缓存窗口标题匹配使用的正则对象。
  function getCachedWindowTitleRegex(pattern: string): RegExp | null {
    if (windowTitleRegexCache.has(pattern)) {
      return windowTitleRegexCache.get(pattern) || null
    }

    try {
      const regex = parseMatchPattern(pattern, {
        preserveFlags: false,
        allowPlainString: true
      })
      if (!regex) {
        throw new Error('invalid regex pattern')
      }
      windowTitleRegexCache.set(pattern, regex)
      return regex
    } catch (error) {
      console.error(`窗口标题正则表达式 ${pattern} 解析失败:`, error)
      windowTitleRegexCache.set(pattern, null)
      return null
    }
  }

  // 判断窗口命令是否匹配当前活动窗口。
  function matchesWindowCommand(
    command: Command,
    windowInfo?: { app?: string; title?: string; className?: string } | null
  ): boolean {
    if (
      !windowInfo ||
      (!windowInfo.app && !windowInfo.title) ||
      command.matchCmd?.type !== 'window'
    ) {
      return false
    }

    const windowCmd = command.matchCmd as WindowCmd
    const titleRegex = windowCmd.match.title
      ? getCachedWindowTitleRegex(windowCmd.match.title)
      : null

    return matchesWindowInput(windowInfo, windowCmd as WindowCmdLike, {
      titleRegex,
      preserveTitleFlags: false
    })
  }

  // 搜索支持窗口的指令（根据当前激活窗口进行匹配）
  function searchWindowCommands(windowInfo?: {
    app?: string
    title?: string
    className?: string
  }): SearchResult[] {
    if (!windowInfo || (!windowInfo.app && !windowInfo.title)) {
      return []
    }

    const windowCommandsList = regexCommands.value.filter((c) => c.matchCmd?.type === 'window')
    const result = windowCommandsList.filter((cmd) => matchesWindowCommand(cmd, windowInfo))

    // 应用特殊指令配置，过滤禁用指令
    return result.filter((cmd) => !isCommandDisabled(cmd)).map((cmd) => applySpecialConfig(cmd))
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
      const currentCommand = findCurrentCommandMatch(historyItem)

      // 如果找到了最新数据，使用最新的；否则使用历史记录
      const command =
        attachPersistedName(currentCommand, historyItem) || currentCommand || historyItem

      // 应用特殊指令配置（统一处理）
      return applySpecialConfig(command)
    })

    if (limit) {
      return syncedHistory.slice(0, limit)
    }
    return syncedHistory
  }

  /**
   * 从历史记录中删除指定指令。
   */
  async function removeFromHistory(
    commandPath: string,
    featureCode?: string,
    name?: string
  ): Promise<void> {
    await window.ztools.removeFromHistory(commandPath, featureCode, name)
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
        pluginExplain: cmd.pluginExplain, // 保存插件说明
        pluginName: cmd.pluginName
      }))

      await window.ztools.dbPut(PINNED_DOC_ID, cleanData)
    } catch (error) {
      console.error('保存固定列表失败:', error)
    }
  }

  /**
   * 检查指令是否已固定。
   */
  function isPinned(commandPath: string, featureCode?: string, name?: string): boolean {
    return pinnedCommands.value.some((cmd) => {
      if (cmd.type === 'plugin' && featureCode !== undefined) {
        if (cmd.featureCode !== featureCode) {
          return false
        }
        const matchesPath = cmd.path === commandPath
        const matchesPluginName = Boolean(name && cmd.pluginName === name)
        return matchesPath || matchesPluginName
      }

      if (cmd.type === 'direct' && cmd.subType === 'app') {
        if (name) {
          return cmd.path === commandPath && cmd.name === name
        }
        return cmd.path === commandPath
      }

      if (name) {
        return cmd.path === commandPath && cmd.name === name
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

  /**
   * 取消固定指定指令。
   */
  async function unpinCommand(
    commandPath: string,
    featureCode?: string,
    name?: string
  ): Promise<void> {
    await window.ztools.unpinApp(commandPath, featureCode, name)
    // 后端会发送 pinned-changed 事件，触发重新加载
  }

  // 获取固定列表（自动同步最新数据）
  function getPinnedCommands(): Command[] {
    // 同步固定列表的数据，确保使用最新的路径和图标
    return pinnedCommands.value
      .map((pinnedItem) => {
        const currentCommand = findCurrentCommandMatch(pinnedItem)

        // 如果插件当前不可用（如被禁用），则不展示
        if (!currentCommand && pinnedItem.type === 'plugin') {
          return null
        }

        return attachPersistedName(currentCommand, pinnedItem) || currentCommand || pinnedItem
      })
      .filter((item): item is Command => item !== null)
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

  // ==================== mainPush 相关 ====================

  /**
   * 获取与搜索查询匹配的 mainPush 功能列表
   * 根据每个 mainPush feature 的 cmds 定义检查匹配
   */
  function getMatchingMainPushFeatures(
    query: string
  ): Array<MainPushFeature & { matchedCmdType: string }> {
    if (!query.trim()) return []

    const results: Array<MainPushFeature & { matchedCmdType: string }> = []
    const seen = new Set<string>()

    for (const feature of mainPushFeatures.value) {
      const featureKey = `${feature.pluginPath}:${feature.featureCode}`
      if (seen.has(featureKey)) continue

      let matched = false
      let matchedCmdType = 'text'

      for (const cmd of feature.cmds) {
        if (typeof cmd === 'string') {
          // 文本匹配：检查查询是否部分匹配 cmd 名称（使用 Fuse.js 的结果或简单包含）
          const cmdLower = cmd.toLowerCase()
          const queryLower = query.toLowerCase()
          const cmdPinyin = pinyin(cmd, { toneType: 'none', type: 'string' })
            .replace(/\s+/g, '')
            .toLowerCase()
          const cmdPinyinAbbr = pinyin(cmd, { pattern: 'first', toneType: 'none', type: 'string' })
            .replace(/\s+/g, '')
            .toLowerCase()

          if (
            cmdLower.includes(queryLower) ||
            queryLower.includes(cmdLower) ||
            cmdPinyin.includes(queryLower) ||
            cmdPinyinAbbr.includes(queryLower)
          ) {
            matched = true
            matchedCmdType = 'text'
            break
          }
        } else if (cmd.type === 'regex') {
          if (matchesRegexText(query, cmd as RegexCmdLike, { preserveFlags: false })) {
            matched = true
            matchedCmdType = 'regex'
            break
          }
        } else if (cmd.type === 'over') {
          if (
            matchesOverText(query, cmd as OverCmdLike, {
              useExclude: true,
              preserveExcludeFlags: false
            })
          ) {
            matched = true
            matchedCmdType = 'over'
            break
          }
        }
      }

      if (matched) {
        seen.add(featureKey)
        results.push({ ...feature, matchedCmdType })
      }
    }

    return results
  }

  return {
    // 状态
    history,
    pinnedCommands,
    commands,
    regexCommands,
    mainPushFeatures,
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
    searchWindowCommands,
    matchesWindowCommand,
    reloadUserData,
    applySpecialConfig, // 导出特殊配置应用函数

    // mainPush 相关
    getMatchingMainPushFeatures,

    // 指令历史记录方法（添加由后端处理）
    getRecentCommands,
    removeFromHistory,

    // 固定指令方法
    isPinned,
    pinCommand,
    unpinCommand,
    getPinnedCommands,
    updatePinnedOrder,
    clearPinned,

    // 匹配推荐置顶方法
    getRecommendationPinIndex,
    isRecommendationPinned,
    sortRecommendations,
    pinRecommendation,
    unpinRecommendation,
    moveRecommendationToFront,

    // 超级面板固定方法
    superPanelPinned,
    loadSuperPanelPinnedData,
    isPinnedToSuperPanel,

    // 插件可用性刷新
    reloadPluginAvailabilityData,

    // 搜索偏好
    saveSearchPreference
  }
})
