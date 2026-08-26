import { UwpManager, type UwpPackageChangeEvent } from './native'

export type { UwpPackageChangeEvent }

/**
 * 启动当前用户 UWP 包安装、更新和卸载完成事件监听。
 *
 * @param callback 包变化完成时调用的回调函数。
 * @returns 无返回值。
 * @throws 原生 PackageCatalog 监听初始化失败时抛出。
 */
export function startUwpPackageMonitor(callback: (event: UwpPackageChangeEvent) => void): void {
  UwpManager.startPackageMonitor(callback)
}

/**
 * 停止当前用户 UWP 包变化监听。
 *
 * @returns 无返回值。
 */
export function stopUwpPackageMonitor(): void {
  UwpManager.stopPackageMonitor()
}
