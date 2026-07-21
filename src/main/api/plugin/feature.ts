import { ipcMain } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import lmdbInstance from '../../core/lmdb/lmdbInstance'
import windowManager from '../../managers/windowManager'
import { getPluginDataPrefix } from '../../../shared/pluginRuntimeNamespace'

interface DynamicFeature {
  code: string
  explain?: string
  icon?: string
  platform?: string | string[]
  mainHide?: boolean
  cmds: Array<string | { type: string; match: string; label: string; minLength?: number }>
}

interface DynamicFeaturesData {
  features: DynamicFeature[]
}

/**
 * 动态 Feature API
 * 允许插件在运行时动态添加/删除功能
 */
export class PluginFeatureAPI {
  private pluginManager: PluginManager | null = null
  private notifyTimer: NodeJS.Timeout | null = null
  private commandsCacheInvalidator: (() => void) | null = null
  private readonly NOTIFY_DEBOUNCE_DELAY = 3000 // 3秒防抖延迟

  public init(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  public setCommandsCacheInvalidator(invalidator: () => void): void {
    this.commandsCacheInvalidator = invalidator
  }

  /**
   * 根据插件名称和来源生成动态 feature 存储键。
   * 动态指令也必须按运行时命名空间隔离，避免开发版和安装版串写。
   */
  private getDynamicFeaturesDocId(pluginName: string): string {
    return `${getPluginDataPrefix(pluginName)}dynamic-features`
  }

  /**
   * 从 IPC 事件中解析当前插件的运行时上下文。
   */
  private getPluginRuntimeContext(event: Electron.IpcMainEvent): { pluginName: string } | null {
    const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
    if (!pluginInfo) {
      return null
    }

    return {
      pluginName: pluginInfo.name
    }
  }

  private setupIPC(): void {
    // 获取动态 features
    ipcMain.on('get-features', (event, codes?: string[]) => {
      try {
        const pluginRuntimeContext = this.getPluginRuntimeContext(event)
        if (!pluginRuntimeContext) {
          event.returnValue = []
          return
        }

        const features = this.loadDynamicFeatures(pluginRuntimeContext.pluginName)

        // 如果指定了 codes，只返回匹配的 features
        if (codes && Array.isArray(codes)) {
          const filtered = features.filter((f) => codes.includes(f.code))
          event.returnValue = filtered
        } else {
          event.returnValue = features
        }
      } catch (error) {
        console.error('[PluginFeature] get-features error:', error)
        event.returnValue = []
      }
    })

    // 设置动态 feature
    ipcMain.on('set-feature', (event, feature: DynamicFeature) => {
      try {
        console.log('[PluginFeature] set-feature', feature)
        const pluginRuntimeContext = this.getPluginRuntimeContext(event)
        if (!pluginRuntimeContext) {
          event.returnValue = { success: false, error: 'Plugin not found' }
          return
        }

        // 验证 feature 结构
        if (!feature.code || !feature.cmds || !Array.isArray(feature.cmds)) {
          event.returnValue = { success: false, error: 'Invalid feature structure' }
          return
        }

        // 加载现有的动态 features
        const features = this.loadDynamicFeatures(pluginRuntimeContext.pluginName)

        // 查找是否已存在该 code
        const existingIndex = features.findIndex((f) => f.code === feature.code)

        if (existingIndex >= 0) {
          // 更新现有 feature
          features[existingIndex] = feature
        } else {
          // 添加新 feature
          features.push(feature)
        }

        // 保存到数据库
        this.saveDynamicFeatures(pluginRuntimeContext.pluginName, features)

        // 通知渲染进程插件列表已变化
        this.notifyPluginsChanged()

        event.returnValue = { success: true }
      } catch (error: unknown) {
        console.error('[PluginFeature] set-feature error:', error)
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 删除动态 feature
    ipcMain.on('remove-feature', (event, code: string) => {
      try {
        console.log('[PluginFeature] remove-feature', code)
        const pluginRuntimeContext = this.getPluginRuntimeContext(event)
        if (!pluginRuntimeContext) {
          event.returnValue = false
          return
        }

        // 加载现有的动态 features
        const features = this.loadDynamicFeatures(pluginRuntimeContext.pluginName)

        // 查找要删除的 feature
        const index = features.findIndex((f) => f.code === code)

        if (index >= 0) {
          // 删除 feature
          features.splice(index, 1)

          // 保存到数据库
          this.saveDynamicFeatures(pluginRuntimeContext.pluginName, features)

          // 通知渲染进程插件列表已变化
          this.notifyPluginsChanged()

          event.returnValue = true
        } else {
          event.returnValue = false
        }
      } catch (error) {
        console.error('[PluginFeature] remove-feature error:', error)
        event.returnValue = false
      }
    })
  }

  /**
   * 从数据库加载动态 features
   */
  public loadDynamicFeatures(pluginName: string): DynamicFeature[] {
    try {
      const key = this.getDynamicFeaturesDocId(pluginName)
      const doc = lmdbInstance.get(key)

      if (doc && doc.data) {
        const data: DynamicFeaturesData = JSON.parse(doc.data)
        return data.features || []
      }

      return []
    } catch (error) {
      console.error('[PluginFeature] loadDynamicFeatures error:', error)
      return []
    }
  }

  /**
   * 保存动态 features 到数据库
   */
  private saveDynamicFeatures(pluginName: string, features: DynamicFeature[]): void {
    const key = this.getDynamicFeaturesDocId(pluginName)
    const existing = lmdbInstance.get(key)
    console.log('[PluginFeature] 保存动态 Feature 到隔离命名空间:', {
      pluginName,
      key,
      featureCount: features.length
    })

    const doc: any = {
      _id: key,
      data: JSON.stringify({ features })
    }

    if (existing) {
      doc._rev = existing._rev
    }

    lmdbInstance.put(doc)
  }

  /**
   * 通知渲染进程插件列表已变化（带防抖处理）
   * 如果3秒内没有新的通知请求，才会真正发送通知
   */
  private notifyPluginsChanged(): void {
    // 如果已有定时器在运行，清除它
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer)
      this.notifyTimer = null
    }

    // 设置新的定时器，3秒后执行实际通知
    this.notifyTimer = setTimeout(() => {
      this.commandsCacheInvalidator?.()

      const mainWindow = windowManager.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('plugins-changed')
      }

      this.notifyTimer = null
    }, this.NOTIFY_DEBOUNCE_DELAY)
  }

  /**
   * 清理插件的动态 features
   */
  public clearPluginFeatures(pluginName: string): void {
    try {
      const key = this.getDynamicFeaturesDocId(pluginName)
      const doc = lmdbInstance.get(key)
      if (doc) {
        console.log('[PluginFeature] 清理动态 Feature 隔离数据:', {
          pluginName,
          key
        })
        lmdbInstance.remove(key)
      }
    } catch (error) {
      console.error('[PluginFeature] clearPluginFeatures error:', error)
    }
  }
}

// 导出单例
export const pluginFeatureAPI = new PluginFeatureAPI()
