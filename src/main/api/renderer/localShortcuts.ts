import { app, ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { pinyin as getPinyin } from 'pinyin-pro'
import databaseAPI from '../shared/database'
import { openDialog } from '../../utils/windowUtils'

/**
 * 本地启动项类型
 */
export interface LocalShortcut {
  id: string // 唯一标识
  name: string // 显示名称（文件名）
  alias?: string // 别名（用户自定义，优先用于搜索和显示）
  path: string // 完整路径
  type: 'file' | 'folder' | 'app' // 类型
  icon?: string // 图标路径（可选）
  keywords?: string[] // 搜索关键词
  pinyin?: string // 拼音（基于 alias || name）
  pinyinAbbr?: string // 拼音首字母（基于 alias || name）
  addedAt: number // 添加时间戳
}

const LOCAL_SHORTCUTS_KEY = 'local-shortcuts'

/**
 * 本地启动 API - 主程序专用
 */
export class LocalShortcutsAPI {
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow): void {
    this.mainWindow = mainWindow
    this.setupIPC()
  }

  private setupIPC(): void {
    ipcMain.handle('local-shortcuts:get-all', () => this.getAllShortcuts())
    ipcMain.handle('local-shortcuts:add', (_event, type: 'file' | 'folder') =>
      this.addShortcut(type)
    )
    ipcMain.handle('local-shortcuts:add-by-path', (_event, filePath: string) =>
      this.addShortcutByPath(filePath)
    )
    ipcMain.handle('local-shortcuts:delete', (_event, id: string) => this.deleteShortcut(id))
    ipcMain.handle('local-shortcuts:delete-when-not-exist', (_event) =>
      this.deleteNotExistShortcut()
    )
    ipcMain.handle('local-shortcuts:open', (_event, shortcutPath: string) =>
      this.openShortcut(shortcutPath)
    )
    ipcMain.handle('local-shortcuts:update-alias', (_event, id: string, alias: string) =>
      this.updateAlias(id, alias)
    )
  }

  /**
   * 获取所有本地启动项
   */
  public getAllShortcuts(): LocalShortcut[] {
    try {
      const shortcuts = databaseAPI.dbGet(LOCAL_SHORTCUTS_KEY)
      return shortcuts || []
    } catch (error) {
      console.error('[LocalShortcut] 获取本地启动项失败:', error)
      return []
    }
  }

  /**
   * 添加本地启动项（通过文件选择对话框）
   */
  private async addShortcut(
    type: 'file' | 'folder'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.mainWindow) {
        return { success: false, error: '主窗口未初始化' }
      }

      // 根据类型设置对话框属性
      let properties: Array<'openFile' | 'openDirectory'>
      if (type === 'folder') {
        // 只选择文件夹
        properties = ['openDirectory']
      } else {
        properties = ['openFile']
      }
      // 打开文件选择对话框
      const result = await openDialog(
        this.mainWindow,
        {
          title: type === 'folder' ? '选择文件夹' : '选择文件或应用',
          properties
        },
        '用户取消选择'
      )
      if (!result.success) {
        return result
      }
      const selectedPath = result.data!.filePaths[0]

      // 获取文件信息
      const stats = await fs.stat(selectedPath)
      const baseNameWithExt = path.basename(selectedPath)
      // 去掉后缀名
      const fileName = path.parse(baseNameWithExt).name

      // 判断类型
      let itemType: 'file' | 'folder' | 'app'
      if (stats.isDirectory()) {
        // 检查是否为 macOS 应用
        if (process.platform === 'darwin' && selectedPath.endsWith('.app')) {
          itemType = 'app'
        } else {
          itemType = 'folder'
        }
      } else {
        // Windows 可执行文件或快捷方式视为应用
        if (
          process.platform === 'win32' &&
          (selectedPath.endsWith('.exe') || selectedPath.endsWith('.lnk'))
        ) {
          itemType = 'app'
        } else {
          itemType = 'file'
        }
      }

      // 获取文件图标
      let icon: string | undefined
      if (itemType === 'app') {
        // 应用程序使用 ztools-icon:// 协议（与系统应用扫描器一致）
        if (process.platform === 'darwin') {
          // macOS: 直接使用 .app 路径，由原生层提取图标
          icon = `ztools-icon://${encodeURIComponent(selectedPath)}`
        } else {
          // Windows: 直接使用 .exe 或 .lnk 路径
          icon = `ztools-icon://${encodeURIComponent(selectedPath)}`
        }
      } else if (itemType === 'folder' && process.platform === 'win32') {
        // Windows 文件夹：使用 ztools-icon:// 协议获取系统文件夹图标
        icon = `ztools-icon://${encodeURIComponent(selectedPath)}`
      } else {
        // 其他情况（macOS 文件夹、普通文件）使用 app.getFileIcon 获取系统图标
        try {
          const iconData = await app.getFileIcon(selectedPath, { size: 'normal' })
          icon = iconData.toDataURL()
        } catch (error) {
          console.warn('[LocalShortcut] 获取文件图标失败:', error)
        }
      }

      // 生成拼音
      const pinyinFull = getPinyin(fileName, { toneType: 'none', type: 'array' }).join('')
      const pinyinAbbr = getPinyin(fileName, { pattern: 'first', toneType: 'none' })
        .split(' ')
        .join('')

      // 创建本地启动项
      const shortcut: LocalShortcut = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: fileName,
        path: selectedPath,
        type: itemType,
        icon,
        keywords: [fileName],
        pinyin: pinyinFull,
        pinyinAbbr,
        addedAt: Date.now()
      }

      // 读取现有列表
      const shortcuts = this.getAllShortcuts()

      // 检查是否已存在
      const exists = shortcuts.some((s) => s.path === selectedPath)
      if (exists) {
        return { success: false, error: '该项目已存在' }
      }

      // 添加到列表
      shortcuts.push(shortcut)

      // 保存到数据库
      databaseAPI.dbPut(LOCAL_SHORTCUTS_KEY, shortcuts)

      console.log('[LocalShortcut] 添加本地启动项成功:', shortcut.name)

      // 通知渲染进程刷新本地启动项
      this.mainWindow?.webContents.send('local-shortcuts-changed')

      return { success: true }
    } catch (error) {
      console.error('[LocalShortcut] 添加本地启动项失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 添加本地启动项（通过文件路径）
   */
  private async addShortcutByPath(
    selectedPath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 获取文件信息
      const stats = await fs.stat(selectedPath)
      const baseNameWithExt = path.basename(selectedPath)
      // 去掉后缀名
      const fileName = path.parse(baseNameWithExt).name

      // 判断类型
      let itemType: 'file' | 'folder' | 'app'
      if (stats.isDirectory()) {
        // 检查是否为 macOS 应用
        if (process.platform === 'darwin' && selectedPath.endsWith('.app')) {
          itemType = 'app'
        } else {
          itemType = 'folder'
        }
      } else {
        // Windows 可执行文件或快捷方式视为应用
        if (
          process.platform === 'win32' &&
          (selectedPath.endsWith('.exe') || selectedPath.endsWith('.lnk'))
        ) {
          itemType = 'app'
        } else {
          itemType = 'file'
        }
      }

      // 获取文件图标
      let icon: string | undefined
      if (itemType === 'app') {
        // 应用程序使用 ztools-icon:// 协议（与系统应用扫描器一致）
        if (process.platform === 'darwin') {
          // macOS: 直接使用 .app 路径，由原生层提取图标
          icon = `ztools-icon://${encodeURIComponent(selectedPath)}`
        } else {
          // Windows: 直接使用 .exe 或 .lnk 路径
          icon = `ztools-icon://${encodeURIComponent(selectedPath)}`
        }
      } else if (itemType === 'folder' && process.platform === 'win32') {
        // Windows 文件夹：使用 ztools-icon:// 协议获取系统文件夹图标
        icon = `ztools-icon://${encodeURIComponent(selectedPath)}`
      } else {
        // 其他情况（macOS 文件夹、普通文件）使用 app.getFileIcon 获取系统图标
        try {
          const iconData = await app.getFileIcon(selectedPath, { size: 'normal' })
          icon = iconData.toDataURL()
        } catch (error) {
          console.warn('[LocalShortcut] 获取文件图标失败:', error)
        }
      }

      // 生成拼音
      const pinyinFull = getPinyin(fileName, { toneType: 'none', type: 'array' }).join('')
      const pinyinAbbr = getPinyin(fileName, { pattern: 'first', toneType: 'none' })
        .split(' ')
        .join('')

      // 创建本地启动项
      const shortcut: LocalShortcut = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: fileName,
        path: selectedPath,
        type: itemType,
        icon,
        keywords: [fileName],
        pinyin: pinyinFull,
        pinyinAbbr,
        addedAt: Date.now()
      }

      // 读取现有列表
      const shortcuts = this.getAllShortcuts()

      // 检查是否已存在
      const exists = shortcuts.some((s) => s.path === selectedPath)
      if (exists) {
        return { success: false, error: '该项目已存在' }
      }

      // 添加到列表
      shortcuts.push(shortcut)

      // 保存到数据库
      databaseAPI.dbPut(LOCAL_SHORTCUTS_KEY, shortcuts)

      console.log('[LocalShortcut] 添加本地启动项成功:', shortcut.name)

      // 通知渲染进程刷新本地启动项
      this.mainWindow?.webContents.send('local-shortcuts-changed')

      return { success: true }
    } catch (error) {
      console.error('[LocalShortcut] 添加本地启动项失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 删除本地启动项
   */
  private async deleteShortcut(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const shortcuts = this.getAllShortcuts()
      const filtered = shortcuts.filter((s) => s.id !== id)

      if (filtered.length === shortcuts.length) {
        return { success: false, error: '未找到该项目' }
      }

      databaseAPI.dbPut(LOCAL_SHORTCUTS_KEY, filtered)

      console.log('[LocalShortcut] 删除本地启动项成功:', id)

      // 通知渲染进程刷新本地启动项
      this.mainWindow?.webContents.send('local-shortcuts-changed')

      return { success: true }
    } catch (error) {
      console.error('[LocalShortcut] 删除本地启动项失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 更新本地启动项别名
   */
  private async updateAlias(
    id: string,
    alias: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const shortcuts = this.getAllShortcuts()
      const shortcut = shortcuts.find((s) => s.id === id)

      if (!shortcut) {
        return { success: false, error: '未找到该项目' }
      }

      // 设置别名（空字符串则清除别名）
      const trimmedAlias = alias.trim()
      shortcut.alias = trimmedAlias || undefined

      // 重新生成拼音（基于 alias || name）
      const displayName = shortcut.alias || shortcut.name
      shortcut.pinyin = getPinyin(displayName, { toneType: 'none', type: 'array' }).join('')
      shortcut.pinyinAbbr = getPinyin(displayName, { pattern: 'first', toneType: 'none' })
        .split(' ')
        .join('')

      // 保存到数据库
      databaseAPI.dbPut(LOCAL_SHORTCUTS_KEY, shortcuts)

      console.log(
        '[LocalShortcut] 更新本地启动项别名成功:',
        shortcut.name,
        '->',
        shortcut.alias || '(无别名)'
      )

      // 通知渲染进程刷新本地启动项
      this.mainWindow?.webContents.send('local-shortcuts-changed')

      return { success: true }
    } catch (error) {
      console.error('[LocalShortcut] 更新本地启动项别名失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 打开本地启动项
   */
  private async openShortcut(shortcutPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 使用 shell.openPath 打开文件/文件夹/应用
      const result = await shell.openPath(shortcutPath)

      if (result) {
        // 如果返回非空字符串，表示有错误
        console.error('[LocalShortcut] 打开失败:', result)
        return { success: false, error: result }
      }

      return { success: true }
    } catch (error) {
      console.error('[LocalShortcut] 打开本地启动项失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  private async deleteNotExistShortcut(): Promise<{ success: boolean; error?: string }> {
    try {
      const shortcuts = this.getAllShortcuts()
      const checks = await Promise.all(
        shortcuts.map(async (cur) => {
          try {
            await fs.access(cur.path)
            return { shortcut: cur, exists: true }
          } catch {
            return { shortcut: cur, exists: false }
          }
        })
      )

      const existShortcuts: LocalShortcut[] = []
      const notExistShortcuts: string[] = []

      for (const check of checks) {
        if (check.exists) {
          existShortcuts.push(check.shortcut)
        } else {
          notExistShortcuts.push(check.shortcut.id)
        }
      }

      databaseAPI.dbPut(LOCAL_SHORTCUTS_KEY, existShortcuts)

      console.log('[LocalShortcut] 删除失效本地启动项成功:', notExistShortcuts.toString())

      // 通知渲染进程刷新本地启动项
      this.mainWindow?.webContents.send('local-shortcuts-changed')

      return { success: true }
    } catch (error) {
      console.error('[LocalShortcut] 删除失效本地启动项失败:', error)
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }
}

export default new LocalShortcutsAPI()
