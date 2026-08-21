import { ref, toRaw, watch } from 'vue'
import { useCommandDataStore } from '../stores/commandDataStore'

/**
 * mainPush 结果项（插件回调返回的单个搜索结果）
 */
export interface MainPushItem {
  icon?: string
  text: string
  title?: string
  [key: string]: any // 插件自定义字段
}

/**
 * mainPush 分组结果（一个 feature 对应一组搜索结果）
 */
export interface MainPushGroup {
  /** 当前分组的唯一键，格式为 `pluginPath:featureCode`。 */
  featureKey: string
  /** 提供该结果分组的插件路径。 */
  pluginPath: string
  /** 提供该结果分组的插件名称。 */
  pluginName: string
  /** 插件 Logo。 */
  pluginLogo: string
  /** 产生命中的功能编码。 */
  featureCode: string
  /** 功能说明文案。 */
  featureExplain: string
  /** 功能图标。 */
  featureIcon?: string
  /** 当前分组命中的 cmd 类型。 */
  matchedCmdType: string
  /** 插件返回的结果项集合。 */
  items: MainPushItem[]
}

/**
 * mainPush 查询所依赖的输入状态。
 */
export interface UseMainPushResultsProps {
  /** 当前搜索框文本。 */
  searchQuery: string
  /** 当前粘贴的图片内容。 */
  pastedImage?: string | null
  /** 当前粘贴的文件列表。 */
  pastedFiles?: any[] | null
  /** 当前粘贴的文本内容。 */
  pastedText?: string | null
}

const MAIN_PUSH_QUERY_TIMEOUT_MS = 2500

/**
 * 为插件查询增加有限等待时间，避免失去响应的插件阻塞整个结果区域。
 * @param promise 插件查询 Promise
 * @param timeoutMs 最大等待时长
 * @returns 原查询结果或超时拒绝的 Promise
 * @throws 查询失败或超时时抛出错误
 */
function withQueryTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('plugin query timed out')), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * mainPush 查询 composable
 * 监听搜索输入，自动查询匹配的 mainPush 插件获取动态结果
 */
export function useMainPushResults(props: UseMainPushResultsProps): {
  mainPushGroups: typeof mainPushGroups
  handleMainPushSelect: (
    group: MainPushGroup,
    item: MainPushItem,
    searchQuery: string
  ) => Promise<boolean>
} {
  const commandDataStore = useCommandDataStore()
  /** 当前搜索词对应的 mainPush 分组结果。 */
  const mainPushGroups = ref<MainPushGroup[]>([])

  /** 防抖定时器，避免输入时频繁触发插件查询。 */
  let queryTimer: ReturnType<typeof setTimeout> | null = null
  /** 查询版本号，用于丢弃过期的异步返回结果。 */
  let queryVersion = 0

  /**
   * 查询所有命中的 mainPush 插件并整理为分组结果。
   */
  async function queryMainPushPlugins(query: string): Promise<void> {
    const currentVersion = ++queryVersion

    // 粘贴图片/文件时不触发 mainPush
    if (props.pastedImage || props.pastedFiles) {
      mainPushGroups.value = []
      return
    }

    const searchText = props.pastedText || query
    if (!searchText.trim()) {
      mainPushGroups.value = []
      return
    }

    // 获取匹配的 mainPush 功能
    const matchingFeatures = commandDataStore.getMatchingMainPushFeatures(searchText)
    if (matchingFeatures.length === 0) {
      mainPushGroups.value = []
      return
    }

    // 并行查询所有匹配的插件
    const results = await Promise.all(
      matchingFeatures.map(async (feature) => {
        try {
          const queryData = {
            code: feature.featureCode,
            type: feature.matchedCmdType,
            payload: searchText
          }
          const items = await withQueryTimeout(
            window.ztools.queryMainPush(feature.pluginPath, feature.featureCode, queryData),
            MAIN_PUSH_QUERY_TIMEOUT_MS
          )
          return { feature, items: Array.isArray(items) ? items : [] }
        } catch (error) {
          console.error(`[MainPush] 查询插件 ${feature.pluginName} 失败:`, error)
          return { feature, items: [] }
        }
      })
    )

    // 检查版本，防止旧查询覆盖新查询
    if (currentVersion !== queryVersion) return

    // 构建分组结果（过滤空结果）
    mainPushGroups.value = results
      .filter((r) => r.items.length > 0)
      .map((r) => ({
        featureKey: `${r.feature.pluginPath}:${r.feature.featureCode}`,
        pluginPath: r.feature.pluginPath,
        pluginName: r.feature.pluginName,
        pluginLogo: r.feature.pluginLogo,
        featureCode: r.feature.featureCode,
        featureExplain: r.feature.featureExplain,
        featureIcon: r.feature.featureIcon,
        matchedCmdType: r.feature.matchedCmdType,
        items: r.items
      }))
  }

  /**
   * 监听搜索输入和粘贴状态变化，并以防抖方式刷新 mainPush 结果。
   */
  watch(
    [
      () => props.searchQuery,
      () => props.pastedText,
      () => props.pastedImage,
      () => props.pastedFiles
    ],
    () => {
      // 立即失效正在返回的查询，后续结果只能由最新输入提交。
      queryVersion++
      if (queryTimer) {
        clearTimeout(queryTimer)
      }
      queryTimer = setTimeout(() => {
        queryMainPushPlugins(props.searchQuery)
      }, 300) // 300ms 防抖
    }
  )

  /**
   * 用户选择 mainPush 结果项
   * @returns 是否需要进入插件界面
   */
  async function handleMainPushSelect(
    group: MainPushGroup,
    item: MainPushItem,
    searchQuery: string
  ): Promise<boolean> {
    try {
      const rawItem = JSON.parse(JSON.stringify(toRaw(item)))
      // 剔除内部展示字段，还原为插件 callback 返回的原始数据
      delete rawItem._resolvedIcon
      const selectData = {
        code: group.featureCode,
        type: group.matchedCmdType,
        payload: searchQuery,
        option: rawItem
      }
      return await window.ztools.selectMainPush(group.pluginPath, group.featureCode, selectData)
    } catch (error) {
      console.error(`[MainPush] 选择处理失败:`, error)
      return false
    }
  }

  return {
    mainPushGroups,
    handleMainPushSelect
  }
}
