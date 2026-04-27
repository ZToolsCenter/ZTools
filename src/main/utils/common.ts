import { app } from 'electron'
import { fileURLToPath } from 'url'
import { WindowManager } from '../core/native/index.js'

/**
 * 睡眠指定毫秒数
 * @param ms 毫秒数
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fisher-Yates 洗牌算法，返回新数组（不修改原数组）
 */
export function shuffleArray<T>(arr: readonly T[]): T[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/**
 * 提取英文名称的首字母缩写
 * 支持两种模式（优先级从高到低）：
 * 1. 空格分隔的单词首字母：Visual Studio Code → vsc
 * 2. 驼峰命名首字母：VisualStudioCode → vsc
 * @param name 应用名称
 * @returns 首字母缩写字符串
 */
export function extractAcronym(name: string): string {
  // 方式1：空格分隔的单词首字母（优先）
  // "Visual Studio Code" → "vsc"
  const words = name.split(/\s+/).filter((w) => w.length > 0)
  if (words.length > 1) {
    return words.map((w) => w[0].toLowerCase()).join('')
  }

  // 方式2：驼峰命名首字母
  // "VisualStudioCode" → "vsc"
  const capitals = name.match(/[A-Z]/g)
  if (capitals && capitals.length > 1) {
    return capitals.map((c) => c.toLowerCase()).join('')
  }

  // 无法提取首字母缩写
  return ''
}

interface ExplorerFolderWindowInfo {
  className?: string
  hwnd?: number | null
}

export function decodeFileUrlToPath(fileUrl: string): string {
  try {
    return fileURLToPath(fileUrl)
  } catch {
    const fallbackPath = fileUrl.replace(/^file:\/\/\//, '').replace(/\//g, '\\')
    try {
      return decodeURIComponent(fallbackPath)
    } catch {
      return fallbackPath
    }
  }
}

/**
 * 根据窗口类名与 hwnd 读取 Explorer 当前目录。
 * 返回 null 表示当前窗口不是可读取目录的 Explorer/桌面窗口。
 */
export function getExplorerFolderPathFromWindow(
  windowInfo: ExplorerFolderWindowInfo,
  logPrefix: string
): string | null {
  if (windowInfo.className === 'Progman' || windowInfo.className === 'WorkerW') {
    return app.getPath('desktop')
  }

  if (windowInfo.className !== 'CabinetWClass' && windowInfo.className !== 'ExploreWClass') {
    return null
  }

  if (typeof windowInfo.hwnd !== 'number') {
    console.error(`[${logPrefix}] Explorer 窗口缺少 hwnd，无法读取目录`)
    return null
  }

  let folderUrl: string | null = null
  try {
    folderUrl = WindowManager.getExplorerFolderPath(windowInfo.hwnd)
  } catch (error) {
    console.error(`[${logPrefix}] Explorer 目录读取异常 (hwnd=${windowInfo.hwnd}):`, error)
    return null
  }

  if (!folderUrl) {
    console.error(`[${logPrefix}] Explorer 目录读取失败 (hwnd=${windowInfo.hwnd})`)
    return null
  }

  return decodeFileUrlToPath(folderUrl)
}
