import chokidar, { FSWatcher } from 'chokidar'
import path from 'path'
import { BrowserWindow } from 'electron'

class AppWatcher {
  private watcher: FSWatcher | null = null
  private mainWindow: BrowserWindow | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private readonly DEBOUNCE_DELAY = 1000 // 1秒防抖

  // 初始化监听器
  public init(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    this.startWatching()
  }

  // 启动监听
  private startWatching(): void {
    // 要监听的目录
    const watchPaths = ['/Applications', '/System/Applications', `${process.env.HOME}/Applications`]

    console.log('开始监听应用目录变化:', watchPaths)

    // 创建监听器,只监听 .app 目录
    this.watcher = chokidar.watch(watchPaths, {
      // 只监听目录的一级深度
      depth: 1,
      // 忽略非 .app 目录
      ignored: (filePath: string) => {
        const basename = path.basename(filePath)
        // 如果是根目录,不忽略
        if (watchPaths.includes(filePath)) {
          return false
        }
        // 只监听 .app 结尾的目录
        return !basename.endsWith('.app')
      },
      // 持久化监听
      persistent: true,
      // 忽略初始添加事件(避免启动时触发大量事件)
      ignoreInitial: true,
      // 使用轮询作为后备方案
      usePolling: false,
      // 监听文件夹事件
      followSymlinks: false,
      // 避免在 macOS 上出现问题
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    })

    // 监听添加事件
    this.watcher.on('addDir', (filePath: string) => {
      if (filePath.endsWith('.app')) {
        console.log('检测到新应用:', filePath)
        this.notifyChange('add', filePath)
      }
    })

    // 监听删除事件
    this.watcher.on('unlinkDir', (filePath: string) => {
      if (filePath.endsWith('.app')) {
        console.log('检测到应用删除:', filePath)
        this.notifyChange('remove', filePath)
      }
    })

    // 监听错误
    this.watcher.on('error', (error: unknown) => {
      console.error('应用目录监听错误:', error)
    })

    // 监听准备完成
    this.watcher.on('ready', () => {
      console.log('应用目录监听器已就绪')
    })
  }

  // 通知渲染进程应用列表变化(使用防抖避免频繁刷新)
  private notifyChange(type: 'add' | 'remove', filePath: string): void {
    // 清除之前的定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // 设置新的定时器
    this.debounceTimer = setTimeout(() => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        console.log(`通知渲染进程应用列表变化: ${type} ${filePath}`)
        this.mainWindow.webContents.send('apps-changed', {
          type,
          path: filePath
        })
      }
      this.debounceTimer = null
    }, this.DEBOUNCE_DELAY)
  }

  // 停止监听
  public stop(): void {
    if (this.watcher) {
      console.log('停止监听应用目录')
      this.watcher.close()
      this.watcher = null
    }

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
