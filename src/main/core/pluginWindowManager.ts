import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { session } from 'electron'
import mainPreload from '../../../resources/preload.js?asset'

/**
 * 插件窗口信息
 */
interface PluginWindowInfo {
  window: BrowserWindow
  parentWebContents: Electron.WebContents
  pluginPath: string
  pluginName: string
}

class PluginWindowManager {
  private windowInfoMap: Map<string, PluginWindowInfo> = new Map()
  private taskMap: Map<string, Promise<any>> = new Map()
  private taskCounter = 0

  /**
   * 创建插件独立窗口
   * @param pluginPath 插件根目录
   * @param pluginName 插件名称(用于 session partition)
   * @param url 相对路径
   * @param options 窗口配置
   * @param callbackId 回调ID (用于通知渲染进程)
   * @param senderWebContents 发送请求的 WebContents (用于发送回调)
   */
  public createWindow(
    pluginPath: string,
    pluginName: string,
    url: string,
    options: BrowserWindowConstructorOptions,
    callbackId: string,
    senderWebContents: Electron.WebContents
  ): string {
    const windowId = uuidv4()

    // 处理 preload 路径 (如果是相对路径)
    let preloadPath = options.webPreferences?.preload
    if (preloadPath && !path.isAbsolute(preloadPath)) {
      preloadPath = path.join(pluginPath, preloadPath)
    }

    console.log('子窗口 preloadPath', preloadPath)

    // 使用插件名称创建 session,确保和插件主视图共享同一个 session
    const sess = session.fromPartition('persist:' + pluginName)
    sess.registerPreloadScript({
      type: 'frame',
      filePath: mainPreload
    })

    // 合并配置
    const windowOptions: BrowserWindowConstructorOptions = {
      ...options,
      webPreferences: {
        ...options.webPreferences,
        preload: preloadPath,
        session: sess,
        contextIsolation: false,
        nodeIntegration: false,
        webSecurity: false,
        sandbox: false
      }
    }

    const win = new BrowserWindow(windowOptions)

    // 保存窗口信息
    this.windowInfoMap.set(windowId, {
      window: win,
      parentWebContents: senderWebContents,
      pluginPath,
      pluginName
    })

    // 处理 URL (如果是相对路径)
    let loadUrl = url
    if (!url.startsWith('http') && !url.startsWith('file:///')) {
      loadUrl = `file:///${path.join(pluginPath, url)}`
    }

    win.loadURL(loadUrl)

    // 监听加载完成
    win.webContents.on('did-finish-load', () => {
      if (callbackId && !senderWebContents.isDestroyed()) {
        senderWebContents.send(`browser-window-loaded-${callbackId}`, windowId)
      }
    })

    // 监听窗口关闭
    win.on('closed', () => {
      this.windowInfoMap.delete(windowId)
    })

    return windowId
  }

  /**
   * 发送消息到父窗口
   */
  public sendToParent(senderWebContents: Electron.WebContents, channel: string, args: any[]): void {
    // 查找包含该 webContents 的窗口信息
    for (const windowInfo of this.windowInfoMap.values()) {
      if (windowInfo.window.webContents === senderWebContents) {
        const parent = windowInfo.parentWebContents
        if (parent && !parent.isDestroyed()) {
          parent.send(channel, ...args)
          return
        }
        break
      }
    }
    console.warn('父窗口不存在或已销毁')
  }

  /**
   * 获取对象成员
   */
  private getMember(win: BrowserWindow, path: string[]): any {
    let current: any = win
    for (const prop of path) {
      if (current === undefined || current === null) return undefined
      current = current[prop]
    }
    return current
  }

  /**
   * 执行方法
   */
  public executeMethod(windowId: string, path: string[], args: any[]): any {
    console.log('executeMethod', windowId, path, args)
    const windowInfo = this.windowInfoMap.get(windowId)
    if (!windowInfo) return null

    const win = windowInfo.window

    // 获取方法所在的上下文对象
    const methodPath = [...path]
    const methodName = methodPath.pop()

    if (!methodName) return null

    const context = this.getMember(win, methodPath)
    if (!context) return null

    const method = context[methodName]
    if (typeof method === 'function') {
      return method.apply(context, args)
    }
    return null
  }

  /**
   * 同步尝试执行方法，如果返回 Promise 则缓存
   */
  public callMethodSync(
    windowId: string,
    path: string[],
    args: any[]
  ): { type: 'value'; data: any } | { type: 'promise'; taskId: string } {
    const windowInfo = this.windowInfoMap.get(windowId)
    if (!windowInfo) return { type: 'value', data: null }

    const win = windowInfo.window

    // 获取方法所在的上下文对象
    const methodPath = [...path]
    const methodName = methodPath.pop()

    if (!methodName) return { type: 'value', data: null }

    const context = this.getMember(win, methodPath)
    if (!context) return { type: 'value', data: null }

    const method = context[methodName]
    if (typeof method !== 'function') {
      return { type: 'value', data: null }
    }

    // 执行方法
    const result = method.apply(context, args)

    // 检查结果是否为 Promise
    if (result instanceof Promise) {
      const taskId = `task_${this.taskCounter++}`
      this.taskMap.set(taskId, result)

      // 清理：Promise 完成后一段时间自动清除
      result.finally(() => {
        setTimeout(() => {
          this.taskMap.delete(taskId)
        }, 60000) // 60秒后清理
      })

      return { type: 'promise', taskId }
    }

    // 同步结果
    return { type: 'value', data: result }
  }

  /**
   * 等待异步任务完成
   */
  public async waitForTask(taskId: string): Promise<any> {
    const promise = this.taskMap.get(taskId)
    if (!promise) {
      throw new Error(`Task ${taskId} not found`)
    }

    try {
      const result = await promise
      return result
    } finally {
      // 任务完成后立即清理
      this.taskMap.delete(taskId)
    }
  }

  /**
   * 获取属性值
   */
  public getPropertyByPath(windowId: string, path: string[]): any {
    console.log('getPropertyByPath', windowId, path)
    const windowInfo = this.windowInfoMap.get(windowId)
    if (!windowInfo) return null

    return this.getMember(windowInfo.window, path)
  }

  /**
   * 获取属性信息 (用于同步调用)
   */
  public getPropertyInfo(windowId: string, path: string[]): { type: string; value?: any } {
    const windowInfo = this.windowInfoMap.get(windowId)
    if (!windowInfo) return { type: 'undefined' }

    const member = this.getMember(windowInfo.window, path)

    if (member === undefined || member === null) {
      return { type: 'value', value: member }
    }

    if (typeof member === 'function') {
      return { type: 'function' }
    }

    if (typeof member === 'object') {
      // 检查是否是 Promise
      if (member instanceof Promise) {
        return { type: 'promise' }
      }
      // 简单的对象或数组可以直接返回
      if (member.constructor === Object || Array.isArray(member)) {
        // 这里需要小心循环引用，Electron IPC 会处理，但为了安全起见，
        // 如果是 Electron 对象（如 WebContents），我们应该标记为 object
        // 简单的判断方法：看是否是纯对象
        return { type: 'object' } // 统统视为 object，由 Proxy 继续代理
      }
      // 其他复杂对象 (BrowserWindow, WebContents 等)
      return { type: 'object' }
    }

    // 基本类型
    return { type: 'value', value: member }
  }

  /**
   * 根据 webContentsId 获取插件路径
   */
  public getPluginPathByWebContentsId(webContentsId: number): string | null {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed() && windowInfo.window.webContents.id === webContentsId) {
        return windowInfo.pluginPath
      }
    }
    return null
  }

  /**
   * 根据 webContentsId 获取插件名称
   */
  public getPluginNameByWebContentsId(webContentsId: number): string | null {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed() && windowInfo.window.webContents.id === webContentsId) {
        return windowInfo.pluginName
      }
    }
    return null
  }

  /**
   * 关闭指定插件的所有窗口
   */
  public closeByPlugin(pluginPath: string): void {
    const windowIdsToClose: string[] = []

    // 查找属于该插件的所有窗口
    for (const [windowId, windowInfo] of this.windowInfoMap.entries()) {
      if (windowInfo.pluginPath === pluginPath) {
        windowIdsToClose.push(windowId)
      }
    }

    // 关闭这些窗口
    for (const windowId of windowIdsToClose) {
      const windowInfo = this.windowInfoMap.get(windowId)
      if (windowInfo && !windowInfo.window.isDestroyed()) {
        windowInfo.window.close()
      }
    }

    console.log(`已关闭插件 ${pluginPath} 的 ${windowIdsToClose.length} 个窗口`)
  }

  /**
   * 关闭所有窗口
   */
  public closeAll(): void {
    for (const windowInfo of this.windowInfoMap.values()) {
      if (!windowInfo.window.isDestroyed()) {
        windowInfo.window.close()
      }
    }
    this.windowInfoMap.clear()
  }
}

export default new PluginWindowManager()
