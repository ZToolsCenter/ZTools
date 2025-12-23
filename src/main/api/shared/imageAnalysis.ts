import { is } from '@electron-toolkit/utils'
import crypto from 'crypto'
import { app, ipcMain, nativeImage } from 'electron'
import fs from 'fs/promises'
import path from 'path'

const analysisCache = new Map<string, ImageAnalysisResult>()

interface ImageAnalysisResult {
  isSimpleIcon: boolean // 是否是简单图标
  mainColor: string | null // 主色调（RGB hex）
  isDark: boolean // 主色调是否为深色
  needsAdaptation: boolean // 是否需要自适应
}

async function analyzeImage(imagePath: string): Promise<ImageAnalysisResult> {
  try {
    // 1. 处理不同格式的图片输入
    let imageBuffer: Buffer
    if (imagePath.startsWith('data:image/')) {
      // Base64 格式
      const base64Data = imagePath.split(',')[1]
      imageBuffer = Buffer.from(base64Data, 'base64')
    } else if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      // URL 格式 - 暂不支持
      return { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false }
    } else {
      // 文件路径格式
      let filePath = imagePath

      // 处理 file:// 协议
      if (filePath.startsWith('file:')) {
        // 移除 file: 前缀
        filePath = filePath
          .replace(/^file:\/\/\//, '') // file:///C:/path -> C:/path
          .replace(/^file:\/\//, '') // file://path -> path
          .replace(/^file:\\/, '') // file:\path -> path (Windows 特殊情况)
          .replace(/^file:/, '') // file:path -> path

        // 如果是 macOS，需要判断是否为/开头，如果不是需要加/
        if (process.platform === 'darwin') {
          if (!filePath.startsWith('/')) {
            filePath = '/' + filePath
          }
        }

        // 解码 URL 编码的字符（如 %20 -> 空格）
        filePath = decodeURIComponent(filePath)

        // 在 Windows 上，确保路径格式正确
        if (process.platform === 'win32') {
          filePath = filePath.replace(/\//g, '\\')
        }
      }

      // 处理相对路径
      const appPath = app.getAppPath()

      // 在 Windows 上，以 / 开头的路径会被 path.isAbsolute 认为是绝对路径
      // 但对于 Vite 资源路径（如 /src/assets/...），我们需要特殊处理
      if (filePath.startsWith('/src/')) {
        // 开发模式：资源在 src/renderer/src/ 目录下
        const relativePath = filePath.substring(1) // 去掉开头的 /
        filePath = path.join(appPath, 'src', 'renderer', relativePath)
      } else if (filePath.startsWith('./assets/') || filePath.startsWith('assets/')) {
        // 生产模式：Vite 打包后的资源路径（如 ./assets/default-xxx.png）
        // 资源通常在 out/renderer/assets/ 目录下
        const assetPath = filePath.replace(/^\.\//, '') // 移除开头的 ./
        if (is.dev) {
          // 开发模式：先尝试 dist 目录（如果存在）
          const distPath = path.join(appPath, 'out', 'renderer', assetPath)
          try {
            await fs.access(distPath)
            filePath = distPath
          } catch {
            // 如果 dist 不存在，尝试 src 目录
            filePath = path.join(appPath, 'src', 'renderer', assetPath)
          }
        } else {
          // 生产模式：资源在 out/renderer/ 目录下（asar 包内或外）
          filePath = path.join(appPath, 'out', 'renderer', assetPath)
        }
      } else if (!path.isAbsolute(filePath)) {
        // 其他相对路径
        filePath = path.join(appPath, filePath)
      }

      imageBuffer = await fs.readFile(filePath)
    }

    // 计算哈希并检查缓存
    const bufferHash = crypto.createHash('md5').update(imageBuffer).digest('hex')
    if (analysisCache.has(bufferHash)) {
      return analysisCache.get(bufferHash)!
    }

    // 2. 使用 Electron nativeImage 加载图片
    const image = nativeImage.createFromBuffer(imageBuffer)
    if (image.isEmpty()) {
      const result = { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false }
      analysisCache.set(bufferHash, result)
      return result
    }

    // 3. 获取原始像素数据（不缩放，避免插值产生的杂色）
    const size = image.getSize()
    // 强制转换为 Buffer 以避免 TypeScript 错误
    const data = image.getBitmap() as unknown as Buffer

    // 4. 像素抽样分析
    // 为了性能，我们不需要遍历几百万个像素，只需要均匀抽样约 1000-2000 个点即可
    // 这相当于"最近邻插值"的物理版，完全通过跳过像素来实现，保证不修改颜色值
    const totalPixels = size.width * size.height
    const targetSamples = 1600 // 相当于分析一张 40x40 的图片
    const step = Math.max(1, Math.floor(totalPixels / targetSamples)) // 步长

    const colorMap = new Map<string, number>()
    let opaquePixels = 0 // 抽样到的不透明像素数
    let totalSampled = 0 // 总抽样数
    let mainColor = ''
    let maxCount = 0

    // BGRA 格式遍历
    for (let i = 0; i < data.length; i += 4 * step) {
      // 边界检查
      if (i + 3 >= data.length) break

      const a = data[i + 3]
      totalSampled++

      // 阈值设为 20，忽略极低透明度的噪点，但保留大部分半透明可能
      if (a > 20) {
        opaquePixels++
        const b = data[i]
        const g = data[i + 1]
        const r = data[i + 2]

        const key = `${r},${g},${b}`
        const count = (colorMap.get(key) || 0) + 1
        colorMap.set(key, count)

        if (count > maxCount) {
          maxCount = count
          mainColor = key
        }
      }
    }

    // 如果没有任何不透明像素
    if (opaquePixels === 0) {
      const result = { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false }
      analysisCache.set(bufferHash, result)
      return result
    }

    // 5. 检测颜色相似度
    const [mainR, mainG, mainB] = mainColor.split(',').map(Number)
    const colorThreshold = 30
    let similarPixels = 0

    // 再次遍历采样点计算相似度
    // 为了性能，如果不重新遍历，可以在第一次遍历时存下来？
    // 但 sampling 只有 1600 个点，再次遍历 Buffer (按步长) 也是极快的。
    // 重新遍历 Buffer 比分配新数组存对象更省内存。
    for (let i = 0; i < data.length; i += 4 * step) {
      if (i + 3 >= data.length) break

      const a = data[i + 3]

      if (a > 20) {
        const b = data[i]
        const g = data[i + 1]
        const r = data[i + 2]

        const distance = Math.sqrt(
          Math.pow(r - mainR, 2) + Math.pow(g - mainG, 2) + Math.pow(b - mainB, 2)
        )

        if (distance < colorThreshold) {
          similarPixels++
        }
      }
    }

    // 6. 判断是否是纯色图标
    // 由于是直接采样，没有杂色，数据非常纯净，我们可以恢复严格的判定标准
    const transparencyRatio = (totalSampled - opaquePixels) / totalSampled
    const similarityRatio = similarPixels / opaquePixels // 相似像素占比

    // 恢复严格标准：
    // 1. 相似度 > 85% (因为没有缩放杂色，纯色图标通常能达到 95%+)
    // 2. 透明度 > 10% (排除满铺的图片)
    const isPureColorIcon = similarityRatio > 0.85 && transparencyRatio > 0.1 && opaquePixels > 20

    // 7. 计算主色调的亮度
    const [r, g, b] = mainColor.split(',').map(Number)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    const isDark = luminance < 0.5
    const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`

    if (!isPureColorIcon) {
      const result = { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false }
      analysisCache.set(bufferHash, result)
      return result
    }

    const result = {
      isSimpleIcon: true,
      mainColor: hexColor,
      isDark,
      needsAdaptation: true
    }
    analysisCache.set(bufferHash, result)
    return result
  } catch (error) {
    console.error('图片分析失败:', error)
    return { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false }
  }
}

// 注册IPC处理器
export function setupImageAnalysisAPI(): void {
  ipcMain.handle('analyze-image', async (_event, imagePath: string) => {
    try {
      return await analyzeImage(imagePath)
    } catch (error) {
      console.error('图片分析失败:', error)
      return { isSimpleIcon: false, mainColor: null, isDark: false, needsAdaptation: false }
    }
  })
}
