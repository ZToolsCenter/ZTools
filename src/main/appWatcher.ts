import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import appsAPI from './api/renderer/commands'
import {
  getMacApplicationPaths,
  getWindowsRootScanPaths,
  getWindowsScanPaths
} from './utils/systemPaths'

// 要跳过的文件夹名称
const SKIP_FOLDERS = [
  'sdk',
  'doc',
  'docs',
  'samples',
  'sample',
  'examples',
  'example',
  'demos',
  'demo',
  'documentation'
]

class AppWatcher {
  private recursiveWatcher: FSWatcher | null = null
  private flatRootWatcher: FSWatcher | null = null
  private mainWindow: BrowserWindow | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private started = false
  private readonly DEBOUNCE_DELAY = 1000 // 1秒防抖

  // 初始化监听器
  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    if (this.started) {
      return
    }
    this.started = true
    this.startWatching()
  }

  // 获取递归监听路径
  private getRecursiveWatchPaths(): string[] {
    if (process.platform === 'win32') {
      return getWindowsScanPaths()
    }

    if (process.platform === 'darwin') {
      return getMacApplicationPaths()
    }

    return []
  }

  // 获取扁平根监听路径
  private getFlatRootWatchPaths(): string[] {
    if (process.platform === 'win32') {
      return getWindowsRootScanPaths()
    }

    return []
  }

  // 判断是否应该忽略
  private shouldIgnore(filePath: string, watchPaths: string[]): boolean {
    const basename = path.basename(filePath)

    // 如果是根目录,不忽略
    if (watchPaths.includes(filePath)) {
      return false
    }

    if (process.platform === 'win32') {
      // Windows: 跳过文档、示例等文件夹
      const pathParts = filePath.split(path.sep)
      for (const part of pathParts) {
        if (SKIP_FOLDERS.includes(part.toLowerCase())) {
          return true
        }
      }
      // 只监听 .lnk 文件和目录
      try {
        const stats = fs.statSync(filePath)
        return !stats.isDirectory() && !filePath.endsWith('.lnk')
      } catch {
        return false
      }
    }

    if (process.platform === 'darwin') {
      // .app 目录始终监听（无论位于顶层还是 PWA 容器内）
      if (basename.endsWith('.app')) {
        return false
      }

      // 放行 watch 根目录下的「顶层子目录」（如 Chrome Apps.localized / Edge Apps.localized），
      // 让 chokidar 下钻一层从而能检测到容器内 PWA 的增删。
      // 仅放行目录、不放行文件（如 .DS_Store）；容器内部 / .app 内部仍只关心 .app。
      const parent = path.dirname(filePath)
      if (watchPaths.includes(parent)) {
        try {
          return !fs.statSync(filePath).isDirectory()
        } catch {
          // stat 失败（如 unlink 事件时目录已不存在）：不忽略，交由上层按 .app 后缀判断
          return false
        }
      }

      return true
    }

    return true
  }

  // 启动监听
  private startWatching(): void {
    const recursivePaths = this.getRecursiveWatchPaths()
    const flatRootPaths = this.getFlatRootWatchPaths()
    const isWindows = process.platform === 'win32'

    console.log('[AppWatcher] 开始监听应用目录变化(递归):', recursivePaths)
    console.log('[AppWatcher] 开始监听应用目录变化(扁平根):', flatRootPaths)

    // 递归 watcher
    // Windows 需要递归监听子目录，macOS 只需要一级
    this.recursiveWatcher = this.createWatcher(recursivePaths, isWindows ? 5 : 1, isWindows)

    // 扁平根 watcher
    if (flatRootPaths.length > 0) {
      this.flatRootWatcher = this.createWatcher(flatRootPaths, 0, isWindows)
    }

    this.bindWatcherEvents(this.recursiveWatcher)
    if (this.flatRootWatcher) {
      this.bindWatcherEvents(this.flatRootWatcher)
    }
  }

  private createWatcher(watchPaths: string[], depth: number, usePolling: boolean): FSWatcher {
    return chokidar.watch(watchPaths, {
      depth,
      // 忽略规则
      ignored: (filePath: string) => {
        return this.shouldIgnore(filePath, watchPaths)
      },
      // 持久化监听
      persistent: true,
      // 忽略初始添加事件(避免启动时触发大量事件)
      ignoreInitial: true,
      // Windows 使用轮询避免 fs.watch 占用文件夹句柄导致无法重命名/删除
      usePolling,
      interval: usePolling ? 5000 : undefined,
      binaryInterval: usePolling ? 5000 : undefined,
      // 监听文件夹事件
      followSymlinks: false,
      // 避免在 macOS 上出现问题
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    })
  }

  private bindWatcherEvents(watcher: FSWatcher): void {
    // 监听添加事件
    if (process.platform === 'win32') {
      // Windows: 监听 .lnk 文件
      watcher.on('add', (filePath: string) => {
        if (filePath.endsWith('.lnk')) {
          console.log('[AppWatcher] 检测到新快捷方式:', filePath)
          this.notifyChange('add', filePath)
        }
      })
    }

    if (process.platform === 'darwin') {
      // macOS: 监听 .app 目录
      watcher.on('addDir', (filePath: string) => {
        if (filePath.endsWith('.app')) {
          console.log('[AppWatcher] 检测到新应用:', filePath)
          this.notifyChange('add', filePath)
        }
      })
    }

    // 监听删除事件
    if (process.platform === 'win32') {
      // Windows: 监听 .lnk 文件删除
      watcher.on('unlink', (filePath: string) => {
        if (filePath.endsWith('.lnk')) {
          console.log('[AppWatcher] 检测到快捷方式删除:', filePath)
          this.notifyChange('remove', filePath)
        }
      })
    }

    if (process.platform === 'darwin') {
      // macOS: 监听 .app 目录删除
      watcher.on('unlinkDir', (filePath: string) => {
        if (filePath.endsWith('.app')) {
          console.log('[AppWatcher] 检测到应用删除:', filePath)
          this.notifyChange('remove', filePath)
        }
      })
    }

    // 监听错误
    watcher.on('error', (error: unknown) => {
      console.error('[AppWatcher] 应用目录监听错误:', error)
    })

    // 监听准备完成
    watcher.on('ready', () => {
      console.log('[AppWatcher] 应用目录监听器已就绪')
    })
  }

  // 通知渲染进程应用列表变化(使用防抖避免频繁刷新)
  private notifyChange(type: 'add' | 'remove', filePath: string): void {
    // 清除之前的定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // 设置新的定时器
    this.debounceTimer = setTimeout(async () => {
      console.log(`[AppWatcher] 检测到应用变化: ${type} ${filePath}`)

      // 刷新应用缓存
      await appsAPI.refreshAppsCache()

      this.debounceTimer = null
    }, this.DEBOUNCE_DELAY)
  }

  // 停止监听
  public stop(): void {
    const watchers = [this.recursiveWatcher, this.flatRootWatcher]
    for (const watcher of watchers) {
      if (watcher) {
        console.log('[AppWatcher] 停止监听应用目录')
        watcher.close()
      }
    }
    this.recursiveWatcher = null
    this.flatRootWatcher = null
    this.started = false

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  // 重启监听
  public restart(): void {
    this.stop()
    if (this.mainWindow) {
      this.startWatching()
    }
  }
}

export default new AppWatcher()
