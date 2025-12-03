import { BrowserWindow, WebContentsView, session, WebContents } from 'electron'
import path from 'path'
import api from './api/index.js'
import fsSync from 'fs'
import hideWindowHtml from '../../resources/hideWindow.html?asset'

import mainPreload from '../../resources/preload.js?asset'
import pluginWindowManager from './core/pluginWindowManager.js'

console.log('mainPreload', mainPreload)

interface PluginViewInfo {
  path: string
  name: string
  view: WebContentsView
  height?: number
  subInputPlaceholder?: string
  logo?: string
  isDevelopment?: boolean
}
class PluginManager {
  private mainWindow: BrowserWindow | null = null
  private pluginView: WebContentsView | null = null
  private currentPluginPath: string | null = null
  private pluginViews: Array<PluginViewInfo> = []

  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
  }

  // 创建或更新插件视图
  public async createPluginView(pluginPath: string, featureCode: string): Promise<void> {
    if (!this.mainWindow) return

    console.log('准备加载插件:', { pluginPath, featureCode })

    // 从数据库查询插件信息，确保 isDevelopment 准确
    let pluginInfoFromDB: any = null
    try {
      const plugins = await api.dbGet('plugins')
      if (plugins && Array.isArray(plugins)) {
        pluginInfoFromDB = plugins.find((p: any) => p.path === pluginPath)
      }
    } catch (error) {
      console.error('查询插件信息失败:', error)
    }

    console.log('从数据库查询到的插件信息:', pluginInfoFromDB)

    // 先尝试从缓存中复用已有视图
    const cached = this.pluginViews.find((v) => v.path === pluginPath)
    if (cached) {
      this.pluginView = cached.view
      this.mainWindow.contentView.addChildView(this.pluginView)

      // 获取主窗口大小并重新设置视图位置
      // const [windowWidth] = this.mainWindow.getSize()
      // 之前已经加载过 直接让插件视图获取焦点
      this.pluginView.webContents.focus()

      // 恢复之前的高度或使用默认高度
      // 如果配置为无界面 (没有 main)，则初始设置为 0
      const isConfigHeadless = !pluginInfoFromDB?.main

      if (isConfigHeadless) {
        this.setExpendHeight(0, false)
      } else {
        const viewHeight = cached.height || 600 - 59
        this.setExpendHeight(viewHeight, false)
      }

      this.currentPluginPath = pluginPath

      // 读取插件配置以获取logo和name
      try {
        const pluginJsonPath = path.join(pluginPath, 'plugin.json')
        const pluginConfig = JSON.parse(fsSync.readFileSync(pluginJsonPath, 'utf-8'))

        // 通知渲染进程插件已打开
        this.mainWindow?.webContents.send('plugin-opened', {
          name: pluginConfig.name,
          logo: pluginConfig.logo ? 'file:///' + path.join(pluginPath, pluginConfig.logo) : '',
          path: pluginPath,
          subInputPlaceholder: cached.subInputPlaceholder || '搜索'
        })
      } catch (error) {
        console.error('读取插件配置失败:', error)
      }

      console.log('复用缓存的 Plugin BrowserView')

      // 处理插件模式
      this.processPluginMode(pluginPath, featureCode, this.pluginView)
      return
    }

    // 读取插件配置
    const pluginJsonPath = path.join(pluginPath, 'plugin.json')

    try {
      const pluginConfig = JSON.parse(fsSync.readFileSync(pluginJsonPath, 'utf-8'))

      // 确定插件入口文件
      let pluginUrl: string
      const isConfigHeadless = !pluginConfig.main

      if (isConfigHeadless) {
        // 无界面插件，加载空白页面
        console.log('检测到无界面插件(Config):', pluginConfig.name)
        pluginUrl = 'file:///' + hideWindowHtml
      } else if (pluginInfoFromDB?.isDevelopment && pluginConfig.development?.main) {
        // 开发中插件，使用 development.main
        console.log('开发中插件，使用 development.main:', pluginConfig.development.main)
        pluginUrl = pluginConfig.development.main
      } else if (pluginConfig.main.startsWith('http')) {
        // 网络插件
        console.log('网络插件:', pluginConfig.main)
        pluginUrl = pluginConfig.main
      } else {
        // 生产模式
        pluginUrl = `file:///${path.join(pluginPath, pluginConfig.main)}`
      }

      // 确定 preload 脚本路径
      const preloadPath = pluginConfig.preload
        ? path.join(pluginPath, pluginConfig.preload)
        : undefined

      console.log('插件配置:', { pluginUrl, preloadPath, featureCode })

      const sess = session.fromPartition('persist:' + pluginConfig.name)
      sess.registerPreloadScript({
        type: 'frame',
        filePath: mainPreload
      })

      // 创建 WebContentsView
      this.pluginView = new WebContentsView({
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: false,
          webSecurity: false,
          sandbox: false,
          preload: preloadPath,
          session: sess
        }
      })

      // 监听 ESC 键
      this.pluginView.webContents.on('before-input-event', (_event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          this.handlePluginEsc()
        }
      })

      // 监听插件进程崩溃或退出（例如调用 process.exit()）
      this.pluginView.webContents.on('render-process-gone', (_event, details) => {
        console.log('插件进程已退出:', {
          pluginPath,
          reason: details.reason,
          exitCode: details.exitCode
        })

        // 从缓存中移除该插件
        const index = this.pluginViews.findIndex((v) => v.path === pluginPath)
        if (index !== -1) {
          this.pluginViews.splice(index, 1)
          console.log('已从缓存中移除崩溃的插件:', pluginPath)
        }

        // 如果是当前显示的插件，隐藏并返回搜索页面
        if (this.currentPluginPath === pluginPath) {
          this.hidePluginView()
          this.mainWindow?.webContents.send('back-to-search')
          this.currentPluginPath = null
          console.log('插件崩溃，已返回搜索页面')
        }

        // 关闭该插件创建的所有窗口
        pluginWindowManager.closeByPlugin(pluginPath)
      })

      this.mainWindow.contentView.addChildView(this.pluginView)

      // 获取主窗口大小
      const [windowWidth] = this.mainWindow.getSize()

      if (isConfigHeadless) {
        // 无界面插件 (Config)，初始设置为最小高度
        this.pluginView.setBounds({ x: 0, y: 59, width: windowWidth, height: 0 })
        api.resizeWindow(59)
      } else {
        // 有界面插件，设置在主窗口搜索框内容的下方
        const mainContentHeight = 59
        const viewHeight = 600 - mainContentHeight

        this.pluginView.setBounds({
          x: 0,
          y: mainContentHeight,
          width: windowWidth,
          height: viewHeight
        })

        // 调整窗口高度为固定 600px
        api.resizeWindow(600)
      }

      // 缓存新创建的视图 (提前缓存，以便 setSubInput 能找到)
      const pluginInfo: PluginViewInfo = {
        path: pluginPath,
        name: pluginConfig.name,
        view: this.pluginView,
        subInputPlaceholder: '搜索', // 默认值
        logo: pluginConfig.logo ? 'file:///' + path.join(pluginPath, pluginConfig.logo) : '',
        isDevelopment: !!pluginInfoFromDB?.isDevelopment
      }
      this.pluginViews.push(pluginInfo)
      this.currentPluginPath = pluginPath

      // 提前通知渲染进程插件已打开
      this.mainWindow?.webContents.send('plugin-opened', {
        name: pluginConfig.name,
        logo: pluginConfig.logo ? 'file:///' + path.join(pluginPath, pluginConfig.logo) : '',
        path: pluginPath,
        subInputPlaceholder: pluginInfo.subInputPlaceholder
      })

      const view = this.pluginView
      // 加载插件页面
      view.webContents.loadURL(pluginUrl)
      // 插件加载完成
      view.webContents.on('did-finish-load', async () => {
        this.processPluginMode(pluginPath, featureCode, view)
      })

      console.log('Plugin WebContentsView 已创建并缓存')
    } catch (error) {
      console.error('加载插件配置失败:', error)
    }
  }

  // 发送消息到插件
  public sendPluginMessage(eventName: string, data: any): void {
    if (this.pluginView && this.pluginView.webContents) {
      this.pluginView.webContents.send(eventName, data)
    }
  }

  // 隐藏插件视图
  public hidePluginView(): void {
    if (this.pluginView && this.mainWindow) {
      // 仅移除视图以达到隐藏效果，但保留实例以便复用
      this.mainWindow.contentView.removeChildView(this.pluginView)

      // 通知渲染进程插件已关闭
      this.mainWindow.webContents.send('plugin-closed')

      // 将当前引用清空，但缓存仍保留
      this.pluginView = null
      this.currentPluginPath = null
      console.log('Plugin WebContentsView 已隐藏，缓存保留')
    }
  }

  // 获取当前加载的插件路径
  public getCurrentPluginPath(): string | null {
    return this.currentPluginPath
  }

  public focusPluginView(): void {
    if (this.pluginView && this.pluginView.webContents) {
      console.log('插件视图获取焦点')
      this.pluginView.webContents.focus()
    }
  }

  // 获取所有运行中的插件路径
  public getRunningPlugins(): string[] {
    return this.pluginViews.map((v) => v.path)
  }

  // 获取所有运行中的插件信息 (包含路径和名称)
  public getRunningPluginsInfo(): Array<{ path: string; name: string }> {
    return this.pluginViews.map((v) => ({ path: v.path, name: v.name }))
  }

  // 通过 webContents 查找插件信息
  public getPluginInfoByWebContents(
    webContents: any
  ): { name: string; logo?: string; path: string } | null {
    const plugin = this.pluginViews.find((v) => v.view.webContents === webContents)
    return plugin ? { name: plugin.name, logo: plugin.logo, path: plugin.path } : null
  }

  // 通过 webContents 查找插件名称
  public getPluginNameByWebContents(webContents: any): string | null {
    const plugin = this.pluginViews.find((v) => v.view.webContents === webContents)
    return plugin ? plugin.name : null
  }

  // 终止指定插件
  public killPlugin(pluginPath: string): boolean {
    try {
      const index = this.pluginViews.findIndex((v) => v.path === pluginPath)
      if (index === -1) {
        console.log('插件未运行:', pluginPath)
        return false
      }

      const { view } = this.pluginViews[index]

      // 如果是当前显示的插件，先隐藏
      if (this.currentPluginPath === pluginPath && this.mainWindow) {
        this.mainWindow.contentView.removeChildView(view)
        this.pluginView = null
        this.currentPluginPath = null
      }

      // 销毁 webContents
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }

      // 关闭该插件创建的所有窗口
      pluginWindowManager.closeByPlugin(pluginPath)

      // 从缓存中移除
      this.pluginViews.splice(index, 1)

      console.log('插件已终止:', pluginPath)
      return true
    } catch (error) {
      console.error('终止插件失败:', error)
      return false
    }
  }

  // 终止所有插件
  public killAllPlugins(): void {
    for (const { view, path } of this.pluginViews) {
      try {
        if (!view.webContents.isDestroyed()) {
          view.webContents.close()
        }
        // 关闭该插件创建的所有窗口
        pluginWindowManager.closeByPlugin(path)
        console.log('插件已终止:', path)
      } catch (error) {
        console.error('终止插件失败:', path, error)
      }
    }

    if (this.mainWindow && this.pluginView) {
      this.mainWindow.contentView.removeChildView(this.pluginView)
    }

    this.pluginViews = []
    this.pluginView = null
    this.currentPluginPath = null
  }

  // 发送输入事件到当前插件（统一接口）
  public sendInputEvent(
    event: Electron.MouseInputEvent | Electron.MouseWheelInputEvent | Electron.KeyboardInputEvent
  ): boolean {
    try {
      if (!this.pluginView || this.pluginView.webContents.isDestroyed()) {
        console.log('没有活动的插件视图')
        return false
      }

      this.pluginView.webContents.sendInputEvent(event)

      console.log('发送输入事件:', event)
      return true
    } catch (error) {
      console.error('发送输入事件失败:', error)
      return false
    }
  }

  // 打开当前插件的开发者工具
  public openPluginDevTools(): boolean {
    try {
      if (!this.pluginView || this.pluginView.webContents.isDestroyed()) {
        console.log('没有活动的插件视图')
        return false
      }

      this.pluginView.webContents.openDevTools({ mode: 'detach' })
      console.log('已打开插件开发者工具')
      return true
    } catch (error) {
      console.error('打开开发者工具失败:', error)
      return false
    }
  }

  // 设置插件视图高度
  public setExpendHeight(height: number, updateCache: boolean = true): void {
    if (!this.mainWindow || !this.pluginView) return

    console.log('设置插件高度:', height)

    // 搜索框高度
    const mainContentHeight = 59
    // 计算总窗口高度
    const totalHeight = height + mainContentHeight

    // 获取当前窗口宽度
    const [width] = this.mainWindow.getSize()

    // 调整主窗口大小
    this.mainWindow.setSize(width, totalHeight)

    // 调整插件视图大小
    this.pluginView.setBounds({
      x: 0,
      y: mainContentHeight,
      width: width,
      height: height
    })

    // 更新缓存中的高度
    if (updateCache) {
      const cached = this.pluginViews.find((v) => v.view === this.pluginView)
      if (cached) {
        cached.height = height
      }
    }
  }

  // 设置子输入框 placeholder
  public setSubInputPlaceholder(placeholder: string): void {
    if (!this.pluginView) return

    // 更新缓存中的 placeholder
    const cached = this.pluginViews.find((v) => v.view === this.pluginView)
    if (cached) {
      cached.subInputPlaceholder = placeholder
    }
  }

  // 更新插件视图大小（跟随窗口大小变化）
  public updatePluginViewBounds(width: number, height: number): void {
    if (!this.pluginView) return

    const mainContentHeight = 59
    const viewHeight = height - mainContentHeight

    if (viewHeight > 0) {
      this.pluginView.setBounds({
        x: 0,
        y: mainContentHeight,
        width: width,
        height: viewHeight
      })

      // 更新缓存中的高度
      const cached = this.pluginViews.find((v) => v.view === this.pluginView)
      if (cached) {
        cached.height = viewHeight
      }
    }
  }

  // 获取插件模式
  private async getPluginMode(
    webContents: WebContents,
    featureCode: string
  ): Promise<string | undefined> {
    if (webContents.isDestroyed()) return undefined

    const callId = Math.random().toString(36).substr(2, 9)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), 1000) // 1s timeout

      webContents.ipc.once(`plugin-mode-result-${callId}`, (_event, mode) => {
        clearTimeout(timeout)
        resolve(mode)
      })

      webContents.send('get-plugin-mode', { featureCode, callId })
    })
  }

  // ==================== 无界面插件相关方法 ====================

  // 处理插件模式
  private async processPluginMode(
    pluginPath: string,
    featureCode: string,
    view: WebContentsView
  ): Promise<void> {
    const mode = await this.getPluginMode(view.webContents, featureCode)
    console.log('插件模式:', mode)

    // 检查视图是否仍是活动视图
    if (this.pluginView !== view) return

    if (mode === 'none') {
      // 无界面插件，调用插件方法
      this.setExpendHeight(0, false) // 不更新缓存，保留上次的 UI 高度
      this.callHeadlessPluginMethod(pluginPath, featureCode, api.getLaunchParam())
    } else {
      // 有界面插件
      // 恢复高度: 优先使用缓存的高度，如果没有则使用默认高度
      const cached = this.pluginViews.find((v) => v.path === pluginPath)
      let targetHeight = cached?.height || 600 - 59

      // 如果目标高度无效（可能被错误置为0），重置为默认值
      if (targetHeight <= 0) targetHeight = 600 - 59

      this.setExpendHeight(targetHeight, true)

      // 让插件视图获取焦点
      view.webContents.focus()
      // 通知插件进入事件
      view.webContents.send('on-plugin-enter', api.getLaunchParam())
    }
  }

  /**
   * 调用无界面插件方法
   */
  public async callHeadlessPluginMethod(
    pluginPath: string,
    featureCode: string,
    action: any
  ): Promise<any> {
    const plugin = this.pluginViews.find((p) => p.path === pluginPath)
    if (!plugin) {
      throw new Error('Plugin not found')
    }

    if (plugin.view.webContents.isDestroyed()) {
      throw new Error('Plugin view is destroyed')
    }

    console.log('调用无界面插件方法:', { pluginPath, featureCode, action })

    // 生成唯一的调用 ID
    const callId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // 创建 Promise 等待结果
    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        reject(new Error('Plugin method call timeout (30s)'))
      }, 30000) // 30秒超时

      // 监听一次性返回结果
      plugin.view.webContents.ipc.once(`plugin-method-result-${callId}`, (_event, result) => {
        clearTimeout(timeout)

        if (result.success) {
          resolve(result.result)
        } else {
          reject(new Error(result.error))
        }
      })

      // 发送调用请求
      plugin.view.webContents.send('call-plugin-method', {
        featureCode,
        action,
        callId
      })
    })
  }

  // 处理插件按 ESC 键
  private handlePluginEsc(): void {
    console.log('插件按下 ESC 键 (Main Process)，返回搜索页面')
    this.hidePluginView()
    // 通知渲染进程返回搜索页面
    this.mainWindow?.webContents.send('back-to-search')
    // 主窗口获取焦点
    this.mainWindow?.webContents.focus()
  }
  // 检查插件是否处于开发模式
  public isPluginDev(webContentsId: number): boolean {
    // 首先检查是否是插件视图
    const plugin = this.pluginViews.find((v) => v.view.webContents.id === webContentsId)
    if (plugin) {
      return !!plugin.isDevelopment
    }

    // 然后检查是否是插件创建的窗口
    const pluginPath = pluginWindowManager.getPluginPathByWebContentsId(webContentsId)
    if (pluginPath) {
      // 根据插件路径查找对应的插件视图，确认是否处于开发模式
      const pluginView = this.pluginViews.find((v) => v.path === pluginPath)
      return !!pluginView?.isDevelopment
    }

    return false
  }
}

export default new PluginManager()
