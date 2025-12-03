import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import plist from 'simple-plist'

const execAsync = promisify(exec)

export interface App {
  name: string
  path: string
  icon?: string
}

// 获取应用图标文件路径
async function getIconFile(appPath: string): Promise<string> {
  return new Promise((resolve) => {
    const plistPath = path.join(appPath, 'Contents', 'Info.plist')

    plist.readFile(plistPath, (err: any, data: any) => {
      if (err || !data || !data.CFBundleIconFile) {
        // 返回系统默认图标
        return resolve(
          '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns'
        )
      }

      const iconFileName = data.CFBundleIconFile
      const baseIconPath = path.join(appPath, 'Contents', 'Resources', iconFileName)

      // 尝试多种扩展名
      const iconCandidates = [
        baseIconPath,
        `${baseIconPath}.icns`,
        `${baseIconPath}.tiff`,
        `${baseIconPath}.png`
      ]

      // 同步检查文件存在性(在回调中使用同步方法)
      for (const candidate of iconCandidates) {
        try {
          if (fsSync.existsSync(candidate)) {
            return resolve(candidate)
          }
        } catch {
          continue
        }
      }

      // 都找不到,返回默认图标
      resolve(
        '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns'
      )
    })
  })
}

// 并发控制函数
async function pLimit<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = []
  const executing: Promise<void>[] = []

  for (const task of tasks) {
    const promise = task().then((result) => {
      results.push(result)
      executing.splice(executing.indexOf(promise), 1)
    })

    executing.push(promise)

    if (executing.length >= concurrency) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)
  return results
}

export async function scanApplications(): Promise<App[]> {
  try {
    console.time('扫描应用')

    // 只扫描常用应用目录
    const searchPaths = [
      '/Applications',
      '/System/Applications',
      `${process.env.HOME}/Applications`
    ]

    const allAppPaths: string[] = []

    // 快速读取所有应用路径
    for (const searchPath of searchPaths) {
      try {
        const entries = await fs.readdir(searchPath, { withFileTypes: true })
        const appDirs = entries
          .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
          .map((entry) => path.join(searchPath, entry.name))

        allAppPaths.push(...appDirs)
      } catch {
        continue
      }
    }

    console.log(`找到 ${allAppPaths.length} 个应用`)

    // 创建任务数组,使用并发控制
    const tasks = allAppPaths.map((appPath) => async () => {
      try {
        // 使用 mdls 获取显示名称
        const { stdout: displayName } = await execAsync(
          `mdls -name kMDItemDisplayName "${appPath}" 2>/dev/null | grep kMDItemDisplayName | cut -d'"' -f2`,
          { timeout: 1000 }
        )

        let name = displayName.trim().replace(/\.app$/i, '')
        if (!name) {
          name = path.basename(appPath, '.app')
        }

        // 获取图标文件路径
        const iconPath = await getIconFile(appPath)

        return {
          name,
          path: appPath,
          icon: iconPath
        }
      } catch {
        return {
          name: path.basename(appPath, '.app'),
          path: appPath,
          icon: '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns'
        }
      }
    })

    // 限制并发数为 50
    const apps = await pLimit(tasks, 50)

    console.timeEnd('扫描应用')
    console.log(`成功加载 ${apps.length} 个应用`)

    return apps
  } catch (error) {
    console.error('扫描应用失败:', error)
    return []
  }
}
