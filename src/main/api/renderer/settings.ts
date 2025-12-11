import { ipcMain, nativeTheme, app, globalShortcut } from 'electron'
import windowManager from '../../windowManager.js'
import { updateShortcut, getCurrentShortcut } from '../../index.js'
import databaseAPI from '../shared/database'

/**
 * 设置管理API - 主程序专用
 * 包含主题、快捷键、开机启动等设置
 */
export class SettingsAPI {
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
    this.loadAndApplySettings()
  }

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
  }

  // 加载并应用设置
  private async loadAndApplySettings(): Promise<void> {
    try {
      const data = await databaseAPI.dbGet('settings-general')
      console.log('加载到的设置:', data)
      if (data) {
        // 应用透明度设置
        if (data.opacity !== undefined && this.mainWindow) {
          const clampedOpacity = Math.max(0.3, Math.min(1, data.opacity))
          this.mainWindow.setOpacity(clampedOpacity)
          console.log('启动时应用透明度设置:', data.opacity)
        }
        // 应用快捷键设置
        if (data.hotkey) {
          const success = updateShortcut(data.hotkey)
          console.log('启动时应用快捷键设置:', data.hotkey, success ? '成功' : '失败')
        }
        // 应用托盘图标显示设置
        windowManager.setTrayIconVisible(data.showTrayIcon)
        console.log('启动时应用托盘图标显示设置:', data.showTrayIcon)
        // 应用失去焦点隐藏设置
        if (data.hideOnBlur !== undefined) {
          windowManager.setHideOnBlur(data.hideOnBlur)
          console.log('启动时应用失去焦点隐藏设置:', data.hideOnBlur)
        }
        // 应用主题设置
        if (data.theme) {
          this.setTheme(data.theme)
          console.log('启动时应用主题设置:', data.theme)
        }
      }

      // 恢复窗口位置
      const position = await databaseAPI.dbGet('window-position')
      if (position && typeof position.x === 'number' && typeof position.y === 'number') {
        this.mainWindow?.setPosition(position.x, position.y)
        console.log('恢复窗口位置:', position)
      }

      // 加载并注册全局快捷键
      await this.loadAndRegisterGlobalShortcuts()
    } catch (error) {
      console.error('加载设置失败:', error)
    }
  }

  // 加载并注册全局快捷键
  private async loadAndRegisterGlobalShortcuts(): Promise<void> {
    try {
      const shortcuts = await databaseAPI.dbGet('global-shortcuts')
      if (shortcuts && Array.isArray(shortcuts)) {
        for (const shortcut of shortcuts) {
          if (shortcut.enabled && shortcut.shortcut && shortcut.target) {
            try {
              const success = globalShortcut.register(shortcut.shortcut, () => {
                console.log(`全局快捷键触发: ${shortcut.shortcut} -> ${shortcut.target}`)
                this.handleGlobalShortcut(shortcut.target)
              })

              if (success) {
                console.log(`成功注册全局快捷键: ${shortcut.shortcut} -> ${shortcut.target}`)
              } else {
                console.warn(`全局快捷键注册失败: ${shortcut.shortcut}`)
              }
            } catch (error) {
              console.error(`注册全局快捷键失败: ${shortcut.shortcut}`, error)
            }
          }
        }
      }
    } catch (error) {
      console.error('加载全局快捷键失败:', error)
    }
  }

  // 设置主题
  private setTheme(theme: string): void {
    nativeTheme.themeSource = theme as 'system' | 'light' | 'dark'
    console.log('设置主题:', theme)
  }

  // 设置开机启动
  private setLaunchAtLogin(enable: boolean): void {
    app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: false
    })
    console.log('设置开机启动:', enable)
  }

  // 获取开机启动状态
  private getLaunchAtLogin(): boolean {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  }

  // 更新快捷键
  private updateShortcut(shortcut: string): { success: boolean; error?: string } {
    try {
      const success = updateShortcut(shortcut)
      if (success) {
        return { success: true }
      } else {
        return { success: false, error: '快捷键已被占用' }
      }
    } catch (error: unknown) {
      console.error('更新快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 获取当前快捷键
  private getCurrentShortcut(): string {
    return getCurrentShortcut()
  }

  // 注册全局快捷键
  private async registerGlobalShortcut(shortcut: string, target: string): Promise<any> {
    try {
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
      console.error('注册全局快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 注销全局快捷键
  private async unregisterGlobalShortcut(shortcut: string): Promise<any> {
    try {
      globalShortcut.unregister(shortcut)
      console.log(`成功注销全局快捷键: ${shortcut}`)
      return { success: true }
    } catch (error: unknown) {
      console.error('注销全局快捷键失败:', error)
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
}

export default new SettingsAPI()
