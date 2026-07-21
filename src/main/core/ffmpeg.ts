import { app, BrowserWindow, net, session } from 'electron'
import path from 'path'
import { createWriteStream } from 'fs'
import { promises as fs } from 'fs'
import AdmZip from 'adm-zip'
import ffmpegDownloadHtml from '../../../resources/ffmpeg.html?asset'
import { getExtendsPath } from './appData/appDataPaths'

class FFmpegManager {
  private downloadWindow: BrowserWindow | null = null
  private downloadingPromise: Promise<string> | null = null

  private readonly ACCELERATION_STATIONS = [
    'https://gh-proxy.org/',
    'https://hk.gh-proxy.org/',
    'https://cdn.gh-proxy.org/',
    'https://edgeone.gh-proxy.org/'
  ]

  private readonly DOWNLOAD_URLS = {
    'win32-x64':
      'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-15-14-01/ffmpeg-n8.1.2-22-g94138f6973-win64-gpl-8.1.zip',
    'win32-arm64':
      'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-15-14-01/ffmpeg-n8.1.2-22-g94138f6973-winarm64-gpl-8.1.zip',
    'darwin-arm64':
      'https://github.com/eko5624/mpv-mac/releases/download/2026-03-09/ffmpeg-arm64-248b481c33.zip',
    'darwin-x64':
      'https://github.com/eko5624/mpv-mac/releases/download/2026-03-09/ffmpeg-x86_64-248b481c33.zip'
  }

  /**
   * FFmpeg 存储路径: {userData}/extends/ffmpeg{.exe}
   */
  private resolveFFmpegPath(): string {
    const ext = process.platform === 'win32' ? '.exe' : ''
    return path.join(getExtendsPath(), `ffmpeg${ext}`)
  }

  private getDownloadUrl(): string {
    const key = `${process.platform}-${process.arch}`
    const url = this.DOWNLOAD_URLS[key as keyof typeof this.DOWNLOAD_URLS]
    if (!url) throw new Error(`不支持的平台: ${key}`)
    return url
  }

  /**
   * ZIP 内查找 ffmpeg 二进制文件
   * Windows: 路径含版本号，需动态查找 bin/ffmpeg.exe
   * macOS: 固定路径 ffmpeg/ffmpeg
   */
  private findFFmpegEntry(zip: AdmZip): AdmZip.IZipEntry | null {
    if (process.platform === 'darwin') {
      return zip.getEntry('ffmpeg/ffmpeg')
    }

    for (const entry of zip.getEntries()) {
      if (entry.entryName.includes('/bin/ffmpeg.exe')) {
        return entry
      }
    }
    return null
  }

  /**
   * 确保 FFmpeg 可用，不存在则触发下载
   */
  async ensureFFmpeg(): Promise<string> {
    const ffmpegPath = this.resolveFFmpegPath()

    if (
      await fs
        .access(ffmpegPath)
        .then(() => true)
        .catch(() => false)
    ) {
      return ffmpegPath
    }

    if (this.downloadingPromise) {
      return this.downloadingPromise
    }

    this.downloadingPromise = this.downloadAndInstall()
    return this.downloadingPromise
  }

  /**
   * 并发测试所有加速站 + 直连，返回响应最快的代理前缀（空字符串表示直连）
   */
  private async selectFastestStation(githubUrl: string): Promise<string> {
    const testStation = (prefix: string): Promise<{ prefix: string; latency: number }> => {
      return new Promise((resolve, reject) => {
        const url = prefix ? `${prefix}${githubUrl}` : githubUrl
        const start = Date.now()
        const request = net.request({ url, method: 'HEAD', session: session.defaultSession })

        const timer = setTimeout(() => {
          request.abort()
          reject(new Error('timeout'))
        }, 8000)

        request.on('response', (response) => {
          clearTimeout(timer)
          request.abort()
          if (response.statusCode && response.statusCode < 400) {
            resolve({ prefix, latency: Date.now() - start })
          } else {
            reject(new Error(`HTTP ${response.statusCode}`))
          }
        })

        request.on('error', () => {
          clearTimeout(timer)
          reject(new Error('connection failed'))
        })

        request.end()
      })
    }

    const prefixes = [
      ...this.ACCELERATION_STATIONS,
      '' // 直连 GitHub
    ]

    const results = await Promise.allSettled(prefixes.map((p) => testStation(p)))

    const fastest = results
      .filter(
        (r): r is PromiseFulfilledResult<{ prefix: string; latency: number }> =>
          r.status === 'fulfilled'
      )
      .map((r) => r.value)
      .sort((a, b) => a.latency - b.latency)

    if (fastest.length === 0) {
      throw new Error('所有下载节点均不可用')
    }

    return fastest[0].prefix
  }

  private async downloadAndInstall(): Promise<string> {
    try {
      this.showDownloadWindow()
      await this.waitForUserConfirmation()

      // 测试加速站并选择最快节点
      this.updateProgressText('正在选择最快的下载节点...')
      const githubUrl = this.getDownloadUrl()
      const prefix = await this.selectFastestStation(githubUrl)
      const downloadUrl = prefix ? `${prefix}${githubUrl}` : githubUrl

      const tempZip = path.join(app.getPath('temp'), `ffmpeg-${Date.now()}.zip`)
      try {
        await this.streamDownload(downloadUrl, tempZip)
      } catch (err) {
        this.showError(`下载失败: ${err instanceof Error ? err.message : '未知错误'}`)
        // 等待用户看到错误信息（3秒或窗口关闭，取早者）
        await Promise.race([
          new Promise((r) => setTimeout(r, 3000)),
          new Promise<void>((r) => {
            if (!this.downloadWindow || this.downloadWindow.isDestroyed()) return r()
            this.downloadWindow.once('closed', () => r())
          })
        ])
        throw err
      }

      const ffmpegPath = this.resolveFFmpegPath()
      await fs.mkdir(path.dirname(ffmpegPath), { recursive: true })

      const zip = new AdmZip(tempZip)
      const entry = this.findFFmpegEntry(zip)
      if (!entry) throw new Error('ZIP 中未找到 ffmpeg 二进制文件')

      const buffer = zip.readFile(entry)
      if (!buffer) throw new Error('无法读取 ZIP 中的 ffmpeg 文件')
      await fs.writeFile(ffmpegPath, buffer)

      if (process.platform !== 'win32') {
        await fs.chmod(ffmpegPath, 0o755)
      }

      await this.verifyFFmpegBinary(ffmpegPath)
      await fs.unlink(tempZip).catch(() => {})
      this.closeDownloadWindow()
      return ffmpegPath
    } catch (error) {
      this.closeDownloadWindow()
      throw error
    } finally {
      this.downloadingPromise = null
    }
  }

  /**
   * 等待用户在下载窗口中点击确认按钮
   * 因为下载窗口启用了 sandbox + contextIsolation 且没有注入 preload，
   * 无法使用 ipcRenderer 通信，所以用 location.href 触发 will-navigate 事件作为替代。
   */
  private waitForUserConfirmation(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.downloadWindow) {
        return reject(new Error('下载窗口未创建'))
      }

      let confirmed = false

      this.downloadWindow.webContents.on('will-navigate', (event) => {
        event.preventDefault()
        confirmed = true
        resolve()
      })

      this.downloadWindow.once('closed', () => {
        this.downloadWindow = null
        if (!confirmed) reject(new Error('用户取消下载'))
      })
    })
  }

  /**
   * 流式下载文件，直接写磁盘避免大文件内存爆炸
   */
  private async streamDownload(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = net.request({ url, session: session.defaultSession })

      let totalBytes = 0
      let downloadedBytes = 0
      const writeStream = createWriteStream(destPath)
      let rejected = false

      const fail = (err: Error): void => {
        if (rejected) return
        rejected = true
        writeStream.destroy()
        reject(err)
      }

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          return fail(new Error(`HTTP ${response.statusCode}`))
        }

        const cl = response.headers['content-length']
        totalBytes = cl ? parseInt(String(cl), 10) : 0

        response.on('data', (chunk) => {
          writeStream.write(chunk)
          downloadedBytes += chunk.length
          if (totalBytes > 0) {
            this.updateProgress(Math.round((downloadedBytes / totalBytes) * 100))
          } else {
            this.updateProgressText(`下载中 ${(downloadedBytes / 1048576).toFixed(1)} MB`)
          }
        })

        response.on('end', () => writeStream.end(() => resolve()))
        response.on('error', (err) => fail(err))
      })

      request.on('error', (err) => fail(err))
      request.end()
    })
  }

  /**
   * 验证下载的 ffmpeg 二进制文件完整性
   */
  private async verifyFFmpegBinary(ffmpegPath: string): Promise<void> {
    const stat = await fs.stat(ffmpegPath)
    if (stat.size < 1024 * 1024) {
      await fs.unlink(ffmpegPath).catch(() => {})
      throw new Error('ffmpeg 文件过小，可能已损坏')
    }

    const { execFile } = await import('child_process')
    await new Promise<void>((resolve, reject) => {
      execFile(ffmpegPath, ['-version'], { timeout: 10000 }, (error, stdout) => {
        if (error || !stdout.includes('ffmpeg')) {
          fs.unlink(ffmpegPath).catch(() => {})
          reject(new Error('ffmpeg 验证失败，文件可能已损坏'))
        } else {
          resolve()
        }
      })
    })
  }

  // ── 下载窗口管理 ──

  private showDownloadWindow(): void {
    if (this.downloadWindow && !this.downloadWindow.isDestroyed()) {
      return
    }

    this.downloadWindow = new BrowserWindow({
      width: 500,
      height: 300,
      center: true,
      resizable: false,
      frame: false,
      alwaysOnTop: true,
      type: process.platform === 'darwin' ? 'panel' : 'toolbar',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    this.downloadWindow.loadFile(ffmpegDownloadHtml)

    this.downloadWindow.once('ready-to-show', () => {
      this.downloadWindow?.show()
    })
  }

  private updateProgress(percent: number): void {
    this.downloadWindow?.webContents
      .executeJavaScript(`if (window.downloadProgressing) window.downloadProgressing(${percent})`)
      .catch(() => {})
  }

  private updateProgressText(text: string): void {
    this.downloadWindow?.webContents
      .executeJavaScript(
        `if (window.downloadProgressText) window.downloadProgressText(${JSON.stringify(text)})`
      )
      .catch(() => {})
  }

  private showError(message: string): void {
    this.downloadWindow?.webContents
      .executeJavaScript(
        `if (window.downloadFailed) window.downloadFailed(${JSON.stringify(message)})`
      )
      .catch(() => {})
  }

  private closeDownloadWindow(): void {
    if (this.downloadWindow && !this.downloadWindow.isDestroyed()) {
      this.downloadWindow.close()
    }
    this.downloadWindow = null
  }
}

export default new FFmpegManager()
