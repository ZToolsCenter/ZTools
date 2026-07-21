import { ref } from 'vue'
import {
  useMatchCommandDetail,
  type SelectedMatchCommand
} from '@/components/common/MatchCommandDetailDialog/MatchCommandDetailDialog'
import type { TagDropdownMenuItem } from '@/components'
import {
  jumpFunctionShortcutsSetting,
  type ShortcutsSettingAliasDraftTarget
} from '@/views/ShortcutsSetting/ShortcutsSetting'
import { getCommandId as _getCommandId } from '@shared/commandShared'

export type CommandCmdType = 'text' | 'regex' | 'over' | 'img' | 'files' | 'window'

type MatchCmd = {
  type: string
  match: string | Record<string, any>
  exclude?: string
  minLength?: number
  maxLength?: number
  fileType?: 'file' | 'directory'
  extensions?: string[]
  [key: string]: any
}

export interface CommandActionCommand {
  name: string
  path?: string
  icon?: string
  type: string
  subType?: string
  featureCode?: string
  pluginName?: string
  pluginTitle?: string
  pluginExplain?: string
  cmdType?: CommandCmdType
  matchCmd?: MatchCmd
}

export interface UsePluginCommandActionsOptions {
  /** 当前插件的有效名称（开发版含 __dev 后缀），用于 commandId */
  getPluginName: () => string | undefined
  /** 当前插件的安装路径，用于匹配 canonical command */
  getPluginPath: () => string | undefined
  /** 当前插件的展示标题，用于别名草稿与快捷键 payload */
  getPluginTitle: () => string | undefined
}

// 禁用指令 / 搜索固定 持久化 key
const DISABLED_COMMANDS_KEY = 'disable-commands'
const SEARCH_PINNED_KEY = 'pinned-commands'

/**
 * 插件指令操作逻辑（禁用 / 固定到搜索 / 固定到超级面板 / 全局快捷键 / 自定义别名 / 打开）
 *
 * 同时服务「插件详情页」与「全部指令页」，逻辑保持一致。
 * 数据源通过 options 注入（插件名 / 路径 / 标题），内部自行加载
 * 禁用列表、超级面板固定、搜索固定以及 canonical commands 快照。
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function usePluginCommandActions(options: UsePluginCommandActionsOptions) {
  const { getPluginName, getPluginPath, getPluginTitle } = options

  // 禁用指令列表
  const disabledCommands = ref<string[]>([])

  // 超级面板固定列表
  const superPanelPinned = ref<any[]>([])

  // 搜索窗口固定列表
  const searchPinned = ref<any[]>([])

  // 当前插件对应的 canonical commands 快照（含 text 与 match），用于补齐 icon/path 等运行时字段
  const pluginCommands = ref<CommandActionCommand[]>([])

  // ============ commandId ============

  function getPluginCommandId(
    pluginName: string,
    featureCode: string,
    cmdName: string,
    cmdType: 'text' | 'window'
  ): string {
    return _getCommandId({
      type: 'plugin',
      pluginName,
      featureCode,
      name: cmdName,
      cmdType
    })
  }

  // ============ 禁用指令 ============

  function isCommandDisabled(
    pluginName: string,
    featureCode: string,
    cmdName: string,
    cmdType: 'text' | 'window'
  ): boolean {
    const id = getPluginCommandId(pluginName, featureCode, cmdName, cmdType)
    return disabledCommands.value.includes(id)
  }

  async function toggleCommandDisabled(
    pluginName: string,
    featureCode: string,
    cmdName: string,
    cmdType: 'text' | 'window'
  ): Promise<void> {
    const id = getPluginCommandId(pluginName, featureCode, cmdName, cmdType)
    const index = disabledCommands.value.indexOf(id)

    if (index === -1) {
      disabledCommands.value.push(id)
    } else {
      disabledCommands.value.splice(index, 1)
    }

    await saveDisabledCommands()
  }

  async function saveDisabledCommands(): Promise<void> {
    try {
      const plainArray = [...disabledCommands.value]
      await window.ztools.internal.dbPut(DISABLED_COMMANDS_KEY, plainArray)
      await window.ztools.internal.notifyDisabledCommandsChanged()
    } catch (error) {
      console.error('保存禁用指令列表失败:', error)
    }
  }

  async function loadDisabledCommands(): Promise<void> {
    try {
      const data = await window.ztools.internal.dbGet(DISABLED_COMMANDS_KEY)
      if (data && Array.isArray(data)) {
        disabledCommands.value = data
      }
    } catch (error) {
      console.error('加载禁用指令列表失败:', error)
    }
  }

  // ============ 超级面板固定 ============

  async function loadSuperPanelPinned(): Promise<void> {
    try {
      superPanelPinned.value = await window.ztools.internal.getSuperPanelPinned()
    } catch (error) {
      console.error('加载超级面板固定列表失败:', error)
    }
  }

  function isPinnedToSuperPanel(pluginName: string, featureCode: string, cmdName: string): boolean {
    return superPanelPinned.value.some(
      (item) =>
        item.name === cmdName && item.featureCode === featureCode && item.pluginName === pluginName
    )
  }

  async function toggleSuperPanelPin(
    pluginName: string,
    featureCode: string,
    cmdName: string
  ): Promise<void> {
    const isPinned = isPinnedToSuperPanel(pluginName, featureCode, cmdName)

    if (isPinned) {
      const item = superPanelPinned.value.find(
        (i) => i.name === cmdName && i.featureCode === featureCode && i.pluginName === pluginName
      )
      if (item) {
        await window.ztools.internal.unpinSuperPanelCommand(item.path, item.featureCode)
      }
    } else {
      const command = findPluginCommand(featureCode, cmdName)

      if (command) {
        await window.ztools.internal.pinToSuperPanel({
          name: command.name,
          path: command.path || '',
          icon: command.icon || '',
          type: command.type,
          featureCode: command.featureCode || '',
          pluginName,
          pluginExplain: command.pluginExplain || '',
          cmdType: command.cmdType || 'text'
        })
      }
    }

    await loadSuperPanelPinned()
  }

  // ============ 搜索框固定 ============

  async function loadSearchPinned(): Promise<void> {
    try {
      const data = await window.ztools.internal.dbGet(SEARCH_PINNED_KEY)
      if (data && Array.isArray(data)) {
        searchPinned.value = data
      }
    } catch (error) {
      console.error('加载搜索固定列表失败:', error)
    }
  }

  function isPinnedToSearch(pluginPath: string | undefined, featureCode: string): boolean {
    return searchPinned.value.some(
      (item) => item.path === pluginPath && item.featureCode === featureCode
    )
  }

  async function toggleSearchPin(
    pluginName: string,
    pluginPath: string | undefined,
    featureCode: string,
    cmdName: string
  ): Promise<void> {
    const pinned = isPinnedToSearch(pluginPath, featureCode)

    if (pinned) {
      // 注意：主进程 filterOutCommand 对插件类型按 pluginName 匹配（而非指令名），
      // 因此取消固定时必须传 pluginName，否则无法命中存储项导致取消失败。
      await window.ztools.internal.unpinApp(pluginPath || '', featureCode, pluginName)
    } else {
      const command = findPluginCommand(featureCode, cmdName)

      if (command) {
        await window.ztools.internal.pinApp(JSON.parse(JSON.stringify(command)))
      }
    }

    await loadSearchPinned()
  }

  // ============ canonical commands ============

  /** 在 pluginCommands 中按 featureCode + cmdName 定位指令 */
  function findPluginCommand(
    featureCode: string,
    cmdName: string
  ): CommandActionCommand | undefined {
    return pluginCommands.value.find((c) => c.featureCode === featureCode && c.name === cmdName)
  }

  async function loadPluginCommands(): Promise<void> {
    const pluginPath = getPluginPath()
    // 切换到非插件来源（如系统应用）时清空缓存，避免残留上一个插件的指令数据
    if (!pluginPath) {
      pluginCommands.value = []
      return
    }

    try {
      const result = await window.ztools.internal.getCommands()
      const all: CommandActionCommand[] = [
        ...(result.commands || []),
        ...(result.regexCommands || [])
      ]
      pluginCommands.value = all.filter((c) => c.path === pluginPath && c.type === 'plugin')
    } catch (error) {
      console.error('加载插件指令数据失败:', error)
    }
  }

  // ============ 打开指令 ============

  async function openCommand(featureCode: string, cmdName: string): Promise<void> {
    try {
      const command = findPluginCommand(featureCode, cmdName)

      if (!command) {
        console.error('未找到指令:', { featureCode, cmdName })
        return
      }

      await window.ztools.internal.launch({
        path: command.path || '',
        type: command.type,
        featureCode: command.featureCode,
        name: command.name,
        param: {
          payload: ''
        }
      })
    } catch (error) {
      console.error('打开指令失败:', error)
    }
  }

  // ============ 自定义别名 ============

  function buildPluginAliasDraftTarget(
    pluginName: string,
    featureCode: string,
    cmdName: string,
    cmdType: 'text' | 'window'
  ): ShortcutsSettingAliasDraftTarget {
    const pluginTitle = getPluginTitle() || pluginName
    const commandIcon = findPluginCommand(featureCode, cmdName)?.icon

    return {
      commandId: getPluginCommandId(pluginName, featureCode, cmdName, cmdType),
      type: 'plugin',
      path: getPluginPath(),
      groupKey: pluginName,
      groupTitle: pluginTitle,
      featureCode,
      subtitle: featureCode,
      pluginName,
      pluginTitle,
      cmdName,
      cmdType,
      icon: commandIcon
    }
  }

  function openAliasShortcut(
    pluginName: string,
    featureCode: string,
    cmdName: string,
    cmdType: 'text' | 'window'
  ): void {
    jumpFunctionShortcutsSetting({
      tab: 'alias',
      draftTarget: buildPluginAliasDraftTarget(pluginName, featureCode, cmdName, cmdType)
    })
  }

  function isAliasableCmdType(cmdType?: string): cmdType is 'text' | 'window' {
    return cmdType === 'text' || cmdType === 'window'
  }

  // ============ 菜单项 ============

  function getMenuItems(
    isDisabled: boolean,
    cmdType?: string,
    pluginName?: string,
    featureCode?: string,
    cmdName?: string
  ): TagDropdownMenuItem[] {
    const items: TagDropdownMenuItem[] = []

    const canAddAlias = isAliasableCmdType(cmdType) && pluginName && featureCode && cmdName

    if (cmdType && cmdType !== 'text') {
      items.push({
        key: 'detail',
        label: '查看详情',
        icon: 'i-z-info'
      })
    }

    if (cmdType === 'text') {
      items.push({
        key: 'open',
        label: '打开指令',
        icon: 'i-z-play'
      })

      if (pluginName && featureCode && cmdName) {
        const pinned = isPinnedToSuperPanel(pluginName, featureCode, cmdName)
        items.push({
          key: 'pin-super-panel',
          label: pinned ? '取消固定超级面板' : '固定到超级面板',
          icon: 'i-z-pin'
        })

        const searchPinnedState = isPinnedToSearch(getPluginPath(), featureCode)
        items.push({
          key: 'pin-search',
          label: searchPinnedState ? '取消固定搜索' : '固定到搜索',
          icon: 'i-z-pin'
        })

        items.push({
          key: 'set-global-shortcut',
          label: '设置全局快捷键',
          icon: 'i-z-keyboard'
        })
      }
    }

    if (canAddAlias) {
      items.push({
        key: 'custom-alias',
        label: '自定义别名',
        icon: 'i-z-alias'
      })
    }

    items.push({
      key: 'toggle',
      label: isDisabled ? '启用指令' : '禁用指令',
      icon: isDisabled ? 'i-z-check' : 'i-z-ban',
      danger: !isDisabled
    })

    return items
  }

  // ============ 匹配指令详情弹窗（集成禁用钩子） ============
  // 放在菜单处理之前，确保 cmdKey / openMatchCommandDetail 等先定义后被引用。

  const {
    selectedMatchCommand,
    selectedMatchCommandDisabled,
    openMatchCommandDetail,
    closeMatchCommandDetail,
    toggleSelectedMatchCommandDisabled,
    cmdKey,
    normalizeCommand,
    isMatchCommand
  } = useMatchCommandDetail({
    getPluginName: () => getPluginName() || '',
    isDisabled: (detail: SelectedMatchCommand) =>
      isCommandDisabled(
        detail.pluginName || getPluginName() || '',
        detail.feature.code || '',
        cmdKey(detail.command),
        (detail.command.type || 'text') as CommandCmdType
      ),
    toggleDisabled: (detail: SelectedMatchCommand) =>
      toggleCommandDisabled(
        detail.pluginName || getPluginName() || '',
        detail.feature.code || '',
        cmdKey(detail.command),
        (detail.command.type || 'text') as CommandCmdType
      )
  })

  async function handleMenuSelect(
    key: string,
    pluginName: string,
    featureCode: string,
    cmdName: string,
    cmdType: 'text' | 'window'
  ): Promise<void> {
    if (key === 'toggle') {
      await toggleCommandDisabled(pluginName, featureCode, cmdName, cmdType)
    } else if (key === 'open') {
      await openCommand(featureCode, cmdName)
    } else if (key === 'pin-super-panel') {
      await toggleSuperPanelPin(pluginName, featureCode, cmdName)
    } else if (key === 'pin-search') {
      await toggleSearchPin(pluginName, getPluginPath(), featureCode, cmdName)
    } else if (key === 'set-global-shortcut') {
      const pluginTitle = getPluginTitle() || pluginName
      jumpFunctionShortcutsSetting({
        payload: `${pluginTitle}/${cmdName}`
      })
    } else if (key === 'custom-alias') {
      if (!isAliasableCmdType(cmdType)) return
      openAliasShortcut(pluginName, featureCode, cmdName, cmdType)
    }
  }

  async function handleMatchMenuSelect(
    key: string,
    feature: { code?: string },
    cmd: { name?: string; label?: string; text?: string; type?: string }
  ): Promise<void> {
    if (key === 'detail') {
      openMatchCommandDetail(feature as any, cmd as any)
      return
    }

    const pluginName = getPluginName() || ''
    // 匹配指令的 name 在不同来源下字段不一致：
    // - 全部指令页：来自 canonical regexCommand.name（已规范化）
    // - 插件详情页：来自 plugin.json 原始对象，仅有 label
    // 这里统一使用 cmdKey，与 commandId 计算规则保持一致。
    const cmdName = cmdKey(cmd)
    await handleMenuSelect(
      key,
      pluginName,
      feature.code || '',
      cmdName,
      (cmd.type || 'text') as CommandCmdType
    )
  }

  // ============ 初始化 ============

  /** 并行加载禁用 / 超级面板 / 搜索固定 + canonical commands */
  async function loadAll(): Promise<void> {
    await Promise.all([
      loadDisabledCommands(),
      loadSuperPanelPinned(),
      loadSearchPinned(),
      loadPluginCommands()
    ])
  }

  return {
    // 状态
    disabledCommands,
    superPanelPinned,
    searchPinned,
    pluginCommands,
    // 加载
    loadAll,
    loadDisabledCommands,
    loadSuperPanelPinned,
    loadSearchPinned,
    loadPluginCommands,
    saveDisabledCommands,
    // commandId
    getPluginCommandId,
    // 判断
    isCommandDisabled,
    isPinnedToSuperPanel,
    isPinnedToSearch,
    // 切换
    toggleCommandDisabled,
    toggleSuperPanelPin,
    toggleSearchPin,
    // 操作
    openCommand,
    openAliasShortcut,
    // 菜单
    getMenuItems,
    handleMenuSelect,
    handleMatchMenuSelect,
    // 匹配指令详情
    selectedMatchCommand,
    selectedMatchCommandDisabled,
    openMatchCommandDetail,
    closeMatchCommandDetail,
    toggleSelectedMatchCommandDisabled,
    // 匹配指令工具
    cmdKey,
    normalizeCommand,
    isMatchCommand
  }
}
