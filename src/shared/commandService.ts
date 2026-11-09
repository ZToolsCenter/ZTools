import type { CommandAliasStore } from './commandShared'
import type { FilesCmdLike, OverCmdLike, RegexCmdLike, WindowCmdLike } from './commandContextShared'
import type { PluginLaunchSource } from './pluginLaunch'

export type CommandType = 'direct' | 'plugin' | 'builtin' | 'file'
export type CommandSubType = 'app' | 'system-setting' | 'local-shortcut'
export type CommandInputType = 'text' | 'regex' | 'over' | 'img' | 'files' | 'window'
export type MatchCmd =
  | RegexCmdLike
  | OverCmdLike
  | FilesCmdLike
  | WindowCmdLike
  | { type: 'img'; label?: string }

export interface Command {
  name: string
  path: string
  type: CommandType
  subType?: CommandSubType
  icon?: string
  featureCode?: string
  pluginName?: string
  pluginTitle?: string
  pluginExplain?: string
  cmdType?: CommandInputType
  matchCmd?: MatchCmd
  mainPush?: boolean
  pinyin?: string
  pinyinAbbr?: string
  acronym?: string
  aliases?: string[]
  highlightRanges?: Array<[number, number]>
  settingUri?: string
  category?: string
  confirmDialog?: any
  originalName?: string
  persistedName?: string
  /** 执行目标、规则与搜索表示使用不同身份，避免 alias 改变匹配型 payload。 */
  targetId?: string
  ruleId?: string
  resultId?: string
  disabled?: boolean
  windowInfo?: CommandWindowInfo
}

/** 已通过目录入口规范化的指令，内部匹配无需再次猜测身份。 */
export interface CatalogCommand extends Command {
  targetId: string
  ruleId: string
  resultId: string
}

export interface CommandFile {
  path: string
  name: string
  isDirectory: boolean
  isFile?: boolean
}

export interface CommandWindowInfo {
  app?: string
  title?: string
  className?: string
  bundleId?: string
  pid?: number
  hwnd?: number
  path?: string
  url?: string
}

export interface CommandContext {
  searchQuery: string
  pastedImage: string | null
  pastedFiles: CommandFile[] | null
  pastedText: string | null
  windowInfo?: CommandWindowInfo | null
}

/** 匹配只需要图片存在状态；图片内容留在主进程执行快照中。 */
export type CommandMatchContext = Omit<CommandContext, 'pastedImage'> & {
  pastedImage: boolean
}

export interface RecommendationPin {
  path: string
  featureCode?: string
  name: string
  pluginName?: string
  type: CommandType
}

/**
 * 某个搜索词下某条指令被选中的累计次数，用于按搜索词热度排序。
 */
export interface SearchTermStat {
  path: string
  featureCode?: string
  name: string
  count: number
}

export interface CommandUserState {
  history: Command[]
  pinned: Command[]
  superPanelPinned: any[]
  recommendationPins: RecommendationPin[]
  usage: Array<{
    path: string
    featureCode?: string
    name?: string
    useCount?: number
    lastUsed?: number
  }>
  preference: Record<string, { path: string; featureCode?: string; name: string }>
  /** 搜索词 -> 指令唯一键 -> 累计选中次数 */
  searchTermStats: Record<string, Record<string, SearchTermStat>>
}

export type CommandRankState = Pick<
  CommandUserState,
  'preference' | 'usage' | 'recommendationPins' | 'searchTermStats'
>

export interface CommandCatalogInput {
  localAppSearchEnabled?: boolean
  apps: any[]
  plugins: any[]
  settings: any[]
  localShortcuts: any[]
  aliases: CommandAliasStore
  disabledPlugins: string[]
  disabledCommands: string[]
  enabledMainPushPlugins: string[]
}

export interface CommandCatalog {
  commands: CatalogCommand[]
  rules: CatalogCommand[]
  canonical: CatalogCommand[]
  plugins: any[]
}

export interface MainPushItem {
  icon?: string
  text: string
  title?: string
  [key: string]: any
}

export interface MainPushGroup {
  featureKey: string
  pluginPath: string
  pluginName: string
  pluginLogo: string
  featureCode: string
  featureExplain: string
  featureIcon?: string
  matchedCmdType: string
  /** 动态结果选择必须复用产生该组结果的查询上下文。 */
  resultId: string
  items: MainPushItem[]
}

export interface CommandSearchRequest {
  target?: string
  sessionId: string
  requestId: number
  context: CommandContext
  intent?: 'search' | 'panel' | 'window'
  showRecommendations?: boolean
}

/** Worker 只负责匹配，页面会话与查询身份由主进程管理。 */
export interface CommandMatchRequest {
  target?: string
  context: CommandMatchContext
  intent?: CommandSearchRequest['intent']
  showRecommendations?: boolean
  includeMainPush?: boolean
}

export interface CommandSearchResult {
  sessionId: string
  requestId: number
  bestSearchResults: Command[]
  bestMatches: Command[]
  recommendations: Command[]
  allListModeResults: Command[]
  windowCommands: Command[]
  panelResults: Command[]
  mainPushCandidates: Command[]
  mainPushGroups: MainPushGroup[]
  error?: string
}

export type CommandMatchResult = Omit<CommandSearchResult, 'sessionId' | 'requestId'>

/** 每次只发布一个完成的动态分组，避免重复传输静态搜索结果。 */
export interface CommandSearchUpdate {
  sessionId: string
  requestId: number
  group: MainPushGroup
}

export interface CommandHomeState {
  history: Command[]
  pinned: Command[]
  superPanelPinned: any[]
  recommendationPins: RecommendationPin[]
}

export interface CommandExecutionRequest {
  target?: string
  sessionId?: string
  requestId?: number
  resultId?: string
  command?: Command
  context?: CommandContext
  source?: PluginLaunchSource
  option?: MainPushItem
  enterMainPush?: boolean
}

export interface CommandExecutionResult {
  success: boolean
  error?: string
  restoreContext?: CommandContext
}

export type RecommendationOperation = {
  action: 'pin' | 'unpin' | 'front'
  command: RecommendationPin
}

/** 面板点击绑定实际展示的查询；不随固定项持久化。 */
export interface PanelSearchSnapshot {
  sessionId: 'content' | 'window'
  requestId: number
}

export type PanelMutation =
  | {
      action: 'move'
      sourceKey: string
      targetKey?: string | null
      beforeKey?: string
      containerKey?: string
    }
  | { action: 'remove' | 'ungroup' | 'new-folder'; key: string }
  | { action: 'rename'; key: string; name: string }

export interface PanelMutationResult {
  success: boolean
  items: any[]
  error?: string
}

export interface CommandServiceClient {
  query(request: CommandSearchRequest): Promise<CommandSearchResult>
  cancel(sessionId: string, requestId: number): void
  releaseSearch(sessionId: string, requestId: number): void
  execute(request: CommandExecutionRequest): Promise<CommandExecutionResult>
  getHome(): Promise<CommandHomeState>
  getCatalog(): Promise<Command[]>
  recommendation(operation: RecommendationOperation): Promise<CommandHomeState>
  onSearchUpdate(callback: (update: CommandSearchUpdate) => void): () => void
  onStateChanged(callback: () => void): () => void
}

/**
 * 创建当前查询的空结果，供取消、错误和初次渲染复用。
 * @param request 查询身份
 * @returns 不携带旧查询内容的空结果
 */
export function emptyCommandSearchResult(
  request: Pick<CommandSearchRequest, 'sessionId' | 'requestId'>
): CommandSearchResult {
  return {
    sessionId: request.sessionId,
    requestId: request.requestId,
    bestSearchResults: [],
    bestMatches: [],
    recommendations: [],
    allListModeResults: [],
    windowCommands: [],
    panelResults: [],
    mainPushCandidates: [],
    mainPushGroups: []
  }
}

/**
 * 生成推荐置顶的稳定身份，兼容插件安装路径变化。
 * @param command 推荐记录
 * @returns 推荐序列使用的稳定键
 */
export function getRecommendationPinKey(command: RecommendationPin): string {
  return command.type === 'plugin'
    ? JSON.stringify([
        'plugin',
        command.pluginName || command.path,
        command.featureCode || command.name
      ])
    : JSON.stringify([command.type, command.path, command.name])
}
