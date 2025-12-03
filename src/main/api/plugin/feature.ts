import { ipcMain } from 'electron'
import lmdbInstance from '../../core/lmdb/lmdbInstance'
import windowManager from '../../windowManager'

interface DynamicFeature {
  code: string
  explain?: string
  icon?: string
  platform?: string | string[]
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
  private pluginManager: any = null

  public init(pluginManager: any): void {
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  private setupIPC(): void {
    // 获取动态 features
    ipcMain.on('get-features', (event, codes?: string[]) => {
      try {
        const pluginName = this.getPluginName(event)
        if (!pluginName) {
          event.returnValue = []
          return
        }

        const features = this.loadDynamicFeatures(pluginName)

        // 如果指定了 codes，只返回匹配的 features
        if (codes && Array.isArray(codes)) {
          const filtered = features.filter((f) => codes.includes(f.code))
          event.returnValue = filtered
        } else {
          event.returnValue = features
        }
      } catch (error) {
        console.error('get-features error:', error)
        event.returnValue = []
      }
    })

    // 设置动态 feature
    ipcMain.on('set-feature', (event, feature: DynamicFeature) => {
      try {
        const pluginName = this.getPluginName(event)
        if (!pluginName) {
          event.returnValue = { success: false, error: 'Plugin not found' }
          return
        }

        // 验证 feature 结构
        if (!feature.code || !feature.cmds || !Array.isArray(feature.cmds)) {
          event.returnValue = { success: false, error: 'Invalid feature structure' }
          return
        }

        // 加载现有的动态 features
        const features = this.loadDynamicFeatures(pluginName)

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
        this.saveDynamicFeatures(pluginName, features)

        // 通知渲染进程插件列表已变化
        this.notifyPluginsChanged()

        event.returnValue = { success: true }
      } catch (error: any) {
        console.error('set-feature error:', error)
        event.returnValue = { success: false, error: error.message }
      }
    })

    // 删除动态 feature
    ipcMain.on('remove-feature', (event, code: string) => {
      try {
        const pluginName = this.getPluginName(event)
        if (!pluginName) {
          event.returnValue = false
          return
        }

        // 加载现有的动态 features
        const features = this.loadDynamicFeatures(pluginName)

        // 查找要删除的 feature
        const index = features.findIndex((f) => f.code === code)

        if (index >= 0) {
          // 删除 feature
          features.splice(index, 1)

          // 保存到数据库
          this.saveDynamicFeatures(pluginName, features)

          // 通知渲染进程插件列表已变化
          this.notifyPluginsChanged()

          event.returnValue = true
        } else {
          event.returnValue = false
        }
      } catch (error) {
        console.error('remove-feature error:', error)
        event.returnValue = false
      }
    })
  }

  /**
   * 获取调用插件的名称
   */
  private getPluginName(event: Electron.IpcMainEvent): string | null {
    const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
    return pluginInfo ? pluginInfo.name : null
  }

  /**
   * 从数据库加载动态 features
   */
  public loadDynamicFeatures(pluginName: string): DynamicFeature[] {
    try {
      const key = `PLUGIN/${pluginName}/dynamic-features`
      const doc = lmdbInstance.get(key)

      if (doc && doc.data) {
        const data: DynamicFeaturesData = JSON.parse(doc.data)
        return data.features || []
      }

      return []
    } catch (error) {
      console.error('loadDynamicFeatures error:', error)
      return []
    }
  }

  /**
   * 保存动态 features 到数据库
   */
  private saveDynamicFeatures(pluginName: string, features: DynamicFeature[]): void {
    const key = `PLUGIN/${pluginName}/dynamic-features`
    const existing = lmdbInstance.get(key)

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
   * 通知渲染进程插件列表已变化
   */
  private notifyPluginsChanged(): void {
    const mainWindow = windowManager.getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('plugins-changed')
    }
  }

  /**
   * 清理插件的动态 features
   */
  public clearPluginFeatures(pluginName: string): void {
    try {
      const key = `PLUGIN/${pluginName}/dynamic-features`
      const doc = lmdbInstance.get(key)
      if (doc) {
        lmdbInstance.remove(key)
      }
    } catch (error) {
      console.error('clearPluginFeatures error:', error)
    }
  }
}

// 导出单例
export const pluginFeatureAPI = new PluginFeatureAPI()
