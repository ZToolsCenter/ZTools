export interface UpgradePluginInput {
  // 插件名称（用于日志）
  name: string
  // 已安装插件路径（卸载/停止时必须）
  path?: string
}

export interface UpgradeResult {
  success: boolean
  cancelled?: boolean
  error?: string
  plugin?: any
}

// 语义化版本比较：v1<v2 返回 -1，v1>v2 返回 1，相等返回 0
export function compareVersions(v1: string, v2: string): number {
  if (!v1 || !v2) return 0
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  const len = Math.max(parts1.length, parts2.length)
  for (let i = 0; i < len; i++) {
    const n1 = Number.isNaN(parts1[i]) ? 0 : (parts1[i] ?? 0)
    const n2 = Number.isNaN(parts2[i]) ? 0 : (parts2[i] ?? 0)
    if (n1 < n2) return -1
    if (n1 > n2) return 1
  }
  return 0
}

/**
 * 升级已安装插件到插件市场版本。
 * 流程：如在运行则先停止 -> 安装市场版本（覆盖安装，保留插件 LMDB 数据）。
 * @param installedPlugin 已安装插件信息
 * @param marketPlugin 插件市场中的目标版本数据
 * @returns 升级结果、取消状态或失败原因。
 */
export async function upgradeInstalledPluginFromMarket(
  installedPlugin: UpgradePluginInput,
  marketPlugin: any
): Promise<UpgradeResult> {
  if (!installedPlugin.path) {
    return { success: false, error: '缺少插件路径' }
  }
  if (!marketPlugin) {
    return { success: false, error: '未找到市场版本信息' }
  }

  try {
    console.log('开始升级插件:', installedPlugin.name)

    console.log('开始安装新版本（覆盖安装，保留插件数据）:', installedPlugin.name)
    const installResult = await window.ztools.internal.installPluginFromMarket(
      JSON.parse(JSON.stringify(marketPlugin))
    )
    // 用户取消下载时保留独立状态，避免把主动取消显示为安装失败。
    if (installResult.cancelled) {
      return { success: false, cancelled: true }
    }
    if (!installResult.success) {
      return { success: false, error: installResult.error || '安装新版本失败' }
    }

    console.log('插件升级成功:', installedPlugin.name)
    return { success: true, plugin: installResult.plugin }
  } catch (err: any) {
    console.error('插件升级异常:', installedPlugin.name, err)
    return { success: false, error: err?.message || '升级异常' }
  }
}
