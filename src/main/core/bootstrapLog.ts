import fs from 'fs'
import path from 'path'
import { getLogsPath } from './appData/appDataPaths'

/**
 * 在主程序和 electron-log 就绪前写入启动轨迹，定位登录瞬间秒退。
 * @param message 一行启动状态，例如单实例锁结果或退出原因。
 * @returns 无返回值
 */
export function writeBootstrapLog(message: string): void {
  try {
    const logsPath = getLogsPath()
    fs.mkdirSync(logsPath, { recursive: true })
    fs.appendFileSync(
      path.join(logsPath, 'bootstrap.log'),
      `[${new Date().toISOString()}] ${message}\n`,
      'utf8'
    )
  } catch {
    // 启动极早期写日志失败时不能再抛，否则会掩盖真正的退出原因。
  }
}
