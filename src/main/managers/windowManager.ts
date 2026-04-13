import { is, platform } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  nativeImage,
  // nativeTheme,
  screen,
  Tray
} from 'electron'
import path from 'path'
// import trayIconLight from '../../../resources/icons/trayTemplate@2x-light.png?asset'
import trayIcon from '../../../resources/icons/trayTemplate@2x.png?asset'
import windowsIcon from '../../../resources/icons/windows-icon.png?asset'

import api from '../api'
import databaseAPI from '../api/shared/database'
import doubleTapManager from '../core/doubleTapManager.js'
import clipboardManager from './clipboardManager'

import { WINDOW_DEFAULT_HEIGHT, WINDOW_INITIAL_HEIGHT, WINDOW_WIDTH } from '../common/constants'
import detachedWindowManager from '../core/detachedWindowManager'
import superPanelManager from '../core/superPanelManager'
import { applyWindowMaterial, getDefaultWindowMaterial } from '../utils/windowUtils'
import pluginManager from './pluginManager'

// 窗口材质类型
type WindowMaterial = 'mica' | 'acrylic' | 'none'

/**
 * 应用快捷键触发时携带的文件输入
 */
interface AppShortcutInputFile {
  path: string
  name: string
  isDirectory: boolean
  isFile?: boolean
}

/**
 * 应用快捷键触发时携带的当前输入上下文
 */
interface AppShortcutLaunchContext {
  searchQuery: string
  pastedImage: string | null
  pastedFiles: AppShortcutInputFile[] | null
  pastedText: string | null
}

/**
 * 窗口管理器
 * 负责主窗口的创建、显示/隐藏、快捷键注册等
 */
class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private tray: Tray | null = null
  private trayMenu: Menu | null = null // 托盘菜单
  private currentShortcut = 'Option+Z' // 当前注册的快捷键
  private isDoubleTapMode = false // 当前呼出快捷键是否为双击修饰键模式
  private static readonly MODIFIER_NAMES = ['Command', 'Ctrl', 'Alt', 'Option', 'Shift']
  private isQuitting = false // 是否正在退出应用
  private previousActiveWindow: {
    app: string
    bundleId?: string
    pid?: number
    title?: string
    x?: number
    y?: number
    width?: number
    height?: number
    appPath?: string
  } | null = null // 打开应用前激活的窗口
  // private _shouldRestoreFocus = true // TODO: 是否在隐藏窗口时恢复焦点（待实现）
  private windowPositionsByDisplay: Record<number, { x: number; y: number }> = {}
  private autoBackToSearchTimer: NodeJS.Timeout | null = null // 自动返回搜索定时器
  private autoBackToSearchConfig: string = 'never' // 自动返回搜索配置
  private lastFocusTarget: 'mainWindow' | 'plugin' | null = null // 窗口隐藏前的焦点状态
  private isRestoringFocus: boolean = false // 是否正在恢复焦点状态（防止 focus 事件监听器干扰）
  private suppressBlurHide: boolean = false // 临时抑制 blur 事件隐藏窗口（文件关联打开等场景）
  private lastBlurHideTime: number = 0 // blur 导致隐藏窗口的时间戳（用于解决托盘点击竞态）
  private blurHideTimer: ReturnType<typeof setTimeout> | null = null // Linux blur 延迟隐藏定时器
  private appShortcuts: Map<string, string> = new Map() // 应用快捷键映射表 (快捷键 -> 目标指令)
  private wakeupBlacklist: Array<{ app: string; bundleId?: string; label?: string }> = [] // 唤醒黑名单
  private onThemeInfoChanged: (() => void) | null = null // 主题信息变更回调钩子
  // 应用快捷键触发时携带的当前输入上下文
  private appShortcutLaunchContext: AppShortcutLaunchContext = {
    searchQuery: '',
    pastedImage: null,
    pastedFiles: null,
    pastedText: null
  }

  /**
   * 更新焦点目标（供外部调用,如 pluginManager）
   */
  public updateFocusTarget(target: 'mainWindow' | 'plugin'): void {
    this.lastFocusTarget = target
    console.log('[Window] 焦点目标已更新:', target)
  }

  /**
   * 通知渲染进程返回搜索页面
   */
  public notifyBackToSearch(): void {
    this.mainWindow?.webContents.send('back-to-search')
  }

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
      type: 'panel',
      title: 'ZTools',
      width: WINDOW_WIDTH,
      height: WINDOW_INITIAL_HEIGHT,
      alwaysOnTop: true,
      // 基于最大窗口高度计算居中位置，确保窗口扩展时不会超出屏幕
      x: displayX + Math.floor((width - WINDOW_WIDTH) / 2),
      y: displayY + Math.floor((height - WINDOW_DEFAULT_HEIGHT) / 2),
      frame: false, // 无边框
      resizable: false, // 禁止用户手动调整窗口大小
      maximizable: false, // 禁用最大化
      skipTaskbar: true,
      show: false,
      hasShadow: true, // 启用窗口阴影（可调整为 false 来移除阴影）
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        backgroundThrottling: false, // 窗口最小化时是否继续动画和定时器
        contextIsolation: true, // 禁用上下文隔离, 渲染进程和preload共用window对象
        nodeIntegration: false, // 渲染进程禁止直接使用 Node
        spellcheck: false, // 禁用拼写检查
        webSecurity: false
      }
    }

    // macOS 系统配置
    if (platform.isMacOS) {
      windowConfig.transparent = true
      windowConfig.vibrancy = 'fullscreen-ui'
    }
    // Windows 系统配置（不设置 transparent，让 setBackgroundMaterial 生效）
    else if (platform.isWindows) {
      windowConfig.backgroundColor = '#00000000'
    }
    // Linux 系统配置
    else if (platform.isLinux) {
      // 不设置 type: 'panel'：X11 下 panel 类型会启用 focus-follows-mouse，
      // 会导致鼠标移出窗口时 blur 就被触发从而隐藏窗口。
      // Linux 下我们通过 setAlwaysOnTop 保持置顶层级，不需要 panel 类型。
      delete windowConfig.type
    }

    this.mainWindow = new BrowserWindow(windowConfig)

    // 强化置顶层级并允许在所有桌面和全屏应用上显示
    this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    if (platform.isMacOS) {
      this.mainWindow.setAlwaysOnTop(true, 'modal-panel', 1)
    } else {
      this.mainWindow.setAlwaysOnTop(true)
    }

    // Windows 11 根据用户配置设置背景材质
    if (platform.isWindows) {
      this.applyWindowMaterialFromSettings()
    }

    // 禁用缩放功能
    this.mainWindow.webContents.setZoomFactor(1.0) // 重置缩放为 100%
    this.mainWindow.webContents.setVisualZoomLevelLimits(1, 1) // 禁用未来缩放

    // 拦截缩放快捷键 (Ctrl+Plus, Ctrl+Minus, Ctrl+0, Ctrl+Wheel)
    // 同时监听应用快捷键
    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      // 拦截缩放快捷键
      if (input.control || input.meta) {
        if (
          input.key === '=' ||
          input.key === '+' ||
          input.key === '-' ||
          input.key === '_' ||
          input.key === '0'
        ) {
          event.preventDefault()
          return
        }
      }

      // 检查应用快捷键（仅在按键按下时触发，且未打开插件时生效）
      if (input.type === 'keyDown') {
        if (
          (input.key === 'w' || input.key === 'W') &&
          (input.meta || input.control) &&
          !input.shift &&
          !input.alt
        ) {
          const settings = databaseAPI.dbGet('settings-general') || {}
          const closeShortcutEnabled = settings?.builtinAppShortcutsEnabled?.closePlugin !== false
          if (!closeShortcutEnabled) {
            // 禁用时不拦截，让按键正常传到渲染进程（供 HotkeyInput 录制）
            return
          }
        }

        // 只在主搜索界面生效，插件打开时忽略应用快捷键
        if (pluginManager.getCurrentPluginPath() !== null) {
          return
        }

        const shortcut = this.buildShortcutString(input)
        const target = this.appShortcuts.get(shortcut)
        if (target) {
          console.log(`应用快捷键触发: ${shortcut} -> ${target}`)
          event.preventDefault()
          this.handleAppShortcut(target)
        }
      }
    })

    // 加载页面
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      console.log('[Window] 生产模式下加载文件:', path.join(__dirname, '../renderer/index.html'))
      this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    // 等待页面加载完成后再处理错误
    this.mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('[Window] 页面加载失败:', errorCode, errorDescription)
    })

    this.mainWindow.webContents.on('did-finish-load', () => {
      console.log('[Window] 页面加载成功!')
    })

    // 监听主窗口 webContents 的焦点事件
    this.mainWindow.webContents.on('focus', () => {
      // 只在非恢复焦点状态时才更新 lastFocusTarget，避免显示窗口流程中被意外覆盖
      if (!this.isRestoringFocus) {
        this.updateFocusTarget('mainWindow')
      }
    })

    this.mainWindow.on('blur', () => {
      if (this.suppressBlurHide) return

      if (platform.isLinux) {
        // Linux 上去掉了 type:'panel'，现在 blur 只会在真正点击其他窗口时触发。
        // 但插件 WebContentsView 获焦仍会触发 blur，需延迟排除。
        if (this.blurHideTimer) {
          clearTimeout(this.blurHideTimer)
          this.blurHideTimer = null
        }
        this.blurHideTimer = setTimeout(() => {
          this.blurHideTimer = null
          // 主窗口重新获焦 → 不隐藏
          if (this.mainWindow?.isFocused()) return
          // 插件视图持有焦点（应用内部切换）→ 不隐藏
          if (pluginManager.isPluginViewFocused()) return
          // 确认是点击了其他窗口，隐藏
          this.lastBlurHideTime = Date.now()
          this.hideWindow(false)
        }, 150)
      } else {
        // macOS / Windows：原有行为不变
        this.lastBlurHideTime = Date.now()
        this.hideWindow(false)
      }
    })

    this.mainWindow.on('show', () => {
      // 开始恢复焦点流程，防止 focus 事件监听器修改 lastFocusTarget
      this.isRestoringFocus = true
      const savedFocusTarget = this.lastFocusTarget

      // 恢复上次的焦点状态
      // 如果明确记录了上次聚焦在主窗口，或者是首次显示（null），则强制聚焦主窗口
      if (savedFocusTarget === 'mainWindow' || savedFocusTarget === null) {
        this.mainWindow?.webContents.focus()
        this.mainWindow?.webContents.send('focus-search', this.previousActiveWindow || null)
      } else if (pluginManager.getCurrentPluginPath() !== null) {
        // 如果有插件在显示（且上次不是主窗口），聚焦插件
        pluginManager.focusPluginView()
        // 修复部分 Windows 系统窗口隐藏再显示后插件白屏：
        // 延迟到下一 tick 执行，避免与窗口 show 动画在同一 vsync 合并导致重绘失效
        setImmediate(() => pluginManager.forceRepaintCurrentView())
      }

      // 恢复完成，清除标志位
      this.isRestoringFocus = false
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
          console.log('[Window] 检测到短时间内插件 ESC，跳过 mainWindow.hide')
          return
        }

        this.mainWindow?.hide()
      }
    })
    // clipboardManager.setWindowFloating(this.mainWindow.getNativeWindowHandle())

    // 从数据库加载唤醒黑名单
    const initSettings = databaseAPI.dbGet('settings-general')
    if (initSettings?.wakeupBlacklist) {
      this.wakeupBlacklist = initSettings.wakeupBlacklist
    }

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
      // const iconPath = nativeTheme.shouldUseDarkColors ? trayIconLight : trayIcon
      icon = nativeImage.createFromPath(windowsIcon)
      icon.setTemplateImage(false)
    }

    this.tray = new Tray(icon)

    // 设置托盘提示文字
    this.tray.setToolTip('ZTools')

    // 创建右键菜单
    this.createTrayMenu()

    if (platform.isLinux && this.trayMenu) {
      // Linux 下往往无法触发 click 事件，直接使用原生菜单
      this.tray.setContextMenu(this.trayMenu)
    } else {
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
    }
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
          this.isQuitting = true
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
   * 判断是否为双击修饰键快捷键（如 "Ctrl+Ctrl"）
   */
  private isDoubleTapShortcut(shortcut: string): boolean {
    const parts = shortcut.split('+')
    return (
      parts.length === 2 && parts[0] === parts[1] && WindowManager.MODIFIER_NAMES.includes(parts[0])
    )
  }

  /**
   * 注册全局快捷键（支持双击修饰键）
   */
  public registerShortcut(shortcut?: string): boolean {
    const keyToRegister = shortcut || this.currentShortcut

    // 保存旧的快捷键信息，用于注册失败时回滚
    const oldShortcut = this.currentShortcut
    const oldIsDoubleTapMode = this.isDoubleTapMode

    // 注销旧的呼出快捷键（仅注销当前快捷键，不影响其他全局快捷键）
    if (this.isDoubleTapMode) {
      const oldModifier = this.currentShortcut.split('+')[0]
      doubleTapManager.unregister(oldModifier)
    } else {
      globalShortcut.unregister(this.currentShortcut)
    }

    // 双击修饰键模式：通过 doubleTapManager 注册
    if (this.isDoubleTapShortcut(keyToRegister)) {
      const modifier = keyToRegister.split('+')[0]
      doubleTapManager.register(modifier, () => {
        this.toggleWindow()
      })
      this.currentShortcut = keyToRegister
      this.isDoubleTapMode = true
      console.log(`双击修饰键呼出快捷键 ${keyToRegister} 注册成功`)
      return true
    }

    // 普通快捷键模式：通过 globalShortcut 注册
    const ret = globalShortcut.register(keyToRegister, () => {
      this.toggleWindow()
    })

    if (!ret) {
      console.error(`快捷键注册失败: ${keyToRegister} 已被占用，回滚到旧快捷键: ${oldShortcut}`)
      // 注册失败，回滚：重新注册旧的快捷键
      if (oldIsDoubleTapMode) {
        const oldModifier = oldShortcut.split('+')[0]
        doubleTapManager.register(oldModifier, () => {
          this.toggleWindow()
        })
      } else {
        globalShortcut.register(oldShortcut, () => {
          this.toggleWindow()
        })
      }
      return false
    } else {
      this.currentShortcut = keyToRegister
      this.isDoubleTapMode = false
      console.log(`快捷键 ${keyToRegister} 注册成功`)
    }

    return ret
  }

  public setPreviousActiveWindow(
    windowInfo: {
      app: string
      bundleId?: string
      pid?: number
      title?: string
      x?: number
      y?: number
      width?: number
      height?: number
      appPath?: string
    } | null
  ): void {
    this.previousActiveWindow = windowInfo
  }

  /**
   * 记录当前的焦点状态（在隐藏之前调用）
   * 注意：焦点状态现在通过事件监听实时跟踪,此方法仅用于确保状态正确
   */
  private recordFocusState(): void {
    // 如果没有插件在运行,焦点一定在主窗口
    if (pluginManager.getCurrentPluginPath() === null) {
      this.updateFocusTarget('mainWindow')
    }
  }

  /**
   * 切换窗口显示/隐藏
   */
  private toggleWindow(): void {
    if (!this.mainWindow) return

    const isFocused = this.mainWindow.isFocused()
    const isVisible = this.mainWindow.isVisible()

    // 判断窗口是否聚焦显示
    // 修复：同时检查聚焦和可见状态，避免alert弹窗后判断错误
    if (isFocused && isVisible) {
      // 窗口已显示且聚焦 → 隐藏

      // 记录当前的焦点状态（在隐藏之前）
      this.recordFocusState()

      this.mainWindow.blur()
      this.mainWindow.hide()
      this.restorePreviousWindow()
    } else {
      // 窗口已隐藏或失焦 → 显示并强制激活
      // 但如果是刚刚因为 blur 事件隐藏的（点击托盘图标导致失焦），
      // 说明用户意图是隐藏窗口，不应再重新显示
      const timeSinceBlurHide = Date.now() - this.lastBlurHideTime
      if (timeSinceBlurHide < 300) {
        return
      }
      this.showWindow()
    }
  }

  /**
   * 强制激活窗口（解决alert等弹窗后无法唤起的问题）
   */
  private forceActivateWindow(): void {
    if (!this.mainWindow) return

    // 1. 显示窗口
    this.mainWindow.show()

    // 2. macOS特殊处理：重申置顶，防止因为系统事件掉层级
    if (platform.isMacOS) {
      this.mainWindow.setAlwaysOnTop(true, 'modal-panel', 1)
      return
    }

    // 3. 设置窗口层级为最前
    this.mainWindow.setAlwaysOnTop(true)

    // 4. 聚焦窗口
    this.mainWindow.focus()
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
      // 计算默认居中位置（基于最大窗口高度）
      x = displayX + Math.floor((width - WINDOW_WIDTH) / 2)
      y = displayY + Math.floor((height - WINDOW_DEFAULT_HEIGHT) / 2)
    }

    this.mainWindow.setPosition(x, y, false)
  }

  /**
   * 显示窗口
   */
  public showWindow(): void {
    if (!this.mainWindow) return

    // 开始恢复焦点流程，防止 focus 事件监听器修改 lastFocusTarget
    this.isRestoringFocus = true

    // 取消自动返回搜索定时器
    this.cancelAutoBackToSearchTimer()

    // 记录打开窗口前的激活窗口
    const currentWindow = clipboardManager.getCurrentWindow()
    if (currentWindow) {
      this.previousActiveWindow = currentWindow

      // 唤醒黑名单检查：当前活动窗口在黑名单中时不弹出
      if (this.isAppInWakeupBlacklist(currentWindow)) {
        this.isRestoringFocus = false
        return
      }
    }

    // 移动到鼠标所在显示器（恢复该显示器记忆的位置或居中）
    this.moveWindowToCursor()

    // mainHide feature 启动时可能把插件视图高度压成 0，窗口重新显示时按需恢复
    pluginManager.restoreCurrentPluginViewHeightOnWindowShow()

    // 使用强制激活逻辑（注意：show 事件会清除 isRestoringFocus 标志）
    this.forceActivateWindow()
  }

  /**
   * 隐藏窗口
   */
  public hideWindow(_restoreFocus: boolean = true): void {
    console.log('[Window] 隐藏窗口', _restoreFocus)

    // 记录当前的焦点状态（在隐藏之前）
    this.recordFocusState()

    this.mainWindow?.hide()
    if (_restoreFocus) {
      this.restorePreviousWindow()
    }

    // 启动自动返回搜索定时器
    this.startAutoBackToSearchTimer()
  }

  /**
   * 启动自动返回搜索定时器
   */
  private startAutoBackToSearchTimer(): void {
    // 清除之前的定时器
    if (this.autoBackToSearchTimer) {
      clearTimeout(this.autoBackToSearchTimer)
      this.autoBackToSearchTimer = null
    }

    // 如果配置为"从不"，不启动定时器
    if (this.autoBackToSearchConfig === 'never') {
      return
    }

    // 获取延时时间（毫秒）
    const delay = this.getAutoBackToSearchDelay()
    if (delay === 0) {
      // 立即返回搜索
      this.backToSearch()
      return
    }

    // 启动定时器
    this.autoBackToSearchTimer = setTimeout(() => {
      this.backToSearch()
      this.autoBackToSearchTimer = null
    }, delay)

    console.log(`自动返回搜索定时器已启动，延时: ${delay}ms`)
  }

  /**
   * 取消自动返回搜索定时器
   */
  private cancelAutoBackToSearchTimer(): void {
    if (this.autoBackToSearchTimer) {
      clearTimeout(this.autoBackToSearchTimer)
      this.autoBackToSearchTimer = null
      console.log('[Window] 自动返回搜索定时器已取消')
    }
  }

  /**
   * 返回搜索界面
   */
  private backToSearch(): void {
    if (!this.mainWindow) return

    pluginManager.hidePluginView()
    // 通知渲染进程返回搜索并切换模式
    this.notifyBackToSearch()
    console.log('[Window] 已触发自动返回搜索')
  }

  /**
   * 获取自动返回搜索的延时时间（毫秒）
   */
  private getAutoBackToSearchDelay(): number {
    switch (this.autoBackToSearchConfig) {
      case 'immediately':
        return 0
      case '30s':
        return 30 * 1000
      case '1m':
        return 60 * 1000
      case '3m':
        return 3 * 60 * 1000
      case '5m':
        return 5 * 60 * 1000
      case '10m':
        return 10 * 60 * 1000
      case 'never':
      default:
        return -1 // 不启动定时器
    }
  }

  /**
   * 更新自动返回搜索配置
   */
  public async updateAutoBackToSearch(config: string): Promise<void> {
    this.autoBackToSearchConfig = config
    console.log('[Window] 更新自动返回搜索配置:', config)
  }

  /**
   * 获取打开窗口前激活的窗口
   */
  public getPreviousActiveWindow(): {
    app: string
    bundleId?: string
    pid?: number
    title?: string
    x?: number
    y?: number
    width?: number
    height?: number
    appPath?: string
  } | null {
    return this.previousActiveWindow
  }

  /**
   * 更新唤醒黑名单（由设置或系统指令调用）
   */
  public updateWakeupBlacklist(
    blacklist: Array<{ app: string; bundleId?: string; label?: string }>
  ): void {
    this.wakeupBlacklist = blacklist
  }

  /**
   * 检查指定窗口是否在唤醒黑名单中
   */
  private isAppInWakeupBlacklist(windowInfo: { app: string; bundleId?: string }): boolean {
    if (this.wakeupBlacklist.length === 0) return false
    if (process.platform === 'darwin' && windowInfo.bundleId) {
      return this.wakeupBlacklist.some((item) => item.bundleId === windowInfo.bundleId)
    }
    return this.wakeupBlacklist.some(
      (item) => item.app.toLowerCase() === windowInfo.app.toLowerCase()
    )
  }

  /**
   * 恢复之前激活的窗口
   */
  public async restorePreviousWindow(): Promise<boolean> {
    if (!this.previousActiveWindow) {
      console.log('[Window] 没有记录的前一个激活窗口')
      return false
    }

    // 忽略同类启动器工具，避免激活冲突
    const ignoredApps = ['uTools', 'Alfred', 'Raycast', 'Wox', 'Listary']
    if (ignoredApps.includes(this.previousActiveWindow.app)) {
      console.log(`跳过恢复同类工具: ${this.previousActiveWindow.app}`)
      return false
    }

    try {
      const success = clipboardManager.activateApp(this.previousActiveWindow)
      if (success) {
        console.log(`已恢复激活窗口: ${this.previousActiveWindow.app}`)
        return true
      } else {
        // 静默失败，不报错（可能进程已关闭或窗口已销毁）
        console.log(`无法恢复窗口: ${this.previousActiveWindow.app}`)
        return false
      }
    } catch (error) {
      console.log('[Window] 恢复激活窗口时出现异常:', error)
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
    doubleTapManager.unregisterAll()
    this.isDoubleTapMode = false
  }

  /**
   * 设置退出标志（允许窗口真正关闭）
   */
  public setQuitting(value: boolean): void {
    this.isQuitting = value
  }

  /**
   * 获取退出标志
   */
  public getQuitting(): boolean {
    return this.isQuitting
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
   * 广播窗口材质到所有渲染进程（包括分离窗口和插件）
   */
  private broadcastWindowMaterial(material: WindowMaterial): void {
    // 发送给主窗口
    this.mainWindow?.webContents.send('update-window-material', material)

    // 发送给所有分离窗口
    detachedWindowManager.updateAllWindowsMaterial(material)

    // 发送给超级面板窗口
    superPanelManager.updateWindowMaterial(material)

    // 通知插件主题信息变更
    this.notifyThemeInfoChanged()
  }

  /**
   * 广播主题色到所有渲染进程
   */
  public broadcastPrimaryColor(primaryColor: string, customColor?: string): void {
    const data = { primaryColor, customColor }
    // 发送给主窗口
    this.mainWindow?.webContents.send('update-primary-color', data)

    // 发送给所有分离窗口
    detachedWindowManager.broadcastToAllWindows('update-primary-color', data)

    // 通知插件主题信息变更
    this.notifyThemeInfoChanged()
  }

  /**
   * 广播亚克力透明度到所有渲染进程
   */
  public broadcastAcrylicOpacity(lightOpacity: number, darkOpacity: number): void {
    const data = { lightOpacity, darkOpacity }
    // 发送给主窗口
    this.mainWindow?.webContents.send('update-acrylic-opacity', data)

    // 发送给所有分离窗口
    detachedWindowManager.broadcastToAllWindows('update-acrylic-opacity', data)
  }

  /**
   * 应用窗口材质
   */
  private applyMaterial(material: WindowMaterial): void {
    if (!this.mainWindow) return
    applyWindowMaterial(this.mainWindow, material)
  }

  /**
   * 从设置中应用窗口材质（启动时调用）
   */
  private applyWindowMaterialFromSettings(): void {
    try {
      const settings = databaseAPI.dbGet('settings-general')
      const savedMaterial = settings?.windowMaterial as WindowMaterial | undefined
      const material = savedMaterial || getDefaultWindowMaterial()

      console.log('[Window] 从配置读取窗口材质:', material)

      // 如果数据库中没有保存材质配置，保存默认值
      if (!savedMaterial) {
        console.log('[Window] 数据库中没有窗口材质配置，保存默认值:', material)
        const updatedSettings = {
          ...(settings || {}),
          windowMaterial: material
        }
        databaseAPI.dbPut('settings-general', updatedSettings)
      }

      this.applyMaterial(material)
    } catch (error) {
      console.error('[Window] 读取窗口材质配置失败，使用默认值:', error)
      const defaultMaterial = getDefaultWindowMaterial()
      this.applyMaterial(defaultMaterial)
    }
  }

  /**
   * 设置窗口材质（用户在设置中更改时调用）
   */
  public setWindowMaterial(material: WindowMaterial): { success: boolean } {
    if (!this.mainWindow || !platform.isWindows) {
      return { success: false }
    }

    this.applyMaterial(material)
    this.broadcastWindowMaterial(material)

    return { success: true }
  }

  /**
   * 获取当前窗口材质
   */
  public getWindowMaterial(): WindowMaterial {
    try {
      const settings = databaseAPI.dbGet('settings-general')
      return (settings?.windowMaterial as WindowMaterial) || getDefaultWindowMaterial()
    } catch (error) {
      console.error('[Window] 获取窗口材质失败:', error)
      return getDefaultWindowMaterial()
    }
  }

  /**
   * 设置主题信息变更回调钩子
   */
  public setOnThemeInfoChanged(callback: (() => void) | null): void {
    this.onThemeInfoChanged = callback
  }

  /**
   * 通知插件主题信息变更（供外部调用）
   */
  public notifyThemeInfoChanged(): void {
    this.onThemeInfoChanged?.()
  }

  /**
   * 显示设置页面
   */
  public async showSettings(): Promise<void> {
    if (!this.mainWindow) return

    // 如果当前有插件在显示，先隐藏插件
    if (pluginManager.getCurrentPluginPath() !== null) {
      console.log('[Window] 检测到插件正在显示，先隐藏插件')
      pluginManager.hidePluginView()
      // 通知渲染进程返回搜索页面
      this.notifyBackToSearch()
    }

    // 记录打开窗口前的激活窗口
    const currentWindow = clipboardManager.getCurrentWindow()
    if (currentWindow) {
      this.previousActiveWindow = currentWindow
      console.log('[Window] 记录打开前的激活窗口:', currentWindow.app)

      // 发送窗口信息到渲染进程
      this.mainWindow.webContents.send('window-info-changed', currentWindow)
    }

    // 从数据库查找设置插件
    try {
      const settingPlugin = this.findSettingPlugin()
      if (!settingPlugin) return

      console.log('[Window] 找到设置插件:', settingPlugin.path)

      // 使用统一的 launch 方法启动设置插件
      const result = await api.launchPlugin({
        path: settingPlugin.path,
        type: 'plugin',
        featureCode: 'main',
        name: '设置'
      })

      if (!result.success) {
        console.error('[Window] 启动设置插件失败:', result.error)
        return
      }

      // 智能定位：将窗口移动到鼠标所在的显示器（同步，从内存读取）
      this.moveWindowToCursor()
      // 使用强制激活逻辑显示窗口
      this.forceActivateWindow()
    } catch (error) {
      console.error('[Window] 打开设置插件失败:', error)
    }
  }

  /**
   * 从数据库查找 setting 插件
   */
  private findSettingPlugin(): any {
    const plugins: any = api.dbGet('plugins')
    if (!plugins || !Array.isArray(plugins)) {
      console.error('[Window] 未找到插件列表')
      return null
    }
    const settingPlugin = plugins.find((p: any) => p.name === 'setting')
    if (!settingPlugin) {
      console.error('[Window] 未找到设置插件')
      return null
    }
    return settingPlugin
  }

  /**
   * 打开插件安装页面（用于 .zpx 文件关联双击打开）
   * 流程：激活应用 → 启动设置插件 → 导航到 PluginInstaller 页面 → 传入文件路径
   * @param zpxPath .zpx 文件路径
   */
  public async openPluginInstaller(zpxPath: string): Promise<void> {
    if (!this.mainWindow) return

    console.log('[Window] 打开插件安装页面:', zpxPath)

    // 临时抑制 blur 隐藏行为，防止窗口激活过程中被 blur 事件隐藏
    this.suppressBlurHide = true

    // macOS: 先显示 Dock 图标并激活应用，否则窗口无法获取焦点
    if (platform.isMacOS) {
      await app.dock?.show()
      app.focus({ steal: true })
    }

    // 如果当前有插件在显示，先隐藏
    if (pluginManager.getCurrentPluginPath() !== null) {
      pluginManager.hidePluginView()
      this.notifyBackToSearch()
    }

    try {
      const settingPlugin = this.findSettingPlugin()
      if (!settingPlugin) {
        this.suppressBlurHide = false
        return
      }

      // 启动设置插件，使用 install-plugin feature code
      // payload 传入文件路径数组（与 "type": "files" cmd 格式一致）
      const result = await api.launchPlugin({
        path: settingPlugin.path,
        type: 'plugin',
        featureCode: 'function.install-plugin?router=PluginInstaller',
        name: '安装插件',
        cmdType: 'files',
        param: {
          code: 'function.install-plugin?router=PluginInstaller',
          payload: [{ path: zpxPath }]
        }
      })

      if (!result.success) {
        console.error('[Window] 启动插件安装页面失败:', result.error)
        this.suppressBlurHide = false
        return
      }

      this.moveWindowToCursor()
      // macOS: forceActivateWindow 不会 setAlwaysOnTop/focus，需要单独处理焦点抢占
      this.mainWindow.show()
      if (platform.isMacOS) {
        this.mainWindow.focus()
      } else {
        this.forceActivateWindow()
      }

      // 延迟恢复 blur 隐藏行为，确保窗口已稳定获取焦点
      setTimeout(() => {
        this.suppressBlurHide = false
      }, 500)
    } catch (error) {
      console.error('[Window] 打开插件安装页面失败:', error)
      this.suppressBlurHide = false
    }
  }

  /**
   * 从 input 事件构建快捷键字符串
   */
  private buildShortcutString(input: Electron.Input): string {
    const keys: string[] = []

    // 修饰键（按标准顺序）
    if (input.meta) {
      keys.push(platform.isMacOS ? 'Command' : 'Meta')
    }
    if (input.control) {
      keys.push(platform.isMacOS ? 'Ctrl' : 'Ctrl')
    }
    if (input.alt) {
      keys.push(platform.isMacOS ? 'Option' : 'Alt')
    }
    if (input.shift) {
      keys.push('Shift')
    }

    // 主键（转换为标准格式）
    const mainKey = this.normalizeKey(input.key)
    if (mainKey && !WindowManager.MODIFIER_NAMES.includes(mainKey)) {
      keys.push(mainKey)
    }

    return keys.join('+')
  }

  /**
   * 标准化按键名称
   */
  private normalizeKey(key: string): string {
    // 字母转大写
    if (key.length === 1 && /[a-z]/.test(key)) {
      return key.toUpperCase()
    }

    // 数字键
    if (key.length === 1 && /[0-9]/.test(key)) {
      return key
    }

    // 特殊键映射
    const keyMap: Record<string, string> = {
      ' ': 'Space',
      Enter: 'Enter',
      Escape: 'Escape',
      Tab: 'Tab',
      Backspace: 'Backspace',
      Delete: 'Delete',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown'
    }

    return keyMap[key] || key
  }

  /**
   * 处理应用快捷键触发
   */
  private async handleAppShortcut(target: string): Promise<void> {
    try {
      // 调用 API 管理器的全局快捷键处理方法
      await api.handleGlobalShortcutTrigger(target, this.appShortcutLaunchContext)
    } catch (error) {
      console.error('[Window] 处理应用快捷键失败:', error)
    }
  }

  /**
   * 更新应用快捷键触发时要带给启动链路的输入上下文
   */
  public updateAppShortcutLaunchContext(context: Partial<AppShortcutLaunchContext>): void {
    this.appShortcutLaunchContext = {
      searchQuery: context.searchQuery ?? '',
      pastedImage: context.pastedImage ?? null,
      pastedFiles: context.pastedFiles ?? null,
      pastedText: context.pastedText ?? null
    }
  }

  /**
   * 检查 Cmd+Q 内置快捷键（killPlugin）是否被用户禁用
   * 用于 before-quit 事件：禁用时不隐藏窗口，让 Cmd+Q 可被用作呼出快捷键
   */
  public isKillPluginShortcutEnabled(): boolean {
    try {
      const settings = databaseAPI.dbGet('settings-general') || {}
      return settings?.builtinAppShortcutsEnabled?.killPlugin !== false
    } catch {
      return true
    }
  }

  /**
   * 注册应用快捷键
   */
  public registerAppShortcut(shortcut: string, target: string): boolean {
    try {
      this.appShortcuts.set(shortcut, target)
      console.log(`成功注册应用快捷键: ${shortcut} -> ${target}`)
      return true
    } catch (error) {
      console.error('[Window] 注册应用快捷键失败:', error)
      return false
    }
  }

  /**
   * 注销应用快捷键
   */
  public unregisterAppShortcut(shortcut: string): void {
    this.appShortcuts.delete(shortcut)
    console.log(`成功注销应用快捷键: ${shortcut}`)
  }

  /**
   * 清空所有应用快捷键
   */
  public unregisterAllAppShortcuts(): void {
    this.appShortcuts.clear()
    console.log('[Window] 已清空所有应用快捷键')
  }
}

// 导出单例
export default new WindowManager()
