import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { MouseMonitor, WindowManager, type MouseMonitorResult } from './native/index.js'
import { launchApp } from './commandLauncher/index.js'
import databaseAPI from '../api/shared/database.js'
import pluginsAPI from '../api/renderer/plugins.js'
import windowManager from '../managers/windowManager.js'
import clipboardManager, { type LastCopiedContent } from '../managers/clipboardManager.js'
import { applyWindowMaterial, getDefaultWindowMaterial } from '../utils/windowUtils.js'
import translationManager from './translationManager.js'

// 超级面板窗口尺寸
const SUPER_PANEL_WIDTH = 250
const SUPER_PANEL_HEIGHT = 400

// 模拟复制后等待剪贴板更新的时间窗口
const CLIPBOARD_WAIT_MS = 180

// 剪贴板内容类型
interface ClipboardContent {
  type: 'text' | 'image' | 'file'
  text?: string
  image?: string // base64
  files?: Array<{ path: string; name: string; isDirectory: boolean }>
}

interface BlockedApp {
  app: string
  bundleId?: string
  label?: string
}

interface SuperPanelConfig {
  enabled: boolean
  mouseButton: 'middle' | 'right' | 'back' | 'forward'
  longPressMs: number
  blockedApps: BlockedApp[]
}

/**
 * 超级面板管理器
 * 负责鼠标监听、模拟复制、创建超级面板窗口、与主窗口通信搜索
 */
class SuperPanelManager {
  private superPanelWindow: BrowserWindow | null = null
  private mainWindow: BrowserWindow | null = null
  private windowReady = false
  private pendingMessages: Array<{ channel: string; data: any }> = []
  private config: SuperPanelConfig = {
    enabled: false,
    mouseButton: 'middle',
    longPressMs: 500,
    blockedApps: []
  }

  /**
   * 初始化超级面板管理器
   */
  init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
    this.loadConfig()
  }

  /**
   * 从数据库加载配置并启动监听
   */
  private loadConfig(): void {
    try {
      const data = databaseAPI.dbGet('settings-general')
      if (data) {
        this.config = {
          enabled: data.superPanelEnabled ?? false,
          mouseButton: data.superPanelMouseButton ?? 'middle',
          longPressMs: data.superPanelLongPressMs ?? 500,
          blockedApps: data.superPanelBlockedApps ?? []
        }
        if (this.config.enabled) {
          this.startMonitor()
        }
        console.log('[SuperPanel] 超级面板配置已加载:', this.config)
      }
    } catch (error) {
      console.error('[SuperPanel] 加载超级面板配置失败:', error)
    }
  }

  /**
   * 设置变更时调用（从设置页面触发）
   */
  updateConfig(config: { enabled: boolean; mouseButton: string; longPressMs: number }): void {
    this.config = {
      enabled: config.enabled,
      mouseButton: config.mouseButton as SuperPanelConfig['mouseButton'],
      longPressMs: config.longPressMs,
      blockedApps: this.config.blockedApps
    }

    if (this.config.enabled) {
      this.startMonitor()
    } else {
      this.stopMonitor()
      this.hideWindow()
    }

    console.log('[SuperPanel] 超级面板配置已更新:', this.config)
  }

  /**
   * 单独更新屏蔽列表
   */
  updateBlockedApps(blockedApps: BlockedApp[]): void {
    this.config.blockedApps = blockedApps
    console.log('[SuperPanel] 超级面板屏蔽列表已更新:', blockedApps.length, '项')
  }

  /**
   * 判断当前窗口是否被屏蔽
   */
  private isWindowBlocked(windowInfo: { app: string; bundleId?: string }): boolean {
    if (!this.config.blockedApps || this.config.blockedApps.length === 0) {
      return false
    }

    const appName = windowInfo.app.toLowerCase()

    for (const blocked of this.config.blockedApps) {
      // macOS 优先匹配 bundleId
      if (blocked.bundleId && windowInfo.bundleId) {
        if (blocked.bundleId.toLowerCase() === windowInfo.bundleId.toLowerCase()) {
          return true
        }
      }
      // 进程名大小写不敏感匹配
      if (blocked.app.toLowerCase() === appName) {
        return true
      }
    }

    return false
  }

  /**
   * 启动鼠标监听
   */
  private startMonitor(): void {
    // 先停止已有的监听
    if (MouseMonitor.isMonitoring) {
      MouseMonitor.stop()
    }

    try {
      MouseMonitor.start(this.config.mouseButton, this.config.longPressMs, () => {
        return this.onMouseTrigger()
      })
      console.log(
        `[SuperPanel] 超级面板鼠标监听已启动: ${this.config.mouseButton}, ${this.config.longPressMs}ms`
      )
    } catch (error) {
      console.error('[SuperPanel] 启动超级面板鼠标监听失败:', error)
    }
  }

  /**
   * 停止鼠标监听
   */
  private stopMonitor(): void {
    if (MouseMonitor.isMonitoring) {
      MouseMonitor.stop()
      console.log('[SuperPanel] 超级面板鼠标监听已停止')
    }
  }

  // 当前剪贴板内容（在模拟复制后读取）
  private currentClipboardContent: ClipboardContent | null = null
  // 触发时的完整窗口信息
  private currentWindowInfo: {
    app: string
    bundleId?: string
    pid?: number
    title?: string
    x?: number
    y?: number
    width?: number
    height?: number
    appPath?: string
    className?: string
    hwnd?: number
  } | null = null

  /**
   * 将剪贴板管理器返回的数据转换为超级面板使用的结构
   */
  private convertLastCopiedContent(content: LastCopiedContent | null): ClipboardContent | null {
    if (!content) {
      return null
    }

    if (content.type === 'text') {
      return typeof content.data === 'string' && content.data.trim() !== ''
        ? { type: 'text', text: content.data }
        : null
    }

    if (content.type === 'image') {
      return typeof content.data === 'string' && content.data
        ? { type: 'image', image: content.data }
        : null
    }

    return Array.isArray(content.data) && content.data.length > 0
      ? { type: 'file', files: content.data }
      : null
  }

  /**
   * 鼠标触发回调
   */
  private onMouseTrigger(): MouseMonitorResult {
    try {
      // 1. 记录鼠标位置
      const cursorPoint = screen.getCursorScreenPoint()

      // 1.5. 记录触发前的窗口信息
      // 优先使用 getActiveWindow() 实时获取前台窗口（更准确），回退到缓存的窗口信息
      const cachedWindow = clipboardManager.getCurrentWindow()
      const activeWindow = WindowManager.getActiveWindow()
      const windowInfo = activeWindow ? { ...cachedWindow, ...activeWindow } : cachedWindow
      this.currentWindowInfo = windowInfo ?? null

      // 1.6. 检查当前窗口是否被屏蔽
      const windowToCheck = activeWindow || cachedWindow
      if (windowToCheck && this.isWindowBlocked(windowToCheck)) {
        console.log('[SuperPanel] 当前窗口被屏蔽，跳过触发:', windowToCheck.app)
        return { shouldBlock: false }
      }

      // 异步部分：模拟复制、读取剪贴板、显示面板
      this.onMouseTriggerAsync(cursorPoint)

      return { shouldBlock: true }
    } catch (error) {
      console.error('[SuperPanel] 超级面板触发失败:', error)
      return { shouldBlock: false }
    }
  }

  private async onMouseTriggerAsync(cursorPoint: { x: number; y: number }): Promise<void> {
    try {
      const lastSequence = clipboardManager.getLastCopiedSequence()

      // 2. 模拟复制（Cmd+C on macOS, Ctrl+C on Windows）
      const modifier = process.platform === 'darwin' ? 'meta' : 'ctrl'
      WindowManager.simulateKeyboardTap('c', modifier)

      // 3. 等待剪贴板监听捕获本次复制事件
      const lastCopiedContent = await clipboardManager.getLastCopiedContent(
        CLIPBOARD_WAIT_MS,
        lastSequence
      )
      const newContent = this.convertLastCopiedContent(lastCopiedContent)
      const hasNewContent = !!newContent

      // 4. 保存当前剪贴板内容
      this.currentClipboardContent = hasNewContent ? newContent : null

      // 5. 显示超级面板窗口
      this.showWindow(cursorPoint.x, cursorPoint.y)

      // 6. 根据剪贴板内容决定模式
      if (hasNewContent && newContent) {
        // 有新内容：发送搜索请求到主窗口（携带剪贴板类型和数据）
        this.requestSearch(newContent)

        // 如果是文本内容，异步请求翻译
        if (newContent.type === 'text' && newContent.text) {
          this.requestTranslation(newContent.text)
        }
      } else {
        // 无新内容：加载固定列表
        this.loadPinnedCommands()
      }
    } catch (error) {
      console.error('[SuperPanel] 超级面板触发失败:', error)
    }
  }

  /**
   * 创建超级面板窗口
   */
  private createWindow(x: number, y: number): BrowserWindow {
    // 新窗口，标记未就绪
    this.windowReady = false
    this.pendingMessages = []

    // 计算窗口位置（防止超出屏幕）
    const { position } = this.adjustPosition(x, y)

    const windowConfig: Electron.BrowserWindowConstructorOptions = {
      width: SUPER_PANEL_WIDTH,
      height: SUPER_PANEL_HEIGHT,
      x: position.x,
      y: position.y,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      hasShadow: true,
      type: 'panel',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        webSecurity: false
      }
    }

    // macOS 系统配置
    if (process.platform === 'darwin') {
      windowConfig.transparent = true
      windowConfig.vibrancy = 'fullscreen-ui'
    }
    // Windows 系统配置（不设置 transparent，让 setBackgroundMaterial 生效）
    else if (process.platform === 'win32') {
      windowConfig.backgroundColor = '#00000000'
    }

    const win = new BrowserWindow(windowConfig)

    // macOS: 不在 Dock 中显示
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }

    // 同步窗口材质（Windows）
    if (process.platform === 'win32') {
      this.applyMaterialToWindow(win)
    }

    // 加载超级面板页面（使用独立的 HTML 入口）
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/super-panel.html`)
    } else {
      win.loadFile(path.join(__dirname, '../renderer/super-panel.html'))
    }

    // 窗口加载完成后显示
    win.once('ready-to-show', () => {
      win.show()
    })

    // 失去焦点时关闭
    win.on('blur', () => {
      this.hideWindow()
    })

    // 窗口关闭时清理引用
    win.on('closed', () => {
      this.superPanelWindow = null
      this.windowReady = false
      this.pendingMessages = []
    })

    return win
  }

  /**
   * 调整窗口位置，防止超出屏幕边界
   */
  private adjustPosition(x: number, y: number): { position: { x: number; y: number } } {
    const display = screen.getDisplayNearestPoint({ x, y })
    const { workArea } = display

    let adjustedX = x
    let adjustedY = y

    // 右边溢出
    if (adjustedX + SUPER_PANEL_WIDTH > workArea.x + workArea.width) {
      adjustedX = workArea.x + workArea.width - SUPER_PANEL_WIDTH
    }
    // 左边溢出
    if (adjustedX < workArea.x) {
      adjustedX = workArea.x
    }
    // 下边溢出
    if (adjustedY + SUPER_PANEL_HEIGHT > workArea.y + workArea.height) {
      adjustedY = workArea.y + workArea.height - SUPER_PANEL_HEIGHT
    }
    // 上边溢出
    if (adjustedY < workArea.y) {
      adjustedY = workArea.y
    }

    return { position: { x: adjustedX, y: adjustedY } }
  }

  /**
   * 显示超级面板窗口
   */
  private showWindow(x: number, y: number): void {
    if (this.superPanelWindow && !this.superPanelWindow.isDestroyed()) {
      // 复用已有窗口：更新位置并显示
      const { position } = this.adjustPosition(x, y)
      this.superPanelWindow.setPosition(position.x, position.y)
      this.superPanelWindow.show()
      this.superPanelWindow.focus()
    } else {
      // 创建新窗口
      this.superPanelWindow = this.createWindow(x, y)
    }
  }

  /**
   * 从数据库读取材质设置并应用到指定窗口
   */
  private applyMaterialToWindow(win: BrowserWindow): void {
    try {
      const settings = databaseAPI.dbGet('settings-general')
      const material = settings?.windowMaterial || getDefaultWindowMaterial()
      applyWindowMaterial(win, material)
      // 通知超级面板渲染进程更新样式
      win.webContents.send('update-window-material', material)
    } catch (error) {
      console.error('[SuperPanel] 应用窗口材质失败:', error)
    }
  }

  /**
   * 更新超级面板窗口材质（由 windowManager 广播时调用）
   */
  updateWindowMaterial(material: 'mica' | 'acrylic' | 'none'): void {
    if (!this.superPanelWindow || this.superPanelWindow.isDestroyed()) return
    applyWindowMaterial(this.superPanelWindow, material)
    this.superPanelWindow.webContents.send('update-window-material', material)
  }

  /**
   * 向超级面板窗口广播消息（公共方法，供外部模块调用）
   */
  broadcastToSuperPanel(channel: string, data: any): void {
    if (this.superPanelWindow && !this.superPanelWindow.isDestroyed()) {
      this.superPanelWindow.webContents.send(channel, data)
    }
  }

  /**
   * 隐藏超级面板窗口
   */
  hideWindow(): void {
    if (this.superPanelWindow && !this.superPanelWindow.isDestroyed()) {
      this.superPanelWindow.hide()
    }
  }

  /**
   * 请求主窗口执行搜索（携带剪贴板内容类型和数据）
   */
  private requestSearch(content: ClipboardContent): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return
    }

    // 搜索文本：文本类型直接使用，文件/图片类型传空字符串（依赖匹配指令）
    const searchText = content.type === 'text' ? content.text || '' : ''
    this.mainWindow.webContents.send('super-panel-search', {
      text: searchText,
      clipboardContent: content
    })
  }

  /**
   * 请求翻译选中的文本
   */
  private async requestTranslation(text: string): Promise<void> {
    try {
      const translation = await translationManager.translate(text)
      if (translation) {
        this.sendToSuperPanel('super-panel-translation', {
          text: translation,
          sourceText: text
        })
      }
    } catch (error) {
      console.error('[SuperPanel] 翻译请求失败:', error)
    }
  }

  private filterPinnedCommandsForDisplay(commands: any[]): any[] {
    const disabledPluginPaths = pluginsAPI.getDisabledPluginSet()
    const visibleCommands: any[] = []

    for (const command of commands) {
      if (command?.isFolder && Array.isArray(command.items)) {
        const visibleItems = command.items.filter(
          (item: any) => !(item?.type === 'plugin' && disabledPluginPaths.has(item.path))
        )

        if (visibleItems.length === 1) {
          visibleCommands.push(visibleItems[0])
        } else if (visibleItems.length > 1) {
          visibleCommands.push({
            ...command,
            items: visibleItems
          })
        }
        continue
      }

      if (command?.type === 'plugin' && disabledPluginPaths.has(command.path)) {
        continue
      }

      visibleCommands.push(command)
    }

    return visibleCommands
  }

  /**
   * 加载固定列表
   */
  private loadPinnedCommands(): void {
    try {
      // 从数据库读取超级面板固定列表
      let pinnedCommands = databaseAPI.dbGet('super-panel-pinned')

      if (!pinnedCommands || !Array.isArray(pinnedCommands)) {
        pinnedCommands = []
      }

      const visiblePinnedCommands = this.filterPinnedCommandsForDisplay(pinnedCommands)

      // 发送固定列表到超级面板窗口
      this.sendToSuperPanel('super-panel-data', {
        type: 'pinned',
        commands: visiblePinnedCommands,
        windowInfo: this.currentWindowInfo
      })
    } catch (error) {
      console.error('[SuperPanel] 加载超级面板固定列表失败:', error)
      this.sendToSuperPanel('super-panel-data', {
        type: 'pinned',
        commands: [],
        windowInfo: this.currentWindowInfo
      })
    }
  }

  /**
   * 发送数据到超级面板窗口（窗口未就绪时缓存消息）
   */
  private sendToSuperPanel(channel: string, data: any): void {
    if (this.superPanelWindow && !this.superPanelWindow.isDestroyed() && this.windowReady) {
      this.superPanelWindow.webContents.send(channel, data)
    } else {
      this.pendingMessages.push({ channel, data })
    }
  }

  /**
   * 设置 IPC 监听
   */
  private setupIPC(): void {
    // 主窗口返回搜索结果（携带剪贴板内容）
    ipcMain.on(
      'super-panel-search-result',
      (_event, data: { results: any[]; clipboardContent?: ClipboardContent }) => {
        this.sendToSuperPanel('super-panel-data', {
          type: 'search',
          results: data.results,
          clipboardContent: data.clipboardContent,
          windowInfo: this.currentWindowInfo
        })
      }
    )

    // 超级面板启动指令 → 转发给主渲染进程处理
    ipcMain.handle('super-panel:launch', async (_event, command: any) => {
      try {
        // 隐藏超级面板
        this.hideWindow()

        // direct 类型（系统应用/系统设置）直接在主进程启动，不唤出主窗口
        if (command.type === 'direct') {
          await launchApp(command.path)
          return { success: true }
        }

        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          return { success: false, error: '主窗口不可用' }
        }

        // 先显示主窗口，确保渲染进程能正常处理启动指令
        if (this.currentWindowInfo) {
          windowManager.setPreviousActiveWindow(this.currentWindowInfo)
        }
        this.mainWindow.show()

        // 转发给主渲染进程，由 handleSelectApp 统一处理
        // 携带剪贴板内容作为 payload 来源
        this.mainWindow.webContents.send('super-panel-launch', {
          command,
          clipboardContent: this.currentClipboardContent,
          windowInfo: command.windowInfo || this.currentWindowInfo
        })

        return { success: true }
      } catch (error) {
        console.error('[SuperPanel] 超级面板启动指令失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 超级面板窗口准备好接收数据
    ipcMain.on('super-panel:ready', () => {
      this.windowReady = true
      // 发送所有缓存的消息
      for (const msg of this.pendingMessages) {
        if (this.superPanelWindow && !this.superPanelWindow.isDestroyed()) {
          this.superPanelWindow.webContents.send(msg.channel, msg.data)
        }
      }
      this.pendingMessages = []
    })

    // 超级面板请求加载固定列表（从搜索模式切换回固定模式）
    ipcMain.on('super-panel:show-pinned', () => {
      this.loadPinnedCommands()
    })

    // 超级面板头像点击：隐藏超级面板，显示主搜索窗口
    ipcMain.on('super-panel:show-main-window', () => {
      this.hideWindow()
      // 将超级面板触发前的窗口信息设置到主窗口管理器，
      // 否则 showWindow() 会获取到超级面板自身作为 previousActiveWindow
      if (this.currentWindowInfo) {
        windowManager.setPreviousActiveWindow(this.currentWindowInfo)
      }
      windowManager.showWindow()
    })

    // 更新超级面板固定列表顺序
    ipcMain.handle('super-panel:update-pinned-order', (_event, commands: any[]) => {
      try {
        databaseAPI.dbPut('super-panel-pinned', commands)
        this.mainWindow?.webContents.send('super-panel-pinned-changed')
        return { success: true }
      } catch (error) {
        console.error('[SuperPanel] 更新超级面板固定列表顺序失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 取消固定命令
    ipcMain.handle('super-panel:unpin-command', (_event, path: string, featureCode?: string) => {
      try {
        console.log('[SuperPanel] 收到取消固定请求:', { path, featureCode })
        let pinnedCommands = databaseAPI.dbGet('super-panel-pinned')
        if (!Array.isArray(pinnedCommands)) {
          pinnedCommands = []
        }

        // 递归处理文件夹内部的指令
        pinnedCommands = pinnedCommands
          .map((cmd: any) => {
            if (cmd.isFolder) {
              cmd.items = cmd.items.filter((item: any) => {
                if (featureCode) {
                  return !(item.path === path && item.featureCode === featureCode)
                }
                return item.path !== path
              })
              return cmd
            }
            return cmd
          })
          .filter((cmd: any) => {
            if (cmd.isFolder) {
              // 文件夹为空则移除，只剩1个则展开
              return cmd.items.length > 0
            }
            if (featureCode) {
              return !(cmd.path === path && cmd.featureCode === featureCode)
            }
            return cmd.path !== path
          })

        // 文件夹只剩1个指令时自动解散
        pinnedCommands = pinnedCommands.flatMap((cmd: any) => {
          if (cmd.isFolder && cmd.items.length === 1) {
            return cmd.items
          }
          return [cmd]
        })

        console.log('[SuperPanel] 更新后的固定列表:', pinnedCommands.length, '项')
        databaseAPI.dbPut('super-panel-pinned', pinnedCommands)

        // 重新加载固定列表
        this.loadPinnedCommands()
        console.log('[SuperPanel] 已重新加载固定列表')

        this.mainWindow?.webContents.send('super-panel-pinned-changed')

        return { success: true }
      } catch (error) {
        console.error('[SuperPanel] 取消固定失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 固定命令到超级面板
    ipcMain.handle('super-panel:pin-command', (_event, command: any) => {
      try {
        let pinnedCommands = databaseAPI.dbGet('super-panel-pinned')
        if (!Array.isArray(pinnedCommands)) {
          pinnedCommands = []
        }

        // 检查是否已存在（避免重复添加）
        const exists = pinnedCommands.some((cmd: any) => {
          if (command.featureCode) {
            return cmd.path === command.path && cmd.featureCode === command.featureCode
          }
          return cmd.path === command.path && cmd.name === command.name
        })

        if (!exists) {
          pinnedCommands.push({
            name: command.name,
            path: command.path || '',
            icon: command.icon || '',
            type: command.type,
            featureCode: command.featureCode || '',
            pluginName: command.pluginName || '',
            pluginExplain: command.pluginExplain || '',
            cmdType: command.cmdType || 'text'
          })
          databaseAPI.dbPut('super-panel-pinned', pinnedCommands)
          this.loadPinnedCommands()
          this.mainWindow?.webContents.send('super-panel-pinned-changed')
        }

        return { success: true }
      } catch (error) {
        console.error('[SuperPanel] 固定到超级面板失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 获取超级面板固定列表
    ipcMain.handle('super-panel:get-pinned', () => {
      try {
        const pinnedCommands = databaseAPI.dbGet('super-panel-pinned')
        if (!Array.isArray(pinnedCommands)) return []

        const flattened: any[] = []
        for (const cmd of pinnedCommands) {
          if (cmd.isFolder && Array.isArray(cmd.items)) {
            flattened.push(...cmd.items)
          } else {
            flattened.push(cmd)
          }
        }
        return flattened
      } catch {
        return []
      }
    })

    // 超级面板添加当前窗口到屏蔽列表
    ipcMain.handle('super-panel:add-blocked-app', async () => {
      try {
        if (!this.currentWindowInfo?.app) {
          return { success: false, error: '无法获取当前窗口信息' }
        }

        const appName = this.currentWindowInfo.app

        // 去重检查（app 名称忽略大小写）
        const alreadyBlocked = this.config.blockedApps.some(
          (b) => b.app.toLowerCase() === appName.toLowerCase()
        )
        if (alreadyBlocked) {
          this.hideWindow()
          return { success: true, app: appName.replace(/\.(exe|app)$/i, '') }
        }

        // 生成 label（去掉 .exe / .app 后缀）
        const label = appName.replace(/\.(exe|app)$/i, '')

        // 构造 BlockedApp 对象
        const blockedApp: BlockedApp = {
          app: appName,
          bundleId: this.currentWindowInfo.bundleId,
          label
        }

        // 添加到内存中的屏蔽列表
        this.config.blockedApps.push(blockedApp)

        // 持久化到数据库
        const data = databaseAPI.dbGet('settings-general') || {}
        data.superPanelBlockedApps = this.config.blockedApps
        databaseAPI.dbPut('settings-general', data)

        // 隐藏超级面板窗口
        this.hideWindow()

        console.log('[SuperPanel] 已将应用添加到屏蔽列表:', label)
        return { success: true, app: label }
      } catch (error) {
        console.error('[SuperPanel] 添加屏蔽应用失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 超级面板请求窗口匹配搜索 → 转发给主渲染进程
    ipcMain.handle(
      'super-panel:search-window-commands',
      (_event, windowInfo: { app?: string; title?: string }) => {
        // 设置触发前的窗口信息到主窗口管理器
        if (this.currentWindowInfo) {
          windowManager.setPreviousActiveWindow(this.currentWindowInfo)
        }
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          this.sendToSuperPanel('super-panel-window-commands-data', { results: [] })
          return
        }
        this.mainWindow.webContents.send('super-panel-search-window-commands', windowInfo)
      }
    )

    // 主渲染进程返回窗口匹配结果 → 转发到超级面板
    ipcMain.on('super-panel-window-commands-result', (_event, data: { results: any[] }) => {
      this.sendToSuperPanel('super-panel-window-commands-data', data)
    })
  }
}

export default new SuperPanelManager()
