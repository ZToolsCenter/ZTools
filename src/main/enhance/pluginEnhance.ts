/**
 * [ZT-Enhance] ZTools 本地增强模块
 * ------------------------------------------------------
 * 本文件是所有本地自定义功能（自动固定 + 插件批量管理）的唯一实现处。
 * 各处调用点均以 "// [ZT-Enhance]" 注释标记，全局搜索该标记即可找到全部改动点。
 *
 * 功能清单：
 *  1. AutoPin 自动固定：新安装/更新的插件立即固定到
 *     「双击 Alt 搜索面板」(pinned-commands) 与「鼠标超级面板」(super-panel-pinned)，
 *     写入发生在 writeInstalledPlugins 内、面板刷新事件之前，因此装完即可见。
 *     同时修复插件更新导致的 asar 路径失效。手动取消固定的插件不会被加回
 *     （以写入前注册表里已存在的插件名为准）。
 *  2. 插件批量管理（设置 → 通用设置 → 插件批量管理卡片）：
 *     - autoDetachAll  自动分离窗口（默认 true）：点击插件直接在独立窗口打开
 *     - outKillAll     关闭后自动销毁（默认 false）：插件退出即结束进程并销毁视图
 *     - autoStartAll   跟随启动（默认 false）：启动时后台加载全部已安装插件（重启生效）
 *     批量开关优先于单个插件的同名设置；关闭批量开关后回落到按插件配置。
 *
 * 配置文档：宿主库 batch-plugin-manage（见 HOST_STORAGE_KEYS.batchPluginManage）
 */
import databaseAPI from '../api/shared/database'
import { HOST_STORAGE_KEYS } from '../../shared/storageKeys'

export interface BatchPluginManageConfig {
  autoStartAll: boolean
  outKillAll: boolean
  autoDetachAll: boolean
}

const BATCH_DEFAULTS: BatchPluginManageConfig = {
  autoStartAll: false,
  outKillAll: false,
  autoDetachAll: true
}

export function getBatchPluginManageConfig(): BatchPluginManageConfig {
  try {
    const cfg = databaseAPI.dbGet(HOST_STORAGE_KEYS.batchPluginManage)
    return { ...BATCH_DEFAULTS, ...(cfg && typeof cfg === 'object' ? cfg : {}) }
  } catch {
    return { ...BATCH_DEFAULTS }
  }
}

function pickDefaultFeature(plugin: any): any {
  const features = Array.isArray(plugin?.features) ? plugin.features : []
  const hasStringCmd = (f: any) =>
    Array.isArray(f?.cmds) && f.cmds.some((c: any) => typeof c === 'string' && c.trim())
  return (
    features.find((f: any) => f && f.mainPush && hasStringCmd(f)) || features.find(hasStringCmd)
  )
}

function buildBaseEntry(plugin: any, feature: any): Record<string, unknown> {
  const name = feature.cmds.find((c: any) => typeof c === 'string' && c.trim()).trim()
  return {
    name,
    path: plugin.path,
    icon: plugin.logo || '',
    type: 'plugin',
    featureCode: feature.code,
    pluginName: plugin.name
  }
}

function toPinyinFields(name: string): { pinyin: string; pinyinAbbr: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { pinyin } = require('pinyin-pro')
    return {
      pinyin: pinyin(name, { toneType: 'none', type: 'string' }).replace(/\s+/g, '').toLowerCase(),
      pinyinAbbr: pinyin(name, { pattern: 'first', toneType: 'none', type: 'string' })
        .replace(/\s+/g, '')
        .toLowerCase()
    }
  } catch {
    return { pinyin: '', pinyinAbbr: '' }
  }
}

/**
 * 在 writeInstalledPlugins 覆盖插件注册表时调用：
 * 先于覆盖读取旧注册表，随后为"新出现"的插件补固定、并修复已有固定条目的失效路径。
 * @param previousPlugins 覆盖前的插件注册表
 * @param nextPlugins 即将写入的插件注册表
 */
export function autoPinOnPluginsWrite(previousPlugins: unknown, nextPlugins: any[]): void {
  try {
    const prevNames = new Set(
      Array.isArray(previousPlugins) ? previousPlugins.map((p: any) => p && p.name) : []
    )
    const list = Array.isArray(nextPlugins) ? nextPlugins.filter(Boolean) : []
    const byName = new Map(list.map((p) => [p.name, p]))
    let disabled = new Set<string>()
    try {
      const d = databaseAPI.dbGet(HOST_STORAGE_KEYS.disabledPlugins)
      disabled = new Set(Array.isArray(d) ? d.filter(Boolean) : [])
    } catch {}

    for (const key of [HOST_STORAGE_KEYS.pinnedCommands, HOST_STORAGE_KEYS.superPanelPinned]) {
      const pinned = databaseAPI.dbGet(key)
      if (!Array.isArray(pinned)) continue
      let changed = false

      // 插件更新后 asar 文件名变化 → 修复固定条目里的旧路径
      for (const entry of pinned) {
        if (!entry || entry.type !== 'plugin' || !entry.pluginName) continue
        const plugin = byName.get(entry.pluginName)
        if (plugin && plugin.path && plugin.path !== entry.path) {
          entry.path = plugin.path
          if (plugin.logo) entry.icon = plugin.logo
          changed = true
          console.log('[ZT-Enhance] 插件更新，已修复固定路径:', entry.pluginName)
        }
      }

      // 为新安装的插件补固定（旧注册表中不存在 = 新插件）
      for (const plugin of list) {
        if (!plugin.name || !plugin.path) continue
        if (prevNames.has(plugin.name)) continue
        if (disabled.has(plugin.path)) continue
        if (pinned.some((e: any) => e && e.pluginName === plugin.name)) continue
        const feature = pickDefaultFeature(plugin)
        if (!feature) continue
        const base = buildBaseEntry(plugin, feature)
        if (key === HOST_STORAGE_KEYS.pinnedCommands) {
          const py = toPinyinFields(base.name as string)
          pinned.push({
            ...base,
            pluginExplain: feature.explain || plugin.description || '',
            cmdType: 'text',
            ...py
          })
        } else {
          pinned.push({ ...base, pluginExplain: plugin.description || '', cmdType: 'text' })
        }
        changed = true
        console.log('[ZT-Enhance] 新插件已自动固定:', plugin.name)
      }

      if (changed) databaseAPI.dbPut(key, pinned)
    }
  } catch (error) {
    console.error('[ZT-Enhance] 自动固定失败:', error)
  }
}
