import { BrowserWindow, screen, globalShortcut, app, Tray, Menu, nativeImage } from 'electron'
import { is, platform } from '@electron-toolkit/utils'
import path from 'path'
import clipboardManager from './clipboardManager'
import appleScriptHelper from './utils/appleScriptHelper'
import pluginManager from './pluginManager'
import trayIcon from '../../resources/trayTemplate@2x.png?asset'

/**
 * 窗口管理器
 * 负责主窗口的创建、显示/隐藏、快捷键注册等
 */
class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private tray: Tray | null = null
  private currentShortcut = 'Option+Z' // 当前注册的快捷键
  private isQuitting = false // 是否正在退出应用
  private previousActiveWindow: {
    appName: string
    bundleId: string
    timestamp: number
  } | null = null // 打开应用前激活的窗口
  private shouldHideOnBlur = true // 是否在失去焦点时隐藏窗口
  // private _shouldRestoreFocus = true // TODO: 是否在隐藏窗口时恢复焦点（待实现）

  /**
   * 创建主窗口
   */
  public createWindow(): BrowserWindow {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    this.mainWindow = new BrowserWindow({
      // type: 'panel',
      title: 'zTools',
      width: 800,
      minWidth: 800,
      height: 59,
      x: Math.floor((width - 800) / 2),
      y: Math.floor((height - 500) / 3),
      frame: false, // 无边框
      resizable: true,
      skipTaskbar: true,
      transparent: true,
      show: false,
      // backgroundColor: '#ffffff', // 白色背景
      vibrancy: 'fullscreen-ui',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        backgroundThrottling: false, // 窗口最小化时是否继续动画和定时器
        contextIsolation: true, // 禁用上下文隔离, 渲染进程和preload共用window对象
        nodeIntegration: false, // 渲染进程禁止直接使用 Node
        spellcheck: false, // 禁用拼写检查
        webSecurity: false
      }
    })

    // 加载页面
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      console.log('生产模式下加载文件:', path.join(__dirname, '../renderer/index.html'))
      this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    // 等待页面加载完成后再处理错误
    this.mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('页面加载失败:', errorCode, errorDescription)
    })

    this.mainWindow.webContents.on('did-finish-load', () => {
      console.log('页面加载成功!')
    })

    this.mainWindow.on('blur', () => {
      if (this.shouldHideOnBlur) {
        this.mainWindow?.hide()
      }
    })

    this.mainWindow.on('show', () => {
      // 判断是插件
      if (pluginManager.getCurrentPluginPath() !== null) {
        // 让插件视图获取焦点
        pluginManager.focusPluginView()
      } else {
        this.mainWindow?.focus()
        // 通知渲染进程聚焦搜索框
        this.mainWindow?.webContents.send('focus-search')
      }
    })

    // this.mainWindow.on('hide', () => {
    //   console.log('窗口隐藏')
    //   // 恢复到原来的焦点窗口
    //   if (this.shouldRestoreFocus) {
    //     app.hide()
    //   }
    //   // 重置为默认值
    //   this.shouldRestoreFocus = true
    // })

    // 监听窗口大小变化
    this.mainWindow.on('resize', () => {
      if (this.mainWindow) {
        const [width, height] = this.mainWindow.getSize()
        // 如果当前有插件正在显示，同步更新插件视图大小
        if (pluginManager.getCurrentPluginPath()) {
          pluginManager.updatePluginViewBounds(width, height)
        }
      }
    })

    // 阻止窗口被销毁（Command+W 时隐藏而不是关闭）
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault()
        this.mainWindow?.hide()
      }
    })
    // clipboardManager.setWindowFloating(this.mainWindow.getNativeWindowHandle())

    return this.mainWindow
  }

  /**
   * 创建系统托盘
   */
  public createTray(): void {
    // 创建托盘图标
    let icon: Electron.NativeImage

    if (platform.isMacOS) {
      // macOS 使用 Template 模式的图标（会自动适配明暗主题）
      icon = nativeImage.createFromPath(trayIcon)
      // icon = icon.resize({ width: 16, height: 16 })
      // 设置为模板图标（适配明暗模式）
      icon.setTemplateImage(true)
    } else {
      // Windows/Linux
      icon = nativeImage.createFromPath(trayIcon)
    }

    this.tray = new Tray(icon)

    // 设置托盘提示文字
    this.tray.setToolTip('zTools')

    // 创建右键菜单
    this.createTrayMenu()

    // macOS：点击托盘图标切换窗口显示
    this.tray.on('click', () => {
      // this.toggleWindow()
    })
  }

  /**
   * 创建托盘菜单
   */
  private createTrayMenu(): void {
    if (!this.tray) return

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示/隐藏',
        click: () => {
          this.toggleWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: '设置',
        click: () => {
          this.showSettings()
        }
      },
      {
        type: 'separator'
      },
      {
        label: '重启',
        click: () => {
          app.relaunch()
          app.quit()
        }
      },
      {
        label: '退出',
        click: () => {
          this.isQuitting = true
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  /**
   * 获取主窗口实例
   */
  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  /**
   * 注册全局快捷键
   */
  public registerShortcut(shortcut?: string): boolean {
    // 先注销旧的快捷键
    globalShortcut.unregisterAll()

    const keyToRegister = shortcut || this.currentShortcut

    const ret = globalShortcut.register(keyToRegister, () => {
      this.toggleWindow()
    })

    if (!ret) {
      console.error(`快捷键注册失败: ${keyToRegister} 已被占用`)
      return false
    } else {
      this.currentShortcut = keyToRegister
      console.log(`快捷键 ${keyToRegister} 注册成功`)
      return true
    }
  }

  public refreshPreviousActiveWindow(): void {
    this.previousActiveWindow = clipboardManager.getCurrentWindow()
  }

  /**
   * 切换窗口显示/隐藏
   */
  private toggleWindow(): void {
    if (!this.mainWindow) return

    if (this.mainWindow.isFocused()) {
      console.log('窗口已显示，隐藏窗口')
      this.mainWindow.blur()
      this.mainWindow.hide()
    } else {
      // 记录打开窗口前的激活窗口
      const currentWindow = clipboardManager.getCurrentWindow()
      if (currentWindow) {
        this.previousActiveWindow = currentWindow
        console.log('记录打开前的激活窗口:', currentWindow.appName)

        // 发送窗口信息到渲染进程
        this.mainWindow.webContents.send('window-info-changed', currentWindow)
      }

      this.mainWindow.show()
    }
  }

  /**
   * 显示窗口
   */
  public showWindow(): void {
    if (!this.mainWindow) return

    // 记录打开窗口前的激活窗口
    const currentWindow = clipboardManager.getCurrentWindow()
    if (currentWindow) {
      this.previousActiveWindow = currentWindow
      console.log('记录打开前的激活窗口:', currentWindow.appName)

      // 发送窗口信息到渲染进程
      this.mainWindow.webContents.send('window-info-changed', currentWindow)
    }

    this.mainWindow.show()
    this.mainWindow.focus()
  }

  /**
   * 隐藏窗口
   */
  public hideWindow(_restoreFocus: boolean = true): void {
    // TODO: 实现焦点恢复功能
    this.mainWindow?.hide()
  }

  /**
   * 获取打开窗口前激活的窗口
   */
  public getPreviousActiveWindow(): {
    appName: string
    bundleId: string
    timestamp: number
  } | null {
    return this.previousActiveWindow
  }

  /**
   * 恢复之前激活的窗口
   */
  public async restorePreviousWindow(): Promise<boolean> {
    if (!this.previousActiveWindow) {
      console.log('没有记录的前一个激活窗口')
      return false
    }

    try {
      const success = clipboardManager.activateApp(this.previousActiveWindow.bundleId)
      if (success) {
        console.log(`已恢复激活窗口: ${this.previousActiveWindow.appName}`)
        return true
      } else {
        console.error(`恢复激活窗口失败: ${this.previousActiveWindow.appName}`)
        return false
      }
    } catch (error) {
      console.error('恢复激活窗口异常:', error)
      return false
    }
  }

  /**
   * 执行粘贴操作
   * 1. 先恢复之前激活的窗口
   * 2. 等待窗口激活
   * 3. 执行粘贴快捷键
   */
  public async pasteToActiveWindow(): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. 恢复之前激活的窗口
      const restored = await this.restorePreviousWindow()
      if (!restored) {
        return { success: false, error: '恢复激活窗口失败' }
      }

      // 2. 等待窗口激活（给系统一点时间切换窗口）
      await this.sleep(200)

      // 3. 使用 AppleScript 执行粘贴操作
      if (platform.isMacOS) {
        const success = await appleScriptHelper.paste()
        if (success) {
          return { success: true }
        } else {
          return { success: false, error: '执行粘贴操作失败' }
        }
      } else {
        // Windows/Linux 暂不支持
        return { success: false, error: '当前只支持 macOS' }
      }
    } catch (error: any) {
      console.error('粘贴操作失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }

  /**
   * 获取当前快捷键
   */
  public getCurrentShortcut(): string {
    return this.currentShortcut
  }

  /**
   * 注销所有快捷键
   */
  public unregisterAllShortcuts(): void {
    globalShortcut.unregisterAll()
  }

  /**
   * 设置退出标志（允许窗口真正关闭）
   */
  public setQuitting(value: boolean): void {
    this.isQuitting = value
  }

  /**
   * 设置托盘图标可见性
   */
  public setTrayIconVisible(visible: boolean): void {
    if (visible) {
      if (!this.tray) {
        this.createTray()
      }
    } else {
      if (this.tray) {
        this.tray.destroy()
        this.tray = null
      }
    }
  }

  /**
   * 设置失去焦点时是否隐藏窗口
   */
  public setHideOnBlur(hide: boolean): void {
    this.shouldHideOnBlur = hide
  }

  /**
   * 显示设置页面
   */
  public showSettings(): void {
    if (!this.mainWindow) return

    // 如果当前有插件在显示，先隐藏插件
    if (pluginManager.getCurrentPluginPath() !== null) {
      console.log('检测到插件正在显示，先隐藏插件')
      pluginManager.hidePluginView()
      // 通知渲染进程返回搜索页面
      this.mainWindow.webContents.send('back-to-search')
    }

    // 记录打开窗口前的激活窗口
    const currentWindow = clipboardManager.getCurrentWindow()
    if (currentWindow) {
      this.previousActiveWindow = currentWindow
      console.log('记录打开前的激活窗口:', currentWindow.appName)

      // 发送窗口信息到渲染进程
      this.mainWindow.webContents.send('window-info-changed', currentWindow)
    }

    // 通知渲染进程显示设置页面
    this.mainWindow.webContents.send('show-settings')

    // 显示窗口
    setTimeout(() => {
      this.mainWindow?.show()
      this.mainWindow?.focus()
    }, 50)
  }

  /**
   * 延时辅助函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// 导出单例
export default new WindowManager()
