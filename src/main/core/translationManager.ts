import { Worker, isMarkedAsUntransferable } from 'node:worker_threads'
import path from 'path'
import fs from 'fs'
import https from 'https'
import { ipcMain } from 'electron'
import { pipeline } from 'node:stream/promises'
import { getZToolsRoot } from './appData/appDataPaths'
import databaseAPI from '../api/shared/database.js'

const TRANSLATION_DIR = 'bergamot-translation'
const IDLE_TIMEOUT_MS = 60_000

// Bergamot WASM 资源下载地址（从 npm CDN）
const BERGAMOT_CDN = 'https://unpkg.com/@browsermt/bergamot-translator@0.4.9/worker'

// Firefox 翻译模型 CDN 基础地址
const FIREFOX_CDN = 'https://firefox-settings-attachments.cdn.mozilla.net'

// 需要下载的文件列表
const RESOURCE_FILES = [
  // WASM 运行时
  {
    name: 'translator-worker.js',
    url: `${BERGAMOT_CDN}/translator-worker.js`
  },
  {
    name: 'bergamot-translator-worker.js',
    url: `${BERGAMOT_CDN}/bergamot-translator-worker.js`
  },
  {
    name: 'bergamot-translator-worker.wasm',
    url: `${BERGAMOT_CDN}/bergamot-translator-worker.wasm`
  },
  // En→Zh 翻译模型（来自 Firefox Translations CDN）
  {
    name: 'model.enzh.intgemm.alphas.bin',
    url: `${FIREFOX_CDN}/main-workspace/translations-models/a7ff7d5e-e67e-406c-a34b-a7edea35b10e.bin`
  },
  {
    name: 'lex.50.50.enzh.s2t.bin',
    url: `${FIREFOX_CDN}/main-workspace/translations-models/da8fccc0-31df-4665-9703-96d36606e019.bin`
  },
  {
    name: 'srcvocab.enzh.spm',
    url: `${FIREFOX_CDN}/main-workspace/translations-models/ea98c52c-58dc-45d5-af23-38f2b029d020.spm`
  },
  {
    name: 'trgvocab.enzh.spm',
    url: `${FIREFOX_CDN}/main-workspace/translations-models/bddbda68-d4d2-4317-a0a1-119caa47525e.spm`
  }
]

const WINDOWS_FILE_READ_NEEDLE = 'const buffer = await readFile(url.pathname);'
const WINDOWS_FILE_READ_PATCH = [
  "const {fileURLToPath} = require(/* webpackIgnore: true */ 'node:url');",
  '                const buffer = await readFile(fileURLToPath(url));'
].join('\n')

const WINDOWS_LOCATION_NEEDLE = 'return new URL(`file://${__filename}`);'
const WINDOWS_LOCATION_PATCH = [
  "const {pathToFileURL} = require(/* webpackIgnore: true */ 'node:url');",
  '            return pathToFileURL(__filename);'
].join('\n')

type TranslationStatus = 'idle' | 'downloading' | 'initializing' | 'ready' | 'error'

/**
 * Bergamot WASM 翻译管理器
 * 使用 Node.js worker_threads 运行 Bergamot 翻译引擎
 */
class TranslationManager {
  private worker: Worker | null = null
  private enabled = false
  private status: TranslationStatus = 'idle'
  private errorMessage = ''
  private translationDir = ''
  private resourceDownload: Promise<void> | null = null
  private initialization: Promise<void> | null = null
  private generation = 0
  private activeRequests = 0
  private idleTimer: NodeJS.Timeout | null = null
  private messageId = 0
  private pendingMessages = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: any) => void }
  >()

  /**
   * 注册接口并恢复开关，模型由第一次有效的翻译请求加载。
   * @returns 无返回值。
   */
  init(): void {
    this.translationDir = path.join(getZToolsRoot(), TRANSLATION_DIR)
    this.setupIPC()
    try {
      this.enabled = databaseAPI.dbGet('settings-general')?.superPanelTranslateEnabled ?? false
    } catch (error) {
      console.error('[Translation] 加载翻译配置失败:', error)
    }
  }

  /**
   * 保存引擎开关。显式启用时准备离线文件，禁用时释放内存。
   * @param enabled 是否允许使用内置翻译。
   * @returns 无返回值。
   */
  updateEnabled(enabled: boolean): void {
    this.enabled = enabled
    try {
      const data = databaseAPI.dbGet('settings-general') || {}
      databaseAPI.dbPut('settings-general', { ...data, superPanelTranslateEnabled: enabled })
    } catch (error) {
      console.error('[Translation] 持久化翻译开关失败:', error)
    }
    if (!enabled) {
      this.destroyWorker()
      return
    }
    // 提前下载以供断网后首次使用，同时保持翻译线程休眠。
    const generation = this.generation
    void this.prepareResources().catch((error) => {
      if (generation === this.generation) this.failWorker(error)
    })
  }

  /**
   * 分别报告用户的开关和引擎的实际状态，休眠时仍保持启用。
   * @returns 是否启用、当前状态和最近一次错误。
   */
  getStatus(): { enabled: boolean; status: TranslationStatus; error?: string } {
    const status = this.enabled && this.resourceDownload ? 'downloading' : this.status
    return { enabled: this.enabled, status, error: this.errorMessage || undefined }
  }

  /**
   * 判断文本是否主要为中文（CJK 字符占比 > 50%）
   */
  private isMostlyChinese(text: string): boolean {
    const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g
    const cjkMatches = text.match(cjkRegex)
    if (!cjkMatches) return false
    // 只统计非空白字符
    const nonWhitespace = text.replace(/\s/g, '').length
    if (nonWhitespace === 0) return false
    return cjkMatches.length / nonWhitespace > 0.5
  }

  /**
   * 在首个有效请求到达时加载引擎，并在并发翻译之间复用同一线程。
   * @param text 待翻译的文本。
   * @returns 中文译文，跳过或失败时返回 null。
   */
  async translate(text: string): Promise<string | null> {
    if (!this.enabled || !text?.trim() || this.isMostlyChinese(text)) return null
    const truncated = text.length > 1000 ? text.slice(0, 1000) + '...' : text
    const generation = this.generation
    this.activeRequests++
    this.cancelIdleTimer()
    try {
      await this.ensureReady()
      // 禁用后即使立刻重新启用，也不向新实例投递旧请求。
      if (generation !== this.generation) return null
      const result = await this.sendWorkerMessage('translate', [
        { models: [{ from: 'en', to: 'zh' }], texts: [{ text: truncated, html: false }] }
      ])
      return result?.[0]?.target?.text || null
    } catch (error) {
      console.error('[Translation] 翻译失败:', error)
      return null
    } finally {
      this.activeRequests--
      this.scheduleIdleRelease()
    }
  }

  /**
   * 合并首次加载和休眠后的并发唤醒，失败后允许下次请求重试。
   * @returns 引擎完成初始化的 Promise。
   * @throws 资源准备、线程启动或模型加载失败时拒绝。
   */
  private ensureReady(): Promise<void> {
    if (this.status === 'ready') return Promise.resolve()
    if (!this.initialization) {
      const generation = this.generation
      this.initialization = this.initializeTranslator(generation)
        .catch((error) => {
          if (generation === this.generation) this.failWorker(error)
          throw error
        })
        .finally(() => {
          if (generation === this.generation) this.initialization = null
        })
    }
    return this.initialization
  }

  /**
   * 先准备离线文件，再创建线程并移交模型。
   * @param generation 本次初始化所属的生命周期版本。
   * @returns 模型就绪后结束的 Promise。
   * @throws 初始化被取消或模型无法加载时拒绝。
   */
  private async initializeTranslator(generation: number): Promise<void> {
    await this.prepareResources()
    if (generation !== this.generation) throw new Error('翻译初始化已取消')
    this.status = 'initializing'
    this.errorMessage = ''
    this.patchWorkerScriptIfNeeded()
    await this.createWorker()
    if (generation !== this.generation) throw new Error('翻译初始化已取消')
    await this.loadModel()
    if (generation !== this.generation) throw new Error('翻译初始化已取消')
    this.status = 'ready'
  }

  /**
   * 复用首次启用和翻译请求的资源下载，下载完毕后保留磁盘缓存。
   * @returns 本地资源可用后结束的 Promise。
   * @throws 文件检查或下载失败时拒绝。
   */
  private async prepareResources(): Promise<void> {
    if (this.resourceDownload) return this.resourceDownload
    if (this.areResourcesReady()) return
    this.resourceDownload = this.downloadResources().finally(() => {
      this.resourceDownload = null
    })
    return this.resourceDownload
  }

  /**
   * 取消旧的空闲期限，避免使用中的线程被回收。
   * @returns 无返回值。
   */
  private cancelIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  /**
   * 从最后一个请求结束时开始计时，超时仅释放内存中的引擎。
   * @returns 无返回值。
   */
  private scheduleIdleRelease(): void {
    this.cancelIdleTimer()
    if (this.activeRequests || this.status !== 'ready') return
    this.idleTimer = setTimeout(() => this.destroyWorker(), IDLE_TIMEOUT_MS)
    this.idleTimer.unref()
  }

  private areResourcesReady(): boolean {
    return RESOURCE_FILES.every((f) => fs.existsSync(path.join(this.translationDir, f.name)))
  }

  /**
   * 下载缺少的离线资源，只在文件写入完成后发布最终文件名。
   * @returns 全部资源可用后结束的 Promise。
   * @throws 资源无法下载或写入时拒绝。
   */
  private async downloadResources(): Promise<void> {
    if (!fs.existsSync(this.translationDir)) {
      fs.mkdirSync(this.translationDir, { recursive: true })
    }

    for (const file of RESOURCE_FILES) {
      const filePath = path.join(this.translationDir, file.name)
      if (fs.existsSync(filePath)) continue

      console.log(`[Translation] 下载: ${file.name}`)
      // 重启时不把上一次中断的下载识别为可直接加载的模型。
      const partialPath = filePath + '.part'
      try {
        await this.downloadResource(file.url, partialPath)
        fs.renameSync(partialPath, filePath)
      } catch (error) {
        fs.rmSync(partialPath, { force: true })
        throw new Error(
          `下载 ${file.name} 失败: ${error instanceof Error ? error.message : '未知错误'}`
        )
      }
    }
  }

  /**
   * 下载资源并等待文件流完整结束。
   * @param url 资源地址。
   * @param filePath 本地目标文件。
   * @returns 资源写入完成的 Promise。
   * @throws 网络或文件流出错时拒绝。
   */
  private downloadResource(url: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { headers: { Accept: '*/*' } }, (response) => {
        // 处理重定向
        if (
          (response.statusCode === 301 || response.statusCode === 302) &&
          response.headers.location
        ) {
          response.resume()
          this.downloadResource(response.headers.location, filePath).then(resolve, reject)
          return
        }

        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }

        // 流中断时让下载方清理残缺文件，下次请求可重试。
        pipeline(response, fs.createWriteStream(filePath)).then(resolve, reject)
      })
      request.on('error', reject)
    })
  }

  /**
   * 启动翻译线程并监听当前实例的回复和异常退出。
   * @returns WASM 引擎初始化完成的 Promise。
   * @throws Worker 无法创建或 WASM 初始化失败时拒绝。
   */
  private async createWorker(): Promise<void> {
    const worker = new Worker(path.join(this.translationDir, 'translator-worker.js'))
    this.worker = worker
    worker.on('message', (msg: { id: number; result?: any; error?: any }) => {
      const pending = this.pendingMessages.get(msg.id)
      if (!pending || this.worker !== worker) return
      this.pendingMessages.delete(msg.id)
      if (msg.error) pending.reject(new Error(msg.error.message || 'Worker 错误'))
      else pending.resolve(msg.result)
    })
    // 主动回收后旧实例的退出事件不能改写新引擎状态。
    worker.on('error', (error) => {
      if (this.worker === worker) this.failWorker(error)
    })
    worker.on('exit', (code) => {
      if (this.worker === worker) this.failWorker(new Error(`翻译线程意外退出 (${code})`))
    })
    // 初始化 WASM 模块
    await this.sendWorkerMessage('initialize', [{ cacheSize: 0 }])
  }

  /**
   * 上游 translator-worker.js 在 Windows 的 Node worker 环境中会错误处理 file:// URL，
   * 导致 wasm 路径被解析成 C:\C:\...。这里在启动前对下载后的脚本做一次就地修补。
   */
  private patchWorkerScriptIfNeeded(): void {
    const workerPath = path.join(this.translationDir, 'translator-worker.js')
    if (!fs.existsSync(workerPath)) return

    const originalContent = fs.readFileSync(workerPath, 'utf-8')
    const patchedContent = this.patchBergamotWorkerScript(originalContent)

    if (patchedContent !== originalContent) {
      fs.writeFileSync(workerPath, patchedContent, 'utf-8')
      console.log('[Translation] 已修补 Bergamot worker 的本地文件 URL 兼容性')
    }
  }

  /**
   * 将上游脚本中依赖 URL.pathname 和手写 file:// 的实现，
   * 替换为 Node 官方的 fileURLToPath/pathToFileURL，确保 Windows 盘符路径正确。
   */
  private patchBergamotWorkerScript(scriptContent: string): string {
    let patchedContent = scriptContent

    if (patchedContent.includes(WINDOWS_FILE_READ_NEEDLE)) {
      patchedContent = patchedContent.replace(WINDOWS_FILE_READ_NEEDLE, WINDOWS_FILE_READ_PATCH)
    }

    if (patchedContent.includes(WINDOWS_LOCATION_NEEDLE)) {
      patchedContent = patchedContent.replace(WINDOWS_LOCATION_NEEDLE, WINDOWS_LOCATION_PATCH)
    }

    return patchedContent
  }

  /**
   * 读取可独占转移的文件缓冲，遇到共享池或不可转移的内存时仅复制有效范围。
   * @param name 模型目录内的资源文件名。
   * @returns 可放入 Worker 转移列表的完整 ArrayBuffer。
   * @throws 资源读取失败时抛出文件系统错误。
   */
  private readModelBuffer(name: string): ArrayBuffer {
    const bytes = fs.readFileSync(path.join(this.translationDir, name))
    const backing = bytes.buffer
    if (
      backing instanceof ArrayBuffer &&
      bytes.byteOffset === 0 &&
      bytes.byteLength === backing.byteLength &&
      !isMarkedAsUntransferable(backing)
    ) {
      return backing
    }
    return Uint8Array.from(bytes).buffer
  }

  /**
   * 将模型、词表和词典一次移交给 Worker，主线程不保留副本。
   * @returns Worker 完成模型加载的 Promise。
   * @throws 文件读取或模型加载失败时拒绝。
   */
  private async loadModel(): Promise<void> {
    const model = this.readModelBuffer('model.enzh.intgemm.alphas.bin')
    const shortlist = this.readModelBuffer('lex.50.50.enzh.s2t.bin')
    const vocabs = ['srcvocab.enzh.spm', 'trgvocab.enzh.spm'].map((name) =>
      this.readModelBuffer(name)
    )
    await this.sendWorkerMessage(
      'loadTranslationModel',
      [
        { from: 'en', to: 'zh' },
        { model, shortlist, vocabs }
      ],
      [model, shortlist, ...vocabs]
    )
  }

  /**
   * 跟踪请求直至收到回复、线程退出或超时。
   * @param name Worker 协议方法名。
   * @param args 方法参数。
   * @param transferList 放弃主线程所有权的缓冲区。
   * @returns Worker 回复的结果。
   * @throws 发送失败、超时或线程报告错误时拒绝。
   */
  private sendWorkerMessage(
    name: string,
    args: any[],
    transferList: ArrayBuffer[] = []
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker 未初始化'))
        return
      }

      const id = ++this.messageId
      const timeoutMs = name === 'initialize' ? 30000 : 10000

      const timeout = setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id)
          reject(new Error(`Worker 消息超时: ${name}`))
        }
      }, timeoutMs)

      this.pendingMessages.set(id, {
        resolve: (value: any) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (reason: any) => {
          clearTimeout(timeout)
          reject(reason)
        }
      })

      // 同步序列化失败时同样撤销定时器和待处理请求。
      try {
        this.worker.postMessage({ id, name, args }, transferList)
      } catch (error) {
        clearTimeout(timeout)
        this.pendingMessages.delete(id)
        reject(error)
      }
    })
  }

  /**
   * 回收发生异常的引擎，并保留可展示的失败原因。
   * @param error 初始化或线程运行期间的异常。
   * @returns 无返回值。
   */
  private failWorker(error: unknown): void {
    this.destroyWorker()
    this.status = 'error'
    this.errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Translation]', this.errorMessage)
  }

  /**
   * 使旧初始化失效并结清待处理请求，保留用户开关和磁盘文件。
   * @returns 无返回值。
   */
  private destroyWorker(): void {
    this.cancelIdleTimer()
    this.generation++
    this.initialization = null
    this.status = 'idle'
    this.errorMessage = ''
    if (this.worker) {
      void this.worker.terminate()
      this.worker = null
    }
    // 拒绝所有待处理的消息
    for (const [, pending] of this.pendingMessages) {
      pending.reject(new Error('Worker 已终止'))
    }
    this.pendingMessages.clear()
  }

  /**
   * 注册引擎查询及显式预热接口，预热也遵循相同的空闲回收期限。
   * @returns 无返回值。
   */
  private setupIPC(): void {
    ipcMain.handle('translation:get-status', () => this.getStatus())

    ipcMain.handle('translation:download-and-init', async () => {
      try {
        await this.ensureReady()
        this.scheduleIdleRelease()
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '初始化失败'
        }
      }
    })
  }
}

export default new TranslationManager()
