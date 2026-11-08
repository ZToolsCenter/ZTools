import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import arrowBackwardIcon from '../assets/image/arrow-backward.png'
import settingsFillIcon from '../assets/image/settings-fill.png'
import {
  emptyCommandSearchResult,
  getRecommendationPinKey,
  type Command,
  type CommandContext,
  type CommandExecutionRequest,
  type CommandHomeState,
  type CommandSearchResult,
  type CommandSearchUpdate,
  type MainPushGroup,
  type RecommendationOperation
} from '@shared/commandService'

export type { Command, CommandType, CommandSubType } from '@shared/commandService'
export { getRecommendationPinKey } from '@shared/commandService'
export type SearchResult = Command

/**
 * 补充宿主内置资源，保持服务端业务身份与排序。
 * @param command 主进程显示项
 * @returns 带显示图标的指令
 */
function decorate(command: Command): Command {
  if (command.path === 'special:last-match') return { ...command, icon: arrowBackwardIcon }
  if (command.subType === 'system-setting') return { ...command, icon: settingsFillIcon }
  return command
}

/**
 * 保存主进程返回的展示快照与查询身份。
 * @returns Pinia 展示状态
 */
export const useCommandDataStore = defineStore('commandData', () => {
  const history = shallowRef<Command[]>([])
  const pinnedCommands = shallowRef<Command[]>([])
  const superPanelPinned = shallowRef<any[]>([])
  const recommendationPins = shallowRef<CommandHomeState['recommendationPins']>([])
  const loading = ref(false)
  const isInitialized = ref(false)
  const stateVersion = ref(0)
  const sessionId = 'main-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  const requestId = ref(0)
  const searchPending = ref(false)
  const pendingGroups = new Map<string, MainPushGroup>()
  let context: CommandContext = {
    searchQuery: '',
    pastedImage: null,
    pastedFiles: null,
    pastedText: null
  }
  const display = shallowRef({
    result: emptyCommandSearchResult({ sessionId, requestId: 0 }),
    context
  })
  const result = computed(() => display.value.result)
  const displayContext = computed(() => display.value.context)
  let homeVersion = 0
  const listeners: Array<() => void> = []
  onScopeDispose(() => {
    listeners.forEach((remove) => remove())
    window.ztools.commands.cancel(sessionId, ++requestId.value)
  })

  /**
   * 应用主页状态。
   * @param home 主进程快照
   * @returns 无返回值
   */
  function applyHome(home: CommandHomeState): void {
    history.value = home.history.map(decorate)
    pinnedCommands.value = home.pinned.map(decorate)
    superPanelPinned.value = home.superPanelPinned
    recommendationPins.value = home.recommendationPins
  }

  /**
   * 刷新历史与固定显示。
   * @returns 刷新完成的 Promise
   */
  async function reloadUserData(): Promise<void> {
    const version = ++homeVersion
    const home = await window.ztools.commands.getHome()
    if (version === homeVersion) applyHome(home)
  }

  /**
   * 按静态候选顺序合并已完成的动态分组，保留静态数组引用。
   * @param incoming 当前结果快照
   * @param groups 新完成的动态分组
   * @returns 合并后的结果快照
   */
  function mergeGroups(
    incoming: CommandSearchResult,
    groups: Iterable<MainPushGroup>
  ): CommandSearchResult {
    const completed = new Map(incoming.mainPushGroups.map((group) => [group.resultId, group]))
    for (const group of groups) completed.set(group.resultId, group)
    return {
      ...incoming,
      mainPushGroups: incoming.mainPushCandidates.flatMap((command) => {
        const group = completed.get(command.resultId!)
        return group ? [group] : []
      })
    }
  }

  /**
   * 仅接受最新输入的静态结果，并释放不再展示的主进程快照。
   * @param incoming 带查询身份的静态结果
   * @returns 无返回值
   */
  function applySearch(incoming: CommandSearchResult): void {
    if (incoming.sessionId !== sessionId) return
    if (incoming.requestId !== requestId.value) {
      window.ztools.commands.releaseSearch(sessionId, incoming.requestId)
      return
    }
    const previousRequestId = display.value.result.requestId
    const next = { ...incoming }
    for (const key of [
      'bestSearchResults',
      'bestMatches',
      'recommendations',
      'allListModeResults',
      'windowCommands',
      'panelResults'
    ] as const)
      next[key] = incoming[key].map(decorate)
    // 一次提交结果和对应输入，避免分组与高亮短暂使用不同版本。
    display.value = { result: mergeGroups(next, pendingGroups.values()), context }
    pendingGroups.clear()
    searchPending.value = false
    // 旧结果保持到整体替换完成；期间点击仍能使用它自己的执行上下文。
    if (previousRequestId && previousRequestId !== incoming.requestId)
      window.ztools.commands.releaseSearch(sessionId, previousRequestId)
  }

  /**
   * 接收单个动态分组；静态 IPC 回复尚未到达时先缓存当前查询的分组。
   * @param update 动态分组增量
   * @returns 无返回值
   */
  function applyUpdate(update: CommandSearchUpdate): void {
    if (update.sessionId !== sessionId || update.requestId !== requestId.value) return
    if (display.value.result.requestId !== update.requestId) {
      pendingGroups.set(update.group.resultId, update.group)
      return
    }
    display.value = {
      ...display.value,
      result: mergeGroups(display.value.result, [update.group])
    }
  }

  /**
   * 初始化主页快照与跨窗口失效通知。
   * @returns 初始化完成的 Promise
   */
  async function initializeData(): Promise<void> {
    if (isInitialized.value) return
    isInitialized.value = true
    loading.value = true
    listeners.push(window.ztools.commands.onSearchUpdate(applyUpdate))
    listeners.push(
      window.ztools.commands.onStateChanged(() => {
        stateVersion.value++
        void reloadUserData().catch((error) => console.error('[Commands] 状态刷新失败:', error))
      })
    )
    try {
      await reloadUserData()
    } finally {
      loading.value = false
    }
  }

  /**
   * 提交完整输入快照，保留旧展示直到最新结果可以整体替换。
   * @param input 当前输入
   * @param showRecommendations 推荐显示设置
   * @returns 查询完成的 Promise
   * @throws 当前查询的 IPC 调用失败时抛出原始错误
   */
  function query(input: CommandContext, showRecommendations: boolean): Promise<void> {
    context = JSON.parse(JSON.stringify(input))
    const version = ++requestId.value
    pendingGroups.clear()
    // 查询期间保持展示快照，避免空数组触发窗口先收缩再展开。
    searchPending.value = true
    return window.ztools.commands
      .query({
        sessionId,
        requestId: version,
        context,
        showRecommendations
      })
      .then(applySearch)
      .catch((error) => {
        if (version === requestId.value) {
          // 失败也提交终态，避免无限保留已经失效的可见结果。
          applySearch({
            ...emptyCommandSearchResult({ sessionId, requestId: version }),
            error: error instanceof Error ? error.message : String(error)
          })
        }
        throw error
      })
  }

  /**
   * 页面离开时取消正在运行的查询。
   * @returns 无返回值
   */
  function cancelQuery(): void {
    window.ztools.commands.cancel(sessionId, ++requestId.value)
    pendingGroups.clear()
    searchPending.value = false
    display.value = {
      result: emptyCommandSearchResult({ sessionId, requestId: requestId.value }),
      context
    }
  }

  /**
   * 将结果身份或历史固定项交由主进程解析执行。
   * @param command 所选显示项
   * @param extra 动态选择参数
   * @returns 主进程执行结果
   */
  function execute(
    command?: Command,
    extra: Partial<CommandExecutionRequest> = {}
  ): ReturnType<typeof window.ztools.commands.execute> {
    const current =
      command?.resultId &&
      [
        ...result.value.allListModeResults,
        ...result.value.windowCommands,
        ...result.value.mainPushCandidates
      ].some((item) => item.resultId === command.resultId)
    const request: CommandExecutionRequest =
      current || extra.resultId
        ? { sessionId, requestId: result.value.requestId, resultId: command?.resultId }
        : { command, context }
    return window.ztools.commands.execute(JSON.parse(JSON.stringify({ ...request, ...extra })))
  }

  /**
   * 获取服务校验后的历史。
   * @param limit 最大条数
   * @returns 历史显示项
   */
  function getRecentCommands(limit?: number): Command[] {
    return limit ? history.value.slice(0, limit) : history.value
  }

  /**
   * 获取服务校验后的固定项。
   * @returns 固定显示项
   */
  function getPinnedCommands(): Command[] {
    return pinnedCommands.value
  }

  /**
   * 检查显示项的固定状态。
   * @param path 路径
   * @param featureCode 功能代码
   * @param name 持久化名称
   * @returns 是否固定
   */
  function isPinned(path: string, featureCode?: string, name?: string): boolean {
    return pinnedCommands.value.some(
      (item) =>
        item.path === path &&
        (featureCode !== undefined
          ? item.featureCode === featureCode
          : !name || item.name === name || item.persistedName === name)
    )
  }

  /**
   * 从主进程删除历史。
   * @param path 路径
   * @param featureCode 功能代码
   * @param name 持久化名称
   * @returns 操作结束的 Promise
   */
  async function removeFromHistory(
    path: string,
    featureCode?: string,
    name?: string
  ): Promise<void> {
    await window.ztools.removeFromHistory(path, featureCode, name)
    await reloadUserData()
  }

  /**
   * 固定显示项。
   * @param command 目标指令
   * @returns 操作结束的 Promise
   */
  async function pinCommand(command: Command): Promise<void> {
    await window.ztools.pinApp(JSON.parse(JSON.stringify(command)))
    await reloadUserData()
  }

  /**
   * 取消固定项。
   * @param path 路径
   * @param featureCode 功能代码
   * @param name 持久化名称
   * @returns 操作结束的 Promise
   */
  async function unpinCommand(path: string, featureCode?: string, name?: string): Promise<void> {
    await window.ztools.unpinApp(path, featureCode, name)
    await reloadUserData()
  }

  /**
   * 乐观展示拖动结果，失败时恢复服务端状态。
   * @param order 拖动后的顺序
   * @returns 持久化结束的 Promise
   */
  async function updatePinnedOrder(order: Command[]): Promise<void> {
    pinnedCommands.value = order
    try {
      await window.ztools.updatePinnedOrder(JSON.parse(JSON.stringify(order)))
    } finally {
      await reloadUserData()
    }
  }

  /**
   * 获取推荐置顶序号，仅用于展示与菜单状态。
   * @param command 推荐项
   * @returns 序号或 -1
   */
  function getRecommendationPinIndex(command: Command): number {
    return recommendationPins.value.findIndex(
      (item) => getRecommendationPinKey(item) === getRecommendationPinKey(command)
    )
  }

  /**
   * 检查推荐是否置顶。
   * @param command 推荐项
   * @returns 是否置顶
   */
  function isRecommendationPinned(command: Command): boolean {
    return getRecommendationPinIndex(command) >= 0
  }

  /**
   * 更新主进程的独立推荐序列。
   * @param action 置顶动作
   * @param command 推荐项
   * @returns 完成后的 Promise
   */
  async function recommendation(
    action: RecommendationOperation['action'],
    command: Command
  ): Promise<void> {
    applyHome(
      await window.ztools.commands.recommendation(JSON.parse(JSON.stringify({ action, command })))
    )
  }

  /**
   * 检查包含文件夹的超级面板固定状态。
   * @param command 目标指令
   * @returns 是否固定
   */
  function isPinnedToSuperPanel(command: Command): boolean {
    return superPanelPinned.value
      .flatMap((item) => (item.isFolder ? item.items || [] : [item]))
      .some(
        (item) =>
          item.path === command.path &&
          (command.featureCode
            ? item.featureCode === command.featureCode
            : item.name === command.name)
      )
  }

  /**
   * 置顶推荐项。
   * @param command 推荐项
   * @returns 操作结束的 Promise
   */
  function pinRecommendation(command: Command): Promise<void> {
    return recommendation('pin', command)
  }

  /**
   * 取消推荐置顶。
   * @param command 推荐项
   * @returns 操作结束的 Promise
   */
  function unpinRecommendation(command: Command): Promise<void> {
    return recommendation('unpin', command)
  }

  /**
   * 将推荐移到最前。
   * @param command 推荐项
   * @returns 操作结束的 Promise
   */
  function moveRecommendationToFront(command: Command): Promise<void> {
    return recommendation('front', command)
  }

  return {
    history,
    pinnedCommands,
    superPanelPinned,
    loading,
    isInitialized,
    result,
    displayContext,
    searchPending,
    stateVersion,
    initializeData,
    reloadUserData,
    reloadPluginAvailabilityData: reloadUserData,
    query,
    cancelQuery,
    execute,
    getRecentCommands,
    getPinnedCommands,
    isPinned,
    pinCommand,
    unpinCommand,
    removeFromHistory,
    updatePinnedOrder,
    getRecommendationPinIndex,
    isRecommendationPinned,
    pinRecommendation,
    unpinRecommendation,
    moveRecommendationToFront,
    loadSuperPanelPinnedData: reloadUserData,
    isPinnedToSuperPanel
  }
})
