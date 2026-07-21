import { Worker } from 'worker_threads'
import path from 'path'
import fs from 'fs'
import https from 'https'
import { app, ipcMain } from 'electron'
import databaseAPI from '../api/shared/database.js'

const TRANSLATION_DIR = 'bergamot-translation'

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
  private messageId = 0
  private pendingMessages = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: any) => void }
  >()

  init(): void {
    // 使用无空格路径，避免 Bergamot WASM 脚本的 URL 编码问题
    // macOS 的 Application Support 含空格，会导致 %20 路径错误
    this.translationDir = path.join(app.getPath('home'), '.ztools', TRANSLATION_DIR)
    this.setupIPC()
    this.loadConfig()
  }

  private loadConfig(): void {
    try {
      const data = databaseAPI.dbGet('settings-general')
      this.enabled = data?.superPanelTranslateEnabled ?? false
      if (this.enabled) {
        this.initializeTranslator()
      }
    } catch (error) {
      console.error('[Translation] 加载翻译配置失败:', error)
    }
  }

  /**
   * 更新翻译功能开关，并持久化到 settings-general.superPanelTranslateEnabled。
   * 翻译 tab 的开关独立于此前的通用设置页写入，因此这里自行合并保存。
   */
  updateEnabled(enabled: boolean): void {
    this.enabled = enabled
    // 合并写入，避免覆盖 settings-general 中的其他字段
    try {
      const data = databaseAPI.dbGet('settings-general') || {}
      databaseAPI.dbPut('settings-general', { ...data, superPanelTranslateEnabled: enabled })
    } catch (error) {
      console.error('[Translation] 持久化翻译开关失败:', error)
    }
    if (enabled) {
      this.initializeTranslator()
    } else {
      this.destroyWorker()
      this.status = 'idle'
      this.errorMessage = ''
    }
  }

  getStatus(): { status: TranslationStatus; error?: string } {
    return { status: this.status, error: this.errorMessage || undefined }
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
   * 翻译文本（英文 → 中文）
   */
  async translate(text: string): Promise<string | null> {
    if (!this.enabled || this.status !== 'ready' || !this.worker) return null
    if (!text || text.trim().length === 0) return null

    // 如果文本主要是中文，跳过翻译
    if (this.isMostlyChinese(text)) return null

    // 限制翻译长度（避免超长文本卡死）
    const truncated = text.length > 1000 ? text.slice(0, 1000) + '...' : text

    try {
      const result = await this.sendWorkerMessage('translate', [
        {
          models: [{ from: 'en', to: 'zh' }],
          texts: [{ text: truncated, html: false }]
        }
      ])
      return result?.[0]?.target?.text || null
    } catch (error) {
      console.error('[Translation] 翻译失败:', error)
      return null
    }
  }

  /**
   * 初始化翻译引擎（下载资源 + 创建 Worker + 加载模型）
   */
  private async initializeTranslator(): Promise<void> {
    if (this.status === 'downloading' || this.status === 'initializing') return

    try {
      // 检查资源是否已下载
      if (!this.areResourcesReady()) {
        this.status = 'downloading'
        console.log('[Translation] 开始下载翻译资源...')
        await this.downloadResources()
        console.log('[Translation] 翻译资源下载完成')
      }

      this.patchWorkerScriptIfNeeded()
      this.status = 'initializing'
      await this.createWorker()
      await this.loadModel()
      this.status = 'ready'
      this.errorMessage = ''
      console.log('[Translation] Bergamot 翻译引擎已就绪')
    } catch (error) {
      this.status = 'error'
      this.errorMessage = error instanceof Error ? error.message : '初始化失败'
      console.error('[Translation] 初始化翻译引擎失败:', error)
    }
  }

  private areResourcesReady(): boolean {
    return RESOURCE_FILES.every((f) => fs.existsSync(path.join(this.translationDir, f.name)))
  }

  private async downloadResources(): Promise<void> {
    if (!fs.existsSync(this.translationDir)) {
      fs.mkdirSync(this.translationDir, { recursive: true })
    }

    for (const file of RESOURCE_FILES) {
      const filePath = path.join(this.translationDir, file.name)
      if (fs.existsSync(filePath)) continue

      console.log(`[Translation] 下载: ${file.name}`)
      try {
        await this.downloadResource(file.url, filePath)
      } catch (error) {
        // 下载失败时清理已下载的部分文件
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
        throw new Error(
          `下载 ${file.name} 失败: ${error instanceof Error ? error.message : '未知错误'}`
        )
      }
    }
  }

  /**
   * 使用 Node.js 原生 https 下载资源（避免 Electron net 模块附加额外请求头）
   */
  private downloadResource(url: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { headers: { Accept: '*/*' } }, (response) => {
        // 处理重定向
        if (
          (response.statusCode === 301 || response.statusCode === 302) &&
          response.headers.location
        ) {
          this.downloadResource(response.headers.location, filePath).then(resolve, reject)
          return
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }

        const fileStream = fs.createWriteStream(filePath)
        response.pipe(fileStream)
        fileStream.on('finish', () => {
          fileStream.close()
          resolve()
        })
        fileStream.on('error', reject)
      })
      request.on('error', reject)
    })
  }

  private async createWorker(): Promise<void> {
    this.destroyWorker()

    const workerPath = path.join(this.translationDir, 'translator-worker.js')
    this.worker = new Worker(workerPath)

    this.worker.on('message', (msg: { id: number; result?: any; error?: any }) => {
      const pending = this.pendingMessages.get(msg.id)
      if (pending) {
        this.pendingMessages.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(msg.error.message || 'Worker error'))
        } else {
          pending.resolve(msg.result)
        }
      }
    })

    this.worker.on('error', (err) => {
      console.error('[Translation] Worker 错误:', err)
      this.status = 'error'
      this.errorMessage = err.message
    })

    this.worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[Translation] Worker 异常退出 (code: ${code})`)
      }
      this.worker = null
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

  private async loadModel(): Promise<void> {
    const modelBuffer = fs.readFileSync(
      path.join(this.translationDir, 'model.enzh.intgemm.alphas.bin')
    )
    const lexBuffer = fs.readFileSync(path.join(this.translationDir, 'lex.50.50.enzh.s2t.bin'))
    const srcVocabBuffer = fs.readFileSync(path.join(this.translationDir, 'srcvocab.enzh.spm'))
    const trgVocabBuffer = fs.readFileSync(path.join(this.translationDir, 'trgvocab.enzh.spm'))

    // 将 Node.js Buffer 转为 ArrayBuffer
    const toArrayBuffer = (buf: Buffer): ArrayBuffer => {
      const ab = new ArrayBuffer(buf.byteLength)
      const view = new Uint8Array(ab)
      view.set(buf)
      return ab
    }

    await this.sendWorkerMessage('loadTranslationModel', [
      { from: 'en', to: 'zh' },
      {
        model: toArrayBuffer(modelBuffer),
        shortlist: toArrayBuffer(lexBuffer),
        vocabs: [toArrayBuffer(srcVocabBuffer), toArrayBuffer(trgVocabBuffer)]
      }
    ])
  }

  private sendWorkerMessage(name: string, args: any[]): Promise<any> {
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

      this.worker.postMessage({ id, name, args })
    })
  }

  private destroyWorker(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    // 拒绝所有待处理的消息
    for (const [, pending] of this.pendingMessages) {
      pending.reject(new Error('Worker 已终止'))
    }
    this.pendingMessages.clear()
  }

  private setupIPC(): void {
    ipcMain.handle('translation:get-status', () => this.getStatus())

    ipcMain.handle('translation:download-and-init', async () => {
      try {
        await this.initializeTranslator()
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
