import {
  getCommandId,
  getLegacyDirectAppCommandId,
  normalizeCommandAliases
} from '../../../shared/commandShared'
import { isMainPushPluginEnabled } from '../../../shared/pluginSettings'
import type {
  Command,
  CatalogCommand,
  CommandCatalog,
  CommandCatalogInput,
  CommandInputType,
  MatchCmd
} from '../../../shared/commandService'

/**
 * 归一化插件 cmd 的名称与匹配类型。
 * @param cmd 插件原始声明
 * @returns 可用于目录构建的名称与类型判定
 */
export function normalizeCmd(cmd: unknown): { isMatchCmd: boolean; cmdName: string } {
  if (typeof cmd === 'string') return { isMatchCmd: false, cmdName: cmd }
  if (!cmd || typeof cmd !== 'object') return { isMatchCmd: false, cmdName: '' }
  const value = cmd as { type?: string; label?: unknown }
  return {
    isMatchCmd: ['regex', 'over', 'img', 'files', 'window'].includes(value.type || ''),
    cmdName: typeof value.label === 'string' ? value.label : ''
  }
}

/**
 * 为执行目标生成与显示名无关的身份。
 * @param command 目录指令
 * @returns 可用于功能级分组的目标身份
 */
export function getTargetId(command: Command): string {
  return JSON.stringify(
    command.type === 'plugin'
      ? ['plugin', command.pluginName || command.path, command.featureCode || '']
      : [command.type, command.subType || '', command.path.replace(/\\/g, '/')]
  )
}

/**
 * 构建统一目录和别名身份，读音及搜索位置索引由引擎在 Worker 内建立。
 * @param input 主进程采集的原始来源和配置
 * @returns 完整目录、普通搜索表示与内容规则
 */
export function buildCommandCatalog(input: CommandCatalogInput): CommandCatalog {
  const commands: CatalogCommand[] = []
  const rules: CatalogCommand[] = []
  const canonical: CatalogCommand[] = []
  const aliases = normalizeCommandAliases(input.aliases)
  const disabled = new Set(input.disabledCommands)
  const disabledPlugins = new Set(input.disabledPlugins)

  /**
   * 发布单个指令和它的搜索表示，别名继承原规则身份。
   * @param command 指令声明
   * @param builtInAliases 应用本地化名称或本地启动项原名
   * @returns 无返回值
   */
  function add(command: Command, builtInAliases: string[] = []): void {
    if (typeof command.name !== 'string' || !command.name || typeof command.path !== 'string')
      return
    const targetId = getTargetId(command)
    const ruleId = JSON.stringify([
      targetId,
      command.cmdType || 'text',
      command.name,
      command.matchCmd || null
    ])
    const unavailable =
      disabledPlugins.has(command.path) ||
      (!!command.pluginName && disabledPlugins.has(command.pluginName)) ||
      disabled.has(getCommandId(command)) ||
      (command.type === 'direct' &&
        command.subType === 'app' &&
        disabled.has(getLegacyDirectAppCommandId(command.originalName || command.name)))
    const base: CatalogCommand = {
      ...command,
      targetId,
      ruleId,
      resultId: JSON.stringify([ruleId, command.name]),
      disabled: unavailable
    }
    canonical.push(base)
    if (unavailable || (command.subType === 'app' && input.localAppSearchEnabled === false)) return

    // 匹配型别名仅在原规则命中内容后参与筛选，避免将关键词错误传给插件。
    const isRule = !!base.matchCmd
    const names = [
      { alias: base.name, icon: base.icon },
      ...builtInAliases.map((alias) => ({ alias, icon: base.icon })),
      ...(aliases[getCommandId(base)] || [])
    ]
    const seen = new Set<string>()
    for (const entry of names) {
      if (!entry.alias || seen.has(entry.alias.toLowerCase())) continue
      seen.add(entry.alias.toLowerCase())
      const item: CatalogCommand = {
        ...base,
        name: entry.alias,
        icon: entry.icon || base.icon,
        resultId: JSON.stringify([ruleId, entry.alias])
      }
      if (isRule) rules.push(item)
      if (!isRule || (base.cmdType === 'window' && entry.alias !== base.name)) commands.push(item)
    }
  }

  // 应用与本地启动项保留旧名称，供历史、固定和旧版禁用键恢复。
  for (const app of input.apps) {
    if (typeof app?.name !== 'string' || typeof app.path !== 'string') continue
    add(
      { ...app, type: 'direct', subType: 'app', cmdType: 'text', originalName: app.name },
      Array.isArray(app.aliases) ? app.aliases.filter((alias) => typeof alias === 'string') : []
    )
  }
  for (const setting of input.settings) {
    if (!setting || typeof setting.uri !== 'string') continue
    add({
      name: setting.name,
      path: setting.uri,
      type: 'direct',
      subType: 'system-setting',
      cmdType: 'text',
      settingUri: setting.uri,
      category: setting.category,
      confirmDialog: setting.confirmDialog
    })
  }
  for (const shortcut of input.localShortcuts) {
    if (typeof shortcut?.name !== 'string' || typeof shortcut.path !== 'string') continue
    add(
      {
        name: shortcut.alias || shortcut.name,
        path: shortcut.path,
        icon: shortcut.icon,
        type: 'direct',
        subType: 'local-shortcut',
        cmdType: 'text',
        originalName: shortcut.name
      },
      shortcut.alias && shortcut.alias !== shortcut.name ? [shortcut.name] : []
    )
  }

  for (const plugin of input.plugins) {
    if (!plugin || typeof plugin.path !== 'string' || !Array.isArray(plugin.features)) continue
    const features = plugin.features.filter(
      (feature) =>
        feature &&
        (!feature.platform ||
          (Array.isArray(feature.platform)
            ? feature.platform.includes(process.platform)
            : feature.platform === process.platform))
    )
    const common = {
      path: plugin.path,
      type: 'plugin' as const,
      pluginName: plugin.name,
      pluginTitle: plugin.title,
      icon: plugin.logo
    }
    const hasName = features.some((feature) =>
      feature.cmds?.some((cmd) => normalizeCmd(cmd).cmdName === (plugin.title ?? plugin.name))
    )
    if (!hasName && features.length) {
      const fallback = !plugin.main
        ? features.find((feature) => feature.cmds?.some((cmd) => typeof cmd === 'string'))
        : undefined
      add({
        ...common,
        name: plugin.title ?? plugin.name,
        featureCode: fallback?.code,
        pluginExplain: fallback?.explain || plugin.description,
        cmdType: 'text'
      })
    }
    for (const feature of features) {
      if (!Array.isArray(feature.cmds)) continue
      for (const cmd of feature.cmds) {
        const { isMatchCmd, cmdName } = normalizeCmd(cmd)
        if (!cmdName) continue
        add({
          ...common,
          name: cmdName,
          featureCode: feature.code,
          pluginExplain: feature.explain,
          icon: feature.icon || plugin.logo,
          cmdType: isMatchCmd ? (cmd.type as CommandInputType) : 'text',
          matchCmd: isMatchCmd
            ? ({ ...cmd, match: cmd.match ?? cmd.regex } as MatchCmd)
            : undefined,
          mainPush:
            !!feature.mainPush && isMainPushPluginEnabled(plugin.name, input.enabledMainPushPlugins)
        })
      }
    }
  }
  return { commands, rules, canonical, plugins: input.plugins }
}
