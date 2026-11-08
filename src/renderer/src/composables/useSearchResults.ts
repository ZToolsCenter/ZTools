import { computed, onUnmounted, watch, type ComputedRef } from 'vue'
import type { Command } from '@shared/commandService'
import { useCommandDataStore } from '../stores/commandDataStore'
import { useWindowStore } from '../stores/windowStore'
export { deduplicateResults } from '@shared/commandResults'

/**
 * 提交输入快照并展示服务端最终分组。
 * @param props 输入展示状态
 * @returns 各分组的响应式快照
 */
export function useSearchResults(props: {
  searchQuery: string
  pastedImage?: string | null
  pastedFiles?: any[] | null
  pastedText?: string | null
}): {
  bestSearchResults: ComputedRef<Command[]>
  bestMatches: ComputedRef<Command[]>
  recommendations: ComputedRef<Command[]>
  allListModeResults: ComputedRef<Command[]>
} {
  const store = useCommandDataStore()
  const windowStore = useWindowStore()
  watch(
    [
      () => props.searchQuery,
      () => props.pastedImage,
      () => props.pastedFiles,
      () => props.pastedText,
      () => windowStore.currentWindow,
      () => windowStore.showMatchRecommendation,
      () => store.stateVersion
    ],
    () => {
      void store
        .query(
          {
            searchQuery: props.searchQuery,
            pastedImage: props.pastedImage || null,
            pastedFiles: props.pastedFiles || null,
            pastedText: props.pastedText || null,
            windowInfo: windowStore.currentWindow
          },
          windowStore.showMatchRecommendation
        )
        .catch((error) => console.error('[Commands] 搜索失败:', error))
    },
    { immediate: true, flush: 'sync' }
  )
  onUnmounted(() => store.cancelQuery())
  return {
    bestSearchResults: computed(() => store.result.bestSearchResults),
    bestMatches: computed(() => store.result.bestMatches),
    recommendations: computed(() => store.result.recommendations),
    allListModeResults: computed(() => store.result.allListModeResults)
  }
}
