/**
 * 插件根目录启动检查。
 *
 * 事务恢复完成后校验所有已登记 ASAR，并报告未登记的 ASAR 实体或 unpack
 * 目录；检查只报告确定的不一致，不自动删除可能需要人工诊断的现场。
 */

import path from 'node:path'
import { physicalFs } from '../../utils/physicalFs.js'
import { validateAsarUnit } from './integrity'
import {
  assertSafePluginName,
  getCanonicalAsarPath,
  PLUGIN_TRANSACTIONS_DIR,
  resolveStorageKind
} from './paths'
import type { InstalledPluginRecord } from './types'

const fs = physicalFs.promises
const ASAR_SUFFIX = '.asar'
const UNPACKED_SUFFIX = '.asar.unpacked'

/** 启动检查发现的确定性存储错误。 */
export interface PluginStorageInspectionFailure {
  /** 能从记录或规范文件名确定时返回插件名。 */
  pluginName?: string
  /** 可直接显示给用户的失败原因。 */
  error: string
}

/**
 * 校验登记记录并寻找没有数据库记录的孤立 ASAR 安装单元。
 * @param options 插件根目录与当前记录快照
 */
export async function inspectPluginStorage(options: {
  pluginsDir: string
  plugins: InstalledPluginRecord[]
  ignoredPluginNames?: ReadonlySet<string>
}): Promise<PluginStorageInspectionFailure[]> {
  const failures = await validateRegisteredAsars(options)
  const registeredPaths = new Set(options.plugins.map((plugin) => path.resolve(plugin.path)))
  for (const asarPath of await findPhysicalAsarCandidates(options.pluginsDir)) {
    const pluginName = path.basename(asarPath, ASAR_SUFFIX)
    if (options.ignoredPluginNames?.has(pluginName)) continue
    if (registeredPaths.has(path.resolve(asarPath))) continue
    if (registeredPaths.has(path.resolve(`${asarPath}.unpacked`))) continue
    failures.push({
      pluginName,
      error: '发现未登记的 ASAR 安装单元'
    })
  }
  return failures
}

/** 校验所有明确声明为 ASAR 的数据库记录。 */
async function validateRegisteredAsars(options: {
  pluginsDir: string
  plugins: InstalledPluginRecord[]
  ignoredPluginNames?: ReadonlySet<string>
}): Promise<PluginStorageInspectionFailure[]> {
  const failures: PluginStorageInspectionFailure[] = []
  for (const plugin of options.plugins) {
    if (resolveStorageKind(plugin) !== 'asar') continue
    if (options.ignoredPluginNames?.has(plugin.name)) continue
    try {
      assertSafePluginName(plugin.name)
      const expectedPath = getCanonicalAsarPath(options.pluginsDir, plugin.name)
      if (path.resolve(plugin.path) !== path.resolve(expectedPath)) {
        throw new Error('ASAR 插件记录没有指向规范安装路径')
      }
      await validateAsarUnit(plugin.path, plugin.name)
    } catch (error) {
      failures.push({ pluginName: plugin.name, error: errorMessage(error) })
    }
  }
  return failures
}

/** 收集物理根目录中可能组成 ASAR 安装单元的规范实体路径。 */
async function findPhysicalAsarCandidates(pluginsDir: string): Promise<Set<string>> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(pluginsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }

  const candidates = new Set<string>()
  for (const entry of entries) {
    if (entry.name === PLUGIN_TRANSACTIONS_DIR) continue
    if (entry.name.endsWith(ASAR_SUFFIX) && !entry.isDirectory()) {
      candidates.add(path.join(pluginsDir, entry.name))
      continue
    }
    if (entry.name.endsWith(UNPACKED_SUFFIX) && entry.isDirectory()) {
      candidates.add(path.join(pluginsDir, entry.name.slice(0, -'.unpacked'.length)))
    }
  }
  return candidates
}

/** 将未知异常转换为保留原始原因的文本。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
