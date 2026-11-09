import {
  emptyCommandSearchResult,
  getRecommendationPinKey,
  type Command,
  type CommandCatalog,
  type CommandCatalogInput,
  type CommandContext,
  type CommandExecutionRequest,
  type CommandExecutionResult,
  type CommandHomeState,
  type CommandMatchContext,
  type CommandRankState,
  type CommandSearchRequest,
  type CommandSearchResult,
  type CommandSearchUpdate,
  type CommandUserState,
  type MainPushGroup,
  type RecommendationOperation
} from '../../../shared/commandService'
import type { SearchWorkerClient } from './workerClient'
import { applyPanelMutation, normalizePanelState } from './panelState'
import type { PanelMutation, PanelMutationResult } from '../../../shared/commandService'
import { normalizeSearchText } from './searchNormalization'

export interface CommandServiceDependencies {
  worker: Pick<SearchWorkerClient, 'publish' | 'query' | 'validateCommand'>
  sources: () => Promise<CommandCatalogInput>
  read: (key: string) => any
  write: (key: string, value: any) => void
  launch: (options: any) => Promise<any>
  queryMainPush: (path: string, code: string, data: any) => Promise<any[]>
  selectMainPush: (path: string, code: string, data: any) => Promise<boolean>
  stateChanged: () => void
}

interface SearchSession {
  requestId: number
  request: CommandSearchRequest
  result?: CommandSearchResult
  timer?: ReturnType<typeof setTimeout>
  update?: (update: CommandSearchUpdate) => void
}

/**
 * 主进程指令业务入口，按调用方隔离查询、动态回调及启动上下文。
 */
export class CommandService {
  private catalog: CommandCatalog = { commands: [], rules: [], canonical: [], plugins: [] }
  private catalogGeneration = 0
  private dirty = true
  private building: Promise<void> | undefined
  private userState: CommandUserState | undefined
  private sessions = new Map<string, SearchSession>()
  private snapshots = new Map<string, Map<number, SearchSession>>()
  private launchQueue: Promise<unknown> = Promise.resolve()

  /**
   * 注入平台适配器，业务服务不直接依赖 Electron 或窗口。
   * @param dependencies 来源、存储和插件运行时适配器
   * @returns 指令服务实例
   */
  constructor(private dependencies: CommandServiceDependencies) {}

  /**
   * 标记目录或用户状态失效，撤销所有旧动态任务。
   * @param catalogChanged 是否需要重建来源目录
   * @returns 无返回值
   */
  invalidate(catalogChanged = true): void {
    this.userState = undefined
    if (catalogChanged) {
      this.dirty = true
      this.catalogGeneration++
      for (const session of this.sessions.values()) {
        clearTimeout(session.timer)
        // 保留仍在展示的执行快照，但目录变化后不再发布它的动态回调。
        session.update = undefined
      }
    }
    this.dependencies.stateChanged()
  }

  /**
   * 原子构建目录，期间发生的新来源变化必须重新构建。
   * @returns 目录就绪的 Promise
   */
  private async ensureCatalog(): Promise<void> {
    if (this.building) await this.building
    if (!this.dirty) return
    this.building = (async () => {
      while (this.dirty) {
        const generation = this.catalogGeneration
        const input = await this.dependencies.sources()
        const catalog = await this.dependencies.worker.publish(input)
        if (generation !== this.catalogGeneration) continue
        this.catalog = catalog
        this.dirty = false
      }
    })()
    try {
      await this.building
    } finally {
      this.building = undefined
    }
  }

  /**
   * 缓存轻量用户状态，输入时无需再读数据库或发送统计 IPC。
   * @returns 当前用户状态快照
   */
  private state(): CommandUserState {
    if (!this.userState) {
      const read = this.dependencies.read
      // 旧关键词只在加载时规范化，规范键优先，查询热路径直接查表。
      const stored: CommandUserState['preference'] = read('search-preference') || {}
      const preference: CommandUserState['preference'] = Object.create(null)
      for (const [key, value] of Object.entries(stored)) {
        const normalized = normalizeSearchText(key)
        if (!(normalized in preference) || key === normalized) preference[normalized] = value
      }
      this.userState = {
        history: read('command-history') || [],
        pinned: read('pinned-commands') || [],
        superPanelPinned: read('super-panel-pinned') || [],
        recommendationPins: read('recommendation-pinned') || [],
        usage: read('command-usage-stats') || [],
        preference,
        searchTermStats: this.readSearchTermStats()
      }
    }
    return this.userState
  }

  /**
   * 读取按搜索词聚合的选中热度统计。
   * 旧版本曾把该结构写在 `search-preference` 中，读取时迁移到独立键，
   * 避免与单关键词偏好结构混用导致两套排序都失效。
   * @returns 搜索词 -> 指令唯一键 -> 累计选中次数
   */
  private readSearchTermStats(): CommandUserState['searchTermStats'] {
    const stored = this.dependencies.read('search-term-stats')
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) return stored

    const legacy = this.dependencies.read('search-preference')
    const migrated: CommandUserState['searchTermStats'] = Object.create(null)
    for (const [term, bucket] of Object.entries(legacy || {})) {
      if (!bucket || typeof bucket !== 'object') continue
      for (const [statKey, stat] of Object.entries(bucket as Record<string, unknown>)) {
        const item = stat as { path?: unknown; name?: unknown; count?: unknown } | null
        if (!item || typeof item.count !== 'number' || typeof item.path !== 'string') continue
        migrated[term] = migrated[term] || Object.create(null)
        migrated[term][statKey] = {
          path: item.path,
          featureCode: typeof (item as { featureCode?: unknown }).featureCode === 'string'
            ? (item as { featureCode: string }).featureCode
            : undefined,
          name: typeof item.name === 'string' ? item.name : '',
          count: item.count
        }
      }
    }
    if (Object.keys(migrated).length > 0) this.dependencies.write('search-term-stats', migrated)
    return migrated
  }

  /**
   * 只向 Worker 发送参与评分的用户数据。
   * @returns 名称排序与推荐置顶状态
   */
  private rankState(): CommandRankState {
    const { preference, usage, recommendationPins, searchTermStats } = this.state()
    return { preference, usage, recommendationPins, searchTermStats }
  }

  /**
   * 构造匹配输入，避免图片原文随每次搜索在线程间往返。
   * @param context 主进程持有的完整执行输入
   * @returns Worker 使用的内容事实
   */
  private matchContext(context: CommandContext): CommandMatchContext {
    return {
      searchQuery: context.searchQuery,
      pastedText: context.pastedText,
      pastedFiles: context.pastedFiles,
      pastedImage: !!context.pastedImage,
      windowInfo: context.windowInfo
    }
  }

  /**
   * 检查查询仍属于当前会话，防止异步结果写回其它输入。
   * @param key 调用方与会话组合键
   * @param session 查询快照
   * @returns 是否仍有效
   */
  private current(key: string, session: SearchSession): boolean {
    return this.sessions.get(key) === session && !this.dirty
  }

  /**
   * 查询静态结果并分别流式发布动态插件结果。
   * @param owner 调用方身份，由主进程提供
   * @param request 查询和完整输入快照
   * @param update 动态结果通知适配器
   * @returns 静态搜索结果
   */
  async query(
    owner: string,
    request: CommandSearchRequest,
    update?: (update: CommandSearchUpdate) => void
  ): Promise<CommandSearchResult> {
    const key = JSON.stringify([owner, request.sessionId])
    const previous = this.sessions.get(key)
    if (previous && request.requestId <= previous.requestId)
      return emptyCommandSearchResult(request)
    clearTimeout(previous?.timer)
    const session: SearchSession = {
      requestId: request.requestId,
      request: structuredClone(request),
      update
    }
    this.sessions.set(key, session)
    try {
      await this.ensureCatalog()
      // 等待目录期间可能已有更新的输入，失效任务不再进入 Worker 队列。
      if (!this.current(key, session)) return emptyCommandSearchResult(request)
      const generation = this.catalogGeneration
      const matches = await this.dependencies.worker.query(
        {
          target: session.request.target,
          context: this.matchContext(session.request.context),
          intent: session.request.intent,
          showRecommendations: session.request.showRecommendations,
          includeMainPush: !!update && (!request.intent || request.intent === 'search')
        },
        this.rankState()
      )
      if (!this.current(key, session) || generation !== this.catalogGeneration)
        return emptyCommandSearchResult(request)
      const result = { ...matches, sessionId: request.sessionId, requestId: request.requestId }
      session.result = result
      const snapshots = this.snapshots.get(key) || new Map<number, SearchSession>()
      snapshots.set(request.requestId, session)
      this.snapshots.set(key, snapshots)
      // 结果在接收方释放前可供点击；只有仍被订阅的最新查询产生动态更新。
      if (update && result.mainPushCandidates.length)
        session.timer = setTimeout(() => this.queryDynamic(key, session), 300)
      return result
    } catch (error) {
      return {
        ...emptyCommandSearchResult(request),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * 每个插件完成后独立发布，慢插件不会阻塞其它分组。
   * @param key 会话组合键
   * @param session 生成候选的输入快照
   * @returns 无返回值
   */
  private queryDynamic(key: string, session: SearchSession): void {
    if (!this.current(key, session) || !session.result || !session.update) return
    for (const command of session.result.mainPushCandidates) {
      const data = this.payload(command, session.request.context)
      void this.dependencies
        .queryMainPush(command.path, command.featureCode || '', data)
        .then((items) => {
          if (
            !this.current(key, session) ||
            !session.result ||
            !session.update ||
            !Array.isArray(items) ||
            !items.length
          )
            return
          const group: MainPushGroup = {
            featureKey: `${command.path}:${command.featureCode}`,
            pluginPath: command.path,
            pluginName: command.pluginName || '',
            pluginLogo: command.icon || '',
            featureCode: command.featureCode || '',
            featureExplain: command.pluginExplain || '',
            featureIcon: command.icon,
            matchedCmdType: command.cmdType || 'text',
            resultId: command.resultId!,
            items: structuredClone(items)
          }
          // 按候选顺序保持分组稳定，完成先后的差异不会重排已显示项目。
          const groups = [...session.result.mainPushGroups, group].sort(
            (a, b) =>
              session.result!.mainPushCandidates.findIndex((item) => item.resultId === a.resultId) -
              session.result!.mainPushCandidates.findIndex((item) => item.resultId === b.resultId)
          )
          session.result = { ...session.result, mainPushGroups: groups }
          session.update?.({
            sessionId: session.request.sessionId,
            requestId: session.requestId,
            group
          })
        })
        .catch((error) => console.error('[Commands] 动态搜索失败:', command.pluginName, error))
    }
  }

  /**
   * 页面替换展示后释放对应执行快照，不影响已经进入启动队列的选择。
   * @param owner 可信调用方身份
   * @param sessionId 查询通道
   * @param requestId 被替换或丢弃的结果身份
   * @returns 无返回值
   */
  releaseSearch(owner: string, sessionId: string, requestId: number): void {
    const key = JSON.stringify([owner, sessionId])
    const snapshots = this.snapshots.get(key)
    const snapshot = snapshots?.get(requestId)
    clearTimeout(snapshot?.timer)
    snapshots?.delete(requestId)
    if (!snapshots?.size) this.snapshots.delete(key)
    // 已发出的动态插件 Promise 也不能继续发布已释放的结果。
    if (snapshot) snapshot.result = undefined
  }

  /**
   * 取消旧查询；取消也推进版本，防止延迟 IPC 复活旧请求。
   * @param owner 可信调用方身份
   * @param sessionId 会话标识
   * @param requestId 最新输入版本
   * @returns 无返回值
   */
  cancel(owner: string, sessionId: string, requestId: number): void {
    const key = JSON.stringify([owner, sessionId])
    const previous = this.sessions.get(key)
    if (previous && previous.requestId >= requestId) return
    clearTimeout(previous?.timer)
    this.snapshots.delete(key)
    this.sessions.set(key, {
      requestId,
      request: {
        sessionId,
        requestId,
        context: { searchQuery: '', pastedImage: null, pastedFiles: null, pastedText: null }
      }
    })
  }

  /**
   * 窗口销毁或页面重载时释放所有相关会话。
   * @param owner 调用方身份
   * @returns 无返回值
   */
  release(owner: string): void {
    for (const [key, session] of this.sessions) {
      if (JSON.parse(key)[0] !== owner) continue
      clearTimeout(session.timer)
      this.sessions.delete(key)
      this.snapshots.delete(key)
    }
  }

  /**
   * 在服务端构造启动数据，匹配型输入只能来自产生结果的快照。
   * @param command 当前指令
   * @param context 查询快照
   * @returns 插件启动数据
   */
  private payload(command: Command, context: CommandContext): any {
    const type = command.cmdType || 'text'
    const payload =
      type === 'img'
        ? context.pastedImage
        : type === 'files'
          ? context.pastedFiles?.map((file) => ({ ...file, isFile: !file.isDirectory }))
          : type === 'window'
            ? context.windowInfo
            : context.pastedText || context.searchQuery
    return { code: command.featureCode || '', type, payload: payload ?? '', inputState: context }
  }

  /**
   * 排队执行启动，兼容现有运行时的共享 launchParam 并防止交叉覆盖。
   * @param owner 可信调用方身份
   * @param request 选择身份或固定项
   * @returns 最终执行结果
   */
  execute(owner: string, request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    const snapshot = structuredClone(request)
    const selected = request.sessionId
      ? this.snapshots.get(JSON.stringify([owner, request.sessionId]))?.get(request.requestId!)
      : undefined
    // 入队前捕获选择，后续页面释放或新输入不能改变此次点击的上下文。
    const selection = selected?.result ? { ...selected, result: selected.result } : undefined
    const operation = this.launchQueue.then(() => this.executeNow(snapshot, selection))
    this.launchQueue = operation.catch(() => undefined)
    return operation
  }

  /**
   * 校验并执行真实指令，兼容空功能代码，仅为成功的主搜索显式选择学习偏好。
   * @param request 不可变选择快照
   * @param session 点击时捕获的结果与输入快照
   * @returns 执行结果或状态恢复请求
   */
  private async executeNow(
    request: CommandExecutionRequest,
    session?: SearchSession
  ): Promise<CommandExecutionResult> {
    try {
      await this.ensureCatalog()
      if (request.command?.path === 'special:last-match')
        return {
          success: true,
          restoreContext: this.dependencies.read('last-match-state') || undefined
        }
      if (request.sessionId && !session?.result) return { success: false, error: '搜索结果已释放' }
      const selected =
        request.resultId && session?.result
          ? [
              ...session.result.allListModeResults,
              ...session.result.windowCommands,
              ...session.result.panelResults,
              ...session.result.mainPushCandidates
            ].find((item) => item.resultId === request.resultId)
          : request.command
      const available = [
        ...this.catalog.commands,
        ...this.catalog.rules,
        ...this.catalog.canonical
      ].filter((item) => !item.disabled)
      const context = structuredClone(
        session?.request.context ||
          request.context || {
            searchQuery: '',
            pastedImage: null,
            pastedFiles: null,
            pastedText: null
          }
      )
      let command: Command | undefined
      if (request.target) {
        const exact = await this.dependencies.worker.query(
          { target: request.target, context: this.matchContext(context) },
          this.rankState()
        )
        const targets = new Set(exact.panelResults.map((item) => item.targetId))
        if (targets.size > 1)
          return { success: false, error: '多个指令同名，请使用「插件名称/指令名称」精确指定' }
        command = exact.panelResults[0]
      } else {
        // 旧面板把缺省功能代码保存为空字符串，与目录中的缺省值视为同一身份。
        command =
          available.find(
            (item) =>
              selected &&
              (selected.ruleId
                ? item.ruleId === selected.ruleId && item.name === selected.name
                : item.path === selected.path &&
                  (item.featureCode || '') === (selected.featureCode || '') &&
                  item.name === selected.name)
          ) ||
          (selected?.ruleId
            ? available.find((item) => item.ruleId === selected.ruleId)
            : undefined) ||
          (!request.resultId && selected
            ? available.find(
                (item) =>
                  item.path === selected.path &&
                  (item.featureCode || '') === (selected.featureCode || '')
              )
            : undefined)
        if (!command && selected?.type === 'file')
          command = this.state().history.find(
            (item) => item.type === 'file' && item.path === selected.path
          )
      }
      if (!command) return { success: false, error: '指令已删除、禁用或不满足当前输入' }
      if (command.matchCmd && !request.target) {
        // 执行校验仍在隔离线程，恶意正则不会因点击结果阻塞主线程。
        const valid = await this.dependencies.worker.validateCommand(
          command.ruleId!,
          this.matchContext(context)
        )
        if (!valid) return { success: false, error: '当前输入不满足指令规则' }
      }
      const param = this.payload(command, context)
      if (request.option) {
        const group = session?.result?.mainPushGroups.find(
          (item) => item.resultId === request.resultId
        )
        if (!group) return { success: false, error: '动态结果已过期' }
        const option = { ...request.option }
        delete option._resolvedIcon
        if (
          !group.items.some((item) => {
            const raw = { ...item }
            delete raw._resolvedIcon
            return JSON.stringify(raw) === JSON.stringify(option)
          })
        )
          return { success: false, error: '动态结果项已过期' }
        param.option = option
        if (
          !request.enterMainPush &&
          !(await this.dependencies.selectMainPush(command.path, command.featureCode || '', param))
        )
          return { success: true }
      }
      if (request.enterMainPush || request.option) param.from = 'main'
      const launched = await this.dependencies.launch({
        path: command.path,
        type: command.type,
        featureCode: command.featureCode,
        name: command.name,
        cmdType: command.cmdType || 'text',
        confirmDialog: command.confirmDialog,
        param,
        launchSource: request.source || 'search'
      })
      if (launched?.success === false) return launched
      // 只有主搜索会话中明确选择并启动成功的普通结果可以学习关键词偏好。
      if (
        session?.result &&
        request.resultId &&
        !request.target &&
        (!request.source || request.source === 'search') &&
        session.request.intent !== 'panel' &&
        session.request.intent !== 'window' &&
        session.result.bestSearchResults.some((item) => item.resultId === request.resultId) &&
        context.searchQuery.trim() &&
        !command.matchCmd &&
        (!command.cmdType || command.cmdType === 'text')
      ) {
        const preference = {
          ...this.state().preference,
          [normalizeSearchText(context.searchQuery)]: {
            path: command.path,
            name: command.name,
            featureCode: command.featureCode
          }
        }
        this.dependencies.write('search-preference', preference)

        // 同时累计当前搜索词下的选中热度，供后续按词排序保持结果稳定
        const term = normalizeSearchText(context.searchQuery)
        const stats = { ...this.state().searchTermStats }
        const bucket = { ...(stats[term] || {}) }
        const statKey = `${command.path}:${command.featureCode || ''}:${command.name}`
        bucket[statKey] = {
          path: command.path,
          featureCode: command.featureCode,
          name: command.name,
          count: (bucket[statKey]?.count || 0) + 1
        }
        stats[term] = bucket
        this.dependencies.write('search-term-stats', stats)
      }
      this.invalidate(false)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 将旧持久化名称恢复为当前目录项，路径升级和别名删除不丢失操作身份。
   * @param records 持久化指令
   * @returns 当前可用的显示指令
   */
  private reconcile(records: Command[]): Command[] {
    const available = [
      ...this.catalog.commands,
      ...this.catalog.rules,
      ...this.catalog.canonical
    ].filter((item) => !item.disabled)
    return records.flatMap<Command>((record) => {
      if (record.path === 'special:last-match') return [{ ...record, type: 'builtin' as const }]
      if (record.type === 'file') return [record]
      const same = (item: Command): boolean =>
        record.type === 'plugin'
          ? (record.pluginName
              ? item.pluginName === record.pluginName
              : item.path === record.path) && item.featureCode === record.featureCode
          : item.path === record.path
      const command =
        available.find((item) => same(item) && item.name === record.name) || available.find(same)
      return command ? [{ ...command, persistedName: record.name }] : []
    })
  }

  /**
   * 返回经过目录校验的历史、固定与推荐置顶快照。
   * @returns 主页状态
   */
  async getHome(): Promise<CommandHomeState> {
    await this.ensureCatalog()
    this.getPanelState()
    const state = this.state()
    const panel = state.superPanelPinned.flatMap((item) => {
      if (!item.isFolder) return this.reconcile([item])
      const items = this.reconcile(item.items || [])
      return items.length > 1 ? [{ ...item, items }] : items
    })
    return structuredClone({
      history: this.reconcile(state.history),
      pinned: this.reconcile(state.pinned),
      superPanelPinned: panel,
      recommendationPins: state.recommendationPins
    })
  }

  /**
   * 提供设置页需要的原始指令，搜索 UI 无需拿到完整索引。
   * @returns 完整目录快照
   */
  async getCatalog(): Promise<CommandCatalog> {
    await this.ensureCatalog()
    return structuredClone(this.catalog)
  }

  /**
   * 精确预解析快捷键名称，不执行第三方规则或剪贴板操作。
   * @param target 配置的名称
   * @returns 可能命中的可用目录表示
   */
  async getTargetCandidates(target: string): Promise<Command[]> {
    await this.ensureCatalog()
    const parts = target.split('/').map((part) => part.trim())
    return [...this.catalog.commands, ...this.catalog.rules].filter(
      (item) =>
        !item.disabled &&
        (parts.length === 2
          ? (item.pluginName === parts[0] || item.pluginTitle === parts[0]) &&
            item.name === parts[1]
          : item.name === parts[0])
    )
  }

  /**
   * 在主进程独立管理推荐置顶序列。
   * @param operation 推荐置顶操作
   * @returns 更新后的主页状态
   */
  async recommendation(operation: RecommendationOperation): Promise<CommandHomeState> {
    const key = getRecommendationPinKey(operation.command)
    const pins = [...this.state().recommendationPins]
    const index = pins.findIndex((item) => getRecommendationPinKey(item) === key)
    if (operation.action === 'unpin' || operation.action === 'front') {
      if (index >= 0) pins.splice(index, 1)
    }
    if (operation.action === 'front') pins.unshift(operation.command)
    else if (operation.action === 'pin' && index < 0) pins.push(operation.command)
    this.dependencies.write('recommendation-pinned', pins)
    this.invalidate(false)
    return this.getHome()
  }

  /**
   * 根据持久化最新状态执行面板操作，页面只提交项目身份与位置。
   * @param operation 面板动作
   * @returns 更新列表或供失败回滚的当前列表
   */
  panelMutation(operation: PanelMutation): PanelMutationResult {
    let current = this.dependencies.read('super-panel-pinned') || []
    try {
      current = this.getPanelState()
      const items = applyPanelMutation(current, operation)
      this.dependencies.write('super-panel-pinned', items)
      this.invalidate(false)
      return { success: true, items }
    } catch (error) {
      return {
        success: false,
        items: current,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * 读取面板结构并一次性持久化旧文件夹缺失的身份。
   * @returns 具有稳定身份的面板列表
   * @throws 持久化结构无效时抛错
   */
  getPanelState(): any[] {
    const current = this.dependencies.read('super-panel-pinned') || []
    const normalized = normalizePanelState(current)
    if (current.some((item) => item?.isFolder && !item.id)) {
      // 在任何页面收到快照前完成迁移，后续拖动使用同一份身份。
      this.dependencies.write('super-panel-pinned', normalized)
      this.userState = undefined
    }
    return normalized
  }
}
