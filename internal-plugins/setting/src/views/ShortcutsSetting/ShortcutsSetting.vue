<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useToast, ShortcutEditor, AdaptiveIcon } from '@/components'
import { weightedSearch } from '@/utils'
import { useJumpFunction, useZtoolsSubInput } from '@/composables'
import type {
  ShortcutsSettingAliasCommandOption,
  ShortcutsSettingAliasDialogState,
  ShortcutsSettingAliasDraftTarget,
  ShortcutsSettingJumpFunction,
  ShortcutsSettingTab
} from '@/views/ShortcutsSetting/ShortcutsSetting'
import {
  COMMAND_ALIASES_KEY,
  DIRECT_APP_ALIAS_GROUP_KEY,
  DIRECT_APP_ALIAS_GROUP_TITLE,
  getCommandId as _getCommandId,
  normalizeCommandAliases
} from '@shared/commandShared'
import type { CommandAliasEntry, CommandAliasStore } from '@shared/commandShared'
import AliasMappingDialog from './components/AliasMappingDialog.vue'

const { success, error, warning, confirm } = useToast()

interface GlobalShortcut {
  id: string
  shortcut: string
  target: string
  enabled: boolean
  configurable?: boolean
  configKey?: BuiltInShortcutKey
}

type BuiltInShortcutKey = 'search' | 'closePlugin' | 'killPlugin'

type BuiltInShortcutConfig = Record<BuiltInShortcutKey, boolean>

interface AliasRow {
  id: string
  commandId: string
  alias: string
  icon?: string
  target: ShortcutsSettingAliasCommandOption | null
  targetLabel: string
  missingTarget: boolean
}

const DEFAULT_BUILTIN_SHORTCUTS_ENABLED: BuiltInShortcutConfig = {
  search: true,
  closePlugin: true,
  killPlugin: true
}

// 获取平台信息
const isMac = ref(false)
const isWindows = ref(false)

// 基础内置快捷键配置（使用 MOD 占位符表示 Cmd/Ctrl）
const baseBuiltInShortcuts: GlobalShortcut[] = [
  {
    id: 'builtin-detach',
    shortcut: 'MOD+D',
    target: '分离插件到独立窗口',
    enabled: true
  },
  {
    id: 'builtin-search',
    shortcut: 'MOD+F',
    target: '固定搜索框的文本，进行二次筛选',
    enabled: true,
    configurable: true,
    configKey: 'search'
  },
  {
    id: 'builtin-tab-target',
    shortcut: 'Tab',
    target: '在搜索框输入文字后，按 Tab 进入 Tab 键目标指令',
    enabled: true
  },
  {
    id: 'builtin-settings',
    shortcut: 'MOD+,',
    target: '打开设置',
    enabled: true
  },
  {
    id: 'builtin-kill-plugin',
    shortcut: 'MOD+Q',
    target: '终止当前插件运行',
    enabled: true,
    configurable: true,
    configKey: 'killPlugin'
  },
  {
    id: 'builtin-close-plugin',
    shortcut: 'MOD+W',
    target: '关闭插件/隐藏窗口',
    enabled: true,
    configurable: true,
    configKey: 'closePlugin'
  },
  {
    id: 'builtin-devtools',
    shortcut: 'DEVTOOLS',
    target: '打开/关闭开发者工具',
    enabled: true
  }
]

// 根据平台转换快捷键修饰符
const builtInAppShortcuts = computed<GlobalShortcut[]>(() => {
  const modifier = isMac.value ? 'Command' : isWindows.value ? 'Ctrl' : ''
  if (!modifier) return []

  return baseBuiltInShortcuts.map((item) => {
    if (item.shortcut === 'DEVTOOLS') {
      return {
        ...item,
        shortcut: isMac.value ? 'Option+Command+I' : 'Ctrl+Shift+I'
      }
    }

    return {
      ...item,
      shortcut: item.shortcut.replace('MOD', modifier)
    }
  })
})

const activeTab = ref<ShortcutsSettingTab>('global')
const globalShortcuts = ref<GlobalShortcut[]>([])
const appShortcuts = ref<GlobalShortcut[]>([])
const isDeleting = ref(false)
const loading = ref(true)
const builtInShortcutsEnabled = ref<BuiltInShortcutConfig>({ ...DEFAULT_BUILTIN_SHORTCUTS_ENABLED })

const aliasMappings = ref<CommandAliasStore>({})
// alias 目标列表来自主进程整理后的 canonical commands，仅包含允许直接触发的插件指令和系统应用。
const aliasTargetOptions = ref<ShortcutsSettingAliasCommandOption[]>([])
const aliasDialogVisible = ref(false)
const aliasDialogRef = ref<InstanceType<typeof AliasMappingDialog> | null>(null)
const aliasDialogState = ref<ShortcutsSettingAliasDialogState | null>(null)
const aliasSaving = ref(false)

const currentShortcuts = computed(() => {
  if (activeTab.value === 'global') return globalShortcuts.value
  if (activeTab.value === 'app') return appShortcuts.value
  return []
})

const { value: searchQuery } = useZtoolsSubInput('', '搜索快捷键或别名...')

const filteredShortcuts = computed(() =>
  weightedSearch(currentShortcuts.value, searchQuery.value || '', [
    { value: (s) => s.shortcut || '', weight: 10 },
    { value: (s) => s.target || '', weight: 5 }
  ])
)

const aliasTargetMap = computed(
  () => new Map(aliasTargetOptions.value.map((target) => [target.commandId, target]))
)

const aliasRows = computed<AliasRow[]>(() => {
  const rows: AliasRow[] = []

  // 持久化结构按 commandId 分桶，这里扁平化成表格行，方便展示和编辑。
  // 目标指令缺失时保留映射并标记 missingTarget，避免用户无感丢失历史配置。
  for (const [commandId, entries] of Object.entries(aliasMappings.value)) {
    for (const entry of entries || []) {
      const normalizedAlias = entry.alias.trim()
      if (!normalizedAlias) continue

      const target = aliasTargetMap.value.get(commandId) || null
      rows.push({
        id: `${commandId}::${normalizedAlias}`,
        commandId,
        alias: normalizedAlias,
        icon: entry.icon,
        target,
        targetLabel: getAliasTargetLabel(target),
        missingTarget: !target
      })
    }
  }

  return rows
})

const filteredAliasRows = computed(() =>
  weightedSearch(aliasRows.value, searchQuery.value || '', [
    { value: (row) => row.alias || '', weight: 10 },
    { value: (row) => row.targetLabel || '', weight: 6 },
    { value: (row) => row.commandId || '', weight: 2 }
  ])
)

const addButtonLabel = computed(() => (activeTab.value === 'alias' ? '添加映射' : '添加快捷键'))

const showAliasEmptyState = computed(() => !loading.value && aliasRows.value.length === 0)

const showAliasSearchEmptyState = computed(
  () => !loading.value && aliasRows.value.length > 0 && filteredAliasRows.value.length === 0
)

const showShortcutEditor = computed(() => showEditor.value && activeTab.value !== 'alias')
const showAliasEditor = computed(() => aliasDialogVisible.value && activeTab.value === 'alias')
const showDetailPanel = computed(() => showShortcutEditor.value || showAliasEditor.value)

const showEditor = ref(false)
const editingShortcut = ref<GlobalShortcut | null>(null)
const prefillTarget = ref('')

function getCommandId(command: {
  name: string
  path?: string
  type: 'plugin' | 'direct'
  subType?: 'app' | 'system-setting' | 'local-shortcut'
  featureCode?: string
  cmdType?: 'text' | 'window'
  pluginName?: string
}): string {
  return _getCommandId({
    type: command.type,
    subType: command.subType,
    path: command.path,
    pluginName: command.pluginName,
    featureCode: command.featureCode,
    name: command.name,
    cmdType: command.cmdType
  })
}

function getAliasTargetLabel(target: ShortcutsSettingAliasCommandOption | null): string {
  if (!target) return '目标已失效'
  return target.label
}

function cloneAliasStore(): CommandAliasStore {
  // 先转成普通对象，避免直接修改响应式引用，也避免后续 IPC 传输时混入 Vue 代理对象
  return JSON.parse(JSON.stringify(aliasMappings.value || {}))
}

function focusAliasInput(select = true): void {
  aliasDialogRef.value?.focusAliasInput(select)
}

function handleAliasDialogAfterEnter(): void {
  focusAliasInput(false)
}

function getAliasDisplayIcon(row: AliasRow): string | undefined {
  return row.icon || row.target?.icon
}

function resolveAliasTarget(
  target: ShortcutsSettingAliasDraftTarget
): ShortcutsSettingAliasCommandOption {
  return (
    // 优先复用当前最新的目标指令数据；若目标已经不在候选列表中，则退回路由里带过来的草稿信息
    aliasTargetMap.value.get(target.commandId) || {
      ...target,
      label: `${target.groupTitle} / ${target.cmdName}`
    }
  )
}

function openAliasDialog(state: ShortcutsSettingAliasDialogState): void {
  closeEditor()
  aliasDialogState.value = {
    ...state,
    target: state.target ? { ...state.target } : null
  }
  aliasDialogVisible.value = true
}

function closeAliasDialog(): void {
  aliasDialogVisible.value = false
  aliasDialogState.value = null
}

function openCreateAliasDialog(target?: ShortcutsSettingAliasDraftTarget): void {
  activeTab.value = 'alias'
  openAliasDialog({
    mode: 'create',
    alias: '',
    icon: undefined,
    target: target ? resolveAliasTarget(target) : null
  })
}

function openEditAliasDialog(row: AliasRow): void {
  openAliasDialog({
    mode: 'edit',
    originalCommandId: row.commandId,
    originalAlias: row.alias,
    alias: row.alias,
    icon: row.icon,
    target: row.target
  })
}

function buildAliasEntry(alias: string, icon?: string): CommandAliasEntry {
  return {
    alias: alias.trim(),
    icon: icon || undefined
  }
}

async function saveAliasMappings(nextStore: CommandAliasStore): Promise<boolean> {
  try {
    const normalized = normalizeCommandAliases(nextStore)
    // 保存前再次做一次归一化，并转成普通对象，避免把 Vue 响应式代理直接发给 IPC
    await window.ztools.internal.updateCommandAliases(JSON.parse(JSON.stringify(normalized)))
    aliasMappings.value = normalized
    return true
  } catch (err: any) {
    console.error('保存指令别名失败:', err)
    error(`保存指令别名失败: ${err?.message || '未知错误'}`)
    return false
  }
}

async function loadGlobalShortcuts(): Promise<void> {
  try {
    const data = await window.ztools.internal.dbGet('global-shortcuts')
    globalShortcuts.value = data || []
  } catch (err) {
    console.error('加载全局快捷键失败:', err)
  }
}

async function loadAppShortcuts(): Promise<void> {
  try {
    const data = await window.ztools.internal.dbGet('app-shortcuts')
    appShortcuts.value = data || []
  } catch (err) {
    console.error('加载应用快捷键失败:', err)
  }
}

async function loadBuiltInShortcutSettings(): Promise<void> {
  try {
    const settings = (await window.ztools.internal.dbGet('settings-general')) || {}
    const config = settings.builtinAppShortcutsEnabled || {}
    builtInShortcutsEnabled.value = {
      ...DEFAULT_BUILTIN_SHORTCUTS_ENABLED,
      ...config
    }
  } catch (err) {
    console.error('加载内置快捷键开关失败:', err)
  }
}

async function loadAliasMappings(): Promise<void> {
  try {
    const data = await window.ztools.internal.dbGet(COMMAND_ALIASES_KEY)
    // 设置页统一读取归一化后的 alias store，兼容旧版 string[] 结构
    aliasMappings.value = normalizeCommandAliases(data)
  } catch (err) {
    console.error('加载指令别名失败:', err)
  }
}

async function loadAliasTargets(): Promise<void> {
  try {
    const result = await window.ztools.internal.getCommands()
    const pluginMap = new Map((result.plugins || []).map((plugin: any) => [plugin.name, plugin]))
    const targetMap = new Map<string, ShortcutsSettingAliasCommandOption>()

    const addTarget = (target: ShortcutsSettingAliasCommandOption): void => {
      targetMap.set(target.commandId, target)
    }

    const addPluginTarget = (command: any, cmdType: 'text' | 'window'): void => {
      if (command.type !== 'plugin') return
      if (!command.pluginName || !command.featureCode || !command.name) return

      const plugin = pluginMap.get(command.pluginName)
      const pluginTitle = command.pluginTitle || plugin?.title || command.pluginName
      const commandId = getCommandId({
        type: 'plugin',
        path: command.path,
        pluginName: command.pluginName,
        featureCode: command.featureCode,
        name: command.name,
        cmdType
      })

      addTarget({
        commandId,
        type: 'plugin',
        path: command.path,
        groupKey: command.pluginName,
        groupTitle: pluginTitle,
        featureCode: command.featureCode,
        subtitle: command.featureCode,
        pluginName: command.pluginName,
        pluginTitle,
        cmdName: command.name,
        cmdType,
        icon: command.icon || plugin?.logo,
        label: `${pluginTitle} / ${command.name}`
      })
    }

    const addDirectAppTarget = (command: any): void => {
      if (
        command.type !== 'direct' ||
        command.subType !== 'app' ||
        !command.path ||
        !command.name
      ) {
        return
      }

      const commandId = getCommandId({
        type: 'direct',
        subType: 'app',
        path: command.path,
        name: command.name,
        cmdType: 'text'
      })

      addTarget({
        commandId,
        type: 'direct',
        subType: 'app',
        path: command.path,
        groupKey: DIRECT_APP_ALIAS_GROUP_KEY,
        groupTitle: DIRECT_APP_ALIAS_GROUP_TITLE,
        featureCode: command.path,
        subtitle: command.path,
        pluginName: DIRECT_APP_ALIAS_GROUP_KEY,
        pluginTitle: DIRECT_APP_ALIAS_GROUP_TITLE,
        cmdName: command.name,
        cmdType: 'text',
        icon: command.icon,
        label: `${DIRECT_APP_ALIAS_GROUP_TITLE} / ${command.name}`
      })
    }

    for (const command of result.commands || []) {
      if (command.type === 'direct' && command.subType === 'app') {
        addDirectAppTarget(command)
        continue
      }

      if (command.cmdType === 'text') {
        addPluginTarget(command, 'text')
      }
    }

    for (const command of result.regexCommands || []) {
      if (command.cmdType === 'window') {
        addPluginTarget(command, 'window')
      }
    }

    aliasTargetOptions.value = Array.from(targetMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label, 'zh-CN')
    )
  } catch (err) {
    console.error('加载指令目标失败:', err)
  }
}

async function loadShortcuts(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([
      loadGlobalShortcuts(),
      loadAppShortcuts(),
      loadBuiltInShortcutSettings(),
      loadAliasMappings(),
      loadAliasTargets()
    ])
  } finally {
    loading.value = false
  }
}

function switchToTab(tab: ShortcutsSettingTab): void {
  activeTab.value = tab

  // alias 编辑器与快捷键编辑器共用详情面板，切换 tab 时需要互斥清理另一侧状态
  if (tab === 'alias') {
    closeEditor()
    return
  }

  closeAliasDialog()
}

async function handleToggleBuiltInShortcut(
  key: BuiltInShortcutKey,
  enabled: boolean
): Promise<void> {
  try {
    const settings = (await window.ztools.internal.dbGet('settings-general')) || {}
    const nextConfig = {
      ...DEFAULT_BUILTIN_SHORTCUTS_ENABLED,
      ...(settings.builtinAppShortcutsEnabled || {}),
      [key]: enabled
    }
    settings.builtinAppShortcutsEnabled = nextConfig
    await window.ztools.internal.dbPut('settings-general', settings)
    builtInShortcutsEnabled.value = nextConfig
    success(enabled ? '已启用内置快捷键' : '已禁用内置快捷键')
  } catch (err: any) {
    console.error('更新内置快捷键开关失败:', err)
    error(`更新失败: ${err?.message || '未知错误'}`)
  }
}

function handleBuiltInToggleChange(key: BuiltInShortcutKey, event: Event): void {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  void handleToggleBuiltInShortcut(key, target.checked)
}

async function saveGlobalShortcuts(): Promise<void> {
  try {
    await window.ztools.internal.dbPut(
      'global-shortcuts',
      JSON.parse(JSON.stringify(globalShortcuts.value))
    )
  } catch (err) {
    console.error('保存全局快捷键失败:', err)
  }
}

async function saveAppShortcuts(): Promise<void> {
  try {
    await window.ztools.internal.dbPut(
      'app-shortcuts',
      JSON.parse(JSON.stringify(appShortcuts.value))
    )
  } catch (err) {
    console.error('保存应用快捷键失败:', err)
  }
}

async function handleSaveAliasDialog(state: ShortcutsSettingAliasDialogState): Promise<void> {
  if (aliasSaving.value) return

  const nextAlias = state.alias.trim()
  if (!nextAlias) {
    warning('别名不能为空')
    focusAliasInput(false)
    return
  }

  if (!state.target) {
    warning('请先选择目标指令')
    return
  }

  const nextStore = cloneAliasStore()

  // 编辑态采用“先删旧映射，再写新映射”的策略，因此允许同时修改 alias 文本和目标指令
  if (state.mode === 'edit' && state.originalCommandId && state.originalAlias) {
    const originalEntries = [...(nextStore[state.originalCommandId] || [])]
    const filteredOriginalEntries = originalEntries.filter(
      (entry) => entry.alias !== state.originalAlias
    )

    if (filteredOriginalEntries.length > 0) {
      nextStore[state.originalCommandId] = filteredOriginalEntries
    } else {
      delete nextStore[state.originalCommandId]
    }
  }

  const targetEntries = [...(nextStore[state.target.commandId] || [])]
  // 重复校验只限制同一目标指令下的 alias，避免影响其它指令使用同名 alias
  if (targetEntries.some((entry) => entry.alias === nextAlias)) {
    warning('该目标已存在相同别名')
    focusAliasInput()
    return
  }

  nextStore[state.target.commandId] = [...targetEntries, buildAliasEntry(nextAlias, state.icon)]

  aliasSaving.value = true
  const saved = await saveAliasMappings(nextStore)
  aliasSaving.value = false

  if (saved) {
    success(state.mode === 'edit' ? '别名已更新' : '别名已添加')
    closeAliasDialog()
  }
}

async function deleteAliasRow(row: AliasRow): Promise<void> {
  const confirmed = await confirm({
    title: '删除别名映射',
    message: `确定要删除别名“${row.alias}”吗？`,
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!confirmed) return

  const nextStore = cloneAliasStore()
  // 删除维度是 commandId + alias；如果某个 bucket 被删空，就直接移除该 commandId
  const entries = (nextStore[row.commandId] || []).filter((entry) => entry.alias !== row.alias)

  if (entries.length > 0) {
    nextStore[row.commandId] = entries
  } else {
    delete nextStore[row.commandId]
  }

  aliasSaving.value = true
  const saved = await saveAliasMappings(nextStore)
  aliasSaving.value = false

  if (saved) {
    success('别名已删除')
  }
}

function showAddEditor(): void {
  if (activeTab.value === 'alias') {
    openCreateAliasDialog()
    return
  }

  editingShortcut.value = null
  prefillTarget.value = ''
  showEditor.value = true
}

function handleEdit(shortcut: GlobalShortcut): void {
  editingShortcut.value = shortcut
  prefillTarget.value = ''
  showEditor.value = true
}

function closeEditor(): void {
  showEditor.value = false
  editingShortcut.value = null
  prefillTarget.value = ''
}

async function handleSave(recordedShortcut: string, targetCommand: string): Promise<void> {
  if (!recordedShortcut || !targetCommand) {
    return
  }

  if (activeTab.value === 'global') {
    await handleSaveGlobalShortcut(recordedShortcut, targetCommand)
  } else {
    await handleSaveAppShortcut(recordedShortcut, targetCommand)
  }
}

async function handleSaveGlobalShortcut(
  recordedShortcut: string,
  targetCommand: string
): Promise<void> {
  if (editingShortcut.value) {
    const exists = globalShortcuts.value.some(
      (s) => s.id !== editingShortcut.value!.id && s.shortcut === recordedShortcut
    )
    if (exists) {
      warning('该快捷键已被其他指令占用，请使用其他快捷键')
      return
    }

    const oldShortcut = editingShortcut.value.shortcut

    try {
      if (oldShortcut !== recordedShortcut) {
        await window.ztools.internal.unregisterGlobalShortcut(oldShortcut)
      }

      const result = await window.ztools.internal.registerGlobalShortcut(
        recordedShortcut,
        targetCommand
      )

      if (result.success) {
        const index = globalShortcuts.value.findIndex((s) => s.id === editingShortcut.value!.id)
        if (index >= 0) {
          globalShortcuts.value[index].shortcut = recordedShortcut
          globalShortcuts.value[index].target = targetCommand
        }

        await saveGlobalShortcuts()
        success('快捷键更新成功!')
        closeEditor()
      } else {
        if (oldShortcut !== recordedShortcut) {
          await window.ztools.internal.registerGlobalShortcut(
            oldShortcut,
            editingShortcut.value.target
          )
        }
        error(`快捷键注册失败: ${result.error}`)
      }
    } catch (err: any) {
      if (oldShortcut !== recordedShortcut) {
        await window.ztools.internal.registerGlobalShortcut(
          oldShortcut,
          editingShortcut.value.target
        )
      }
      console.error('更新快捷键失败:', err)
      error(`更新快捷键失败: ${err.message || '未知错误'}`)
    }
    return
  }

  const exists = globalShortcuts.value.some((s) => s.shortcut === recordedShortcut)
  if (exists) {
    warning('该快捷键已存在，请使用其他快捷键')
    return
  }

  const newShortcut: GlobalShortcut = {
    id: Date.now().toString(),
    shortcut: recordedShortcut,
    target: targetCommand,
    enabled: true
  }

  globalShortcuts.value.push(newShortcut)
  await saveGlobalShortcuts()

  try {
    const result = await window.ztools.internal.registerGlobalShortcut(
      recordedShortcut,
      targetCommand
    )
    if (result.success) {
      success('快捷键添加成功!')
      closeEditor()
    } else {
      globalShortcuts.value = globalShortcuts.value.filter((s) => s.id !== newShortcut.id)
      await saveGlobalShortcuts()
      error(`快捷键注册失败: ${result.error}`)
    }
  } catch (err: any) {
    globalShortcuts.value = globalShortcuts.value.filter((s) => s.id !== newShortcut.id)
    await saveGlobalShortcuts()
    console.error('注册快捷键失败:', err)
    error(`注册快捷键失败: ${err.message || '未知错误'}`)
  }
}

async function handleSaveAppShortcut(
  recordedShortcut: string,
  targetCommand: string
): Promise<void> {
  if (editingShortcut.value) {
    const exists = appShortcuts.value.some(
      (s) => s.id !== editingShortcut.value!.id && s.shortcut === recordedShortcut
    )
    if (exists) {
      warning('该快捷键已被其他指令占用，请使用其他快捷键')
      return
    }

    const oldShortcut = editingShortcut.value.shortcut

    try {
      if (oldShortcut !== recordedShortcut) {
        await window.ztools.internal.unregisterAppShortcut(oldShortcut)
      }

      const result = await window.ztools.internal.registerAppShortcut(
        recordedShortcut,
        targetCommand
      )

      if (result.success) {
        const index = appShortcuts.value.findIndex((s) => s.id === editingShortcut.value!.id)
        if (index >= 0) {
          appShortcuts.value[index].shortcut = recordedShortcut
          appShortcuts.value[index].target = targetCommand
        }

        await saveAppShortcuts()
        success('应用快捷键更新成功!')
        closeEditor()
      } else {
        if (oldShortcut !== recordedShortcut) {
          await window.ztools.internal.registerAppShortcut(
            oldShortcut,
            editingShortcut.value.target
          )
        }
        error(`应用快捷键注册失败: ${result.error}`)
      }
    } catch (err: any) {
      if (oldShortcut !== recordedShortcut) {
        await window.ztools.internal.registerAppShortcut(oldShortcut, editingShortcut.value.target)
      }
      console.error('更新应用快捷键失败:', err)
      error(`更新应用快捷键失败: ${err.message || '未知错误'}`)
    }
    return
  }

  const exists = appShortcuts.value.some((s) => s.shortcut === recordedShortcut)
  if (exists) {
    warning('该快捷键已存在，请使用其他快捷键')
    return
  }

  const newShortcut: GlobalShortcut = {
    id: Date.now().toString(),
    shortcut: recordedShortcut,
    target: targetCommand,
    enabled: true
  }

  appShortcuts.value.push(newShortcut)
  await saveAppShortcuts()

  try {
    const result = await window.ztools.internal.registerAppShortcut(recordedShortcut, targetCommand)
    if (result.success) {
      success('应用快捷键添加成功!')
      closeEditor()
    } else {
      appShortcuts.value = appShortcuts.value.filter((s) => s.id !== newShortcut.id)
      await saveAppShortcuts()
      error(`应用快捷键注册失败: ${result.error}`)
    }
  } catch (err: any) {
    appShortcuts.value = appShortcuts.value.filter((s) => s.id !== newShortcut.id)
    await saveAppShortcuts()
    console.error('注册应用快捷键失败:', err)
    error(`注册应用快捷键失败: ${err.message || '未知错误'}`)
  }
}

async function handleDelete(id: string): Promise<void> {
  const isGlobal = activeTab.value === 'global'
  const shortcutList = isGlobal ? globalShortcuts.value : appShortcuts.value
  const shortcut = shortcutList.find((s) => s.id === id)
  if (!shortcut) return

  const confirmed = await confirm({
    title: '删除快捷键',
    message: `确定要删除快捷键"${shortcut.shortcut}"吗？`,
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!confirmed) return

  isDeleting.value = true
  try {
    if (isGlobal) {
      const result = await window.ztools.internal.unregisterGlobalShortcut(shortcut.shortcut)
      if (result.success) {
        globalShortcuts.value = globalShortcuts.value.filter((s) => s.id !== id)
        await saveGlobalShortcuts()
      } else {
        error(`快捷键删除失败: ${result.error}`)
      }
    } else {
      const result = await window.ztools.internal.unregisterAppShortcut(shortcut.shortcut)
      if (result.success) {
        appShortcuts.value = appShortcuts.value.filter((s) => s.id !== id)
        await saveAppShortcuts()
      } else {
        error(`应用快捷键删除失败: ${result.error}`)
      }
    }
  } catch (err: any) {
    console.error('删除快捷键失败:', err)
    error(`删除快捷键失败: ${err.message || '未知错误'}`)
  } finally {
    isDeleting.value = false
  }
}

onMounted(() => {
  const userAgent = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()

  isMac.value = platform.includes('mac') || userAgent.includes('mac')
  isWindows.value = platform.includes('win') || userAgent.includes('windows')

  void loadShortcuts()
})

useJumpFunction<ShortcutsSettingJumpFunction>(async (state) => {
  // 支持从“所有指令”页带着 draftTarget 跳转过来，进入 alias tab 后直接打开创建对话框
  if (state.tab === 'alias' && state.draftTarget) {
    switchToTab('alias')
    await nextTick()
    openCreateAliasDialog(state.draftTarget)
    return
  }

  if (state.tab) {
    switchToTab(state.tab)
    return
  }

  if (state.payload && !state.type) {
    activeTab.value = 'global'
    closeAliasDialog()
    prefillTarget.value = state.payload
    editingShortcut.value = null
    showEditor.value = true
  }
})
</script>
<template>
  <div class="h-full content-panel">
    <Transition name="list-slide">
      <div v-show="!showDetailPanel" class="scrollable-content">
        <!-- tab 切换区 -->
        <div class="tabs-container">
          <div class="tab-group">
            <button
              :class="['tab-btn', { active: activeTab === 'global' }]"
              @click="switchToTab('global')"
            >
              全局快捷键
            </button>
            <button
              :class="['tab-btn', { active: activeTab === 'app' }]"
              @click="switchToTab('app')"
            >
              应用快捷键
            </button>
            <button
              :class="['tab-btn', { active: activeTab === 'alias' }]"
              @click="switchToTab('alias')"
            >
              指令别名
            </button>
          </div>
        </div>

        <div class="panel-header">
          <button class="btn" @click="showAddEditor">{{ addButtonLabel }}</button>
        </div>

        <!-- alias 列表区 -->
        <div v-if="activeTab === 'alias'" class="shortcut-list">
          <div v-if="filteredAliasRows.length > 0" class="alias-table">
            <div v-for="row in filteredAliasRows" :key="row.id" class="card alias-table-row">
              <div class="alias-icon-cell">
                <AdaptiveIcon
                  v-if="getAliasDisplayIcon(row)"
                  :src="getAliasDisplayIcon(row)!"
                  class="alias-command-icon"
                  alt="指令图标"
                  draggable="false"
                />
                <div v-else class="alias-icon-placeholder">
                  <div class="i-z-command font-size-18px" />
                </div>
              </div>

              <div class="alias-value-cell">
                <div class="alias-display-text">{{ row.alias }}</div>
              </div>

              <div class="alias-target-cell">
                <div :class="['alias-target-title', { invalid: row.missingTarget }]">
                  {{ row.targetLabel }}
                </div>
                <div class="alias-target-subtitle">
                  {{ row.missingTarget ? row.commandId : row.target?.subtitle }}
                </div>
              </div>

              <div class="alias-actions-cell">
                <button
                  class="icon-btn edit-btn"
                  title="编辑"
                  @click.stop="openEditAliasDialog(row)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </button>
                <button class="icon-btn delete-btn" title="删除" @click.stop="deleteAliasRow(row)">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path
                      d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                    ></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div v-else-if="showAliasEmptyState" class="empty-state alias-empty-state">
            <div class="i-z-command empty-icon" style="font-size: 64px" />
            <div class="empty-text">暂无指令别名</div>
            <div class="empty-hint">点击右上角“添加映射”，或从所有指令中直接创建</div>
          </div>

          <!-- alias 空态区 -->
          <div v-else-if="showAliasSearchEmptyState" class="empty-state alias-empty-state">
            <div class="i-z-search empty-icon" style="font-size: 64px" />
            <div class="empty-text">未找到匹配映射</div>
            <div class="empty-hint">换个关键词试试</div>
          </div>
        </div>

        <div v-else class="shortcut-list">
          <template v-if="activeTab === 'app'">
            <div class="shortcut-section">
              <div class="category-label">自定义快捷键</div>
              <!-- 有自定义快捷键时显示列表 -->
              <div v-if="filteredShortcuts.length > 0">
                <div
                  v-for="shortcut in filteredShortcuts"
                  :key="shortcut.id"
                  class="card shortcut-item"
                >
                  <div class="shortcut-info">
                    <div class="shortcut-key-display">{{ shortcut.shortcut }}</div>
                    <div class="shortcut-desc">{{ shortcut.target }}</div>
                  </div>

                  <div class="shortcut-meta">
                    <button
                      class="icon-btn edit-btn"
                      title="编辑"
                      :disabled="isDeleting"
                      @click="handleEdit(shortcut)"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                    <button
                      class="icon-btn delete-btn"
                      title="删除"
                      :disabled="isDeleting"
                      @click="handleDelete(shortcut.id)"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path
                          d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                        ></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div v-else-if="!loading" class="empty-state-inline">
                <div class="i-z-keyboard empty-icon" style="font-size: 48px" />
                <div class="empty-text-inline">暂无自定义快捷键</div>
                <div class="empty-hint-inline">点击上方“添加快捷键”按钮创建</div>
              </div>
            </div>

            <div v-if="builtInAppShortcuts.length > 0" class="shortcut-section">
              <div class="category-label">内置快捷键</div>
              <div
                v-for="shortcut in builtInAppShortcuts"
                :key="shortcut.id"
                class="card shortcut-item built-in"
              >
                <div class="shortcut-info">
                  <div class="shortcut-key-display">{{ shortcut.shortcut }}</div>
                  <div class="shortcut-desc">{{ shortcut.target }}</div>
                </div>
                <div class="shortcut-meta">
                  <label
                    v-if="shortcut.configurable && shortcut.configKey"
                    class="toggle built-in-toggle"
                    :title="
                      builtInShortcutsEnabled[shortcut.configKey]
                        ? '点击禁用该内置快捷键'
                        : '点击启用该内置快捷键'
                    "
                  >
                    <input
                      :checked="builtInShortcutsEnabled[shortcut.configKey]"
                      type="checkbox"
                      @change="handleBuiltInToggleChange(shortcut.configKey, $event)"
                    />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          </template>

          <template v-else>
            <div
              v-for="shortcut in filteredShortcuts"
              :key="shortcut.id"
              class="card shortcut-item"
            >
              <div class="shortcut-info">
                <div class="shortcut-key-display">{{ shortcut.shortcut }}</div>
                <div class="shortcut-desc">{{ shortcut.target }}</div>
              </div>

              <div class="shortcut-meta">
                <button
                  class="icon-btn edit-btn"
                  title="编辑"
                  :disabled="isDeleting"
                  @click="handleEdit(shortcut)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </button>
                <button
                  class="icon-btn delete-btn"
                  title="删除"
                  :disabled="isDeleting"
                  @click="handleDelete(shortcut.id)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path
                      d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                    ></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
            </div>

            <div v-if="!loading && currentShortcuts.length === 0" class="empty-state">
              <div class="i-z-keyboard empty-icon" style="font-size: 64px" />
              <div class="empty-text">暂无全局快捷键</div>
              <div class="empty-hint">点击“添加快捷键”来创建你的第一个全局快捷键</div>
            </div>
          </template>
        </div>
      </div>
    </Transition>

    <Transition name="slide">
      <!-- 快捷键编辑面板 -->
      <ShortcutEditor
        v-if="showShortcutEditor"
        :editing-shortcut="editingShortcut"
        :prefill-target="prefillTarget"
        :is-app-shortcut="activeTab === 'app'"
        @back="closeEditor"
        @save="handleSave"
      />
    </Transition>

    <Transition name="alias-slide" @after-enter="handleAliasDialogAfterEnter">
      <!-- alias 编辑面板 -->
      <AliasMappingDialog
        v-if="showAliasEditor"
        ref="aliasDialogRef"
        v-model:visible="aliasDialogVisible"
        :initial-state="aliasDialogState"
        :target-options="aliasTargetOptions"
        :saving="aliasSaving"
        @save="handleSaveAliasDialog"
        @cancel="closeAliasDialog"
      />
    </Transition>
  </div>
</template>

<style lang="less" scoped>
.alias-slide-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.alias-slide-leave-active {
  transition:
    transform 0.2s ease-in,
    opacity 0.15s ease;
}

.alias-slide-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.alias-slide-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.alias-slide-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.alias-slide-leave-to {
  transform: translateX(100%);
  opacity: 1;
}

.content-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}

.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}

.tabs-container {
  position: sticky;
  top: 0;
  z-index: 10;
  padding-bottom: 16px;
}

.tab-group {
  display: flex;
  gap: 6px;
  background: var(--control-bg);
  padding: 3px;
  border-radius: 8px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
  padding: 6px 14px;
  font-size: 13px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.tab-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.tab-btn.active {
  background: var(--active-bg);
  color: var(--primary-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.list-slide-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.list-slide-leave-active {
  transition:
    transform 0.2s ease-in,
    opacity 0.15s ease;
}

.list-slide-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}

.list-slide-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

.panel-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 20px;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.shortcut-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 4px;
  margin-bottom: 4px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.shortcut-item:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.shortcut-item.built-in {
  cursor: default;
  opacity: 0.85;
}

.shortcut-item.built-in:hover {
  transform: none;
}

.shortcut-info {
  flex: 1;
  min-width: 0;
}

.shortcut-key-display {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  font-family: monospace;
}

.shortcut-desc {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortcut-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.built-in-toggle {
  transform: scale(0.85);
  transform-origin: center;
}

.alias-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alias-table-header,
.alias-table-row {
  display: grid;
  grid-template-columns: 56px minmax(180px, 1.2fr) minmax(180px, 2fr) 56px;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
}

.alias-table-header {
  background: var(--control-bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.alias-header-cell {
  white-space: nowrap;
}

.alias-table-row {
  transition: all 0.2s;
}

.alias-table-row:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.alias-icon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.alias-command-icon,
.alias-icon-placeholder,
.alias-target-option-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  flex-shrink: 0;
}

.alias-command-icon,
.alias-target-option-icon {
  object-fit: contain;
}

.alias-icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  color: var(--text-secondary);
}

.alias-value-cell,
.alias-target-cell {
  min-width: 0;
}

.alias-display-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-input,
.alias-target-search {
  width: 100%;
}

.alias-target-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-target-title.invalid {
  color: var(--danger-color);
}

.alias-target-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-target-change-btn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 12px;
}

.alias-target-change-btn:hover {
  text-decoration: underline;
}

.alias-target-options {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.alias-target-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: var(--card-bg);
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
}

.alias-target-option:hover {
  border-color: var(--primary-color);
  background: var(--primary-light-bg);
}

.alias-target-option-texts {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.alias-target-option-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-target-option-plugin {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.alias-target-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  background: var(--card-bg);
  border-radius: 8px;
}

.alias-actions-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.edit-btn {
  color: var(--primary-color);
}

.edit-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.delete-btn {
  color: var(--danger-color);
}

.delete-btn:hover:not(:disabled) {
  background: var(--danger-light-bg);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.alias-empty-state {
  border: 2px dashed var(--divider-color);
  border-radius: 12px;
  background: var(--card-bg);
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.3;
  color: var(--text-secondary);
}

.empty-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
  color: var(--text-secondary);
}

.empty-state-inline {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
}

.empty-text-inline {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.empty-hint-inline {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.7;
}
</style>
