import { app, globalShortcut, ipcMain, nativeTheme } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import { getCurrentShortcut, updateShortcut } from '../../index.js'

import doubleTapManager from '../../core/doubleTapManager.js'
import proxyManager from '../../managers/proxyManager.js'
import windowManager from '../../managers/windowManager.js'
import databaseAPI from '../shared/database'

/**
 * 设置管理API - 主程序专用
 * 包含主题、快捷键、开机启动等设置
 */
export class SettingsAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: PluginManager | null = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
    this.loadAndApplySettings()
  }

  // 临时快捷键录制相关
  private recordingShortcuts: string[] = []

  private setupIPC(): void {
    // 主题
    ipcMain.handle('set-theme', (_event, theme: string) => this.setTheme(theme))

    // 开机启动
    ipcMain.handle('set-launch-at-login', (_event, enable: boolean) =>
      this.setLaunchAtLogin(enable)
    )
    ipcMain.handle('get-launch-at-login', () => this.getLaunchAtLogin())

    // 快捷键
    ipcMain.handle('update-shortcut', (_event, shortcut: string) => this.updateShortcut(shortcut))
    ipcMain.handle('get-current-shortcut', () => this.getCurrentShortcut())
    ipcMain.handle('register-global-shortcut', (_event, shortcut: string, target: string) =>
      this.registerGlobalShortcut(shortcut, target)
    )
    ipcMain.handle('unregister-global-shortcut', (_event, shortcut: string) =>
      this.unregisterGlobalShortcut(shortcut)
    )

    // 应用快捷键
    ipcMain.handle('register-app-shortcut', (_event, shortcut: string, target: string) =>
      this.registerAppShortcut(shortcut, target)
    )
    ipcMain.handle('unregister-app-shortcut', (_event, shortcut: string) =>
      this.unregisterAppShortcut(shortcut)
    )

    // 临时快捷键录制
    ipcMain.handle('start-hotkey-recording', () => this.startHotkeyRecording())
  }

  // 加载并应用设置
  private async loadAndApplySettings(): Promise<void> {
    try {
      const data = databaseAPI.dbGet('settings-general')
      console.log('[Settings] 加载到的设置:', data)
      if (data) {
        // 应用透明度设置
        if (data.opacity !== undefined && this.mainWindow) {
          const clampedOpacity = Math.max(0.3, Math.min(1, data.opacity))
          this.mainWindow.setOpacity(clampedOpacity)
          console.log('[Settings] 启动时应用透明度设置:', data.opacity)
        }
        // 应用快捷键设置
        if (data.hotkey) {
          const success = updateShortcut(data.hotkey)
          console.log('[Settings] 启动时应用快捷键设置:', data.hotkey, success ? '成功' : '失败')
        }
        // 应用托盘图标显示设置（默认显示）
        windowManager.setTrayIconVisible(data.showTrayIcon ?? true)
        console.log('[Settings] 启动时应用托盘图标显示设置:', data.showTrayIcon ?? true)
        // 应用主题设置
        if (data.theme) {
          this.setTheme(data.theme)
          console.log('[Settings] 启动时应用主题设置:', data.theme)
        }
        // 应用自动返回搜索设置
        if (data.autoBackToSearch) {
          await windowManager.updateAutoBackToSearch(data.autoBackToSearch)
          console.log('[Settings] 启动时应用自动返回搜索设置:', data.autoBackToSearch)
        }
        // 应用代理配置
        if (data.proxyEnabled !== undefined && data.proxyUrl !== undefined) {
          proxyManager.setProxyConfig({
            enabled: data.proxyEnabled,
            url: data.proxyUrl
          })
          // 应用全局代理
          await proxyManager.applyProxyToDefaultSession()
          console.log('[Settings] 启动时应用代理配置:', {
            enabled: data.proxyEnabled,
            url: data.proxyUrl
          })
        }
        // 应用窗口默认高度设置
        if (data.windowDefaultHeight !== undefined) {
          this.pluginManager?.setPluginDefaultHeight(data.windowDefaultHeight)
          console.log('[Settings] 启动时应用插件默认高度设置:', data.windowDefaultHeight)
        }
      }

      // 窗口位置现在由 windowManager.moveWindowToCursor() 处理
      // 每个显示器会自动恢复该显示器上次保存的位置

      // 加载并注册全局快捷键
      await this.loadAndRegisterGlobalShortcuts()
      // 加载并注册应用快捷键
      await this.loadAndRegisterAppShortcuts()
    } catch (error) {
      console.error('[Settings] 加载设置失败:', error)
    }
  }

  // 加载并注册全局快捷键
  private async loadAndRegisterGlobalShortcuts(): Promise<void> {
    try {
      const shortcuts = databaseAPI.dbGet('global-shortcuts')
      if (shortcuts && Array.isArray(shortcuts)) {
        for (const shortcut of shortcuts) {
          if (shortcut.enabled && shortcut.shortcut && shortcut.target) {
            try {
              this.registerGlobalShortcut(shortcut.shortcut, shortcut.target)
            } catch (error) {
              console.error(`注册全局快捷键失败: ${shortcut.shortcut}`, error)
            }
          }
        }
      }
    } catch (error) {
      console.error('[Settings] 加载全局快捷键失败:', error)
    }
  }

  // 加载并注册应用快捷键
  private async loadAndRegisterAppShortcuts(): Promise<void> {
    try {
      const shortcuts = databaseAPI.dbGet('app-shortcuts')
      if (shortcuts && Array.isArray(shortcuts)) {
        for (const shortcut of shortcuts) {
          if (shortcut.enabled && shortcut.shortcut && shortcut.target) {
            try {
              this.registerAppShortcut(shortcut.shortcut, shortcut.target)
            } catch (error) {
              console.error(`注册应用快捷键失败: ${shortcut.shortcut}`, error)
            }
          }
        }
      }
    } catch (error) {
      console.error('[Settings] 加载应用快捷键失败:', error)
    }
  }

  // 设置主题
  public setTheme(theme: string): void {
    nativeTheme.themeSource = theme as 'system' | 'light' | 'dark'
    console.log('[Settings] 设置主题:', theme)
  }

  // 设置开机启动
  public setLaunchAtLogin(enable: boolean): void {
    app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: true
    })
    console.log('[Settings] 设置开机启动:', enable)
  }

  // 获取开机启动状态
  public getLaunchAtLogin(): boolean {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  }

  // 更新快捷键
  public updateShortcut(shortcut: string): { success: boolean; error?: string } {
    try {
      const success = updateShortcut(shortcut)
      if (success) {
        return { success: true }
      } else {
        return { success: false, error: '快捷键已被占用' }
      }
    } catch (error: unknown) {
      console.error('[Settings] 更新快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 获取当前快捷键
  private getCurrentShortcut(): string {
    return getCurrentShortcut()
  }

  private static readonly MODIFIER_NAMES = ['Command', 'Ctrl', 'Alt', 'Option', 'Shift']

  // 判断是否为双击修饰键快捷键（如 "Command+Command"）
  private isDoubleTapShortcut(shortcut: string): boolean {
    const parts = shortcut.split('+')
    return (
      parts.length === 2 && parts[0] === parts[1] && SettingsAPI.MODIFIER_NAMES.includes(parts[0])
    )
  }

  // 从双击快捷键字符串中提取修饰键名称
  private getDoubleTapModifier(shortcut: string): string {
    return shortcut.split('+')[0]
  }

  // 注册全局快捷键
  public registerGlobalShortcut(shortcut: string, target: string): any {
    try {
      if (this.isDoubleTapShortcut(shortcut)) {
        const modifier = this.getDoubleTapModifier(shortcut)
        doubleTapManager.unregister(modifier)
        doubleTapManager.register(modifier, () => {
          console.log(`双击修饰键触发: ${shortcut} -> ${target}`)
          this.handleGlobalShortcut(target)
        })
        console.log(`成功注册双击修饰键快捷键: ${shortcut} -> ${target}`)
        return { success: true }
      }

      // 先尝试取消注册该快捷键（如果已被注册），避免重复注册导致失败
      globalShortcut.unregister(shortcut)

      const success = globalShortcut.register(shortcut, () => {
        console.log(`全局快捷键触发: ${shortcut} -> ${target}`)
        this.handleGlobalShortcut(target)
      })

      if (!success) {
        return { success: false, error: '快捷键注册失败，可能已被其他应用占用' }
      }

      console.log(`成功注册全局快捷键: ${shortcut} -> ${target}`)
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 注册全局快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 注销全局快捷键
  public unregisterGlobalShortcut(shortcut: string): any {
    try {
      if (this.isDoubleTapShortcut(shortcut)) {
        const modifier = this.getDoubleTapModifier(shortcut)
        doubleTapManager.unregister(modifier)
        console.log(`成功注销双击修饰键快捷键: ${shortcut}`)
        return { success: true }
      }

      globalShortcut.unregister(shortcut)
      console.log(`成功注销全局快捷键: ${shortcut}`)
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 注销全局快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 处理全局快捷键触发
  // 注意：实际的启动逻辑在 APIManager 中处理，这里只是触发回调
  private handleGlobalShortcut(target: string): void {
    // 调用外部设置的回调
    if (this.onGlobalShortcutTriggered) {
      this.onGlobalShortcutTriggered(target)
    }
  }

  // 外部回调（由 APIManager 设置）
  private onGlobalShortcutTriggered?: (target: string) => void

  public setGlobalShortcutHandler(handler: (target: string) => void): void {
    this.onGlobalShortcutTriggered = handler
  }

  // 开始快捷键录制（注册临时快捷键监听）
  public startHotkeyRecording(): { success: boolean; error?: string } {
    try {
      // 如果已经在录制，先注销之前的临时快捷键
      if (this.recordingShortcuts.length > 0) {
        this.cleanupRecordingShortcuts()
      }

      // 定义需要临时注册的快捷键（常见的快捷键组合）
      const commonShortcuts = ['Alt+Space', 'Option+Space']

      // 注册所有快捷键
      for (const shortcut of commonShortcuts) {
        try {
          const success = globalShortcut.register(shortcut, () => {
            // 快捷键被触发，发送到设置插件
            console.log(`临时快捷键触发: ${shortcut}`)

            // 获取设置插件的 webContents 并发送事件
            if (this.pluginManager) {
              const settingWebContents = this.pluginManager.getPluginWebContentsByName('setting')
              if (settingWebContents) {
                settingWebContents.send('hotkey-recorded', shortcut)
              } else {
                console.warn('[Settings] 设置插件未找到，无法发送快捷键录制事件')
              }
            }

            // 立即注销所有临时快捷键（只能触发一次）
            this.cleanupRecordingShortcuts()
          })

          if (success) {
            this.recordingShortcuts.push(shortcut)
            console.log(`成功注册临时快捷键: ${shortcut}`)
          } else {
            console.warn(`临时快捷键注册失败（可能已被占用）: ${shortcut}`)
          }
        } catch (error) {
          console.error(`注册临时快捷键失败: ${shortcut}`, error)
        }
      }

      console.log(`开始快捷键录制，已注册 ${this.recordingShortcuts.length} 个临时快捷键`)
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 开始快捷键录制失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 清理临时快捷键（内部方法）
  private cleanupRecordingShortcuts(): void {
    for (const shortcut of this.recordingShortcuts) {
      try {
        globalShortcut.unregister(shortcut)
        console.log(`成功注销临时快捷键: ${shortcut}`)
      } catch (error) {
        console.error(`注销临时快捷键失败: ${shortcut}`, error)
      }
    }

    const count = this.recordingShortcuts.length
    this.recordingShortcuts = []
    console.log(`已清理 ${count} 个临时快捷键`)
  }

  // 设置代理配置
  public async setProxyConfig(config: {
    enabled: boolean
    url: string
  }): Promise<{ success: boolean; error?: string }> {
    try {
      proxyManager.setProxyConfig(config)
      console.log('[Settings] 代理配置已更新:', config)

      // 应用全局代理配置
      await proxyManager.applyProxyToDefaultSession()

      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 设置代理配置失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 设置窗口默认高度
  public setWindowDefaultHeight(height: number): { success: boolean; error?: string } {
    try {
      this.pluginManager?.setPluginDefaultHeight(height)
      console.log('[Settings] 插件默认高度已更新:', height)
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 设置插件默认高度失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 注册应用快捷键
  public registerAppShortcut(shortcut: string, target: string): any {
    try {
      const success = windowManager.registerAppShortcut(shortcut, target)
      if (!success) {
        return { success: false, error: '应用快捷键注册失败' }
      }
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 注册应用快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 注销应用快捷键
  public unregisterAppShortcut(shortcut: string): any {
    try {
      windowManager.unregisterAppShortcut(shortcut)
      console.log(`成功注销应用快捷键: ${shortcut}`)
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 注销应用快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }
}

export default new SettingsAPI()
