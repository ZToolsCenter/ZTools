import type { MatchBudget } from '../searchTypes'
import type { PreparedQuery } from './contracts'
import type { IndexedName, NameMatcherRegistry } from './nameMatcherRegistry'

/** 普通搜索资格由引擎复用；此策略专门验证完整命令词后附参数。 */
export class MainPushTriggerPolicy {
  /**
   * 注入与搜索共用的策略集合。
   * @param names 名称匹配器注册表
   * @returns 触发策略实例
   */
  constructor(private readonly names: NameMatcherRegistry) {}

  /**
   * 检查完整表示和参数边界，评分不影响触发资格。
   * @param index 名称内部索引
   * @param query 输入快照
   * @param budget 共享读音预算
   * @returns 是否含合法完整命令词
   */
  matchesPrefix(index: IndexedName, query: PreparedQuery, budget: MatchBudget): boolean {
    return !!this.names.match(index, query, budget, 'command-prefix')
  }
}
