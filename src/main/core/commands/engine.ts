import {
  getRecommendationPinKey,
  type CatalogCommand,
  type CommandCatalog,
  type CommandMatchContext,
  type CommandMatchRequest,
  type CommandMatchResult,
  type CommandRankState
} from '../../../shared/commandService'
import { deduplicateResults } from '../../../shared/commandResults'
import { prepareQuery } from './matching/preparedQuery'
import {
  createDefaultNameMatcherRegistry,
  type IndexedName,
  type NameMatcherRegistry
} from './matching/nameMatcherRegistry'
import {
  createDefaultContextMatcherRegistry,
  type ContextMatcherRegistry,
  type PreparedContextRule
} from './matching/contextMatcherRegistry'
import { MainPushTriggerPolicy } from './matching/mainPushTriggerPolicy'
import type { PreparedQuery } from './matching/contracts'
import { compareRankedNames, scoreNameResult } from './searchRanking'
import type { MatchBudget, NameMatch, RankedName } from './searchTypes'

export interface CommandSearchEngineOptions {
  nameMatchers?: NameMatcherRegistry
  contextMatchers?: ContextMatcherRegistry
}

interface QueryWork {
  state: CommandRankState
  usage: Map<string, number>
  budget: MatchBudget
  names: Map<string, Map<IndexedName, NameMatch | null>>
}

type RankedCatalogName = Omit<RankedName, 'command'> & { command: CatalogCommand }

/**
 * 为功能统计使用统一的无歧义身份，空功能码保持现有兼容语义。
 * @param command 目录命令或使用记录
 * @returns 使用统计键
 */
function usageKey(command: { path: string; featureCode?: string }): string {
  return JSON.stringify([command.path, command.featureCode || ''])
}

/**
 * 生成搜索词热度统计中的指令唯一键，与所选指令的持久化结构保持一致。
 * @param command 目录命令
 * @returns 热度统计键
 */
function searchTermStatKey(command: CatalogCommand): string {
  return `${command.path}:${command.featureCode || ''}:${command.name}`
}

/**
 * 判断目录项是否属于 Windows 系统应用或系统自带组件。
 * 这类结果命中范围过宽，同分时应排在用户可定制的指令之后。
 * @param command 目录命令
 * @returns 是否属于系统应用或自带组件
 */
function isSystemCatalogEntry(command: CatalogCommand): boolean {
  return (
    command.type === 'direct' &&
    (command.subType === 'app' || command.subType === 'system-setting')
  )
}

/**
 * 为不可变目录建立六类名称索引，匹配、排名与高亮均在 Worker 内完成。
 */
export class CommandSearchEngine {
  private indexes = new Map<string, IndexedName>()
  private contextRules = new Map<string, PreparedContextRule>()
  private rules = new Map<string, CatalogCommand>()
  private readonly nameMatchers: NameMatcherRegistry
  private readonly pushPolicy: MainPushTriggerPolicy
  private pushCommands: CatalogCommand[]
  readonly nameDiagnostics = { visited: 0, degraded: 0 }

  /**
   * 构建名称缓存和编译规则，内部索引不会发送到主进程。
   * @param catalog 原子目录快照
   * @param options 可扩展的名称和内容策略注册表
   * @returns 搜索引擎实例
   * @throws 名称或内容匹配器的内部编译实现异常时抛错
   */
  constructor(
    public readonly catalog: CommandCatalog,
    options: CommandSearchEngineOptions = {}
  ) {
    this.nameMatchers = options.nameMatchers ?? createDefaultNameMatcherRegistry()
    this.pushPolicy = new MainPushTriggerPolicy(this.nameMatchers)
    const contexts = options.contextMatchers ?? createDefaultContextMatcherRegistry()
    const names = new Map<string, IndexedName>()
    const characters = new Map<string, string[]>()
    // 同名表示和逐字读音共用数据；规则别名共用一次编译产物。
    for (const command of [...catalog.commands, ...catalog.rules]) {
      const key = JSON.stringify([command.name, command.acronym || ''])
      let index = names.get(key)
      if (!index) {
        index = this.nameMatchers.build(command, characters)
        names.set(key, index)
      }
      this.indexes.set(command.resultId, index)
      this.rules.set(command.ruleId, command)
      if (command.matchCmd && !this.contextRules.has(command.ruleId)) {
        this.contextRules.set(command.ruleId, contexts.prepare(command.matchCmd))
      }
    }
    this.pushCommands = catalog.commands.filter((command) => command.mainPush)
  }

  /**
   * 读取构建时必定发布的名称索引，内部状态损坏不能静默漏掉候选。
   * @param command 目录中的展示命令
   * @returns 对应名称索引
   * @throws 目录与名称索引不一致时抛错
   */
  private indexFor(command: CatalogCommand): IndexedName {
    const index = this.indexes.get(command.resultId)
    if (!index) throw new Error(`搜索目录缺少名称索引: ${command.resultId}`)
    return index
  }

  /**
   * 使用目录预编译的策略验证候选，无规则的普通命令直接通过。
   * @param command 当前候选
   * @param context 输入快照
   * @returns 内容资格是否满足
   * @throws 目录内容规则未编译时抛错
   */
  private matchesContext(command: CatalogCommand, context: CommandMatchContext): boolean {
    if (!command.matchCmd) return true
    const prepared = this.contextRules.get(command.ruleId)
    if (!prepared) throw new Error(`搜索目录缺少内容规则: ${command.ruleId}`)
    return prepared.matches(context)
  }

  /**
   * 验证被选中的单条规则，复用预编译产物且不运行名称搜索或排名。
   * @param ruleId 被选中命令的稳定规则身份
   * @param context 所选结果对应的最小输入快照
   * @returns 当前目录中仍存在且符合内容规则时为 true
   * @throws 已构建目录的内部规则缺失或策略实现异常时抛错
   */
  validateCommand(ruleId: string, context: CommandMatchContext): boolean {
    const command = this.rules.get(ruleId)
    return !!command && this.matchesContext(command, context)
  }

  /**
   * 为相同查询和名称索引复用命中事实，普通搜索与动态触发不重复消耗读音预算。
   * @param command 目录命令
   * @param query 已准备查询
   * @param work 本次查询共享状态
   * @returns 最佳名称命中或 null
   * @throws 目录与名称索引不一致时抛错
   */
  private nameMatch(
    command: CatalogCommand,
    query: PreparedQuery,
    work: QueryWork
  ): NameMatch | null {
    const index = this.indexFor(command)
    let matches = work.names.get(query.text)
    if (!matches) {
      matches = new Map()
      work.names.set(query.text, matches)
    }
    if (!matches.has(index)) {
      matches.set(index, this.nameMatchers.match(index, query, work.budget))
    }
    return matches.get(index)!
  }

  /**
   * 聚合当前搜索词热度，包含所有以该词为前缀的历史词条。
   * @param stats 搜索词 -> 指令唯一键 -> 累计选中次数
   * @param text 当前搜索词
   * @returns 指令唯一键 -> 累计选中次数
   */
  private searchTermHeat(
    stats: CommandRankState['searchTermStats'],
    text: string
  ): Map<string, number> {
    const heat = new Map<string, number>()
    const key = text.trim().toLowerCase()
    if (!key || !stats) return heat
    for (const [term, bucket] of Object.entries(stats)) {
      if (!term.startsWith(key)) continue
      for (const [statKey, stat] of Object.entries(bucket || {})) {
        heat.set(statKey, (heat.get(statKey) || 0) + (stat?.count || 0))
      }
    }
    return heat
  }

  /**
   * 使用已建索引筛选候选，偏好键在主进程加载状态时已经规范化。
   * @param commands 查询范围，省略时使用普通名称目录
   * @param query 已准备查询快照
   * @param work 本次查询共享的排名状态、读音预算和命中缓存
   * @param contentUsage 是否叠加内容使用统计分
   * @returns 最佳显示表示，顺序同时用于聚合与列表
   * @throws 目录与名称索引不一致时抛错
   */
  private names(
    commands: CatalogCommand[] | undefined,
    query: PreparedQuery,
    work: QueryWork,
    contentUsage = false
  ): CatalogCommand[] {
    if (!query.text) return commands || []
    const preference = work.state.preference[query.text]
    const ranked: RankedCatalogName[] = []
    for (const command of commands || this.catalog.commands) {
      const match = this.nameMatch(command, query, work)
      if (!match) continue
      ranked.push({
        command,
        match,
        score: scoreNameResult(
          match,
          !!preference &&
            command.path === preference.path &&
            (command.featureCode || '') === (preference.featureCode || '') &&
            command.name === preference.name,
          contentUsage ? work.usage.get(usageKey(command)) || 0 : 0
        ),
        stableKey: command.resultId
      })
    }
    // 先选出每个功能的最佳显示表示，再把唯一获胜路径发送到页面。
    ranked.sort(compareRankedNames)
    // 叠加搜索词热度：同一搜索词下被选中过的指令优先，其余保持上面的匹配顺序；
    // Windows 系统应用与自带组件同分时沉底，避免淹没用户可定制的指令。
    const heat = this.searchTermHeat(work.state.searchTermStats, query.text)
    ranked.sort((a, b) => {
      const heatA = heat.get(searchTermStatKey(a.command)) || 0
      const heatB = heat.get(searchTermStatKey(b.command)) || 0
      if (heatA !== heatB) return heatB - heatA
      const systemA = isSystemCatalogEntry(a.command)
      const systemB = isSystemCatalogEntry(b.command)
      return systemA === systemB ? 0 : systemA ? 1 : -1
    })
    return deduplicateResults(
      ranked.map(({ command, match }) => ({
        ...command,
        highlightRanges: match.ranges
      }))
    )
  }

  /**
   * 从同一索引快照生成搜索、窗口、内容和按需动态候选，不处理界面会话身份。
   * @param request 最小匹配输入与展示用途
   * @param state 已规范化的排序状态快照
   * @returns 静态分组与调用方要求的动态候选
   * @throws 目录索引不一致或策略实现异常时抛错
   */
  query(request: CommandMatchRequest, state: CommandRankState): CommandMatchResult {
    // 明确响应字段，输入快照与图片原始数据不随匹配结果回传。
    const result: CommandMatchResult = {
      bestSearchResults: [],
      bestMatches: [],
      recommendations: [],
      allListModeResults: [],
      windowCommands: [],
      panelResults: [],
      mainPushCandidates: [],
      mainPushGroups: []
    }
    const context = request.context
    const query = prepareQuery(context.searchQuery)
    const budget: MatchBudget = { remaining: 500000, degraded: 0 }
    const contextMatches = new Map<string, boolean>()
    /**
     * 同一条规则的显示别名复用内容资格，避免反复运行相同正则。
     * @param command 待验证目录命令
     * @returns 当前输入是否满足规则
     */
    const matchesContext = (command: CatalogCommand): boolean => {
      if (!contextMatches.has(command.ruleId)) {
        contextMatches.set(command.ruleId, this.matchesContext(command, context))
      }
      return contextMatches.get(command.ruleId)!
    }
    this.nameDiagnostics.visited = 0
    this.nameDiagnostics.degraded = 0
    if (request.target) {
      const parts = request.target.split('/').map((part) => part.trim())
      const candidates = [...this.catalog.commands, ...this.catalog.rules].filter((item) =>
        parts.length === 2
          ? (item.pluginName === parts[0] || item.pluginTitle === parts[0]) &&
            item.name === parts[1]
          : item.name === parts[0]
      )
      const priority = { files: 500, img: 450, regex: 400, over: 350, window: 300, text: 0 }
      result.panelResults = candidates
        .filter(matchesContext)
        .sort((a, b) => priority[b.cmdType || 'text'] - priority[a.cmdType || 'text'])
      return result
    }
    const work: QueryWork = {
      state,
      usage: new Map(state.usage.map((item) => [usageKey(item), item.useCount || 0])),
      budget,
      names: new Map()
    }
    // 内容规则先命中，再筛选名称；别名与拼音不能改变 payload。
    const matched = this.catalog.rules.filter(
      (item) => (request.intent !== 'window' || item.cmdType === 'window') && matchesContext(item)
    )
    const content = matched.filter((item) => item.cmdType !== 'window')
    const filterContent = !!context.pastedImage || !!context.pastedFiles || !!context.pastedText
    const contentFiltered = filterContent && !!query.text
    const contentNames = contentFiltered ? this.names(content, query, work, true) : content
    /**
     * 为没有名称过滤的内容候选按已建立的统计映射排序。
     * @param items 已符合内容资格的候选
     * @returns 去重后的使用频率顺序
     */
    const byUsage = (items: CatalogCommand[]): CatalogCommand[] =>
      deduplicateResults(
        [...items].sort(
          (a, b) => (work.usage.get(usageKey(b)) || 0) - (work.usage.get(usageKey(a)) || 0)
        )
      )
    /**
     * 保留名称综合评分顺序，未筛选名称时使用频率排序。
     * @param items 已符合内容资格的候选
     * @returns 当前展示规则下的结果
     */
    const rankContent = (items: CatalogCommand[]): CatalogCommand[] =>
      contentFiltered ? deduplicateResults(items) : byUsage(items)
    result.windowCommands = this.names(
      matched.filter((item) => item.cmdType === 'window'),
      query,
      work,
      true
    ).map((item) => ({ ...item, windowInfo: context.windowInfo || undefined }))
    if (request.intent !== 'window') {
      // 主搜索粘贴态不展示普通名称；面板仍保留名称候选的已有行为。
      const normal =
        query.text && (!filterContent || request.intent === 'panel')
          ? this.names(undefined, query, work).filter(matchesContext)
          : []
      const regex = contentNames.filter((item) =>
        ['regex', 'img', 'files'].includes(item.cmdType || '')
      )
      const over = contentNames.filter((item) => item.cmdType === 'over')
      result.bestSearchResults = !filterContent
        ? normal
        : context.pastedText && !regex.length
          ? rankContent(over)
          : []
      result.bestMatches = rankContent(regex)
      const pins = new Map(
        state.recommendationPins.map((item, index) => [getRecommendationPinKey(item), index])
      )
      result.recommendations =
        request.showRecommendations === false
          ? []
          : rankContent(over).sort(
              (a, b) =>
                (pins.get(getRecommendationPinKey(a)) ?? Infinity) -
                (pins.get(getRecommendationPinKey(b)) ?? Infinity)
            )
      result.allListModeResults = deduplicateResults([
        ...result.bestSearchResults,
        ...result.bestMatches,
        ...result.recommendations
      ])
      // 仅面板消费完整内容候选；主搜索执行使用单条规则验证，无需重复列表。
      if (request.intent === 'panel') {
        result.panelResults = deduplicateResults([
          ...normal,
          ...rankContent(contentNames),
          ...byUsage(content)
        ])
      }
      const pushQuery = context.pastedText ? prepareQuery(context.pastedText) : query
      if (
        request.includeMainPush &&
        !context.pastedImage &&
        !context.pastedFiles &&
        pushQuery.text
      ) {
        const pushNames = this.pushCommands.filter(
          (item) =>
            !!this.nameMatch(item, pushQuery, work) ||
            this.pushPolicy.matchesPrefix(this.indexFor(item), pushQuery, budget)
        )
        result.mainPushCandidates = deduplicateResults(
          [...pushNames, ...content].filter((item) => item.mainPush)
        )
      }
    }
    this.nameDiagnostics.visited = 500000 - budget.remaining
    this.nameDiagnostics.degraded = budget.degraded
    if (budget.degraded) console.warn('[Search] 备用读音预算降级:', budget.degraded)
    return result
  }
}
