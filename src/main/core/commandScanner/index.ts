import type { ApplicationScanResult } from './types'
import { scanApplications as macScan } from './macScanner'
import { scanApplications as winScan } from './windowsScanner'
import { scanApplications as linuxScan } from './linuxScanner'

export type { AppScanner, ApplicationScanResult, Command } from './types'

/**
 * 扫描当前平台的本地应用，并统一返回可判断完整性的结果。
 *
 * @returns 应用列表、扫描完整性和错误摘要。
 */
export async function scanApplications(): Promise<ApplicationScanResult> {
  const platform = process.platform

  if (platform === 'darwin') {
    // macOS
    return { apps: await macScan(), complete: true, errors: [] }
  } else if (platform === 'win32') {
    // Windows
    return winScan()
  } else if (platform === 'linux') {
    // Linux
    return { apps: await linuxScan(), complete: true, errors: [] }
  } else {
    console.warn(`[Scanner] 不支持的平台: ${platform}`)
    return { apps: [], complete: false, errors: [`Unsupported platform: ${platform}`] }
  }
}
