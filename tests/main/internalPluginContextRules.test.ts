import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultContextMatcherRegistry } from '../../src/main/core/commands/matching/contextMatcherRegistry'
import type { CommandMatchContext } from '../../src/shared/commandService'

const CONTEXT_RULE_TYPES = new Set(['regex', 'over', 'img', 'files', 'window'])
const INTERNAL_PLUGIN_CONFIGS = [
  'internal-plugins/setting/public/plugin.json',
  'internal-plugins/system/public/plugin.json'
]

interface PluginConfigFixture {
  features: Array<{ code: string; cmds: unknown[] }>
}

/**
 * 读取内置插件的 plugin.json。
 * @param relativePath 相对仓库根目录的配置路径
 * @returns 解析后的插件配置
 */
function readPluginConfig(relativePath: string): PluginConfigFixture {
  return JSON.parse(readFileSync(resolve(__dirname, '../..', relativePath), 'utf8'))
}

/**
 * 构造只包含粘贴文件的内容快照。
 * @param files 粘贴的文件或目录
 * @returns 可交给内容规则验证的快照
 */
function filesContext(files: Array<{ name: string; isDirectory: boolean }>): CommandMatchContext {
  return {
    searchQuery: '',
    pastedImage: false,
    pastedFiles: files.map((file) => ({ path: `C:\\fixture\\${file.name}`, ...file })),
    pastedText: null
  }
}

describe('内置插件的内容匹配规则', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(INTERNAL_PLUGIN_CONFIGS)('%s 中的内容规则都能被注册表接受', (relativePath) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = createDefaultContextMatcherRegistry()
    const config = readPluginConfig(relativePath)

    // 无效规则会被降级为永不匹配，只留下告警，因此以告警判定配置是否合法。
    for (const feature of config.features) {
      for (const cmd of feature.cmds) {
        if (typeof cmd !== 'object' || cmd === null) continue
        const rule = cmd as { type?: string }
        if (!rule.type || !CONTEXT_RULE_TYPES.has(rule.type)) continue
        registry.prepare(rule as { type: string })
      }
    }

    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['function.local-launch-add?router=LocalLaunch', 'function.pin-to-search'])(
    '%s 同时匹配文件和目录',
    (code) => {
      const registry = createDefaultContextMatcherRegistry()
      const feature = readPluginConfig(INTERNAL_PLUGIN_CONFIGS[0]).features.find(
        (item) => item.code === code
      )
      const rule = feature?.cmds.find(
        (cmd) => typeof cmd === 'object' && cmd !== null && (cmd as any).type === 'files'
      ) as { type: string } | undefined
      expect(rule, `未找到 ${code} 的 files 规则`).toBeDefined()

      const prepared = registry.prepare(rule!)

      expect(prepared.matches(filesContext([{ name: 'app.exe', isDirectory: false }]))).toBe(true)
      expect(prepared.matches(filesContext([{ name: 'folder', isDirectory: true }]))).toBe(true)
    }
  )
})
