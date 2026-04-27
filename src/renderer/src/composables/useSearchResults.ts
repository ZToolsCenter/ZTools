import { computed, ref, watch } from 'vue'
import { useCommandDataStore } from '../stores/commandDataStore'
import { useWindowStore } from '../stores/windowStore'

/**
 * 去重：同一个 feature 只保留第一个匹配的 cmd
 * 插件类型用 path+featureCode 去重，非插件用 name+path 去重
 */
export function deduplicateResults<
  T extends { type?: string; path: string; name: string; featureCode?: string }
>(results: T[]): T[] {
  const seenFeatures = new Set<string>()
  return results.filter((item) => {
    const featureKey =
      item.type === 'plugin' ? `${item.path}:${item.featureCode}` : `${item.name}|${item.path}`
    if (seenFeatures.has(featureKey)) {
      return false
    }
    seenFeatures.add(featureKey)
    return true
  })
}

/**
 * 根据使用统计对匹配指令结果排序（useCount 降序）
 */
function sortByUsage<T extends { path: string; featureCode?: string }>(
  results: T[],
  statsMap: Map<string, number>
): T[] {
  if (statsMap.size === 0) return results
  return [...results].sort((a, b) => {
    const keyA = `${a.path}:${a.featureCode || ''}`
    const keyB = `${b.path}:${b.featureCode || ''}`
    const countA = statsMap.get(keyA) || 0
    const countB = statsMap.get(keyB) || 0
    return countB - countA
  })
}

/**
 * 搜索结果计算 Composable
 * 统一管理所有搜索结果的计算逻辑
 */
export function useSearchResults(props: {
  searchQuery: string
  pastedImage?: string | null
  pastedFiles?: any[] | null
  pastedText?: string | null
}): {
  bestSearchResults: any
  bestMatches: any
  recommendations: any
  allListModeResults: any
} {
  const commandDataStore = useCommandDataStore()
  const windowStore = useWindowStore()
  const {
    search,
    searchInCommands,
    searchImageCommands,
    searchTextCommands,
    searchFileCommands,
    matchesWindowCommand
  } = commandDataStore

  // 使用统计缓存（key: "path:featureCode", value: useCount）
  const usageStatsMap = ref<Map<string, number>>(new Map())

  // 每次搜索条件变化时，异步加载最新的使用统计数据
  watch(
    [
      () => props.searchQuery,
      () => props.pastedImage,
      () => props.pastedText,
      () => props.pastedFiles
    ],
    async () => {
      try {
        const stats: any[] = await window.ztools.getUsageStats()
        const map = new Map<string, number>()
        for (const item of stats) {
          const key = `${item.path}:${item.featureCode || ''}`
          map.set(key, item.useCount || 0)
        }
        usageStatsMap.value = map
      } catch (error) {
        console.error('加载使用统计失败:', error)
      }
    },
    { immediate: true }
  )

  function filterUnavailableWindowCommands<
    T extends { cmdType?: string; matchCmd?: { type?: string } }
  >(results: T[]): T[] {
    return results.filter((cmd) => {
      const cmdType = cmd.cmdType || cmd.matchCmd?.type
      return cmdType !== 'window' || matchesWindowCommand(cmd as any, windowStore.currentWindow)
    })
  }

  // 统一的搜索结果（只执行一次搜索）
  const unifiedSearchResult = computed(() => {
    if (!props.searchQuery.trim()) {
      return { bestMatches: [], regexMatches: [] }
    }
    return search(props.searchQuery)
  })

  // 最佳搜索结果（模糊搜索：应用、插件、系统设置）
  const bestSearchResults = computed(() => {
    // 粘贴图片或文件时不显示最佳搜索结果
    if (props.pastedImage || props.pastedFiles) {
      return []
    }

    // 粘贴文本时，检查是否有 regex 类型的匹配
    if (props.pastedText) {
      const allMatched = searchTextCommands(props.pastedText)
      const regexMatched = allMatched.filter((cmd) => {
        const cmdType = cmd.cmdType || cmd.matchCmd?.type
        return cmdType === 'regex'
      })

      // 如果有 regex 匹配，则不显示 over 类型
      if (regexMatched.length > 0) {
        return []
      }

      // 返回 over 类型的指令
      const matchedCommands = allMatched.filter((cmd) => {
        const cmdType = cmd.cmdType || cmd.matchCmd?.type
        return cmdType === 'over'
      })

      // 如果有搜索关键词，在匹配的指令中搜索
      if (props.searchQuery.trim()) {
        return sortByUsage(
          searchInCommands(matchedCommands, props.searchQuery),
          usageStatsMap.value
        )
      }
      return sortByUsage(matchedCommands, usageStatsMap.value)
    }

    // 正常搜索
    if (!props.searchQuery.trim()) {
      return []
    }

    return filterUnavailableWindowCommands(unifiedSearchResult.value.bestMatches)
  })

  // 最佳匹配（匹配指令：regex/img/files 类型）
  const bestMatches = computed(() => {
    // 粘贴图片时，返回 img 类型的匹配指令
    if (props.pastedImage) {
      const matchedCommands = searchImageCommands()
      if (props.searchQuery.trim()) {
        return sortByUsage(
          searchInCommands(matchedCommands, props.searchQuery),
          usageStatsMap.value
        )
      }
      return sortByUsage(matchedCommands, usageStatsMap.value)
    }

    // 粘贴文件时，返回 files 类型的匹配指令
    if (props.pastedFiles) {
      const matchedCommands = searchFileCommands(props.pastedFiles)
      if (props.searchQuery.trim()) {
        return sortByUsage(
          searchInCommands(matchedCommands, props.searchQuery),
          usageStatsMap.value
        )
      }
      return sortByUsage(matchedCommands, usageStatsMap.value)
    }

    // 粘贴文本时，返回 regex 类型的匹配指令
    if (props.pastedText) {
      const allMatched = searchTextCommands(props.pastedText)
      const regexMatched = allMatched.filter((cmd) => {
        const cmdType = cmd.cmdType || cmd.matchCmd?.type
        return cmdType === 'regex'
      })

      if (props.searchQuery.trim()) {
        return sortByUsage(searchInCommands(regexMatched, props.searchQuery), usageStatsMap.value)
      }
      return sortByUsage(regexMatched, usageStatsMap.value)
    }

    // 普通搜索：过滤出 regex、img、files 类型（排除 over）
    if (!props.searchQuery.trim()) {
      return []
    }

    const filtered = unifiedSearchResult.value.regexMatches.filter((cmd) => {
      const cmdType = cmd.cmdType || cmd.matchCmd?.type
      return cmdType === 'regex' || cmdType === 'img' || cmdType === 'files'
    })
    return sortByUsage(filtered, usageStatsMap.value)
  })

  // 推荐列表（over 类型）
  const recommendations = computed(() => {
    if (!windowStore.showMatchRecommendation) {
      return []
    }

    // 粘贴图片或文件时不显示推荐
    if (props.pastedImage || props.pastedFiles) return []

    let overTypeResults: any[] = []

    // 粘贴文本时，获取 over 类型的匹配指令
    if (props.pastedText) {
      const allMatched = searchTextCommands(props.pastedText)
      overTypeResults = allMatched.filter((cmd) => {
        const cmdType = cmd.cmdType || cmd.matchCmd?.type
        return cmdType === 'over'
      })

      if (props.searchQuery.trim()) {
        overTypeResults = searchInCommands(overTypeResults, props.searchQuery)
      }
    } else {
      // 普通搜索
      if (props.searchQuery.trim() === '') {
        return []
      }

      overTypeResults = unifiedSearchResult.value.regexMatches.filter((cmd) => {
        const cmdType = cmd.cmdType || cmd.matchCmd?.type
        return cmdType === 'over'
      })
    }

    // 去重：同一个 feature 只保留第一个匹配的 cmd
    const deduplicated = deduplicateResults(overTypeResults)
    // 按使用频率排序
    return sortByUsage(deduplicated, usageStatsMap.value)
  })

  // 列表模式：合并所有搜索结果，按匹配分数排序
  const allListModeResults = computed(() => {
    const query = props.searchQuery.trim().toLowerCase()

    // 合并所有结果
    const allResults = [...bestSearchResults.value, ...bestMatches.value, ...recommendations.value]
    const deduped = deduplicateResults(allResults)

    // 无搜索词（如仅粘贴文本）时，返回去重后的原始顺序结果
    if (!query) return deduped

    // 排序：完全匹配 > 前缀匹配 > 系统应用 > 其他
    return deduped.sort((a, b) => {
      const nameA = a.name.toLowerCase()
      const nameB = b.name.toLowerCase()

      // 1. 完全匹配优先
      const isExactA = nameA === query
      const isExactB = nameB === query
      if (isExactA && !isExactB) return -1
      if (!isExactA && isExactB) return 1

      // 2. 前缀匹配优先
      const isPrefixA = nameA.startsWith(query)
      const isPrefixB = nameB.startsWith(query)
      if (isPrefixA && !isPrefixB) return -1
      if (!isPrefixA && isPrefixB) return 1

      // 3. 系统应用权重略高
      const isAppA = a.type === 'direct' && a.subType === 'app'
      const isAppB = b.type === 'direct' && b.subType === 'app'
      if (isAppA && !isAppB) return -1
      if (!isAppA && isAppB) return 1

      // 4. 使用频率排序
      const keyA = `${a.path}:${a.featureCode || ''}`
      const keyB = `${b.path}:${b.featureCode || ''}`
      const countA = usageStatsMap.value.get(keyA) || 0
      const countB = usageStatsMap.value.get(keyB) || 0
      return countB - countA
    })
  })

  return {
    bestSearchResults,
    bestMatches,
    recommendations,
    allListModeResults
  }
}
