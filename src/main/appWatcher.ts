import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import appsAPI from './api/renderer/commands'
import {
  startUwpPackageMonitor,
  stopUwpPackageMonitor,
  type UwpPackageChangeEvent
} from './core/uwpPackageMonitor'
import {
  getMacApplicationPaths,
  getWindowsFlatScanPaths,
  getWindowsRecursiveScanPaths
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
  private pendingRefreshType: 'full' | 'uwp' | null = null
  private started = false
  private readonly DEBOUNCE_DELAY = 1000 // 1秒防抖

  /**
   * 初始化应用目录与 UWP 包变化监听器。
   *
   * @param mainWindow 接收应用列表变化通知的主窗口。
   * @returns 无返回值。
   */
  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    if (this.started) {
      return
    }
    this.started = true
    this.startWatching()
  }

  /**
   * 获取当前平台需要递归监听的应用目录。
   *
   * @returns 递归监听路径；不支持的平台返回空数组。
   */
  private getRecursiveWatchPaths(): string[] {
    if (process.platform === 'win32') {
      return getWindowsRecursiveScanPaths()
    }

    if (process.platform === 'darwin') {
      return getMacApplicationPaths()
    }

    return []
  }

  /**
   * 获取 Windows 只监听顶层的桌面路径。
   *
   * @returns 扁平监听路径；非 Windows 平台返回空数组。
   */
  private getFlatRootWatchPaths(): string[] {
    if (process.platform === 'win32') {
      return getWindowsFlatScanPaths()
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

  /**
   * 启动当前平台支持的应用目录和包注册变化监听。
   *
   * @returns 无返回值。
   */
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

    // UWP 不一定创建或更新 .lnk，需要单独监听当前用户的包注册完成事件。
    this.startUwpPackageMonitor()
  }

  /**
   * 启动 Windows PackageCatalog 监听，并把完成事件合并到应用缓存刷新队列。
   *
   * @returns 无返回值；初始化失败时记录日志并保留启动校验兜底。
   */
  private startUwpPackageMonitor(): void {
    if (process.platform !== 'win32') return

    try {
      startUwpPackageMonitor((event: UwpPackageChangeEvent) => {
        console.log('[AppWatcher] 检测到 UWP 包变化完成:', event)
        this.notifyChange('package', event.packageFullName)
      })
      console.log('[AppWatcher] UWP PackageCatalog 监听器已就绪')

      // 订阅成功后再次比较快照，补偿启动扫描与监听建立之间发生的变化。
      void appsAPI.refreshAppsCacheIfUwpPackagesChanged()
    } catch (error) {
      // PackageCatalog 不可用时不影响主程序，启动缓存校验仍会修复离线更新。
      console.error('[AppWatcher] UWP PackageCatalog 监听启动失败:', error)
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

  /**
   * 合并短时间内的应用变化并刷新持久化应用缓存。
   *
   * @param type 文件添加、删除或 UWP 包注册变化类型。
   * @param sourcePath 触发变化的快捷方式路径或包完整名。
   * @returns 无返回值。
   */
  private notifyChange(type: 'add' | 'remove' | 'package', sourcePath: string): void {
    // 同一防抖窗口内只要出现快捷方式变化，就必须执行覆盖面更完整的 Win32 扫描。
    if (type !== 'package' || this.pendingRefreshType === 'full') {
      this.pendingRefreshType = 'full'
    } else {
      this.pendingRefreshType = 'uwp'
    }

    // 清除之前的定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // 设置新的定时器
    this.debounceTimer = setTimeout(async () => {
      console.log(`[AppWatcher] 检测到应用变化: ${type} ${sourcePath}`)
      const refreshType = this.pendingRefreshType

      // 先释放防抖状态，让刷新执行期间到达的新事件能够进入下一轮。
      this.pendingRefreshType = null
      this.debounceTimer = null

      // UWP 包变化只替换 UWP 条目，快捷方式变化才执行 Win32 全量扫描。
      if (refreshType === 'uwp') {
        await appsAPI.refreshUwpAppsCache()
      } else {
        await appsAPI.refreshAppsCache()
      }
    }, this.DEBOUNCE_DELAY)
  }

  /**
   * 停止全部应用变化监听并清理尚未执行的刷新任务。
   *
   * @returns 无返回值。
   */
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

    if (process.platform === 'win32') {
      try {
        // 先撤销 PackageCatalog 订阅，阻止退出期间继续排入刷新任务。
        stopUwpPackageMonitor()
      } catch (error) {
        console.error('[AppWatcher] 停止 UWP PackageCatalog 监听失败:', error)
      }
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingRefreshType = null
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
