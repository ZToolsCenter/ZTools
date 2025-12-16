import { is, platform } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  Tray
} from 'electron'
import path from 'path'
import trayIconLight from '../../resources/icons/trayTemplate@2x-light.png?asset'
import trayIcon from '../../resources/icons/trayTemplate@2x.png?asset'
import clipboardManager from './clipboardManager'
import pluginManager from './pluginManager'

/**
 * 窗口管理器
 * 负责主窗口的创建、显示/隐藏、快捷键注册等
 */
class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private tray: Tray | null = null
  private trayMenu: Menu | null = null // 托盘菜单
  private currentShortcut = 'Option+Z' // 当前注册的快捷键
  private isQuitting = false // 是否正在退出应用
  private previousActiveWindow: {
    appName: string
    bundleId: string
    processId: number
    timestamp: number
  } | null = null // 打开应用前激活的窗口
  private shouldHideOnBlur = true // 是否在失去焦点时隐藏窗口
  // private _shouldRestoreFocus = true // TODO: 是否在隐藏窗口时恢复焦点（待实现）
  private windowPositionsByDisplay: Record<number, { x: number; y: number }> = {}

  /**
   * 获取鼠标所在显示器的工作区尺寸和位置
   */
  private getDisplayAtCursor(): {
    width: number
    height: number
    x: number
    y: number
    id: number
  } {
    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint)
    return {
      ...display.workArea,
      id: display.id
    }
  }

  /**
   * 获取当前显示器 ID（基于窗口位置）
   */
  public getCurrentDisplayId(): number | null {
    if (!this.mainWindow) return null
    const [x, y] = this.mainWindow.getPosition()
    const display = screen.getDisplayNearestPoint({ x, y })
    return display.id
  }

  /**
   * 创建主窗口
   */
  public createWindow(): BrowserWindow {
    // 智能检测：在鼠标所在的显示器上打开窗口
    const { width, height, x: displayX, y: displayY } = this.getDisplayAtCursor()

    // 根据平台设置不同的窗口配置
    const windowConfig: Electron.BrowserWindowConstructorOptions = {
      // type: 'panel',
      title: 'zTools',
      width: 800,
      minWidth: 800,
      height: 59,
      x: displayX + Math.floor((width - 800) / 2),
      y: displayY + Math.floor((height - 500) / 2.5), // 稍微偏上一点的居中位置
      frame: false, // 无边框
      resizable: true,
      maximizable: false, // 禁用最大化
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        backgroundThrottling: false, // 窗口最小化时是否继续动画和定时器
        contextIsolation: true, // 禁用上下文隔离, 渲染进程和preload共用window对象
        nodeIntegration: false, // 渲染进程禁止直接使用 Node
        spellcheck: false, // 禁用拼写检查
        webSecurity: false
      }
    }

    // Windows 系统配置
    if (platform.isWindows) {
      windowConfig.backgroundColor = '#ffffff'
      windowConfig.transparent = false
    }
    // macOS 系统配置
    else if (platform.isMacOS) {
      windowConfig.transparent = true
      windowConfig.vibrancy = 'fullscreen-ui'
    }

    this.mainWindow = new BrowserWindow(windowConfig)

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
        this.mainWindow?.webContents.focus()
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

        // 若当前处于插件页面，先退出插件回到主搜索框
        if (pluginManager.getCurrentPluginPath() !== null) {
          pluginManager.handlePluginEsc()
          return
        }

        // 如果刚刚（100ms 内）触发过插件 ESC，则不再执行 mainWindow.hide，
        // 避免快速连续操作导致窗口被错误隐藏
        if (pluginManager.shouldSuppressMainHide()) {
          console.log('检测到短时间内插件 ESC，跳过 mainWindow.hide')
          return
        }

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
      // 使用 dark 版本作为模板图标
      icon = nativeImage.createFromPath(trayIcon)
      // 设置为模板图标（适配明暗模式）
      icon.setTemplateImage(true)
    } else {
      // Windows/Linux - 根据系统主题选择图标
      // 暗色模式用 light（白色图标），亮色模式用 dark（黑色图标）
      const iconPath = nativeTheme.shouldUseDarkColors ? trayIconLight : trayIcon
      icon = nativeImage.createFromPath(iconPath)
    }

    this.tray = new Tray(icon)

    // 设置托盘提示文字
    this.tray.setToolTip('zTools')

    // 创建右键菜单
    this.createTrayMenu()

    // 左键点击：切换窗口显示
    this.tray.on('click', () => {
      this.toggleWindow()
    })

    // 右键点击：显示菜单
    this.tray.on('right-click', () => {
      if (this.tray && this.trayMenu) {
        this.tray.popUpContextMenu(this.trayMenu)
      }
    })

    // 监听系统主题变化（Windows/Linux）
    if (!platform.isMacOS) {
      nativeTheme.on('updated', () => {
        this.updateTrayIcon()
      })
    }
  }

  /**
   * 更新托盘图标（用于主题切换）
   */
  private updateTrayIcon(): void {
    if (!this.tray || platform.isMacOS) return

    // 暗色模式用 light（白色图标），亮色模式用 dark（黑色图标）
    const iconPath = nativeTheme.shouldUseDarkColors ? trayIconLight : trayIcon
    const icon = nativeImage.createFromPath(iconPath)
    this.tray.setImage(icon)
  }

  /**
   * 创建托盘菜单
   */
  private createTrayMenu(): void {
    if (!this.tray) return

    this.trayMenu = Menu.buildFromTemplate([
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

    const isVisible = this.mainWindow.isVisible()
    console.log(`切换窗口状态 - 当前可见性: ${isVisible}`)

    // 使用 isVisible() 判断窗口是否显示，更可靠
    if (isVisible) {
      // 窗口已显示 → 隐藏
      console.log('隐藏窗口')
      this.mainWindow.blur()
      this.mainWindow.hide()
      this.restorePreviousWindow()
    } else {
      // 窗口已隐藏 → 显示
      console.log('显示窗口')
      // 记录打开窗口前的激活窗口
      const currentWindow = clipboardManager.getCurrentWindow()
      if (currentWindow) {
        this.previousActiveWindow = currentWindow

        // 发送窗口信息到渲染进程
        this.mainWindow.webContents.send('window-info-changed', currentWindow)
      }

      // 移动到鼠标所在显示器（恢复该显示器记忆的位置或居中）
      this.moveWindowToCursor()
      this.mainWindow.show()
      this.mainWindow.focus()
    }
  }

  /**
   * 保存窗口位置到指定显示器（仅内存）
   */
  public saveWindowPosition(displayId: number, x: number, y: number): void {
    this.windowPositionsByDisplay[displayId] = { x, y }
  }

  /**
   * 将窗口移动到鼠标所在显示器
   * 优先恢复该显示器记忆的位置，否则居中显示
   */
  private moveWindowToCursor(): void {
    if (!this.mainWindow) return

    const { width, height, x: displayX, y: displayY, id: displayId } = this.getDisplayAtCursor()

    const savedPosition = this.windowPositionsByDisplay[displayId]

    let x: number, y: number

    if (savedPosition) {
      // 恢复该显示器记忆的位置
      x = savedPosition.x
      y = savedPosition.y
    } else {
      // 计算默认居中位置（稍微偏上）
      const [windowWidth] = this.mainWindow.getSize()
      x = displayX + Math.floor((width - windowWidth) / 2)
      y = displayY + Math.floor((height - 500) / 2.5)
    }

    this.mainWindow.setPosition(x, y, false)
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

    // 移动到鼠标所在显示器（恢复该显示器记忆的位置或居中）
    this.moveWindowToCursor()
    this.mainWindow.show()
    this.mainWindow.webContents.focus()
  }

  /**
   * 隐藏窗口
   */
  public hideWindow(_restoreFocus: boolean = true): void {
    console.log('隐藏窗口', _restoreFocus)
    this.mainWindow?.hide()
    this.restorePreviousWindow()
  }

  /**
   * 获取打开窗口前激活的窗口
   */
  public getPreviousActiveWindow(): {
    appName: string
    bundleId: string
    processId: number
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

    // 忽略同类启动器工具，避免激活冲突
    const ignoredApps = ['uTools', 'Alfred', 'Raycast', 'Wox', 'Listary']
    if (ignoredApps.includes(this.previousActiveWindow.appName)) {
      console.log(`跳过恢复同类工具: ${this.previousActiveWindow.appName}`)
      return false
    }

    try {
      const success = clipboardManager.activateApp(this.previousActiveWindow)
      if (success) {
        console.log(`已恢复激活窗口: ${this.previousActiveWindow.appName}`)
        return true
      } else {
        // 静默失败，不报错（可能进程已关闭或窗口已销毁）
        console.log(`无法恢复窗口: ${this.previousActiveWindow.appName}`)
        return false
      }
    } catch (error) {
      console.log('恢复激活窗口时出现异常:', error)
      return false
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
        this.trayMenu = null
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

    // 智能定位：将窗口移动到鼠标所在的显示器（同步，从内存读取）
    this.moveWindowToCursor()
    // 直接显示窗口，位置已同步设置完成
    this.mainWindow.show()
    this.mainWindow.webContents.focus()
  }
}

// 导出单例
export default new WindowManager()
