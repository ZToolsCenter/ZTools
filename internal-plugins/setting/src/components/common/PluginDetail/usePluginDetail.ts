import { marked } from 'marked'
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useToast } from '@/components'
import type { DocItem, PluginItem, PluginUninstallOptions, TabId, TabItem } from './types'
import {
  ENABLED_MAIN_PUSH_PLUGINS_KEY,
  normalizeConfigList,
  isMainPushPluginEnabled
} from '@shared/pluginSettings'

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true
})

export interface UsePluginDetailOptions {
  plugin: Ref<PluginItem>
  isRunning?: Ref<boolean | undefined>
  /** 是否显示详情/README Tab */
  showDetail?: boolean
  /** 是否显示留言 Tab */
  showComments?: boolean
  /** 是否显示指令列表 Tab */
  showCommands?: boolean
  /** 是否显示插件数据 Tab */
  showData?: boolean
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function usePluginDetail(options: UsePluginDetailOptions) {
  const {
    plugin,
    isRunning,
    showDetail = true,
    showComments = false,
    showCommands = true,
    showData = true
  } = options
  const { success, error, confirm, confirmWithExtra } = useToast()

  // 插件设置状态
  const showSettingsDropdown = ref(false)
  const isAutoKill = ref(false)
  const isAutoDetach = ref(false)
  const isAutoStart = ref(false)
  const isMainPushEnabled = ref(false)

  // 当前详情页插件的有效名称（已包含 __dev 后缀）
  const currentPluginName = computed(() => plugin.value.name || null)
  const pluginHasMainPush = computed(() =>
    Boolean(
      plugin.value.features?.some(
        (feature: any) => feature?.mainPush && Array.isArray(feature.cmds)
      )
    )
  )

  /** 切换字符串列表中的某项 */
  function toggleInList(list: string[], name: string): string[] {
    return list.includes(name) ? list.filter((n) => n !== name) : [...list, name]
  }

  // 点击外部关闭下拉菜单
  function handleClickOutside(): void {
    showSettingsDropdown.value = false
  }

  // 切换插件设置菜单展开状态
  function toggleSettingsDropdown(): void {
    showSettingsDropdown.value = !showSettingsDropdown.value
  }

  // 加载插件设置
  async function loadPluginSettings(): Promise<void> {
    if (!plugin.value.name) return

    try {
      const killData = await window.ztools.internal.dbGet('out-kill-plugin')
      if (Array.isArray(killData) && currentPluginName.value) {
        isAutoKill.value = normalizeConfigList(killData).includes(currentPluginName.value)
      }
    } catch (err) {
      console.debug('未找到 outKillPlugin 配置', err)
    }

    try {
      const detachData = await window.ztools.internal.dbGet('auto-detach-plugin')
      if (Array.isArray(detachData) && currentPluginName.value) {
        isAutoDetach.value = normalizeConfigList(detachData).includes(currentPluginName.value)
      }
    } catch (err) {
      console.debug('未找到 autoDetachPlugin 配置', err)
    }

    try {
      const startData = await window.ztools.internal.dbGet('auto-start-plugin')
      if (Array.isArray(startData) && currentPluginName.value) {
        isAutoStart.value = normalizeConfigList(startData).includes(currentPluginName.value)
      }
    } catch (err) {
      console.debug('未找到 autoStartPlugin 配置', err)
    }

    try {
      const mainPushData = await window.ztools.internal.dbGet(ENABLED_MAIN_PUSH_PLUGINS_KEY)
      if (currentPluginName.value) {
        isMainPushEnabled.value = isMainPushPluginEnabled(
          currentPluginName.value,
          normalizeConfigList(mainPushData)
        )
      }
    } catch (err) {
      console.debug('未找到 enabled-main-push-plugin 配置', err)
    }
  }

  // 切换「退出即结束」
  async function toggleAutoKill(): Promise<void> {
    if (!currentPluginName.value) return

    let list: string[] = []
    try {
      const data = await window.ztools.internal.dbGet('out-kill-plugin')
      list = normalizeConfigList(data)
    } catch {
      // ignore
    }

    list = toggleInList(list, currentPluginName.value)
    await window.ztools.internal.dbPut('out-kill-plugin', list)
    isAutoKill.value = list.includes(currentPluginName.value)
  }

  // 切换「自动分离窗口」
  async function toggleAutoDetach(): Promise<void> {
    if (!currentPluginName.value) return

    let list: string[] = []
    try {
      const data = await window.ztools.internal.dbGet('auto-detach-plugin')
      list = normalizeConfigList(data)
    } catch {
      // ignore
    }

    list = toggleInList(list, currentPluginName.value)
    await window.ztools.internal.dbPut('auto-detach-plugin', list)
    isAutoDetach.value = list.includes(currentPluginName.value)
  }

  // 切换「跟随主程序同时启动运行」
  async function toggleAutoStart(): Promise<void> {
    if (!currentPluginName.value) return

    let list: string[] = []
    try {
      const data = await window.ztools.internal.dbGet('auto-start-plugin')
      list = normalizeConfigList(data)
    } catch {
      // ignore
    }

    list = toggleInList(list, currentPluginName.value)
    await window.ztools.internal.dbPut('auto-start-plugin', list)
    isAutoStart.value = list.includes(currentPluginName.value)
  }

  async function toggleMainPushEnabled(): Promise<void> {
    if (!currentPluginName.value) return

    const nextEnabled = !isMainPushEnabled.value
    const result = await window.ztools.internal.setPluginMainPushEnabled(
      currentPluginName.value,
      nextEnabled
    )
    if (result.success) {
      isMainPushEnabled.value = nextEnabled
    } else {
      error(`更新搜索栏推送状态失败: ${result.error || '未知错误'}`)
    }
  }

  // Tab 状态
  const activeTab = ref<TabId>('detail')

  // README 状态
  const readmeContent = ref<string>('')
  const readmeLoading = ref(false)
  const readmeError = ref<string>('')

  // 插件数据状态
  const docKeys = ref<DocItem[]>([])
  const dataLoading = ref(false)
  const dataError = ref<string>('')
  const expandedDataId = ref<string>('')
  const currentDocContent = ref<any>(null)
  const currentDocType = ref<'document' | 'attachment'>('document')
  const isClearing = ref(false)

  // 内存信息状态
  const memoryInfo = ref<{ private: number; shared: number; total: number } | null>(null)
  const memoryLoading = ref(false)
  let memoryUpdateTimer: ReturnType<typeof setTimeout> | null = null

  // 渲染 Markdown
  const renderedMarkdown = computed(() => {
    if (!readmeContent.value) return ''
    return marked(readmeContent.value)
  })

  // 可用的 Tab
  const availableTabs = computed(() => {
    const tabs: TabItem[] = []

    if (showDetail) {
      tabs.push({ id: 'detail', label: '详情' })
    }

    if (showCommands) {
      tabs.push({ id: 'commands', label: '指令列表' })
    }

    if (showData && plugin.value.installed) {
      tabs.push({ id: 'data', label: '数据' })
    }

    if (showComments) {
      tabs.push({ id: 'comments', label: '留言' })
    }

    return tabs
  })

  // 切换 Tab
  function switchTab(tabId: TabId): void {
    if (!availableTabs.value.some((tab) => tab.id === tabId)) return
    activeTab.value = tabId

    if (tabId === 'data' && !docKeys.value.length && !dataLoading.value) {
      loadPluginData()
    }
  }

  // 加载 README
  async function loadReadme(): Promise<void> {
    if (!showDetail) return
    readmeLoading.value = true
    readmeError.value = ''

    try {
      if (plugin.value.name) {
        const result = await window.ztools.internal.getPluginReadme(plugin.value.name)
        if (result.success && result.content) {
          readmeContent.value = result.content
        } else {
          readmeError.value = result.error || '加载失败'
        }
      } else {
        readmeError.value = '插件信息不完整'
      }
    } catch (err) {
      console.error('加载 README 失败:', err)
      readmeError.value = '读取失败'
    } finally {
      readmeLoading.value = false
    }
  }

  // 加载插件数据
  async function loadPluginData(): Promise<void> {
    if (!plugin.value.name || !currentPluginName.value) {
      dataError.value = '插件名称不存在'
      return
    }

    dataLoading.value = true
    dataError.value = ''

    try {
      const result = await window.ztools.internal.getPluginDocKeys(currentPluginName.value)
      if (result.success) {
        docKeys.value = result.data || []
      } else {
        dataError.value = result.error || '获取失败'
      }
    } catch (err) {
      console.error('加载插件数据失败:', err)
      dataError.value = '获取失败'
    } finally {
      dataLoading.value = false
    }
  }

  // 清除插件全部数据
  async function handleClearAllData(): Promise<void> {
    if (!plugin.value.name || !currentPluginName.value || isClearing.value) return

    const confirmed = await confirm({
      title: '清除全部数据',
      message: `确定要清除插件"${plugin.value.name}"的全部数据吗？\n\n⚠️ 警告：此操作将永久删除该插件存储的所有数据，包括文档和附件。\n\n此操作不可恢复，请谨慎操作！`,
      type: 'danger',
      confirmText: '清除',
      cancelText: '取消'
    })

    if (!confirmed) return

    isClearing.value = true
    try {
      const result = await window.ztools.internal.clearPluginData(currentPluginName.value)
      if (result.success) {
        success('插件数据已清除')
        expandedDataId.value = ''
        currentDocContent.value = null
        await loadPluginData()
      } else {
        error(`清除失败: ${result.error}`)
      }
    } catch (err: any) {
      console.error('清除插件数据失败:', err)
      error(`清除失败: ${err.message || '未知错误'}`)
    } finally {
      isClearing.value = false
    }
  }

  // 版本比较函数
  function compareVersions(v1: string, v2: string): number {
    if (!v1 || !v2) return 0
    const parts1 = v1.split('.').map(Number)
    const parts2 = v2.split('.').map(Number)
    const len = Math.max(parts1.length, parts2.length)

    for (let i = 0; i < len; i++) {
      const num1 = parts1[i] || 0
      const num2 = parts2[i] || 0
      if (num1 < num2) return -1
      if (num1 > num2) return 1
    }
    return 0
  }

  // 判断是否可以升级
  const canUpgrade = computed(() => {
    if (!plugin.value.installed || !plugin.value.localVersion || !plugin.value.version) return false
    return compareVersions(plugin.value.localVersion, plugin.value.version) < 0
  })

  // 处理卸载
  async function handleUninstall(emitFn: (options: PluginUninstallOptions) => void): Promise<void> {
    const result = await confirmWithExtra({
      title: '删除插件',
      message: `确定要删除插件"${plugin.value.name}"吗？\n\n此操作将删除插件文件，无法恢复。`,
      type: 'danger',
      extra: [
        {
          id: 'deleteData',
          message: '同时删除插件数据',
          defaultChecked: false
        }
      ],
      confirmText: '删除',
      cancelText: '取消'
    })
    if (result.confirmed) {
      emitFn({ deleteData: result.extra.deleteData === true })
    }
  }

  // 切换数据详情展开状态
  async function toggleDataDetail(item: DocItem): Promise<void> {
    if (!currentPluginName.value) return

    if (expandedDataId.value === item.key) {
      expandedDataId.value = ''
      currentDocContent.value = null
      return
    }

    expandedDataId.value = item.key
    currentDocType.value = item.type

    try {
      const result = await window.ztools.internal.getPluginDoc(currentPluginName.value, item.key)
      if (result.success) {
        currentDocContent.value = result.data
        currentDocType.value = result.type || 'document'
      } else {
        currentDocContent.value = { error: result.error || '加载失败' }
      }
    } catch (err) {
      console.error('加载文档内容失败:', err)
      currentDocContent.value = { error: '加载失败' }
    }
  }

  function formatJsonData(data: any): string {
    if (!data) return ''
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return String(data)
    }
  }

  function formatDate(dateStr?: string): string {
    if (!dateStr) return ''
    try {
      const date = new Date(dateStr)
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    } catch {
      return dateStr
    }
  }

  function formatSize(bytes?: number): string {
    if (!bytes || bytes <= 0) return ''
    const mb = bytes / (1024 * 1024)
    if (mb >= 1) {
      return `${mb.toFixed(2)} MB`
    }
    const kb = bytes / 1024
    return `${kb.toFixed(2)} KB`
  }

  function openHomepage(): void {
    if (plugin.value.homepage) {
      window.ztools.shellOpenExternal(plugin.value.homepage)
    }
  }

  // 加载插件内存信息
  async function loadMemoryInfo(): Promise<void> {
    if (!plugin.value.path) {
      memoryInfo.value = null
      return
    }

    if (!isRunning?.value) {
      memoryInfo.value = null
      return
    }

    memoryLoading.value = true
    try {
      const result = await window.ztools.internal.getPluginMemoryInfo(plugin.value.path)
      if (result.success && result.data) {
        memoryInfo.value = result.data
      } else {
        memoryInfo.value = null
      }
    } catch (err) {
      console.error('[PluginDetail] 获取插件内存信息失败:', err)
      memoryInfo.value = null
    } finally {
      memoryLoading.value = false
    }
  }

  function startMemoryUpdate(): void {
    loadMemoryInfo()
    if (memoryUpdateTimer) {
      clearInterval(memoryUpdateTimer)
    }
    memoryUpdateTimer = setInterval(() => {
      loadMemoryInfo()
    }, 3000)
  }

  function stopMemoryUpdate(): void {
    if (memoryUpdateTimer) {
      clearInterval(memoryUpdateTimer)
      memoryUpdateTimer = null
    }
    memoryInfo.value = null
  }

  // 生命周期
  onMounted(() => {
    if (showDetail && plugin.value.name) {
      loadReadme()
    }
    if (plugin.value.installed && plugin.value.name) {
      loadPluginSettings()
    }
    if (isRunning?.value) {
      startMemoryUpdate()
    }
    document.addEventListener('click', handleClickOutside)
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside)
    stopMemoryUpdate()
  })

  watch(
    () => plugin.value.name,
    () => {
      if (showDetail && plugin.value.name) {
        readmeContent.value = ''
        readmeError.value = ''
        loadReadme()
      }
      if (plugin.value.installed && plugin.value.name) {
        loadPluginSettings()
      }
    }
  )

  watch(
    availableTabs,
    (tabs) => {
      if (!tabs.some((tab) => tab.id === activeTab.value)) {
        activeTab.value = tabs[0]?.id || 'detail'
      }
    },
    { immediate: true }
  )

  watch(
    () => isRunning?.value,
    (newValue) => {
      if (newValue) {
        startMemoryUpdate()
      } else {
        stopMemoryUpdate()
      }
    }
  )

  return {
    // 设置状态
    showSettingsDropdown,
    isAutoKill,
    isAutoDetach,
    isAutoStart,
    isMainPushEnabled,
    pluginHasMainPush,
    currentPluginName,
    toggleSettingsDropdown,
    toggleAutoKill,
    toggleAutoDetach,
    toggleAutoStart,
    toggleMainPushEnabled,

    // Tab 状态
    activeTab,
    availableTabs,
    switchTab,

    // README
    readmeContent,
    readmeLoading,
    readmeError,
    renderedMarkdown,

    // 插件数据
    docKeys,
    dataLoading,
    dataError,
    expandedDataId,
    currentDocContent,
    currentDocType,
    isClearing,
    handleClearAllData,
    toggleDataDetail,

    // 内存
    memoryInfo,
    memoryLoading,

    // 版本
    canUpgrade,

    // 操作
    handleUninstall,

    // 工具
    formatJsonData,
    formatDate,
    formatSize,
    openHomepage
  }
}
