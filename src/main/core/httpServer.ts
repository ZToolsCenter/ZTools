import { createServer, IncomingMessage, ServerResponse, Server } from 'http'
import { randomBytes } from 'crypto'
import fsSync from 'fs'
import path from 'path'
import windowManager from '../managers/windowManager'
import databaseAPI from '../api/shared/database'
import lmdbInstance from './lmdb/lmdbInstance'
import { getPluginDataPrefix } from '../../shared/pluginRuntimeNamespace'

interface HttpServerConfig {
  enabled: boolean
  port: number
  apiKey: string
}

interface ApiResponse {
  code: number
  message: string
  data?: unknown
}

interface PluginLaunchOptions {
  path: string
  type: 'plugin'
  featureCode?: string
  param?: {
    payload?: unknown
    type: string
    code: string
  }
  name?: string
  cmdType?: string
}

type PluginLauncher = (options: PluginLaunchOptions) => Promise<{
  success?: boolean
  error?: string
  [key: string]: unknown
}>

interface PluginLaunchFile {
  path: string
  name: string
  isDirectory: boolean
  isFile: boolean
}

const PLUGIN_COMMAND_TYPES = ['text', 'over', 'regex', 'img', 'files', 'window']
const DB_KEY = 'settings-http-server'
const DEFAULT_PORT = 36578

class HttpServer {
  private server: Server | null = null
  private pluginLauncher: PluginLauncher | null = null
  private config: HttpServerConfig = {
    enabled: false,
    port: DEFAULT_PORT,
    apiKey: ''
  }

  /**
   * 注入插件启动器，供 HTTP 接口复用应用内统一启动链路。
   * @param launcher 负责启动指定插件的异步函数。
   * @returns 无返回值。
   */
  public setPluginLauncher(launcher: PluginLauncher): void {
    this.pluginLauncher = launcher
  }

  public async init(): Promise<void> {
    await this.loadConfig()
    if (this.config.enabled) {
      this.start()
    }
  }

  public async loadConfig(): Promise<HttpServerConfig> {
    try {
      const saved = databaseAPI.dbGet(DB_KEY)
      if (saved) {
        this.config = {
          enabled: saved.enabled ?? false,
          port: saved.port ?? DEFAULT_PORT,
          apiKey: saved.apiKey || this.generateApiKey()
        }
      }
    } catch (error) {
      console.error('[HttpServer] 加载配置失败:', error)
    }
    return this.config
  }

  public async saveConfig(config: Partial<HttpServerConfig>): Promise<HttpServerConfig> {
    this.config = { ...this.config, ...config }
    databaseAPI.dbPut(DB_KEY, {
      enabled: this.config.enabled,
      port: this.config.port,
      apiKey: this.config.apiKey
    })
    return this.config
  }

  public getConfig(): HttpServerConfig {
    if (!this.config.apiKey) {
      this.config.apiKey = this.generateApiKey()
      this.saveConfig({ apiKey: this.config.apiKey })
    }
    return { ...this.config }
  }

  public generateApiKey(): string {
    return randomBytes(16).toString('hex')
  }

  public start(): boolean {
    if (this.server) {
      this.stop()
    }

    try {
      this.server = createServer((req, res) => this.handleRequest(req, res))

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        console.error('[HttpServer] 服务器错误:', error)
        if (error.code === 'EADDRINUSE') {
          console.error(`[HttpServer] 端口 ${this.config.port} 已被占用`)
        }
        this.server = null
      })

      this.server.listen(this.config.port, '127.0.0.1', () => {
        console.log(`[HttpServer] 服务已启动: http://127.0.0.1:${this.config.port}`)
      })

      return true
    } catch (error) {
      console.error('[HttpServer] 启动失败:', error)
      this.server = null
      return false
    }
  }

  public stop(): void {
    if (this.server) {
      this.server.close(() => {
        console.log('[HttpServer] 服务已停止')
      })
      this.server = null
    }
  }

  public isRunning(): boolean {
    return this.server !== null && this.server.listening
  }

  private sendJson(res: ServerResponse, statusCode: number, body: ApiResponse): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    })
    res.end(JSON.stringify(body))
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      })
      res.end()
      return
    }

    const url = req.url || '/'

    // GET / 无需认证，返回欢迎信息
    if (req.method === 'GET' && url === '/') {
      this.sendJson(res, 200, { code: 0, message: 'Hello ZTools' })
      return
    }

    if (req.method !== 'POST') {
      this.sendJson(res, 405, { code: 405, message: '仅支持 POST 请求' })
      return
    }

    const authHeader = req.headers['authorization']
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token || token !== this.config.apiKey) {
      this.sendJson(res, 401, { code: 401, message: 'API 密钥无效' })
      return
    }

    try {
      const body = await this.readBody(req)
      const result = await this.routeRequest(url, body)
      this.sendJson(res, 200, result)
    } catch (error) {
      console.error('[HttpServer] 请求处理失败:', error)
      this.sendJson(res, 500, {
        code: 500,
        message: error instanceof Error ? error.message : '内部服务器错误'
      })
    }
  }

  private readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      const MAX_BODY_SIZE = 1024 * 1024 // 1MB

      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_SIZE) {
          reject(new Error('请求体过大'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        if (!raw) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(raw))
        } catch {
          reject(new Error('无效的 JSON 格式'))
        }
      })

      req.on('error', reject)
    })
  }

  /**
   * 根据请求路径分发到具体 HTTP API 处理器。
   * @param url 请求路径。
   * @param body 已解析的 JSON 请求体。
   * @returns 统一 API 响应。
   */
  private async routeRequest(url: string, body: Record<string, unknown>): Promise<ApiResponse> {
    switch (url) {
      case '/api/window/show':
        return this.handleShowWindow(body)
      case '/api/window/hide':
        return this.handleHideWindow()
      case '/api/window/toggle':
        return this.handleToggleWindow()
      case '/api/plugin/launch':
        return await this.handleLaunchPlugin(body)
      default:
        return { code: 404, message: `未知接口: ${url}` }
    }
  }

  /**
   * 按插件名称从已安装插件列表中查找目标插件。
   * @param pluginName 插件 name 或 title。
   * @returns 匹配到的插件记录；找不到时返回 null。
   */
  private findPluginByName(pluginName: string): any | null {
    const plugins = databaseAPI.dbGet('plugins')
    if (!Array.isArray(plugins)) return null

    // 优先匹配清单 name，title 作为面向用户展示名的兜底。
    return (
      plugins.find((plugin: any) => plugin?.name === pluginName) ||
      plugins.find((plugin: any) => plugin?.title === pluginName) ||
      null
    )
  }

  /**
   * 解析 HTTP 插件启动类型，保持与手动启动插件时的 type/cmdType 一致。
   * @param body 已解析的 JSON 请求体。
   * @returns 插件命令类型。
   */
  private resolvePluginCommandType(body: Record<string, unknown>): string {
    const type = typeof body.type === 'string' ? body.type.trim() : ''
    if (!type) {
      return 'text'
    }

    if (PLUGIN_COMMAND_TYPES.includes(type)) {
      return type
    }

    throw new Error(`不支持的插件启动类型: ${type}`)
  }

  /**
   * 读取插件运行时注册的动态功能列表。
   * @param pluginName 插件运行时名称。
   * @returns 动态功能列表，读取失败时返回空数组。
   */
  private loadDynamicPluginFeatures(pluginName: string): any[] {
    try {
      const doc = lmdbInstance.get(`${getPluginDataPrefix(pluginName)}dynamic-features`)
      if (!doc?.data) return []

      const data = JSON.parse(doc.data)
      return Array.isArray(data.features) ? data.features : []
    } catch (error) {
      console.error('[HttpServer] 读取动态插件功能失败:', error)
      return []
    }
  }

  /**
   * 校验插件是否声明了指定功能 code。
   * @param plugin 已安装插件记录。
   * @param featureCode 待启动的插件功能 code。
   * @returns 插件静态或动态功能中存在该 code 时返回 true。
   */
  private validatePluginFeatureCode(plugin: any, featureCode: string): boolean {
    const features: any[] = []

    // 先使用安装记录里的 features，覆盖常规已安装插件。
    if (Array.isArray(plugin?.features)) {
      features.push(...plugin.features)
    }

    try {
      const pluginJsonPath = path.join(plugin.path, 'plugin.json')
      const pluginConfig = JSON.parse(fsSync.readFileSync(pluginJsonPath, 'utf-8'))
      if (Array.isArray(pluginConfig.features)) {
        features.push(...pluginConfig.features)
      }
    } catch (error) {
      console.error('[HttpServer] 读取插件功能配置失败:', error)
    }

    // 动态 feature 与手动启动/搜索链路一致，按插件运行时名称读取。
    features.push(...this.loadDynamicPluginFeatures(plugin.name))

    return features.some((feature) => feature?.code === featureCode)
  }

  /**
   * 将 HTTP 文件 payload 转成手动启动文件插件时一致的文件对象列表。
   * @param payload HTTP 请求中的 payload，支持路径字符串数组或文件对象数组。
   * @returns 标准文件 payload 列表。
   * @throws payload 结构不符合 files 类型要求时抛错。
   */
  private normalizeFilesPayload(payload: unknown): PluginLaunchFile[] {
    if (!Array.isArray(payload)) {
      throw new Error('files 类型的 payload 必须是文件数组')
    }

    return payload.map((item) => {
      const filePath =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && typeof (item as any).path === 'string'
            ? (item as any).path
            : ''

      if (!filePath) {
        throw new Error('files 类型的 payload 每一项都必须包含文件路径')
      }

      let isDirectory = false
      try {
        // 尽量补全目录信息，让插件收到的结构与手动文件启动保持一致。
        isDirectory = fsSync.statSync(filePath).isDirectory()
      } catch {
        isDirectory =
          typeof item === 'object' && item !== null ? Boolean((item as any).isDirectory) : false
      }

      const name =
        typeof item === 'object' && item !== null && typeof (item as any).name === 'string'
          ? (item as any).name
          : path.basename(filePath)

      return {
        path: filePath,
        name,
        isDirectory,
        isFile:
          typeof item === 'object' && item !== null && typeof (item as any).isFile === 'boolean'
            ? (item as any).isFile
            : !isDirectory
      }
    })
  }

  /**
   * 解析并规范化 HTTP 插件启动 payload。
   * @param commandType 插件启动类型。
   * @param payload HTTP 请求中的原始 payload。
   * @returns 与手动启动插件一致的 payload。
   * @throws payload 与启动类型不匹配时抛错。
   */
  private normalizePluginLaunchPayload(commandType: string, payload: unknown): unknown {
    if (commandType === 'files') {
      return this.normalizeFilesPayload(payload)
    }

    return payload
  }

  /**
   * 通过 HTTP 请求启动已安装插件，并将请求参数传给插件。
   * @param body 已解析的 JSON 请求体，必须包含 pluginName 和 code。
   * @returns 插件启动结果。
   */
  private async handleLaunchPlugin(body: Record<string, unknown>): Promise<ApiResponse> {
    try {
      const pluginName = typeof body.pluginName === 'string' ? body.pluginName.trim() : ''
      if (!pluginName) {
        return { code: 400, message: '缺少插件名称 pluginName' }
      }

      const featureCode = typeof body.code === 'string' ? body.code.trim() : ''
      if (!featureCode) {
        return { code: 400, message: '缺少插件功能 code' }
      }

      if (!this.pluginLauncher) {
        return { code: 500, message: '插件启动器未初始化' }
      }

      const plugin = this.findPluginByName(pluginName)
      if (!plugin?.path) {
        return { code: 404, message: `未找到插件: ${pluginName}` }
      }

      if (!this.validatePluginFeatureCode(plugin, featureCode)) {
        return { code: 404, message: `插件 ${pluginName} 未找到功能 code: ${featureCode}` }
      }

      // HTTP 启动参数与手动启动插件保持一致，避免插件侧适配额外协议。
      let commandType: string
      try {
        commandType = this.resolvePluginCommandType(body)
      } catch (error) {
        return {
          code: 400,
          message: error instanceof Error ? error.message : '插件启动类型无效'
        }
      }

      let payload: unknown
      try {
        payload = this.normalizePluginLaunchPayload(commandType, body.payload)
      } catch (error) {
        return {
          code: 400,
          message: error instanceof Error ? error.message : '插件启动 payload 无效'
        }
      }

      const result = await this.pluginLauncher({
        path: plugin.path,
        type: 'plugin',
        featureCode,
        param: {
          payload,
          type: commandType,
          code: featureCode
        },
        name: plugin.title || plugin.name || pluginName,
        cmdType: commandType
      })

      if (result?.success === false) {
        return { code: 500, message: result.error || '启动插件失败' }
      }

      return {
        code: 0,
        message: '操作成功',
        data: {
          name: plugin.name,
          title: plugin.title,
          path: plugin.path,
          result
        }
      }
    } catch (error) {
      return {
        code: 500,
        message: error instanceof Error ? error.message : '启动插件失败'
      }
    }
  }

  /**
   * 等待宿主恢复后显示窗口并投递可选搜索词。
   * @param body 外部调用传入的请求体。
   * @returns 完成投递安排后的响应。
   */
  private async handleShowWindow(body: Record<string, unknown>): Promise<ApiResponse> {
    try {
      const mainWindow = await windowManager.ensureMainWindowReady()
      windowManager.showWindow()

      const text = typeof body.text === 'string' ? body.text : undefined
      if (text !== undefined) {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('set-search-text', text)
        }, 100)
      }

      return { code: 0, message: '操作成功' }
    } catch (error) {
      return {
        code: 500,
        message: error instanceof Error ? error.message : '显示窗口失败'
      }
    }
  }

  private handleHideWindow(): ApiResponse {
    try {
      windowManager.hideWindow(false)
      return { code: 0, message: '操作成功' }
    } catch (error) {
      return {
        code: 500,
        message: error instanceof Error ? error.message : '隐藏窗口失败'
      }
    }
  }

  private handleToggleWindow(): ApiResponse {
    try {
      const mainWindow = windowManager.getMainWindow()
      if (mainWindow?.isVisible()) {
        windowManager.hideWindow(false)
      } else {
        windowManager.showWindow()
      }
      return { code: 0, message: '操作成功' }
    } catch (error) {
      return {
        code: 500,
        message: error instanceof Error ? error.message : '切换窗口失败'
      }
    }
  }
}

export default new HttpServer()
