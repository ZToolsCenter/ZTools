import { app, BrowserWindow } from 'electron'
import { platform } from '@electron-toolkit/utils'
import api from './api/index'
import pluginManager from './pluginManager'
import windowManager from './windowManager'
import appWatcher from './appWatcher'

// 开发模式下禁用某些警告
if (process.env.NODE_ENV !== 'production') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

// 导出函数供 API 使用
export function updateShortcut(shortcut: string): boolean {
  return windowManager.registerShortcut(shortcut)
}

export function getCurrentShortcut(): string {
  return windowManager.getCurrentShortcut()
}

app.whenReady().then(() => {
  // 隐藏 Dock 图标
  if (platform.isMacOS) {
    app.dock?.hide()
  }

  // 创建主窗口
  const mainWindow = windowManager.createWindow()

  // 初始化 API 和插件管理器
  if (mainWindow) {
    api.init(mainWindow, pluginManager)
    pluginManager.init(mainWindow)
    // 初始化应用目录监听器
    appWatcher.init(mainWindow)
  }

  // 注册全局快捷键
  windowManager.registerShortcut()

  // 创建系统托盘
  windowManager.createTray()
})

app.on('window-all-closed', () => {
  if (!platform.isMacOS) {
    app.quit()
  }
})

app.on('will-quit', () => {
  windowManager.unregisterAllShortcuts()
  // 停止应用目录监听
  appWatcher.stop()
})

app.on('before-quit', () => {
  windowManager.setQuitting(true)
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createWindow()
  }
})

// 开发模式下监听 Ctrl+C 信号
if (process.env.NODE_ENV !== 'production') {
  process.on('SIGINT', () => {
    console.log('收到 SIGINT 信号，退出应用')
    app.quit()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，退出应用')
    app.quit()
    process.exit(0)
  })
}
