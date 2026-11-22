import { onMounted, onUnmounted, ref } from 'vue'
import {
  upgradeInstalledPluginFromMarket,
  type UpgradePluginInput,
  type UpgradeResult
} from '@/utils/pluginUpgrade'
import { useToast } from '@/components/common/Toast'
import type { PluginDownloadState, PluginItem } from '@/components/common/PluginDetail/types'

// 设置插件的不同页面共用同一个宿主下载通道，切换页面时保持当前任务的进度和互斥状态。
const installingPlugin = ref<string | null>(null)
const downloadStates = ref<Record<string, PluginDownloadState | undefined>>({})
const cancelling = ref(false)
type InstallResult = Awaited<ReturnType<Window['ztools']['internal']['installPluginFromMarket']>>
type LaunchItem = Pick<PluginItem, 'name' | 'title' | 'path'>

/**
 * 复用市场的安装、取消、启动及进度监听，并随使用页面释放监听器。
 * @returns 可用于市场卡片、详情和个人中心的操作与响应式进度。
 */
export function useMarketPluginActions(): {
  installingPlugin: typeof installingPlugin
  downloadStates: typeof downloadStates
  cancelling: typeof cancelling
  upgradePlugin(local: UpgradePluginInput, plugin: PluginItem): Promise<UpgradeResult>
  installPlugin(plugin: PluginItem): Promise<InstallResult | undefined>
  cancelDownload(name: string): Promise<void>
  openPlugin(plugin: LaunchItem): Promise<void>
} {
  const api = window.ztools.internal
  const { error } = useToast()
  let unsubscribe: (() => void) | undefined
  onMounted(() => {
    unsubscribe = api.onPluginMarketDownloadProgress(({ pluginName, ...state }) => {
      // 忽略无关窗口的任务，仅用当前安装操作对应的进度驱动按钮。
      if (pluginName !== installingPlugin.value) return
      const currentTask = downloadStates.value[pluginName]?.taskId
      if (currentTask && currentTask !== state.taskId) return
      downloadStates.value[pluginName] = state
    })
  })
  onUnmounted(() => unsubscribe?.())

  /**
   * 在获取安装互斥锁后运行下载或升级，所有退出路径都复原按钮。
   * @param name 市场插件标识。
   * @param operation 实际下载或升级操作。
   * @returns 操作结果，已有活动任务时返回 undefined。
   * @throws 透传下载或安装操作的异常。
   */
  async function withProgress<T>(
    name: string,
    operation: () => Promise<T>
  ): Promise<T | undefined> {
    if (installingPlugin.value) return
    installingPlugin.value = name
    downloadStates.value[name] = { status: 'downloading', progress: null }
    try {
      return await operation()
    } finally {
      // 下载结果已经返回，后续相同插件可重新开始任务。
      delete downloadStates.value[name]
      installingPlugin.value = null
    }
  }

  /**
   * 下载并安装当前平台的市场插件。
   * @param plugin 当前市场条目，包含宿主解析安装包所需的信息。
   * @returns 已安装记录，取消或已有任务时返回 undefined。
   * @throws 下载或安装失败时抛出宿主返回的原因。
   */
  async function installPlugin(plugin: PluginItem): Promise<InstallResult | undefined> {
    return withProgress(plugin.name, async () => {
      // IPC 需要普通对象，剥离 Vue 响应式代理后再传递市场元数据。
      const result = await api.installPluginFromMarket(JSON.parse(JSON.stringify(plugin)))
      if (result.cancelled) return
      if (!result.success) throw new Error(result.error || '安装失败')
      return result
    })
  }

  /**
   * 让插件中心与市场升级入口使用同一任务锁和宿主进度。
   * @param local 当前设备上的已安装插件。
   * @param plugin 对应的市场版本。
   * @returns 升级结果、取消状态或失败原因。
   */
  async function upgradePlugin(
    local: UpgradePluginInput,
    plugin: PluginItem
  ): Promise<UpgradeResult> {
    // 保留升级流程的安装路径校验和结构化取消结果。
    return (
      (await withProgress(local.name, () => upgradeInstalledPluginFromMarket(local, plugin))) ?? {
        success: false,
        error: '已有插件正在安装'
      }
    )
  }

  /**
   * 取消处于下载阶段的任务，进入安装阶段后禁止中止。
   * @param name 市场插件标识。
   * @returns 取消请求结束的 Promise。
   */
  async function cancelDownload(name: string): Promise<void> {
    const state = downloadStates.value[name]
    if (state?.status !== 'downloading' || cancelling.value) return
    cancelling.value = true
    try {
      const result = await api.cancelPluginMarketDownload(state.taskId || name)
      if (!result.success) error(result.error || '取消下载失败')
    } catch (err) {
      error(err instanceof Error ? err.message : '取消下载失败')
    } finally {
      cancelling.value = false
    }
  }

  /**
   * 使用当前设备的注册路径启动插件，失败时反馈宿主原因。
   * @param plugin 带本机路径和显示名称的插件。
   * @returns 启动请求结束的 Promise。
   */
  async function openPlugin(plugin: LaunchItem): Promise<void> {
    if (!plugin.path) {
      error('无法打开插件：路径未知')
      return
    }
    try {
      const result = await api.launch({
        path: plugin.path,
        type: 'plugin',
        name: plugin.title || plugin.name,
        param: {}
      })
      if (result && !result.success) error(result.error || '打开插件失败')
    } catch (err) {
      error(err instanceof Error ? err.message : '打开插件失败')
    }
  }

  return {
    installingPlugin,
    downloadStates,
    cancelling,
    upgradePlugin,
    installPlugin,
    cancelDownload,
    openPlugin
  }
}
