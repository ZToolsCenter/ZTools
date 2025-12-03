import { ipcMain, clipboard, nativeImage } from 'electron'

/**
 * 剪贴板基础操作API - 插件专用
 * 注意：这里是基础的复制操作，与 shared/clipboard.ts 的历史管理不同
 */
export class PluginClipboardAPI {
  public init(): void {
    this.setupIPC()
  }

  private setupIPC(): void {
    // 复制文本到剪贴板
    ipcMain.on('copy-text', (event, text: string) => {
      try {
        clipboard.writeText(text)
        event.returnValue = true
      } catch (error) {
        console.error('复制文本失败:', error)
        event.returnValue = false
      }
    })

    // 复制图片到剪贴板
    ipcMain.on('copy-image', (event, image: string | Buffer) => {
      try {
        let nativeImg

        if (typeof image === 'string') {
          if (image.startsWith('data:image/')) {
            nativeImg = nativeImage.createFromDataURL(image)
          } else {
            nativeImg = nativeImage.createFromPath(image)
          }
        } else if (Buffer.isBuffer(image)) {
          nativeImg = nativeImage.createFromBuffer(image)
        } else {
          throw new Error('不支持的图片类型')
        }

        if (nativeImg.isEmpty()) {
          throw new Error('图片为空或无效')
        }

        clipboard.writeImage(nativeImg)
        event.returnValue = true
      } catch (error) {
        console.error('复制图片失败:', error)
        event.returnValue = false
      }
    })

    // 复制文件到剪贴板
    ipcMain.on('copy-file', (event, filePath: string | string[]) => {
      try {
        const files = Array.isArray(filePath) ? filePath : [filePath]
        clipboard.writeBuffer('FileNameW', Buffer.from(files.join('\0') + '\0', 'ucs2'))
        event.returnValue = true
      } catch (error) {
        console.error('复制文件失败:', error)
        event.returnValue = false
      }
    })
  }
}

export default new PluginClipboardAPI()
