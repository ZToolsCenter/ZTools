import { ipcMain, nativeTheme, Notification } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'
import { fileURLToPath } from 'url'
import detachedWindowManager from '../../core/detachedWindowManager'
import databaseAPI from '../shared/database'
import windowManager from '../../managers/windowManager'
import pluginWindowManager from '../../core/pluginWindowManager'
import { registerPluginApiServices } from './pluginApiDispatcher'

/**
 * 插件UI控制API - 插件专用
 */
export class PluginUIAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: PluginManager | null = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
    this.setupThemeChangeListeners()
  }

  private setupIPC(): void {
    // 注册 getThemeInfo 到统一分发器（同步 API）
    registerPluginApiServices({
      getThemeInfo: (event: Electron.IpcMainEvent) => {
        event.returnValue = this.buildThemeInfo()
      }
    })

    // 显示系统通知
    ipcMain.handle('show-notification', (event, body: string) => this.showNotification(event, body))

    // 设置插件高度
    ipcMain.handle('set-expend-height', (event, height: number) =>
      this.setExpendHeight(event, height)
    )

    // 子输入框相关
    ipcMain.handle('set-sub-input', (event, placeholder?: string, isFocus?: boolean) =>
      this.setSubInput(placeholder, isFocus, event)
    )
    ipcMain.handle('remove-sub-input', (event) => this.removeSubInput(event))
    ipcMain.on('notify-sub-input-change', (event, text: string) =>
      this.notifySubInputChange(text, event)
    )
    ipcMain.handle('set-sub-input-value', (event, text: string) =>
      this.setSubInputValue(text, event)
    )
    ipcMain.on('sub-input-focus', (event) => {
      event.returnValue = this.subInputFocus(event)
    })
    ipcMain.on('sub-input-blur', (event) => {
      event.returnValue = this.subInputBlur(event)
    })
    ipcMain.on('sub-input-select', (event) => {
      event.returnValue = this.subInputSelect(event)
    })

    // 隐藏插件
    ipcMain.on('hide-plugin', () => this.hidePlugin())

    // 插件 ESC 按键事件（由插件 preload 通过 JS 拦截后上报）
    ipcMain.on('plugin-esc-pressed', () => {
      if (this.pluginManager && typeof this.pluginManager.handlePluginEsc === 'function') {
        this.pluginManager.handlePluginEsc()
      }
    })

    // 获取是否深色主题
    ipcMain.on('is-dark-colors', (event) => {
      event.returnValue = nativeTheme.shouldUseDarkColors
    })
  }

  private showNotification(event: Electron.IpcMainInvokeEvent, body: string): void {
    if (Notification.isSupported()) {
      const options: Electron.NotificationConstructorOptions = {
        title: 'ZTools',
        body: body
      }

      const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
      if (pluginInfo) {
        options.title = pluginInfo.name
        if (pluginInfo.logo) {
          options.icon = fileURLToPath(pluginInfo.logo)
        }
      }

      new Notification(options).show()
    }
  }

  private setExpendHeight(event: Electron.IpcMainInvokeEvent, height: number): void {
    // 检查是否在分离窗口中
    const detachedWindow = detachedWindowManager.getWindowByPluginWebContents(event.sender.id)
    if (detachedWindow) {
      detachedWindowManager.setExpendHeight(event.sender.id, height)
    } else if (this.pluginManager) {
      this.pluginManager.setExpendHeight(height)
    }
  }

  private setSubInput(
    placeholder?: string,
    isFocus?: boolean,
    event?: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent
  ): boolean {
    try {
      // 判断插件是在主窗口还是分离窗口
      const targetWindow = event
        ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow
        : this.mainWindow

      if (!targetWindow) {
        console.warn('[PluginUI] 无法找到目标窗口')
        return false
      }

      // 调用 setSubInput 时，显示输入框
      targetWindow.webContents.send('update-sub-input-visible', true)

      targetWindow.webContents.send('update-sub-input-placeholder', {
        placeholder: placeholder || '搜索'
      })

      // 如果插件在主窗口，更新 pluginManager 的状态
      if (targetWindow === this.mainWindow) {
        this.pluginManager?.setSubInputPlaceholder(placeholder || '搜索')
        // 更新可见性状态
        if (event) {
          const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
          if (pluginInfo) {
            this.pluginManager?.setSubInputVisible(pluginInfo.path, true)
          }
        }
      }

      console.log('[PluginUI] 设置子输入框 placeholder:', { placeholder, isFocus })

      // 如果 isFocus 为 true，聚焦子输入框
      if (isFocus) {
        this.subInputFocus(event)
      }

      return true
    } catch (error: unknown) {
      console.error('[PluginUI] 设置子输入框失败:', error)
      return false
    }
  }

  private removeSubInput(event?: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
    try {
      // 判断插件是在主窗口还是分离窗口
      const targetWindow = event
        ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow
        : this.mainWindow

      if (!targetWindow) {
        console.warn('[PluginUI] 无法找到目标窗口')
        return false
      }

      // 发送事件到目标窗口渲染进程，隐藏子输入框
      targetWindow.webContents.send('update-sub-input-visible', false)
      console.log('[PluginUI] 隐藏子输入框')

      // 如果插件在主窗口，更新 pluginManager 的状态
      if (targetWindow === this.mainWindow && event) {
        const pluginInfo = this.pluginManager?.getPluginInfoByWebContents(event.sender)
        if (pluginInfo) {
          this.pluginManager?.setSubInputVisible(pluginInfo.path, false)
        }
      }

      return true
    } catch (error: unknown) {
      console.error('[PluginUI] 隐藏子输入框失败:', error)
      return false
    }
  }

  private notifySubInputChange(
    text: string,
    event?: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent
  ): void {
    // 更新缓存中的搜索框值
    if (this.pluginManager) {
      this.pluginManager.setSubInputValue(text)
    }

    if (event) {
      // 检查调用者是否是分离窗口中的插件
      const detachedWindow = detachedWindowManager.getWindowByPluginWebContents(event.sender.id)
      if (detachedWindow) {
        // 如果是分离窗口的插件，直接发送到插件 webContents
        event.sender.send('sub-input-change', { text })
      } else {
        // 否则是主窗口调用，发送到主窗口的插件
        if (this.pluginManager) {
          this.pluginManager.sendPluginMessage('sub-input-change', { text })
        }
      }
    } else if (this.pluginManager) {
      // 没有 event，发送到主窗口的插件
      this.pluginManager.sendPluginMessage('sub-input-change', { text })
    }
  }

  private setSubInputValue(
    text: string,
    event?: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent
  ): boolean {
    try {
      // 判断插件是在主窗口还是分离窗口
      const targetWindow = event
        ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow
        : this.mainWindow

      if (!targetWindow) {
        console.warn('[PluginUI] 无法找到目标窗口')
        return false
      }

      // 发送事件到目标窗口渲染进程，设置输入框的值
      targetWindow.webContents.send('set-sub-input-value', text)
      console.log('[PluginUI] 设置子输入框值:', text)

      // 触发插件的 onChange 回调
      this.notifySubInputChange(text, event)

      // 聚焦子输入框
      this.subInputFocus(event)

      return true
    } catch (error: unknown) {
      console.error('[PluginUI] 设置子输入框值失败:', error)
      return false
    }
  }

  private subInputFocus(event?: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    try {
      // 判断插件是在主窗口还是分离窗口
      const targetWindow = event
        ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow
        : this.mainWindow

      if (!targetWindow) {
        console.warn('[PluginUI] 无法找到目标窗口')
        return false
      }

      targetWindow.webContents.focus()
      console.log('[PluginUI] 目标窗口获取焦点')

      // 发送事件到目标窗口渲染进程，聚焦输入框
      targetWindow.webContents.send('focus-sub-input')
      console.log('[PluginUI] 请求聚焦子输入框')

      return true
    } catch (error: unknown) {
      console.error('[PluginUI] 聚焦子输入框失败:', error)
      return false
    }
  }

  private subInputBlur(event?: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    try {
      // 让插件应用获得焦点（子输入框会自动失去焦点）
      if (event) {
        // 直接让调用者（插件 webContents）获得焦点
        event.sender.focus()
        console.log('[PluginUI] 插件应用获取焦点（分离窗口）')
        return true
      } else {
        const currentPluginView = this.pluginManager?.getCurrentPluginView()
        if (currentPluginView) {
          currentPluginView.webContents.focus()
          console.log('[PluginUI] 插件应用获取焦点（主窗口）')
          return true
        } else {
          console.warn('[PluginUI] 没有活动的插件,无法获取焦点')
          return false
        }
      }
    } catch (error: unknown) {
      console.error('[PluginUI] 插件获取焦点失败:', error)
      return false
    }
  }

  private subInputSelect(event?: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    try {
      const targetWindow = event
        ? detachedWindowManager.getWindowByPluginWebContents(event.sender.id) || this.mainWindow
        : this.mainWindow

      if (!targetWindow) {
        console.warn('[PluginUI] 无法找到目标窗口')
        return false
      }

      targetWindow.webContents.focus()
      targetWindow.webContents.send('select-sub-input')

      return true
    } catch (error: unknown) {
      console.error('[PluginUI] 选中子输入框失败:', error)
      return false
    }
  }

  private hidePlugin(): void {
    if (this.pluginManager) {
      this.pluginManager.hidePluginView()
    }
  }

  /**
   * 构建当前主题信息
   */
  private buildThemeInfo(): {
    isDark: boolean
    primaryColor: string
    customColor?: string
    windowMaterial: string
  } {
    const settings = databaseAPI.dbGet('settings-general')
    return {
      isDark: nativeTheme.shouldUseDarkColors,
      primaryColor: settings?.primaryColor || 'blue',
      customColor: settings?.customColor,
      windowMaterial: windowManager.getWindowMaterial()
    }
  }

  /**
   * 向所有插件视图广播消息
   */
  private broadcastToAllPluginViews(channel: string, data: any): void {
    // 主窗口中的插件视图
    const views = this.pluginManager?.getAllPluginViews() || []
    for (const { view } of views) {
      try {
        if (!view.webContents.isDestroyed()) {
          view.webContents.send(channel, data)
        }
      } catch {
        // webContents 可能在遍历期间被销毁
      }
    }
    // 分离窗口中的插件
    detachedWindowManager.broadcastToAllWindows(channel, data)
    // 插件创建的独立窗口
    pluginWindowManager.broadcastToAll(channel, data)
  }

  /**
   * 广播主题信息到所有插件视图
   */
  public broadcastThemeInfoToAllPlugins(): void {
    const themeInfo = this.buildThemeInfo()
    this.broadcastToAllPluginViews('update-theme-info', themeInfo)
  }

  /**
   * 监听主题变更（系统深浅色切换）
   */
  private setupThemeChangeListeners(): void {
    nativeTheme.on('updated', () => {
      this.broadcastThemeInfoToAllPlugins()
    })
  }
}

export default new PluginUIAPI()
