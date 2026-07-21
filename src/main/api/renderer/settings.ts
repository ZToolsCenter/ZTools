import { app, globalShortcut, ipcMain, nativeTheme } from 'electron'
import fs from 'fs'
import type { PluginManager } from '../../managers/pluginManager'

// 共享API（主程序和插件都能用）
import {
  OptimizedShortcutManager,
  WindowManager as NativeWindowManager
} from '../../core/native/index.js'
import { getCurrentShortcut, updateShortcut } from '../../appMain.js'

import doubleTapManager from '../../core/doubleTapManager.js'
import proxyManager from '../../managers/proxyManager.js'
import windowManager from '../../managers/windowManager.js'
import { primeScreenCaptureFrame } from '../../core/screenCapture'
import type { GlobalShortcutPreparation } from '../index'
import api from '../index'
import databaseAPI from '../shared/database'

/**
 * 快捷键触发时携带的文件输入
 */
interface ShortcutInputFile {
  path: string
  name: string
  isDirectory: boolean
  isFile?: boolean
}

/**
 * 快捷键触发启动链路时使用的输入上下文
 */
interface ShortcutLaunchContext {
  searchQuery: string
  pastedImage: string | null
  pastedFiles: ShortcutInputFile[] | null
  pastedText: string | null
}

/**
 * 设置管理API - 主程序专用
 * 包含主题、快捷键、开机启动等设置
 */
export class SettingsAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: PluginManager | null = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: PluginManager): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
    this.loadAndApplySettings()
  }

  /**
   * 停止设置模块持有的 native 快捷键监听资源。
   */
  public cleanup(): void {
    if (process.platform === 'win32') {
      OptimizedShortcutManager.stopListener()
    }
    this.nativeOptimizedShortcutSet.clear()
  }

  // 临时快捷键录制相关
  private recordingShortcuts: string[] = []
  // 全局快捷键配置映射（存储每个快捷键的 autoCopy 等配置）
  private globalShortcutConfigs: Map<
    string,
    { autoCopy: boolean; preScreenshotOptimization: boolean }
  > = new Map()
  private globalShortcutTargets = new Map<string, string>()
  private globalShortcutPreparations = new Map<string, GlobalShortcutPreparation>()
  private nativeOptimizedShortcutSet = new Set<string>()
  private globalShortcutKeyboardStateReleasers = new Map<string, () => void>()
  // 全局快捷键触发流程执行中时，后续触发会被忽略，避免重复复制和重复启动。
  private isGlobalShortcutTriggering = false

  // 启动 native 优化快捷键监听，并把命中事件回流到既有执行链路。
  private setupOptimizedShortcutListener(): void {
    if (process.platform !== 'win32') {
      return
    }

    OptimizedShortcutManager.ensureListener(({ shortcut }) => {
      console.log(`[Settings] native 优化快捷键触发: ${shortcut}`)
      const preparation = this.globalShortcutPreparations.get(shortcut)
      if (!preparation) {
        console.warn(`[Settings] 未找到 native 优化快捷键预处理信息: ${shortcut}`)
        return
      }
      void this.triggerGlobalShortcut(shortcut, preparation, true)
    })
  }

  // 判断某个快捷键是否应由 native 接管监听。
  private shouldUseNativeOptimizedShortcut(
    shortcut: string,
    preScreenshotOptimization: boolean
  ): boolean {
    return (
      process.platform === 'win32' &&
      preScreenshotOptimization &&
      !this.isDoubleTapShortcut(shortcut)
    )
  }

  // 注册单个 native 优化快捷键，并确保底层监听存在。
  private registerNativeOptimizedShortcut(shortcut: string): void {
    this.setupOptimizedShortcutListener()
    const result = OptimizedShortcutManager.registerShortcut(shortcut)
    if (!result.success) {
      throw new Error(result.error || 'native 优化快捷键注册失败')
    }
    this.nativeOptimizedShortcutSet.add(shortcut)
  }

  // 注销单个 native 优化快捷键，并在为空时停止底层监听。
  private unregisterNativeOptimizedShortcut(shortcut: string): void {
    const result = OptimizedShortcutManager.unregisterShortcut(shortcut)
    if (!result.success) {
      throw new Error(result.error || 'native 优化快捷键注销失败')
    }
    this.nativeOptimizedShortcutSet.delete(shortcut)
    if (this.nativeOptimizedShortcutSet.size === 0) {
      OptimizedShortcutManager.stopListener()
    }
  }

  // 统一清理一个全局快捷键的运行时注册状态。
  private unregisterGlobalShortcutBackend(shortcut: string): void {
    if (this.isDoubleTapShortcut(shortcut)) {
      const modifier = this.getDoubleTapModifier(shortcut)
      doubleTapManager.unregister(modifier)
      return
    }

    if (this.nativeOptimizedShortcutSet.has(shortcut)) {
      this.unregisterNativeOptimizedShortcut(shortcut)
      return
    }

    globalShortcut.unregister(shortcut)
  }

  // 重新应用某个快捷键配置，必要时切换 Electron/native 后端。
  private async rebindGlobalShortcut(
    shortcut: string,
    force: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    const config = this.globalShortcutConfigs.get(shortcut)
    const target = this.globalShortcutTargets.get(shortcut)
    if (!config || !target) {
      return { success: false, error: '快捷键信息不存在' }
    }

    const previousWasNative = this.nativeOptimizedShortcutSet.has(shortcut)
    const nextUseNative = this.shouldUseNativeOptimizedShortcut(
      shortcut,
      config.preScreenshotOptimization
    )

    if (!force && previousWasNative === nextUseNative) {
      return { success: true }
    }

    this.unregisterGlobalShortcutBackend(shortcut)
    return await this.registerGlobalShortcut(
      shortcut,
      target,
      config.autoCopy,
      config.preScreenshotOptimization
    )
  }

  private setupIPC(): void {
    // 主题
    ipcMain.handle('set-theme', (_event, theme: string) => this.setTheme(theme))

    // 开机启动
    ipcMain.handle('set-launch-at-login', (_event, enable: boolean) =>
      this.setLaunchAtLogin(enable)
    )
    ipcMain.handle('get-launch-at-login', () => this.getLaunchAtLogin())

    // 快捷键
    ipcMain.handle('update-shortcut', (_event, shortcut: string) => this.updateShortcut(shortcut))
    ipcMain.handle('get-current-shortcut', () => this.getCurrentShortcutValue())
    ipcMain.handle(
      'register-global-shortcut',
      (
        _event,
        shortcut: string,
        target: string,
        autoCopy?: boolean,
        preScreenshotOptimization?: boolean
      ) =>
        this.registerGlobalShortcut(
          shortcut,
          target,
          autoCopy ?? false,
          preScreenshotOptimization ?? false
        )
    )
    ipcMain.handle('unregister-global-shortcut', (_event, shortcut: string) =>
      this.unregisterGlobalShortcut(shortcut)
    )
    ipcMain.handle(
      'update-global-shortcut-config',
      (
        _event,
        shortcut: string,
        config: { autoCopy: boolean; preScreenshotOptimization: boolean }
      ) => this.updateGlobalShortcutConfig(shortcut, config)
    )

    // 应用快捷键
    ipcMain.handle('register-app-shortcut', (_event, shortcut: string, target: string) =>
      this.registerAppShortcut(shortcut, target)
    )
    ipcMain.handle('unregister-app-shortcut', (_event, shortcut: string) =>
      this.unregisterAppShortcut(shortcut)
    )

    // 临时快捷键录制
    ipcMain.handle('start-hotkey-recording', () => this.startHotkeyRecording())
  }

  // 加载并应用设置
  private async loadAndApplySettings(): Promise<void> {
    try {
      const data = databaseAPI.dbGet('settings-general')
      console.log('[Settings] 加载到的设置:', data)
      // 应用托盘图标显示设置（默认显示，在 if(data) 块外确保首次启动也能创建托盘）
      windowManager.setTrayIconVisible(data?.showTrayIcon ?? true)
      console.log('[Settings] 启动时应用托盘图标显示设置:', data?.showTrayIcon ?? true)

      if (data) {
        // 应用透明度设置
        if (data.opacity !== undefined && this.mainWindow) {
          const clampedOpacity = Math.max(0.3, Math.min(1, data.opacity))
          this.mainWindow.setOpacity(clampedOpacity)
          console.log('[Settings] 启动时应用透明度设置:', data.opacity)
        }
        // 应用快捷键设置
        if (data.hotkey) {
          const success = updateShortcut(data.hotkey)
          console.log('[Settings] 启动时应用快捷键设置:', data.hotkey, success ? '成功' : '失败')
        }
        // 应用主题设置
        if (data.theme) {
          this.setTheme(data.theme)
          console.log('[Settings] 启动时应用主题设置:', data.theme)
        }
        // 应用自动返回搜索设置
        if (data.autoBackToSearch) {
          await windowManager.updateAutoBackToSearch(data.autoBackToSearch)
          console.log('[Settings] 启动时应用自动返回搜索设置:', data.autoBackToSearch)
        }
        // 应用窗口呼出位置策略设置
        if (data.windowPositionStrategy) {
          await windowManager.updateWindowPositionStrategy(data.windowPositionStrategy)
          console.log('[Settings] 启动时应用窗口呼出位置策略:', data.windowPositionStrategy)
        }
        // 应用代理配置
        if (data.proxyEnabled !== undefined && data.proxyUrl !== undefined) {
          proxyManager.setProxyConfig({
            enabled: data.proxyEnabled,
            url: data.proxyUrl
          })
          // 应用全局代理
          await proxyManager.applyProxyToDefaultSession()
          console.log('[Settings] 启动时应用代理配置:', {
            enabled: data.proxyEnabled,
            url: data.proxyUrl
          })
        }
        // 应用窗口默认高度设置
        if (data.windowDefaultHeight !== undefined) {
          this.pluginManager?.setPluginDefaultHeight(data.windowDefaultHeight)
          console.log('[Settings] 启动时应用插件默认高度设置:', data.windowDefaultHeight)
        }
      }

      // 窗口位置现在由 windowManager.moveWindowToCursor() 处理
      // 每个显示器会自动恢复该显示器上次保存的位置

      // 加载并注册全局快捷键
      await this.loadAndRegisterGlobalShortcuts()
      // 加载并注册应用快捷键
      await this.loadAndRegisterAppShortcuts()
    } catch (error) {
      console.error('[Settings] 加载设置失败:', error)
    }
  }

  // 加载并注册全局快捷键
  private async loadAndRegisterGlobalShortcuts(): Promise<void> {
    try {
      const shortcuts = databaseAPI.dbGet('global-shortcuts')
      if (shortcuts && Array.isArray(shortcuts)) {
        for (const shortcut of shortcuts) {
          if (shortcut.enabled && shortcut.shortcut && shortcut.target) {
            try {
              await this.registerGlobalShortcut(
                shortcut.shortcut,
                shortcut.target,
                shortcut.autoCopy ?? false,
                shortcut.preScreenshotOptimization ?? false
              )
            } catch (error) {
              console.error(`注册全局快捷键失败: ${shortcut.shortcut}`, error)
            }
          }
        }
      }
    } catch (error) {
      console.error('[Settings] 加载全局快捷键失败:', error)
    }
  }

  // 加载并注册应用快捷键
  private async loadAndRegisterAppShortcuts(): Promise<void> {
    try {
      const shortcuts = databaseAPI.dbGet('app-shortcuts')
      if (shortcuts && Array.isArray(shortcuts)) {
        for (const shortcut of shortcuts) {
          if (shortcut.enabled && shortcut.shortcut && shortcut.target) {
            try {
              this.registerAppShortcut(shortcut.shortcut, shortcut.target)
            } catch (error) {
              console.error(`注册应用快捷键失败: ${shortcut.shortcut}`, error)
            }
          }
        }
      }
    } catch (error) {
      console.error('[Settings] 加载应用快捷键失败:', error)
    }
  }

  // 设置主题
  public setTheme(theme: string): void {
    nativeTheme.themeSource = theme as 'system' | 'light' | 'dark'
    console.log('[Settings] 设置主题:', theme)
  }

  // 设置开机启动
  public setLaunchAtLogin(enable: boolean): void {
    app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: true
    })
    console.log('[Settings] 设置开机启动:', enable)
  }

  // 获取开机启动状态
  public getLaunchAtLogin(): boolean {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  }

  // 更新快捷键
  public updateShortcut(shortcut: string): { success: boolean; error?: string } {
    try {
      const success = updateShortcut(shortcut)
      if (success) {
        return { success: true }
      } else {
        return { success: false, error: '快捷键已被占用' }
      }
    } catch (error: unknown) {
      console.error('[Settings] 更新快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 获取当前快捷键
  public getCurrentShortcutValue(): string {
    return getCurrentShortcut()
  }

  private static readonly MODIFIER_NAMES = ['Command', 'Ctrl', 'Alt', 'Option', 'Shift']

  // 判断是否为双击修饰键快捷键（如 "Command+Command"）
  private isDoubleTapShortcut(shortcut: string): boolean {
    const parts = shortcut.split('+')
    return (
      parts.length === 2 && parts[0] === parts[1] && SettingsAPI.MODIFIER_NAMES.includes(parts[0])
    )
  }

  // 从双击快捷键字符串中提取修饰键名称
  private getDoubleTapModifier(shortcut: string): string {
    return shortcut.split('+')[0]
  }

  /**
   * 注册全局快捷键。
   * 触发时会按需采集当前外部应用中的选中文本，再把上下文交给上层统一处理。
   */
  public async registerGlobalShortcut(
    shortcut: string,
    target: string,
    autoCopy: boolean = false,
    preScreenshotOptimization: boolean = false
  ): Promise<any> {
    console.log(
      `[Settings] 注册全局快捷键: ${shortcut} -> ${target}, autoCopy: ${autoCopy}, preScreenshotOptimization: ${preScreenshotOptimization}`
    )

    try {
      // 存储快捷键配置
      this.globalShortcutConfigs.set(shortcut, { autoCopy, preScreenshotOptimization })
      this.globalShortcutTargets.set(shortcut, target)
      console.log('[Settings] 快捷键配置已存储到 Map')

      this.ensureGlobalShortcutKeyboardState(shortcut)
      const preparation = await api.prepareGlobalShortcut(target)
      this.globalShortcutPreparations.set(shortcut, preparation)

      const previousWasNative = this.nativeOptimizedShortcutSet.has(shortcut)
      const nextUseNative = this.shouldUseNativeOptimizedShortcut(
        shortcut,
        preScreenshotOptimization
      )

      // 重新注册前先切换掉该快捷键当前占用的监听后端，避免 native/Electron 双后端互相占用。
      if (previousWasNative !== nextUseNative) {
        this.unregisterGlobalShortcutBackend(shortcut)
      }

      if (this.isDoubleTapShortcut(shortcut)) {
        const modifier = this.getDoubleTapModifier(shortcut)
        doubleTapManager.unregister(modifier)
        doubleTapManager.register(modifier, () => {
          console.log(`双击修饰键触发: ${shortcut} -> ${target}`)
          void this.triggerGlobalShortcut(shortcut, preparation)
        })
        console.log(`成功注册双击修饰键快捷键: ${shortcut} -> ${target}`)
        return { success: true }
      }

      if (this.shouldUseNativeOptimizedShortcut(shortcut, preScreenshotOptimization)) {
        globalShortcut.unregister(shortcut)
        this.registerNativeOptimizedShortcut(shortcut)
        console.log(`成功注册 native 优化快捷键: ${shortcut} -> ${target}`)
        return { success: true }
      }

      // 先尝试取消注册该快捷键（如果已被注册），避免重复注册导致失败
      globalShortcut.unregister(shortcut)

      const success = globalShortcut.register(shortcut, () => {
        console.log(`全局快捷键触发: ${shortcut} -> ${target}`)
        void this.triggerGlobalShortcut(shortcut, preparation)
      })

      if (!success) {
        this.releaseGlobalShortcutKeyboardState(shortcut)
        this.globalShortcutConfigs.delete(shortcut)
        this.globalShortcutTargets.delete(shortcut)
        this.globalShortcutPreparations.delete(shortcut)
        return { success: false, error: '快捷键注册失败，可能已被其他应用占用' }
      }

      console.log(`成功注册全局快捷键: ${shortcut} -> ${target}`)
      return { success: true }
    } catch (error: unknown) {
      this.releaseGlobalShortcutKeyboardState(shortcut)
      this.globalShortcutConfigs.delete(shortcut)
      this.globalShortcutTargets.delete(shortcut)
      this.globalShortcutPreparations.delete(shortcut)
      this.nativeOptimizedShortcutSet.delete(shortcut)
      console.error('[Settings] 注册全局快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 注销全局快捷键
  public unregisterGlobalShortcut(shortcut: string): any {
    try {
      this.unregisterGlobalShortcutBackend(shortcut)
      this.releaseGlobalShortcutKeyboardState(shortcut)
      this.globalShortcutConfigs.delete(shortcut)
      this.globalShortcutTargets.delete(shortcut)
      this.globalShortcutPreparations.delete(shortcut)
      console.log(`成功注销全局快捷键: ${shortcut}`)
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 注销全局快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 更新全局快捷键的配置，并在后端需要切换时重新注册。
   */
  public async updateGlobalShortcutConfig(
    shortcut: string,
    config: { autoCopy: boolean; preScreenshotOptimization: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const previousConfig = this.globalShortcutConfigs.get(shortcut)
    const previousTarget = this.globalShortcutTargets.get(shortcut)
    const previousPreparation = this.globalShortcutPreparations.get(shortcut)

    try {
      console.log(
        `[Settings] 更新全局快捷键配置: ${shortcut}, autoCopy: ${config.autoCopy}, preScreenshotOptimization: ${config.preScreenshotOptimization}`
      )
      this.globalShortcutConfigs.set(shortcut, config)
      const rebindResult = await this.rebindGlobalShortcut(shortcut)
      if (!rebindResult.success) {
        if (previousConfig) {
          this.globalShortcutConfigs.set(shortcut, previousConfig)
          if (previousTarget) {
            this.globalShortcutTargets.set(shortcut, previousTarget)
          }
          if (previousPreparation) {
            this.globalShortcutPreparations.set(shortcut, previousPreparation)
          }
          await this.rebindGlobalShortcut(shortcut, true)
        }
        return rebindResult
      }
      console.log('[Settings] 配置更新成功')
      return { success: true }
    } catch (error: unknown) {
      if (previousConfig) {
        this.globalShortcutConfigs.set(shortcut, previousConfig)
        if (previousTarget) {
          this.globalShortcutTargets.set(shortcut, previousTarget)
        }
        if (previousPreparation) {
          this.globalShortcutPreparations.set(shortcut, previousPreparation)
        }
        await this.rebindGlobalShortcut(shortcut, true)
      }
      console.error('[Settings] 更新全局快捷键配置失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 为已注册的全局快捷键持有键盘状态监听。
   * 这样触发时可以直接读取完整的按键释放状态，不必临时启动监听。
   */
  private ensureGlobalShortcutKeyboardState(shortcut: string): void {
    this.releaseGlobalShortcutKeyboardState(shortcut)
    this.globalShortcutKeyboardStateReleasers.set(shortcut, doubleTapManager.acquireKeyboardState())
  }

  /**
   * 释放某个全局快捷键持有的键盘状态监听引用。
   */
  private releaseGlobalShortcutKeyboardState(shortcut: string): void {
    const release = this.globalShortcutKeyboardStateReleasers.get(shortcut)
    if (!release) {
      return
    }

    release()
    this.globalShortcutKeyboardStateReleasers.delete(shortcut)
  }

  /**
   * 处理全局快捷键的统一触发入口。
   * 仅在目标命令需要文本上下文时才会执行复制取词，避免无关快捷键产生副作用。
   */
  private async triggerGlobalShortcut(
    shortcut: string,
    preparation: GlobalShortcutPreparation,
    skipPrime: boolean = false
  ): Promise<void> {
    if (!this.shouldTriggerGlobalShortcut(preparation.target)) {
      console.log(`[Settings] 上一次全局快捷键流程未完成，忽略本次触发: ${shortcut}`)
      return
    }

    this.isGlobalShortcutTriggering = true

    try {
      // 读取该快捷键的 autoCopy 配置，默认 false
      const config = this.globalShortcutConfigs.get(shortcut)
      const autoCopy = config?.autoCopy ?? false
      const preScreenshotOptimization = config?.preScreenshotOptimization ?? false

      console.log(`[Settings] 快捷键触发: ${shortcut}`)
      console.log(`[Settings] 指令类型需要文本: ${preparation.shouldCaptureSelectedText}`)
      console.log(`[Settings] 用户启用自动复制: ${autoCopy}`)
      console.log(`[Settings] 用户启用预截图优化: ${preScreenshotOptimization}`)

      if (preScreenshotOptimization && !skipPrime) {
        primeScreenCaptureFrame()
      }

      // 双重判断：指令类型需要文本 AND 用户启用自动复制
      const shouldCapture = preparation.shouldCaptureSelectedText && autoCopy

      console.log(`[Settings] 最终是否执行取词: ${shouldCapture}`)

      const context = shouldCapture ? await this.captureSelectedTextContext() : undefined
      await this.handleGlobalShortcut(preparation.target, context)
    } finally {
      this.isGlobalShortcutTriggering = false
    }
  }

  /**
   * 判断某个快捷键目标是否允许在阻断期内再次触发。
   * 若上一次全局快捷键流程尚未完成，直接忽略新的触发，避免重复取词和重复启动。
   */
  private shouldTriggerGlobalShortcut(_target: string): boolean {
    return !this.isGlobalShortcutTriggering
  }

  /**
   * 获取当前选中内容并转换成快捷键启动上下文。
   * 使用 native getSelectedContent() 方法，自动处理剪贴板暂停；调用前需等待修饰键释放。
   */
  private async captureSelectedTextContext(): Promise<ShortcutLaunchContext> {
    console.log('[Settings] 开始捕获选中内容...')
    try {
      const modifiersReleased = await doubleTapManager.waitForModifierKeysReleased()
      if (!modifiersReleased) {
        console.warn('[Settings] 修饰键未在限定时间内抬起，跳过本次取词')
        return {
          searchQuery: '',
          pastedImage: null,
          pastedFiles: null,
          pastedText: null
        }
      }

      const contents = NativeWindowManager.getSelectedContent()

      // 防御性检查：确保 contents 是有效数组
      if (!Array.isArray(contents)) {
        console.log('[Settings] 未捕获到任何内容 (contents 不是数组)')
        return {
          searchQuery: '',
          pastedImage: null,
          pastedFiles: null,
          pastedText: null
        }
      }

      console.log('[Settings] 捕获到内容数量:', contents.length)

      // 处理文件内容
      const fileContent = contents.find((item) => item.type === 'file')
      if (fileContent && fileContent.type === 'file') {
        console.log('[Settings] 捕获到文件，数量:', fileContent.data.length)
        const files = fileContent.data.map((filePath) => {
          let isDirectory = false
          try {
            isDirectory = fs.statSync(filePath).isDirectory()
          } catch (e) {
            // 忽略读取失败的情况，默认设为 false
            console.warn(`[Settings] 无法读取文件状态: ${filePath}`, e)
          }
          return {
            path: filePath,
            name: filePath.split(/[/\\]/).pop() || '',
            isDirectory,
            isFile: !isDirectory
          }
        })
        return {
          searchQuery: '',
          pastedImage: null,
          pastedFiles: files,
          pastedText: null
        }
      }

      // 处理图片内容
      const imageContent = contents.find((item) => item.type === 'image')
      if (imageContent && imageContent.type === 'image') {
        console.log('[Settings] 捕获到图片')
        return {
          searchQuery: '',
          pastedImage: imageContent.data,
          pastedFiles: null,
          pastedText: null
        }
      }

      // 处理文本内容
      const textContent = contents.find((item) => item.type === 'text')
      if (textContent && textContent.type === 'text') {
        const text = textContent.data
        console.log('[Settings] 捕获到文本，长度:', text.length)
        if (text.trim()) {
          console.log('[Settings] 文本捕获成功')
          return {
            searchQuery: text,
            pastedImage: null,
            pastedFiles: null,
            pastedText: text
          }
        } else {
          console.log('[Settings] 文本为空')
        }
      }

      console.log('[Settings] 未捕获到任何内容')
    } catch (error) {
      console.error('[Settings] 获取选中内容失败:', error)
    }

    return {
      searchQuery: '',
      pastedImage: null,
      pastedFiles: null,
      pastedText: null
    }
  }

  /**
   * 处理全局快捷键触发。
   * 兼容普通全局快捷键和双击修饰键快捷键，统一向上层传递目标与上下文。
   */
  private async handleGlobalShortcut(
    target: string,
    context?: ShortcutLaunchContext
  ): Promise<void> {
    if (this.onGlobalShortcutTriggered) {
      await this.onGlobalShortcutTriggered(target, context)
    }
  }

  // 外部回调（由 APIManager 设置）
  private onGlobalShortcutTriggered?: (
    target: string,
    context?: ShortcutLaunchContext
  ) => void | Promise<void>

  /**
   * 设置全局快捷键触发后的统一回调。
   * 上层可根据目标命令和上下文完成最终启动。
   */
  public setGlobalShortcutHandler(
    handler: (target: string, context?: ShortcutLaunchContext) => void | Promise<void>
  ): void {
    this.onGlobalShortcutTriggered = handler
  }

  // 开始快捷键录制（注册临时快捷键监听）
  public startHotkeyRecording(): { success: boolean; error?: string } {
    try {
      // 如果已经在录制，先注销之前的临时快捷键
      if (this.recordingShortcuts.length > 0) {
        this.cleanupRecordingShortcuts()
      }

      // 定义需要临时注册的快捷键（常见的快捷键组合）
      const commonShortcuts = ['Alt+Space', 'Option+Space']

      // 注册所有快捷键
      for (const shortcut of commonShortcuts) {
        try {
          const success = globalShortcut.register(shortcut, () => {
            // 快捷键被触发，发送到设置插件
            console.log(`临时快捷键触发: ${shortcut}`)

            // 获取设置插件的 webContents 并发送事件
            if (this.pluginManager) {
              const settingWebContents = this.pluginManager.getPluginWebContentsByName('setting')
              if (settingWebContents) {
                settingWebContents.send('hotkey-recorded', shortcut)
              } else {
                console.warn('[Settings] 设置插件未找到，无法发送快捷键录制事件')
              }
            }

            // 立即注销所有临时快捷键（只能触发一次）
            this.cleanupRecordingShortcuts()
          })

          if (success) {
            this.recordingShortcuts.push(shortcut)
            console.log(`成功注册临时快捷键: ${shortcut}`)
          } else {
            console.warn(`临时快捷键注册失败（可能已被占用）: ${shortcut}`)
          }
        } catch (error) {
          console.error(`注册临时快捷键失败: ${shortcut}`, error)
        }
      }

      console.log(`开始快捷键录制，已注册 ${this.recordingShortcuts.length} 个临时快捷键`)
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 开始快捷键录制失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 清理临时快捷键（内部方法）
  private cleanupRecordingShortcuts(): void {
    for (const shortcut of this.recordingShortcuts) {
      try {
        globalShortcut.unregister(shortcut)
        console.log(`成功注销临时快捷键: ${shortcut}`)
      } catch (error) {
        console.error(`注销临时快捷键失败: ${shortcut}`, error)
      }
    }

    const count = this.recordingShortcuts.length
    this.recordingShortcuts = []
    console.log(`已清理 ${count} 个临时快捷键`)
  }

  // 设置代理配置
  public async setProxyConfig(config: {
    enabled: boolean
    url: string
  }): Promise<{ success: boolean; error?: string }> {
    try {
      proxyManager.setProxyConfig(config)
      console.log('[Settings] 代理配置已更新:', config)

      // 应用全局代理配置
      await proxyManager.applyProxyToDefaultSession()

      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 设置代理配置失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 设置窗口默认高度
  public setWindowDefaultHeight(height: number): { success: boolean; error?: string } {
    try {
      this.pluginManager?.setPluginDefaultHeight(height)
      console.log('[Settings] 插件默认高度已更新:', height)
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 设置插件默认高度失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 注册应用快捷键
  public registerAppShortcut(shortcut: string, target: string): any {
    try {
      const success = windowManager.registerAppShortcut(shortcut, target)
      if (!success) {
        return { success: false, error: '应用快捷键注册失败' }
      }
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 注册应用快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  // 注销应用快捷键
  public unregisterAppShortcut(shortcut: string): any {
    try {
      windowManager.unregisterAppShortcut(shortcut)
      console.log(`成功注销应用快捷键: ${shortcut}`)
      return { success: true }
    } catch (error: unknown) {
      console.error('[Settings] 注销应用快捷键失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }
}

export default new SettingsAPI()
