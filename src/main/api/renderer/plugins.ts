import { ipcMain, app, dialog } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import { getLanzouDownloadLink, getLanzouFolderFileList } from '../../utils/lanzou.js'
import { downloadFile } from '../../utils/download.js'
import { sleep } from '../../utils/common.js'
import databaseAPI from '../shared/database'
import { pluginFeatureAPI } from '../plugin/feature'

// 插件目录
const PLUGIN_DIR = path.join(app.getPath('userData'), 'plugins')

/**
 * 插件管理API - 主程序专用
 */
export class PluginsAPI {
  private mainWindow: Electron.BrowserWindow | null = null
  private pluginManager: any = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: any): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  private setupIPC(): void {
    ipcMain.handle('get-plugins', () => this.getPlugins())
    ipcMain.handle('import-plugin', () => this.importPlugin())
    ipcMain.handle('import-dev-plugin', () => this.importDevPlugin())
    ipcMain.handle('delete-plugin', (_event, pluginPath: string) => this.deletePlugin(pluginPath))
    ipcMain.handle('reload-plugin', (_event, pluginPath: string) => this.reloadPlugin(pluginPath))
    ipcMain.handle('get-running-plugins', () => this.getRunningPlugins())
    ipcMain.handle('kill-plugin', (_event, pluginPath: string) => this.killPlugin(pluginPath))
    ipcMain.handle('kill-plugin-and-return', (_event, pluginPath: string) =>
      this.killPluginAndReturn(pluginPath)
    )
    ipcMain.handle('fetch-plugin-market', () => this.fetchPluginMarket())
    ipcMain.handle('install-plugin-from-market', (_event, plugin: any) =>
      this.installPluginFromMarket(plugin)
    )
    ipcMain.handle(
      'call-headless-plugin',
      async (_event, pluginPath: string, featureCode: string, action: any) => {
        try {
          const result = await this.pluginManager.callHeadlessPluginMethod(
            pluginPath,
            featureCode,
            action
          )
          return { success: true, result }
        } catch (error: any) {
          console.error('调用无界面插件失败:', error)
          return { success: false, error: error.message }
        }
      }
    )
  }

  // 获取插件列表
  private async getPlugins(): Promise<any[]> {
    try {
      const data = await databaseAPI.dbGet('plugins')
      const plugins = data || []

      // 合并动态 features
      for (const plugin of plugins) {
        const dynamicFeatures = pluginFeatureAPI.loadDynamicFeatures(plugin.name)
        plugin.features = [...(plugin.features || []), ...dynamicFeatures]
      }

      return plugins
    } catch (error) {
      console.error('获取插件列表失败:', error)
      return []
    }
  }

  // 导入ZIP插件
  private async importPlugin(): Promise<any> {
    try {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        title: '选择插件文件',
        filters: [{ name: '插件文件', extensions: ['zip'] }],
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '未选择文件' }
      }

      const zipPath = result.filePaths[0]
      return await this._installPluginFromZip(zipPath)
    } catch (error: any) {
      console.error('导入插件失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }

  // 从ZIP安装插件（核心逻辑）
  private async _installPluginFromZip(zipPath: string): Promise<any> {
    await fs.mkdir(PLUGIN_DIR, { recursive: true })
    const tempDir = path.join(app.getPath('temp'), 'ztools-plugin-temp')
    await fs.mkdir(tempDir, { recursive: true })
    const tempExtractPath = path.join(tempDir, `plugin-${Date.now()}`)

    try {
      // 解压到临时目录
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(tempExtractPath, true)

      // 校验plugin.json
      const pluginJsonPath = path.join(tempExtractPath, 'plugin.json')
      try {
        await fs.access(pluginJsonPath)
      } catch {
        await fs.rm(tempExtractPath, { recursive: true, force: true })
        return { success: false, error: 'plugin.json 文件不存在' }
      }

      // 读取配置
      const pluginJsonContent = await fs.readFile(pluginJsonPath, 'utf-8')
      let pluginConfig: any
      try {
        pluginConfig = JSON.parse(pluginJsonContent)
      } catch {
        await fs.rm(tempExtractPath, { recursive: true, force: true })
        return { success: false, error: 'plugin.json 格式错误' }
      }

      if (!pluginConfig.name) {
        await fs.rm(tempExtractPath, { recursive: true, force: true })
        return { success: false, error: 'plugin.json 缺少 name 字段' }
      }

      const pluginName = pluginConfig.name
      const pluginPath = path.join(PLUGIN_DIR, pluginName)

      // 检查是否已存在
      try {
        await fs.access(pluginPath)
        await fs.rm(tempExtractPath, { recursive: true, force: true })
        return { success: false, error: '插件目录已存在' }
      } catch {
        // 不存在，继续
      }

      const existingPlugins = await this.getPlugins()
      if (existingPlugins.some((p: any) => p.name === pluginName)) {
        await fs.rm(tempExtractPath, { recursive: true, force: true })
        return { success: false, error: '插件已存在' }
      }

      // 校验必填字段
      const requiredFields = ['name', 'version', 'features']
      for (const field of requiredFields) {
        if (!pluginConfig[field]) {
          await fs.rm(tempExtractPath, { recursive: true, force: true })
          return { success: false, error: `缺少必填字段: ${field}` }
        }
      }

      if (!Array.isArray(pluginConfig.features) || pluginConfig.features.length === 0) {
        await fs.rm(tempExtractPath, { recursive: true, force: true })
        return { success: false, error: 'features 必须是非空数组' }
      }

      for (const feature of pluginConfig.features) {
        if (!feature.code || !Array.isArray(feature.cmds)) {
          await fs.rm(tempExtractPath, { recursive: true, force: true })
          return { success: false, error: 'feature 缺少必填字段 (code, cmds)' }
        }
      }

      // 移动到最终目录
      await fs.rename(tempExtractPath, pluginPath)

      // 保存到数据库
      const pluginInfo = {
        name: pluginConfig.name,
        version: pluginConfig.version,
        description: pluginConfig.description || '',
        logo: pluginConfig.logo ? 'file:///' + path.join(pluginPath, pluginConfig.logo) : '',
        main: pluginConfig.main,
        preload: pluginConfig.preload,
        features: pluginConfig.features,
        path: pluginPath,
        isDevelopment: false,
        installedAt: new Date().toISOString()
      }

      let plugins: any = await databaseAPI.dbGet('plugins')
      if (!plugins) plugins = []
      plugins.push(pluginInfo)
      await databaseAPI.dbPut('plugins', plugins)

      this.mainWindow?.webContents.send('plugins-changed')
      return { success: true, plugin: pluginInfo }
    } catch (error: any) {
      await fs.rm(tempExtractPath, { recursive: true, force: true })
      console.error('安装插件失败:', error)
      return { success: false, error: error.message || '安装失败' }
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (e) {
        console.error('清理临时目录失败:', e)
      }
    }
  }

  // 导入开发中插件
  private async importDevPlugin(): Promise<any> {
    try {
      const result = await dialog.showOpenDialog(this.mainWindow!, {
        title: '选择插件文件夹',
        properties: ['openDirectory']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '未选择文件夹' }
      }

      const pluginPath = result.filePaths[0]
      const pluginJsonPath = path.join(pluginPath, 'plugin.json')

      try {
        await fs.access(pluginJsonPath)
      } catch {
        return { success: false, error: 'plugin.json 文件不存在' }
      }

      const pluginJsonContent = await fs.readFile(pluginJsonPath, 'utf-8')
      let pluginConfig: any
      try {
        pluginConfig = JSON.parse(pluginJsonContent)
      } catch {
        return { success: false, error: 'plugin.json 格式错误' }
      }

      if (!pluginConfig.name) {
        return { success: false, error: 'plugin.json 缺少 name 字段' }
      }

      const existingPlugins = await this.getPlugins()
      if (existingPlugins.some((p: any) => p.name === pluginConfig.name)) {
        return { success: false, error: '插件已存在' }
      }

      const requiredFields = ['name', 'version', 'features']
      for (const field of requiredFields) {
        if (!pluginConfig[field]) {
          return { success: false, error: `缺少必填字段: ${field}` }
        }
      }

      if (!Array.isArray(pluginConfig.features) || pluginConfig.features.length === 0) {
        return { success: false, error: 'features 必须是非空数组' }
      }

      for (const feature of pluginConfig.features) {
        if (!feature.code || !Array.isArray(feature.cmds)) {
          return { success: false, error: 'feature 缺少必填字段 (code, cmds)' }
        }
      }

      const pluginInfo = {
        name: pluginConfig.name,
        version: pluginConfig.version,
        description: pluginConfig.description || '',
        logo: pluginConfig.logo ? 'file:///' + path.join(pluginPath, pluginConfig.logo) : '',
        main: pluginConfig?.development?.main,
        preload: pluginConfig.preload,
        features: pluginConfig.features,
        path: pluginPath,
        isDevelopment: true,
        installedAt: new Date().toISOString()
      }

      let plugins: any = await databaseAPI.dbGet('plugins')
      if (!plugins) plugins = []
      plugins.push(pluginInfo)
      await databaseAPI.dbPut('plugins', plugins)

      this.mainWindow?.webContents.send('plugins-changed')
      return { success: true }
    } catch (error: any) {
      console.error('添加开发中插件失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }

  // 删除插件
  private async deletePlugin(pluginPath: string): Promise<any> {
    try {
      const plugins: any = await databaseAPI.dbGet('plugins')
      if (!plugins || !Array.isArray(plugins)) {
        return { success: false, error: '插件列表不存在' }
      }

      const pluginIndex = plugins.findIndex((p: any) => p.path === pluginPath)
      if (pluginIndex === -1) {
        return { success: false, error: '插件不存在' }
      }

      const pluginInfo = plugins[pluginIndex]
      plugins.splice(pluginIndex, 1)
      await databaseAPI.dbPut('plugins', plugins)

      // 清理历史记录
      try {
        const history: any = await databaseAPI.dbGet('app-history')
        if (history && Array.isArray(history)) {
          // 如果类型是 plugin 且 path 匹配，则删除
          const filteredHistory = history.filter((item: any) => {
            if (item.type === 'plugin' && item.path === pluginPath) {
              return false
            }
            return true
          })
          if (filteredHistory.length !== history.length) {
            await databaseAPI.dbPut('app-history', filteredHistory)
            console.log(`已清理 ${history.length - filteredHistory.length} 条历史记录`)
          }
        }
      } catch (error) {
        console.error('清理历史记录失败:', error)
      }

      // 清理固定列表
      try {
        const pinned: any = await databaseAPI.dbGet('pinned-apps')
        if (pinned && Array.isArray(pinned)) {
          // 匹配插件路径
          const filteredPinned = pinned.filter((item: any) => {
            if (item.type === 'plugin' && item.path === pluginPath) {
              return false
            }
            return true
          })
          if (filteredPinned.length !== pinned.length) {
            await databaseAPI.dbPut('pinned-apps', filteredPinned)
            console.log(`已清理 ${pinned.length - filteredPinned.length} 条固定记录`)
          }
        }
      } catch (error) {
        console.error('清理固定列表失败:', error)
      }

      // 清理动态 features
      pluginFeatureAPI.clearPluginFeatures(pluginInfo.name)

      this.mainWindow?.webContents.send('plugins-changed')

      if (!pluginInfo.isDevelopment) {
        try {
          await fs.rm(pluginPath, { recursive: true, force: true })
          console.log('已删除插件目录:', pluginPath)
        } catch (error) {
          console.error('删除插件目录失败:', error)
        }
      } else {
        console.log('开发中插件，保留目录:', pluginPath)
      }

      return { success: true }
    } catch (error: any) {
      console.error('删除插件失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }

  // 重载插件
  private async reloadPlugin(pluginPath: string): Promise<any> {
    try {
      const plugins: any = await databaseAPI.dbGet('plugins')
      if (!plugins || !Array.isArray(plugins)) {
        return { success: false, error: '插件列表不存在' }
      }

      const pluginIndex = plugins.findIndex((p: any) => p.path === pluginPath)
      if (pluginIndex === -1) {
        return { success: false, error: '插件不存在' }
      }

      const oldPlugin = plugins[pluginIndex]
      const pluginJsonPath = path.join(pluginPath, 'plugin.json')

      try {
        await fs.access(pluginJsonPath)
      } catch (error) {
        console.log('文件不存在', error)
        return { success: false, error: 'plugin.json 文件不存在' }
      }

      const pluginJsonContent = await fs.readFile(pluginJsonPath, 'utf-8')
      const pluginConfig = JSON.parse(pluginJsonContent)

      plugins[pluginIndex] = {
        ...oldPlugin,
        name: pluginConfig.name || oldPlugin.name,
        version: pluginConfig.version || oldPlugin.version,
        description: pluginConfig.description || oldPlugin.description,
        logo: pluginConfig.logo
          ? 'file:///' + path.join(pluginPath, pluginConfig.logo)
          : oldPlugin.logo,
        features: pluginConfig.features || oldPlugin.features,
        main: pluginConfig.main || oldPlugin.main
      }

      await databaseAPI.dbPut('plugins', plugins)
      this.mainWindow?.webContents.send('plugins-changed')
      console.log('插件重载成功:', pluginPath)
      return { success: true }
    } catch (error: any) {
      console.error('重载插件失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }

  // 获取运行中的插件
  private getRunningPlugins(): string[] {
    if (this.pluginManager) {
      return this.pluginManager.getRunningPlugins()
    }
    return []
  }

  // 终止插件
  private killPlugin(pluginPath: string): { success: boolean; error?: string } {
    try {
      console.log('终止插件:', pluginPath)
      if (this.pluginManager) {
        const result = this.pluginManager.killPlugin(pluginPath)
        if (result) {
          return { success: true }
        } else {
          return { success: false, error: '插件未运行' }
        }
      }
      return { success: false, error: '功能不可用' }
    } catch (error: any) {
      console.error('终止插件失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }

  // 终止插件并返回搜索页面
  private killPluginAndReturn(pluginPath: string): { success: boolean; error?: string } {
    try {
      console.log('终止插件并返回搜索页面:', pluginPath)
      if (this.pluginManager) {
        const result = this.pluginManager.killPlugin(pluginPath)
        if (result) {
          this.mainWindow?.webContents.send('back-to-search')
          this.mainWindow?.webContents.focus()
          return { success: true }
        } else {
          return { success: false, error: '插件未运行' }
        }
      }
      return { success: false, error: '功能不可用' }
    } catch (error: any) {
      console.error('终止插件并返回搜索页面失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }

  // 获取插件市场列表
  private async fetchPluginMarket(): Promise<any> {
    try {
      const folderUrl = 'https://ilt.lanzouu.com/b0pn75v9g'
      const password = '5w87'

      const fileList = await getLanzouFolderFileList(folderUrl, password)
      if (!Array.isArray(fileList) || fileList.length === 0) {
        throw new Error('插件市场文件列表为空')
      }

      let latestFile: any = null
      let latestVersion = '0.0.0'
      const versionRegex = /plugins_(\d+(\.\d+)*)\.txt/

      for (const file of fileList) {
        const match = file.name_all.match(versionRegex)
        if (match) {
          const version = match[1]
          if (this.compareVersions(version, latestVersion) > 0) {
            latestVersion = version
            latestFile = file
          }
        }
      }

      if (!latestFile) {
        throw new Error('未找到有效的插件列表文件')
      }

      console.log(`发现最新插件列表版本: ${latestVersion}, 文件: ${latestFile.name_all}`)

      const cachedVersion = await databaseAPI.dbGet('plugin-market-version')
      const cachedData = await databaseAPI.dbGet('plugin-market-data')

      if (cachedVersion === latestVersion && cachedData) {
        console.log('使用本地缓存的插件市场列表')
        return { success: true, data: cachedData }
      }

      console.log('下载新版本插件列表...')
      const filePageUrl = 'https://ilt.lanzouu.com/' + latestFile.id
      const downloadLink = await getLanzouDownloadLink(filePageUrl)

      const tempDir = path.join(app.getPath('temp'), 'ztools-plugin-market')
      await fs.mkdir(tempDir, { recursive: true })
      const tempFilePath = path.join(tempDir, `plugins-${Date.now()}.json`)

      let retryCount = 0
      const maxRetries = 3
      while (retryCount < maxRetries) {
        try {
          await downloadFile(downloadLink, tempFilePath)
          break
        } catch (error) {
          retryCount++
          console.error(`下载失败，重试第 ${retryCount} 次:`, error)
          if (retryCount >= maxRetries) throw error
          await sleep(500)
        }
      }

      const fileContent = await fs.readFile(tempFilePath, 'utf-8')
      const json = JSON.parse(fileContent)

      try {
        await fs.unlink(tempFilePath)
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (e) {
        console.error('清理临时文件失败:', e)
      }

      await databaseAPI.dbPut('plugin-market-version', latestVersion)
      await databaseAPI.dbPut('plugin-market-data', json)

      return { success: true, data: json }
    } catch (error: any) {
      console.error('获取插件市场列表失败:', error)
      try {
        const cachedData = await databaseAPI.dbGet('plugin-market-data')
        if (cachedData) {
          console.log('获取失败，降级使用本地缓存')
          return { success: true, data: cachedData }
        }
      } catch {
        // ignore
      }
      return { success: false, error: error.message || '获取失败' }
    }
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number)
    const parts2 = v2.split('.').map(Number)

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0
      const p2 = parts2[i] || 0
      if (p1 > p2) return 1
      if (p1 < p2) return -1
    }
    return 0
  }

  // 从市场安装插件
  private async installPluginFromMarket(plugin: any): Promise<any> {
    try {
      console.log('开始从市场安装插件:', plugin.name)
      const downloadUrl = plugin.downloadUrl
      if (!downloadUrl) {
        return { success: false, error: '无效的下载链接' }
      }

      const realDownloadUrl = await getLanzouDownloadLink(downloadUrl)
      console.log('插件真实下载链接:', realDownloadUrl)

      const tempDir = path.join(app.getPath('temp'), 'ztools-plugin-download')
      await fs.mkdir(tempDir, { recursive: true })
      const tempFilePath = path.join(tempDir, `${plugin.name}-${Date.now()}.zip`)

      let retryCount = 0
      const maxRetries = 3
      while (retryCount < maxRetries) {
        try {
          await downloadFile(realDownloadUrl, tempFilePath)
          break
        } catch (error) {
          retryCount++
          console.error(`下载失败，重试第 ${retryCount} 次:`, error)
          if (retryCount >= maxRetries) throw error
          await sleep(500)
        }
      }

      console.log('插件下载完成:', tempFilePath)
      const result = await this._installPluginFromZip(tempFilePath)

      try {
        await fs.unlink(tempFilePath)
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (e) {
        console.error('清理下载临时文件失败:', e)
      }

      return result
    } catch (error: any) {
      console.error('从市场安装插件失败:', error)
      return { success: false, error: error.message || '安装失败' }
    }
  }
}

export default new PluginsAPI()
