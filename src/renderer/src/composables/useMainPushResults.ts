import { computed, type ComputedRef } from 'vue'
import { useCommandDataStore } from '../stores/commandDataStore'
import type { MainPushGroup, MainPushItem } from '@shared/commandService'
export type { MainPushGroup, MainPushItem } from '@shared/commandService'

/**
 * 展示统一查询流中的动态分组。
 * @returns 动态结果与选择适配器
 */
export function useMainPushResults(): {
  mainPushGroups: ComputedRef<MainPushGroup[]>
  handleMainPushSelect: (
    group: MainPushGroup,
    item?: MainPushItem,
    enter?: boolean
  ) => Promise<void>
} {
  const store = useCommandDataStore()
  /**
   * 根据结果身份交由主进程选择或进入插件。
   * @param group 所选分组
   * @param item 插件返回的选项
   * @param enter 是否直接进入插件
   * @returns 操作结束的 Promise
   */
  async function handleMainPushSelect(
    group: MainPushGroup,
    item?: MainPushItem,
    enter = false
  ): Promise<void> {
    const response = await store.execute(undefined, {
      resultId: group.resultId,
      option: item,
      enterMainPush: enter
    })
    if (!response.success) console.error('[Commands] 动态选择失败:', response.error)
  }
  return { mainPushGroups: computed(() => store.result.mainPushGroups), handleMainPushSelect }
}
