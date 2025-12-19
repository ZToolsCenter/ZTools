import { app, clipboard, nativeImage } from 'electron'
import { createHash } from 'crypto'
import path from 'path'
import { promises as fs } from 'fs'
import lmdbInstance from './core/lmdb/lmdbInstance'
import { v4 as uuidv4 } from 'uuid'
import plist from 'simple-plist'
import pluginManager from './pluginManager'
import { ClipboardMonitor, WindowMonitor, WindowManager } from './core/native'
import os from 'os'
// 剪贴板类型
type ClipboardType = 'text' | 'image' | 'file'

// 文件项
interface FileItem {
  path: string // 文件完整路径
  name: string // 文件名
  isDirectory: boolean // 是否为文件夹
}

// 剪贴板记录
interface ClipboardItem {
  id: string
  type: ClipboardType
  timestamp: number
  hash: string
  appName?: string // 复制时的应用名称
  bundleId?: string // 复制时的应用 Bundle ID
  content?: string // text: 文本内容
  files?: FileItem[] // file: 文件列表
  imagePath?: string // image: 保存的图片路径
  resolution?: string // image: 图片分辨率 "width * height"
  preview?: string // 预览文本
}

// 窗口激活信息
interface WindowActivationInfo {
  appName: string
  bundleId: string
  processId: number
  timestamp: number
}

// 配置
interface ClipboardConfig {
  maxItems: number // 最大条数
  maxImageSize: number // 单张图片最大大小（bytes）
  maxTotalImageSize: number // 图片总大小限制（bytes）
}

// 默认配置
const DEFAULT_CONFIG: ClipboardConfig = {
  maxItems: 1000,
  maxImageSize: 10 * 1024 * 1024, // 10MB
  maxTotalImageSize: 500 * 1024 * 1024 // 500MB
}

class ClipboardManager {
  private isRunning = false
  private config: ClipboardConfig = DEFAULT_CONFIG
  private readonly DB_BUCKET = 'CLIPBOARD'
  private readonly IMAGE_DIR: string
  private currentWindow: WindowActivationInfo | null = null
  private clipboardMonitor: ClipboardMonitor
  private windowMonitor: WindowMonitor

  // 记录最后一次复制的内容（统一管理）
  private lastCopiedContent: {
    type: 'text' | 'image' | 'file'
    data: string | FileItem[] // text/image: string, file: FileItem[]
    timestamp: number
  } | null = null

  constructor() {
    this.IMAGE_DIR = path.join(app.getPath('userData'), 'clipboard', 'images')
    this.clipboardMonitor = new ClipboardMonitor()
    this.windowMonitor = new WindowMonitor()
    this.init()
  }

  private async init(): Promise<void> {
    // 确保图片目录存在
    await fs.mkdir(this.IMAGE_DIR, { recursive: true })

    // 启动剪贴板监听器（原生事件已做去重）
    this.clipboardMonitor.start(() => {
      console.log('剪贴板变化事件触发')
      this.handleClipboardChange()
    })

    // 启动窗口激活监听
    this.windowMonitor.start((windowInfo) => {
      console.log('窗口激活事件：', windowInfo)
      this.handleWindowActivation(windowInfo)
    })

    this.isRunning = true
    console.log('剪贴板监听已启动（原生事件模式）')
    console.log('窗口激活监听已启动')
  }

  // 处理窗口激活事件
  private handleWindowActivation(data: {
    appName: string
    bundleId?: string
    processId?: number
  }): void {
    this.currentWindow = {
      appName: data.appName,
      bundleId: data.bundleId || '',
      processId: data.processId || 0,
      timestamp: Date.now()
    }

    // console.log(`窗口激活变化: ${data.appName} (${data.bundleId || data.processId})`)
  }

  // 获取当前激活的窗口
  public getCurrentWindow(): WindowActivationInfo | null {
    return this.currentWindow
  }

  // 激活指定应用
  public activateApp(info: WindowActivationInfo): boolean {
    try {
      const identifier = os.platform() === 'win32' ? info.processId : info.bundleId
      const success = WindowManager.activateWindow(identifier)
      console.log(`激活应用 ${identifier}: ${success ? '成功' : '失败'}`)
      return success
    } catch (error) {
      console.error('激活应用失败:', error)
      return false
    }
  }

  // 更新配置
  public updateConfig(config: Partial<ClipboardConfig>): void {
    this.config = { ...this.config, ...config }
  }

  // 处理剪贴板变化（原生事件已去重，直接处理）
  private async handleClipboardChange(): Promise<void> {
    try {
      let item: Partial<ClipboardItem> | null = null

      // 优先级：文件 > 图片 > 文本
      // 跨平台文件检测
      let hasFiles = false
      if (os.platform() === 'darwin') {
        hasFiles = clipboard.has('NSFilenamesPboardType')
      } else if (os.platform() === 'win32') {
        // Windows 使用原生 API 检测文件
        try {
          const files = ClipboardMonitor.getClipboardFiles()
          hasFiles = files.length > 0
        } catch (error) {
          console.error('原生 API 获取文件失败:', error)
          hasFiles = false
        }
      }

      if (hasFiles) {
        item = await this.handleFile()
      } else if (!clipboard.readImage().isEmpty()) {
        item = await this.handleImage()
      } else {
        item = await this.handleText()
      }

      if (item) {
        console.log('新剪贴板内容:', item)
        await this.saveItem(item as ClipboardItem)
        // 通知插件剪贴板变化
        pluginManager?.sendPluginMessage('clipboard-change', item)
      }
    } catch (error) {
      console.error('处理剪贴板失败:', error)
    }
  }

  // 处理文件
  private async handleFile(): Promise<Partial<ClipboardItem>> {
    try {
      let files: FileItem[] = []

      if (os.platform() === 'darwin') {
        // macOS 使用 NSFilenamesPboardType 格式
        if (!clipboard.has('NSFilenamesPboardType')) {
          console.error('没有文件类型数据')
          return null as any
        }

        const result = clipboard.read('NSFilenamesPboardType')
        console.log('文件原始数据:', result)

        if (!result) {
          console.error('读取文件数据为空')
          return null as any
        }

        // 解析 plist 格式
        let filePaths: string[] = []
        try {
          filePaths = plist.parse(result) as string[]
          console.log('解析后的文件列表:', filePaths)
        } catch (error) {
          console.error('plist 解析失败:', error)
          return null as any
        }

        if (!Array.isArray(filePaths) || filePaths.length === 0) {
          console.error('文件列表为空')
          return null as any
        }

        // 处理所有文件，检查是否为文件夹
        files = await Promise.all(
          filePaths.map(async (filePath) => {
            const name = path.basename(filePath)
            let isDirectory = false

            try {
              const stat = await fs.stat(filePath)
              isDirectory = stat.isDirectory()
            } catch (error) {
              console.error('检查文件状态失败:', filePath, error)
            }

            return {
              path: filePath,
              name,
              isDirectory
            }
          })
        )
      } else if (os.platform() === 'win32') {
        // Windows 使用原生 API 获取文件列表
        files = ClipboardMonitor.getClipboardFiles()
        console.log('原生 API 获取的文件列表:', files)
      }

      if (!Array.isArray(files) || files.length === 0) {
        console.error('文件列表为空')
        return null as any
      }

      // 记录最后一次复制的文件列表（包含完整元数据）
      this.lastCopiedContent = {
        type: 'file',
        data: files, // 存储完整的 FileItem 对象
        timestamp: Date.now()
      }

      // 生成 hash（基于所有文件路径）
      const hashContent = files.map((f) => f.path).join('|')
      const hash = createHash('md5').update(hashContent).digest('hex')

      // 生成预览文本
      let preview = ''
      if (files.length === 1) {
        const file = files[0]
        preview = `[${file.isDirectory ? '文件夹' : '文件'}] ${file.name}`
      } else {
        const fileCount = files.filter((f) => !f.isDirectory).length
        const dirCount = files.filter((f) => f.isDirectory).length
        const parts: string[] = []
        if (fileCount > 0) parts.push(`${fileCount}个文件`)
        if (dirCount > 0) parts.push(`${dirCount}个文件夹`)
        preview = `[${parts.join('、')}]`
      }

      return {
        id: uuidv4(),
        type: 'file',
        timestamp: Date.now(),
        hash,
        files,
        preview
      }
    } catch (error) {
      console.error('处理文件失败:', error)
      return null as any
    }
  }

  // 处理图片内容
  private async handleImage(): Promise<Partial<ClipboardItem>> {
    try {
      const image = clipboard.readImage()
      const buffer = image.toPNG()

      // 记录最后一次复制的图片（转为 base64）
      const base64 = `data:image/png;base64,${buffer.toString('base64')}`
      this.lastCopiedContent = {
        type: 'image',
        data: base64,
        timestamp: Date.now()
      }

      // 检查图片大小
      if (buffer.length > this.config.maxImageSize) {
        console.log('图片过大，跳过保存:', (buffer.length / 1024 / 1024).toFixed(2), 'MB')
        return {
          id: uuidv4(),
          type: 'image',
          timestamp: Date.now(),
          hash: createHash('md5').update(buffer).digest('hex'),
          preview: `[图片] 过大未保存 (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`
        }
      }

      // 检查总存储大小
      await this.checkAndCleanImageStorage()

      // 保存图片
      const imageName = `${Date.now()}-${uuidv4().slice(0, 8)}.png`
      const imagePath = path.join(this.IMAGE_DIR, imageName)
      await fs.writeFile(imagePath, buffer)

      const size = (buffer.length / 1024).toFixed(2)
      const { width, height } = image.getSize()
      const resolution = `${width} * ${height}`

      return {
        id: uuidv4(),
        type: 'image',
        timestamp: Date.now(),
        hash: createHash('md5').update(buffer).digest('hex'),
        imagePath,
        resolution,
        preview: `[图片] ${size}KB`
      }
    } catch (error) {
      console.error('处理图片失败:', error)
      return null as any
    }
  }

  // 处理纯文本
  private async handleText(): Promise<Partial<ClipboardItem>> {
    const text = clipboard.readText()

    if (!text) {
      return null as any
    }

    // 记录最后一次复制的文本
    this.lastCopiedContent = {
      type: 'text',
      data: text,
      timestamp: Date.now()
    }

    return {
      id: uuidv4(),
      type: 'text',
      timestamp: Date.now(),
      hash: createHash('md5').update(text).digest('hex'),
      content: text,
      preview: text.length > 100 ? text.slice(0, 100) + '...' : text
    }
  }

  // 保存记录
  private async saveItem(item: ClipboardItem): Promise<void> {
    try {
      // 添加当前窗口信息
      if (this.currentWindow) {
        item.appName = this.currentWindow.appName
        item.bundleId = this.currentWindow.bundleId
      }

      // 构造文档并保存到 LMDB
      const doc = {
        _id: `${this.DB_BUCKET}/${item.id}`,
        type: item.type,
        timestamp: item.timestamp,
        hash: item.hash,
        appName: item.appName,
        bundleId: item.bundleId,
        content: item.content,
        files: item.files,
        imagePath: item.imagePath,
        resolution: item.resolution,
        preview: item.preview
      }

      await lmdbInstance.promises.put(doc)

      console.log(
        '剪贴板记录已保存:',
        item.type,
        item.preview,
        item.appName ? `来自: ${item.appName}` : ''
      )

      // 检查并清理旧记录
      await this.checkAndCleanOldItems()
    } catch (error) {
      console.error('保存剪贴板记录失败:', error)
    }
  }

  // 检查并清理旧记录（超过最大条数）
  private async checkAndCleanOldItems(): Promise<void> {
    try {
      const allItems = await this.getAllItems()

      if (allItems.length > this.config.maxItems) {
        // 按时间排序，删除最旧的
        const sortedItems = allItems.sort((a, b) => a.timestamp - b.timestamp)
        const toDelete = sortedItems.slice(0, allItems.length - this.config.maxItems)

        for (const item of toDelete) {
          await this.deleteItem(item.id)
        }

        console.log(`清理了 ${toDelete.length} 条旧记录`)
      }
    } catch (error) {
      console.error('清理旧记录失败:', error)
    }
  }

  // 检查并清理图片存储（超过总大小限制）
  private async checkAndCleanImageStorage(): Promise<void> {
    try {
      const allItems = await this.getAllItems()
      const imageItems = allItems.filter((item) => item.type === 'image' && item.imagePath)

      // 计算总大小
      let totalSize = 0
      for (const item of imageItems) {
        try {
          const stat = await fs.stat(item.imagePath!)
          totalSize += stat.size
        } catch {
          // 文件不存在，忽略
        }
      }

      // 超过限制，删除最旧的图片
      if (totalSize > this.config.maxTotalImageSize) {
        const sortedImages = imageItems.sort((a, b) => a.timestamp - b.timestamp)

        for (const item of sortedImages) {
          if (totalSize <= this.config.maxTotalImageSize * 0.8) {
            break
          }

          try {
            const stat = await fs.stat(item.imagePath!)
            await fs.unlink(item.imagePath!)
            totalSize -= stat.size
            console.log('删除旧图片:', item.imagePath)
          } catch {
            // 文件已不存在
          }
        }
      }
    } catch (error) {
      console.error('清理图片存储失败:', error)
    }
  }

  // 获取所有记录
  private async getAllItems(): Promise<ClipboardItem[]> {
    try {
      const docs = await lmdbInstance.promises.allDocs(`${this.DB_BUCKET}/`)
      if (!docs || !Array.isArray(docs)) {
        return []
      }

      return docs.map((doc) => {
        // 从 _id 中提取原始 id (移除前缀)
        return {
          id: doc._id.replace(`${this.DB_BUCKET}/`, ''),
          ...doc
        } as unknown as ClipboardItem
      })
    } catch (error) {
      console.error('获取所有记录失败:', error)
      return []
    }
  }

  // 分页查询
  public async getHistory(
    page: number = 1,
    pageSize: number = 50,
    filter?: { type?: ClipboardType; keyword?: string }
  ): Promise<{ items: any[]; total: number; page: number; pageSize: number }> {
    try {
      let allItems = await this.getAllItems()

      // 过滤
      if (filter?.type) {
        allItems = allItems.filter((item) => item.type === filter.type)
      }
      if (filter?.keyword) {
        const keyword = filter.keyword.toLowerCase()
        allItems = allItems.filter((item) => {
          // 搜索文本内容
          if (item.content?.toLowerCase().includes(keyword)) {
            return true
          }
          // 搜索文件名（搜索 files 数组中的所有文件名）
          if (item.files) {
            return item.files.some((file: FileItem) => file.name.toLowerCase().includes(keyword))
          }
          // 搜索预览文本
          if (item.preview?.toLowerCase().includes(keyword)) {
            return true
          }
          return false
        })
      }

      // 按时间倒序
      allItems.sort((a, b) => b.timestamp - a.timestamp)

      const total = allItems.length
      const start = (page - 1) * pageSize
      const end = start + pageSize
      const items = allItems.slice(start, end)

      // 对于文件类型，检查文件是否存在
      const itemsWithStatus = await Promise.all(
        items.map(async (item) => {
          if (item.type === 'file' && item.files) {
            // 检查每个文件是否存在
            const filesWithStatus = await Promise.all(
              item.files.map(async (file: FileItem) => {
                try {
                  await fs.access(file.path)
                  return { ...file, exists: true }
                } catch {
                  return { ...file, exists: false }
                }
              })
            )
            return { ...item, files: filesWithStatus }
          }
          return item
        })
      )

      return {
        items: itemsWithStatus,
        total,
        page,
        pageSize
      }
    } catch (error) {
      console.error('查询历史记录失败:', error)
      return { items: [], total: 0, page, pageSize }
    }
  }

  // 搜索
  public async search(keyword: string): Promise<ClipboardItem[]> {
    const result = await this.getHistory(1, 1000, { keyword })
    return result.items
  }

  // 删除单条记录
  public async deleteItem(id: string): Promise<boolean> {
    try {
      const docId = `${this.DB_BUCKET}/${id}`
      const doc = await lmdbInstance.promises.get(docId)

      if (doc) {
        // 如果是图片，删除文件
        if (doc.type === 'image' && doc.imagePath) {
          try {
            await fs.unlink(doc.imagePath)
            console.log('删除图片文件:', doc.imagePath)
          } catch {
            // 文件可能已被删除
          }
        }

        await lmdbInstance.promises.remove(docId)
        console.log('删除剪贴板记录:', id)
        return true
      }
      return false
    } catch (error) {
      console.error('删除记录失败:', error)
      return false
    }
  }

  // 清空历史
  public async clear(type?: ClipboardType): Promise<number> {
    try {
      let allItems = await this.getAllItems()

      if (type) {
        allItems = allItems.filter((item) => item.type === type)
      }

      let count = 0
      for (const item of allItems) {
        const success = await this.deleteItem(item.id)
        if (success) count++
      }

      console.log(`清空了 ${count} 条记录`)
      return count
    } catch (error) {
      console.error('清空历史失败:', error)
      return 0
    }
  }

  // 写回剪贴板
  public async writeToClipboard(id: string): Promise<boolean> {
    try {
      const docId = `${this.DB_BUCKET}/${id}`
      const doc = await lmdbInstance.promises.get(docId)

      if (!doc) {
        console.error('记录不存在:', id)
        return false
      }

      const item: ClipboardItem = doc as any

      // 先检查当前剪贴板内容是否与要写回的内容一致
      let isSame = false

      switch (item.type) {
        case 'text': {
          const currentText = clipboard.readText()
          isSame = currentText === item.content
          break
        }

        case 'image': {
          const currentImage = clipboard.readImage()
          if (!currentImage.isEmpty()) {
            const currentBuffer = currentImage.toPNG()
            const currentHash = createHash('md5').update(currentBuffer).digest('hex')
            isSame = currentHash === item.hash
          }
          break
        }

        case 'file': {
          // 跨平台文件比较
          if (os.platform() === 'darwin') {
            if (clipboard.has('NSFilenamesPboardType')) {
              try {
                const result = clipboard.read('NSFilenamesPboardType')
                if (result) {
                  const currentFilePaths = plist.parse(result) as string[]
                  const itemFilePaths = item.files?.map((f) => f.path) || []
                  // 比较文件路径列表（顺序也要一致）
                  isSame = JSON.stringify(currentFilePaths) === JSON.stringify(itemFilePaths)
                }
              } catch (error) {
                console.error('解析当前剪贴板文件列表失败:', error)
              }
            }
          } else {
            // Windows 使用原生 API
            try {
              const currentFiles = ClipboardMonitor.getClipboardFiles()
              const itemFilePaths = item.files?.map((f) => f.path) || []
              const currentFilePaths = currentFiles.map((f) => f.path)
              // 比较文件路径列表（顺序也要一致）
              isSame = JSON.stringify(currentFilePaths) === JSON.stringify(itemFilePaths)
            } catch (error) {
              console.error('获取当前剪贴板文件列表失败:', error)
            }
          }
          break
        }
      }

      // 如果内容一致，不执行写回和删除操作
      if (isSame) {
        console.log('剪贴板内容与要写回的内容一致，跳过操作:', item.type, item.preview)
        return true
      }

      // 删除原纪录
      await lmdbInstance.promises.remove(docId)

      // 根据类型写回（原生模块会处理去重，不会触发重复事件）
      switch (item.type) {
        case 'text':
          if (item.content) {
            clipboard.writeText(item.content)
            return true
          }
          break

        case 'image':
          if (item.imagePath) {
            try {
              const imageBuffer = await fs.readFile(item.imagePath)
              const image = nativeImage.createFromBuffer(imageBuffer)
              clipboard.writeImage(image)
              return true
            } catch (error) {
              console.error('读取图片失败:', error)
              return false
            }
          }
          break

        case 'file':
          // 跨平台写回文件列表
          if (item.files && item.files.length > 0) {
            try {
              const filePaths = item.files.map((f: FileItem) => f.path)
              if (os.platform() === 'darwin') {
                // macOS 使用 NSFilenamesPboardType 格式
                const plistData = plist.stringify(filePaths)
                clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plistData))
              } else if (os.platform() === 'win32') {
                // Windows 使用原生 API
                ClipboardMonitor.setClipboardFiles(filePaths)
              }
              console.log('文件列表已写回剪贴板:', filePaths)
              return true
            } catch (error) {
              console.error('写回文件列表失败:', error)
              return false
            }
          }
          break
      }

      return false
    } catch (error) {
      console.error('写回剪贴板失败:', error)
      return false
    }
  }

  // 直接写入内容到剪贴板
  public writeContent(data: { type: 'text' | 'image'; content: string }): boolean {
    try {
      if (data.type === 'text') {
        clipboard.writeText(data.content)
        return true
      } else if (data.type === 'image') {
        // 1. 尝试作为 DataURL 处理
        let image = nativeImage.createFromDataURL(data.content)

        // 2. 如果为空，尝试作为文件路径处理
        if (image.isEmpty()) {
          image = nativeImage.createFromPath(data.content)
        }

        // 3. 如果仍为空，尝试作为 Base64 处理
        if (image.isEmpty()) {
          try {
            image = nativeImage.createFromBuffer(Buffer.from(data.content, 'base64'))
          } catch {
            // ignore
          }
        }

        if (!image.isEmpty()) {
          clipboard.writeImage(image)
          return true
        }

        console.error('无效的图片内容')
        return false
      }
      return false
    } catch (error) {
      console.error('写入内容失败:', error)
      return false
    }
  }

  // 获取最后一次复制的文本（在指定时间内）- 兼容旧 API
  public getLastCopiedText(timeLimit: number): string | null {
    const content = this.getLastCopiedContent(timeLimit)
    return content?.type === 'text' ? (content.data as string) : null
  }

  // 获取最后复制的图片（自动粘贴功能）- 兼容旧 API
  public getLastCopiedImage(timeLimit: number): string | null {
    const content = this.getLastCopiedContent(timeLimit)
    return content?.type === 'image' ? (content.data as string) : null
  }

  // 获取最后复制的内容（统一接口）
  public getLastCopiedContent(
    timeLimit?: number // 可选：时间限制（毫秒），不传或传 0 表示无时间限制
  ): { type: 'text' | 'image' | 'file'; data: string | FileItem[]; timestamp: number } | null {
    if (!this.lastCopiedContent) {
      return null
    }

    // 如果指定了时间限制，检查是否超时
    if (timeLimit && timeLimit > 0) {
      const now = Date.now()
      const elapsed = now - this.lastCopiedContent.timestamp

      // 如果超过时间限制，返回 null
      if (elapsed > timeLimit) {
        return null
      }
    }

    return this.lastCopiedContent
  }

  // 获取状态
  public async getStatus(): Promise<{
    isRunning: boolean
    itemCount: number
    imageCount: number
    imageStorageSize: number
  }> {
    try {
      const allItems = await this.getAllItems()
      const imageItems = allItems.filter((item) => item.type === 'image' && item.imagePath)

      let imageStorageSize = 0
      for (const item of imageItems) {
        try {
          const stat = await fs.stat(item.imagePath!)
          imageStorageSize += stat.size
        } catch {
          // 忽略
        }
      }

      return {
        isRunning: this.isRunning,
        itemCount: allItems.length,
        imageCount: imageItems.length,
        imageStorageSize
      }
    } catch (error) {
      console.error('获取状态失败:', error)
      return {
        isRunning: this.isRunning,
        itemCount: 0,
        imageCount: 0,
        imageStorageSize: 0
      }
    }
  }
}

export default new ClipboardManager()
