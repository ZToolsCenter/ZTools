import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * AppleScript 辅助工具类
 * 提供常用的 macOS 系统交互功能
 */
class AppleScriptHelper {
  /**
   * 执行 AppleScript 脚本
   * @param script AppleScript 脚本内容
   * @returns 脚本执行结果
   */
  private async execute(script: string): Promise<string> {
    try {
      // 转义单引号以防止脚本注入
      const escapedScript = script.replace(/'/g, "'\\''")
      const { stdout } = await execAsync(`osascript -e '${escapedScript}'`)
      return stdout.trim()
    } catch (error) {
      console.error('执行 AppleScript 失败:', error)
      throw error
    }
  }

  /**
   * 获取访达（Finder）当前打开的路径
   * @returns 访达当前路径，如果访达未激活或没有打开窗口则返回 null
   */
  async getFinderPath(): Promise<string | null> {
    try {
      const script = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
        end tell

        if frontApp is "Finder" then
          tell application "Finder"
            if (count of windows) > 0 then
              return POSIX path of (target of front window as alias)
            else
              return ""
            end if
          end tell
        else
          return ""
        end if
      `
      const result = await this.execute(script)
      return result || null
    } catch (error) {
      console.error('获取访达路径失败:', error)
      return null
    }
  }

  /**
   * 获取当前激活的应用程序信息
   * @returns 当前激活应用的信息对象
   */
  async getFrontmostApp(): Promise<{
    name: string
    bundleId: string
    path: string
  } | null> {
    try {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp

          -- 获取 Bundle Identifier
          set appBundleId to bundle identifier of frontApp

          -- 获取应用路径
          tell application "Finder"
            set appPath to POSIX path of (application file id appBundleId as alias)
          end tell

          return appName & "|" & appBundleId & "|" & appPath
        end tell
      `
      const result = await this.execute(script)

      if (result) {
        const [name, bundleId, path] = result.split('|')
        return { name, bundleId, path }
      }

      return null
    } catch (error) {
      console.error('获取当前激活应用失败:', error)
      return null
    }
  }

  /**
   * 获取当前激活应用的名称（简化版）
   * @returns 应用名称
   */
  async getFrontmostAppName(): Promise<string | null> {
    try {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          return name of frontApp
        end tell
      `
      const result = await this.execute(script)
      return result || null
    } catch (error) {
      console.error('获取当前激活应用名称失败:', error)
      return null
    }
  }

  /**
   * 激活指定的应用程序（通过应用名称）
   * @param appName 应用程序名称（例如：Safari, Chrome, Finder）
   * @returns 是否成功激活
   */
  async activateAppByName(appName: string): Promise<boolean> {
    try {
      const script = `
        tell application "${appName}"
          activate
        end tell
      `
      await this.execute(script)
      return true
    } catch (error) {
      console.error(`激活应用 ${appName} 失败:`, error)
      return false
    }
  }

  /**
   * 激活指定的应用程序（通过 Bundle ID）
   * @param bundleId Bundle Identifier（例如：com.apple.Safari）
   * @returns 是否成功激活
   */
  async activateAppByBundleId(bundleId: string): Promise<boolean> {
    try {
      const script = `
        tell application id "${bundleId}"
          activate
        end tell
      `
      await this.execute(script)
      return true
    } catch (error) {
      console.error(`激活应用 ${bundleId} 失败:`, error)
      return false
    }
  }

  /**
   * 激活指定的应用程序（通过应用路径）
   * @param appPath 应用程序路径（例如：/Applications/Safari.app）
   * @returns 是否成功激活
   */
  async activateAppByPath(appPath: string): Promise<boolean> {
    try {
      const script = `
        tell application "${appPath}"
          activate
        end tell
      `
      await this.execute(script)
      return true
    } catch (error) {
      console.error(`激活应用 ${appPath} 失败:`, error)
      return false
    }
  }

  /**
   * 在终端中打开指定路径
   * @param path 要打开的路径
   * @returns 是否成功打开
   */
  async openInTerminal(path: string): Promise<boolean> {
    try {
      // 转义路径中的单引号
      const escapedPath = path.replace(/'/g, "'\\''")
      const script = `
        tell application "Terminal"
          activate
          do script "cd '${escapedPath}'"
        end tell
      `
      await this.execute(script)
      return true
    } catch (error) {
      console.error('在终端打开路径失败:', error)
      return false
    }
  }

  /**
   * 显示系统通知
   * @param title 通知标题
   * @param message 通知内容
   * @param subtitle 通知副标题（可选）
   * @returns 是否成功显示
   */
  async showNotification(title: string, message: string, subtitle?: string): Promise<boolean> {
    try {
      const subtitlePart = subtitle ? `subtitle "${subtitle}"` : ''
      const script = `
        display notification "${message}" with title "${title}" ${subtitlePart}
      `
      await this.execute(script)
      return true
    } catch (error) {
      console.error('显示通知失败:', error)
      return false
    }
  }

  /**
   * 获取所有运行中的应用程序列表
   * @returns 运行中的应用程序名称数组
   */
  async getRunningApps(): Promise<string[]> {
    try {
      const script = `
        tell application "System Events"
          set appList to name of every application process
          return appList as text
        end tell
      `
      const result = await this.execute(script)
      if (result) {
        // AppleScript 返回的列表用逗号分隔
        return result.split(', ').filter((name) => name.trim())
      }
      return []
    } catch (error) {
      console.error('获取运行中应用列表失败:', error)
      return []
    }
  }

  /**
   * 检查指定应用是否正在运行
   * @param appName 应用程序名称
   * @returns 是否正在运行
   */
  async isAppRunning(appName: string): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          set isRunning to (name of processes) contains "${appName}"
          return isRunning
        end tell
      `
      const result = await this.execute(script)
      return result === 'true'
    } catch (error) {
      console.error(`检查应用 ${appName} 运行状态失败:`, error)
      return false
    }
  }

  /**
   * 退出指定应用程序
   * @param appName 应用程序名称
   * @returns 是否成功退出
   */
  async quitApp(appName: string): Promise<boolean> {
    try {
      const script = `
        tell application "${appName}"
          quit
        end tell
      `
      await this.execute(script)
      return true
    } catch (error) {
      console.error(`退出应用 ${appName} 失败:`, error)
      return false
    }
  }

  /**
   * 隐藏指定应用程序
   * @param appName 应用程序名称
   * @returns 是否成功隐藏
   */
  async hideApp(appName: string): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          set visible of process "${appName}" to false
        end tell
      `
      await this.execute(script)
      return true
    } catch (error) {
      console.error(`隐藏应用 ${appName} 失败:`, error)
      return false
    }
  }

  /**
   * 执行粘贴操作（模拟 Command+V）
   * @returns 是否成功执行粘贴
   */
  async paste(): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `
      await this.execute(script)
      console.log('已执行粘贴操作 (Command+V)')
      return true
    } catch (error) {
      console.error('执行粘贴操作失败:', error)
      return false
    }
  }
}

// 导出单例
export default new AppleScriptHelper()
