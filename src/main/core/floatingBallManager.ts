import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import floatingBallHtml from '../../../resources/floatingBall.html?asset'
import databaseAPI from '../api/shared/database'
import windowManager from '../managers/windowManager'

// 悬浮球尺寸
const BALL_SIZE = 48

/**
 * 悬浮球管理器
 * 创建一个始终置顶的小圆球窗口，点击可切换主窗口显示/隐藏
 */
class FloatingBallManager {
  private ballWindow: BrowserWindow | null = null
  private enabled = false
  private letter = 'Z' // 悬浮球显示的文字，默认 Z
  private doubleClickCommand = '' // 悬浮球双击目标指令
  // 拖拽状态：记录拖拽开始时鼠标相对窗口左上角的偏移
  private dragOffsetX = 0
  private dragOffsetY = 0

  /**
   * 初始化悬浮球管理器
   * 从数据库加载配置，决定是否创建悬浮球
   */
  public async init(): Promise<void> {
    this.setupIPC()
    this.loadConfig()
  }

  /**
   * 从数据库加载悬浮球配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const data = databaseAPI.dbGet('settings-general')
      this.enabled = data?.floatingBallEnabled ?? false
      this.letter = data?.floatingBallLetter || 'Z'
      this.doubleClickCommand = data?.floatingBallDoubleClickCommand || ''

      if (this.enabled) {
        this.createBallWindow()

        // 恢复保存的位置
        const savedPos = data?.floatingBallPosition
        if (savedPos && this.ballWindow) {
          this.ballWindow.setPosition(savedPos.x, savedPos.y, false)
        }
      }

      console.log('[FloatingBall] 悬浮球配置已加载, enabled:', this.enabled)
    } catch (error) {
      console.error('[FloatingBall] 加载悬浮球配置失败:', error)
    }
  }

  /**
   * 设置 IPC 处理器
   */
  private setupIPC(): void {
    // 悬浮球被点击 → 切换主窗口
    ipcMain.on('floating-ball-click', () => {
      this.handleBallClick()
    })

    // 悬浮球被双击 → 打开目标指令
    ipcMain.on('floating-ball-double-click', () => {
      this.handleBallDoubleClick()
    })

    // 拖拽开始 → 记录鼠标相对窗口的偏移
    ipcMain.on(
      'floating-ball-drag-start',
      (_event, data: { mouseScreenX: number; mouseScreenY: number }) => {
        if (!this.ballWindow || this.ballWindow.isDestroyed()) return
        const [winX, winY] = this.ballWindow.getPosition()
        this.dragOffsetX = data.mouseScreenX - winX
        this.dragOffsetY = data.mouseScreenY - winY
      }
    )

    // 拖拽中 → 移动窗口
    ipcMain.on('floating-ball-dragging', (_event, data: { screenX: number; screenY: number }) => {
      if (!this.ballWindow || this.ballWindow.isDestroyed()) return
      const newX = data.screenX - this.dragOffsetX
      const newY = data.screenY - this.dragOffsetY
      this.ballWindow.setPosition(newX, newY, false)
    })

    // 拖拽结束 → 保存位置
    ipcMain.on('floating-ball-drag-end', () => {
      this.savePosition()
    })

    // 右键菜单
    ipcMain.on('floating-ball-contextmenu', () => {
      this.showContextMenu()
    })

    // 文件拖放到悬浮球
    ipcMain.on(
      'floating-ball-file-drop',
      (_event, files: Array<{ path: string; name: string; isDirectory: boolean }>) => {
        this.handleFileDrop(files)
      }
    )

    // 外部控制：显示/隐藏悬浮球
    ipcMain.handle('floating-ball:set-enabled', (_event, enabled: boolean) => {
      return this.setEnabled(enabled)
    })

    // 外部控制：获取悬浮球状态
    ipcMain.handle('floating-ball:get-enabled', () => {
      return this.enabled
    })

    // 外部控制：设置悬浮球文字
    ipcMain.handle('floating-ball:set-letter', (_event, letter: string) => {
      return this.setLetter(letter)
    })

    // 外部控制：获取悬浮球文字
    ipcMain.handle('floating-ball:get-letter', () => {
      return this.letter
    })

    // 外部控制：设置双击目标指令
    ipcMain.handle('floating-ball:set-double-click-command', (_event, command: string) => {
      return this.setDoubleClickCommand(command)
    })

    // 外部控制：获取双击目标指令
    ipcMain.handle('floating-ball:get-double-click-command', () => {
      return this.doubleClickCommand
    })
  }

  /**
   * 创建悬浮球窗口
   */
  private createBallWindow(): void {
    if (this.ballWindow && !this.ballWindow.isDestroyed()) {
      this.ballWindow.show()
      return
    }

    // 获取主显示器工作区（放在屏幕右边中间）
    const primaryDisplay = screen.getPrimaryDisplay()
    const {
      width: screenWidth,
      height: screenHeight,
      x: workAreaX,
      y: workAreaY
    } = primaryDisplay.workArea

    const x = workAreaX + screenWidth - BALL_SIZE - 30
    const y = workAreaY + Math.floor(screenHeight / 2) - Math.floor(BALL_SIZE / 2)

    this.ballWindow = new BrowserWindow({
      width: BALL_SIZE,
      height: BALL_SIZE,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      type: 'panel',
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true
      }
    })

    // macOS 上设置窗口层级为浮动面板（高于普通窗口）
    this.ballWindow.setAlwaysOnTop(true, 'floating')
    // 所有工作空间都可见
    this.ballWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // 加载悬浮球页面
    this.ballWindow.loadFile(floatingBallHtml)

    // 页面加载完成后发送配置的文字
    this.ballWindow.webContents.on('did-finish-load', () => {
      if (this.ballWindow && !this.ballWindow.isDestroyed()) {
        this.ballWindow.webContents.send('floating-ball-set-letter', this.letter)
      }
    })

    // 防止窗口被意外关闭
    this.ballWindow.on('close', (event) => {
      if (this.enabled) {
        event.preventDefault()
      }
    })

    console.log('[FloatingBall] 悬浮球窗口已创建')
  }

  /**
   * 处理悬浮球点击
   */
  private handleBallClick(): void {
    const mainWindow = windowManager.getMainWindow()
    if (!mainWindow) return

    if (mainWindow.isVisible()) {
      windowManager.hideWindow(false)
    } else {
      windowManager.showWindow()
    }
  }

  /**
   * 处理悬浮球双击
   */
  private handleBallDoubleClick(): void {
    if (!this.doubleClickCommand) {
      // 如果未配置双击指令，执行默认行为（打开/隐藏主窗口）
      this.handleBallClick()
      return
    }

    const mainWindow = windowManager.getMainWindow()
    if (!mainWindow) return

    // 显示主窗口并发送双击指令
    windowManager.showWindow()

    // 延迟发送指令，确保窗口完全打开
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('floating-ball-double-click-command', this.doubleClickCommand)
        console.log('[FloatingBall] 悬浮球双击，触发指令:', this.doubleClickCommand)
      }
    }, 100)
  }

  /**
   * 处理文件拖放到悬浮球
   * 显示主窗口并将文件数据发送给渲染进程（等同于复制文件后打开搜索框粘贴）
   */
  private handleFileDrop(files: Array<{ path: string; name: string; isDirectory: boolean }>): void {
    const mainWindow = windowManager.getMainWindow()
    if (!mainWindow) return

    // 显示主窗口
    windowManager.showWindow()

    // 延迟发送文件数据，确保 focus-search 事件及其处理器完全执行完毕
    // showWindow() 会触发 show 事件 → focus-search，其处理器会清空 pastedFilesData
    // 如果不延迟，floating-ball-files 可能先于 focus-search 到达渲染进程，
    // 导致设置的文件数据被 focus-search 处理器清空
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('floating-ball-files', files)
        console.log('[FloatingBall] 悬浮球文件拖放:', files.length, '个文件')
      }
    }, 500)
  }

  /**
   * 保存悬浮球位置到数据库
   */
  private savePosition(): void {
    if (!this.ballWindow || this.ballWindow.isDestroyed()) return

    const [x, y] = this.ballWindow.getPosition()

    try {
      const data = databaseAPI.dbGet('settings-general') || {}
      data.floatingBallPosition = { x, y }
      databaseAPI.dbPut('settings-general', data)
      console.log('[FloatingBall] 悬浮球位置已保存:', { x, y })
    } catch (error) {
      console.error('[FloatingBall] 保存悬浮球位置失败:', error)
    }
  }

  /**
   * 显示右键菜单
   */
  private showContextMenu(): void {
    if (!this.ballWindow) return

    const menu = Menu.buildFromTemplate([
      {
        label: '显示/隐藏 ZTools',
        click: () => {
          this.handleBallClick()
        }
      },
      { type: 'separator' },
      {
        label: '隐藏悬浮球',
        click: () => {
          this.setEnabled(false)
        }
      },
      { type: 'separator' },
      {
        label: '退出 ZTools',
        click: () => {
          windowManager.setQuitting(true)
          app.quit()
        }
      }
    ])

    menu.popup({ window: this.ballWindow })
  }

  /**
   * 设置悬浮球启用/禁用
   */
  public async setEnabled(enabled: boolean): Promise<{ success: boolean }> {
    this.enabled = enabled

    if (enabled) {
      this.createBallWindow()
    } else {
      this.destroyBallWindow()
    }

    // 保存到数据库
    try {
      const data = databaseAPI.dbGet('settings-general') || {}
      data.floatingBallEnabled = enabled
      databaseAPI.dbPut('settings-general', data)
      console.log('[FloatingBall] 悬浮球已', enabled ? '启用' : '禁用')
    } catch (error) {
      console.error('[FloatingBall] 保存悬浮球设置失败:', error)
    }

    return { success: true }
  }

  /**
   * 设置悬浮球显示文字
   */
  public setLetter(letter: string): { success: boolean } {
    this.letter = letter || 'Z'

    // 通知悬浮球窗口更新文字
    if (this.ballWindow && !this.ballWindow.isDestroyed()) {
      this.ballWindow.webContents.send('floating-ball-set-letter', this.letter)
    }

    // 保存到数据库
    try {
      const data = databaseAPI.dbGet('settings-general') || {}
      data.floatingBallLetter = this.letter
      databaseAPI.dbPut('settings-general', data)
      console.log('悬浮球文字已更新:', this.letter)
    } catch (error) {
      console.error('保存悬浮球文字失败:', error)
    }

    return { success: true }
  }

  /**
   * 设置悬浮球双击目标指令
   */
  public setDoubleClickCommand(command: string): { success: boolean } {
    this.doubleClickCommand = command || ''

    // 保存到数据库
    try {
      const data = databaseAPI.dbGet('settings-general') || {}
      data.floatingBallDoubleClickCommand = this.doubleClickCommand
      databaseAPI.dbPut('settings-general', data)
      console.log('悬浮球双击目标指令已更新:', this.doubleClickCommand)
    } catch (error) {
      console.error('保存悬浮球双击目标指令失败:', error)
    }

    return { success: true }
  }

  /**
   * 销毁悬浮球窗口
   */
  private destroyBallWindow(): void {
    if (this.ballWindow && !this.ballWindow.isDestroyed()) {
      this.enabled = false // 先标记为禁用，避免 close 事件 preventDefault
      // 移除所有事件监听器，防止干扰销毁过程
      this.ballWindow.removeAllListeners('close')
      this.ballWindow.destroy()
      this.ballWindow = null
      console.log('[FloatingBall] 悬浮球窗口已销毁')
    }
  }

  /**
   * 获取悬浮球是否启用
   */
  public isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 应用退出时清理
   */
  public cleanup(): void {
    this.destroyBallWindow()
  }
}

// 导出单例
export default new FloatingBallManager()
