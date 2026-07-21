<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import settingsFillIcon from '@/assets/image/settings-fill.png'
import { weightedSearch } from '@/utils'
import {
  AdaptiveIcon,
  CommandTag,
  FeatureCard,
  TagDropdown,
  CommandCard,
  MatchCommandDetailDialog
} from '@/components'
import type { TagDropdownMenuItem } from '@/components'
import { usePluginCommandActions, useZtoolsSubInput } from '@/composables'
import {
  jumpFunctionShortcutsSetting,
  type ShortcutsSettingAliasDraftTarget
} from '@/views/ShortcutsSetting/ShortcutsSetting'
import {
  DIRECT_APP_ALIAS_GROUP_KEY,
  DIRECT_APP_ALIAS_GROUP_TITLE,
  getCommandId as _getCommandId,
  getLegacyDirectAppCommandId
} from '@shared/commandShared'

// 定义 Command 类型（从 commandDataStore 复制）
export type CommandType = 'direct' | 'plugin' | 'builtin'
export type CommandSubType = 'app' | 'system-setting' | 'local-shortcut'
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

export interface Command {
  name: string
  path?: string
  icon?: string
  type: CommandType
  subType?: CommandSubType
  pinyin?: string
  pinyinAbbr?: string
  featureCode?: string
  pluginExplain?: string
  pluginName?: string
  pluginTitle?: string
  cmdType?: CommandCmdType
  matchCmd?: MatchCmd
}

interface Feature {
  code: string
  name: string
  explain: string
  icon: string
  textCmds: {
    text: string
    name: string
  }[]
  matchCmds: {
    type: CommandCmdType
    match: MatchCmd
    name: string
  }[]
}

interface Source {
  type?: string
  subType?: string
  name: string
  title?: string
  path?: string
  logo?: string
}

// 本地状态：指令数据
const loading = ref(true)
const commands = ref<Command[]>([])
const regexCommands = ref<Command[]>([])

const plugins = ref<any[]>([])
const selectedSource = ref<Source | null>(null)
const activeTab = ref<'text' | 'match'>('text')

// 生成指令唯一标识（direct/app 用）
function getCommandId(
  command: Pick<Command, 'name' | 'path' | 'type' | 'subType' | 'featureCode' | 'cmdType'> & {
    pluginName?: string
  }
): string {
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

function isDirectAppCommand(cmd: Command): boolean {
  return cmd.type === 'direct' && cmd.subType === 'app'
}

function buildAppAliasDraftTarget(cmd: Command): ShortcutsSettingAliasDraftTarget {
  return {
    commandId: getCommandId(cmd),
    type: 'direct',
    subType: 'app',
    path: cmd.path,
    groupKey: DIRECT_APP_ALIAS_GROUP_KEY,
    groupTitle: DIRECT_APP_ALIAS_GROUP_TITLE,
    featureCode: cmd.path || '',
    subtitle: cmd.path || '',
    pluginName: DIRECT_APP_ALIAS_GROUP_KEY,
    pluginTitle: DIRECT_APP_ALIAS_GROUP_TITLE,
    cmdName: cmd.name,
    cmdType: 'text',
    icon: cmd.icon
  }
}

function isDirectAppCommandDisabled(cmd: Command): boolean {
  const nextId = getCommandId(cmd)
  const legacyId = getLegacyDirectAppCommandId(cmd.name, cmd.cmdType || 'text')
  return disabledCommands.value.includes(nextId) || disabledCommands.value.includes(legacyId)
}

async function toggleDirectAppCommandDisabled(cmd: Command): Promise<void> {
  const nextId = getCommandId(cmd)
  const legacyId = getLegacyDirectAppCommandId(cmd.name, cmd.cmdType || 'text')
  const nextIndex = disabledCommands.value.indexOf(nextId)
  const legacyIndex = disabledCommands.value.indexOf(legacyId)
  const isDisabled = nextIndex !== -1 || legacyIndex !== -1

  if (isDisabled) {
    disabledCommands.value = disabledCommands.value.filter((id) => id !== nextId && id !== legacyId)
  } else {
    disabledCommands.value = [...disabledCommands.value.filter((id) => id !== legacyId), nextId]
  }

  await saveDisabledCommands()
}

function isAppPinnedToSuperPanel(cmd: Command): boolean {
  return superPanelPinned.value.some(
    (item) => item.path === cmd.path && item.name === cmd.name && item.type === 'direct'
  )
}

async function toggleAppSuperPanelPin(cmd: Command): Promise<void> {
  const isPinned = isAppPinnedToSuperPanel(cmd)

  if (isPinned) {
    await window.ztools.internal.unpinSuperPanelCommand(cmd.path || '', cmd.featureCode)
  } else {
    await window.ztools.internal.pinToSuperPanel({
      name: cmd.name,
      path: cmd.path || '',
      icon: cmd.icon || '',
      type: cmd.type,
      featureCode: '',
      pluginName: '',
      pluginExplain: '',
      cmdType: cmd.cmdType || 'text'
    })
  }

  await loadSuperPanelPinned()
}

function isAppPinnedToSearch(cmd: Command): boolean {
  return searchPinned.value.some((item) => item.path === cmd.path && item.name === cmd.name)
}

async function toggleAppSearchPin(cmd: Command): Promise<void> {
  const pinned = isAppPinnedToSearch(cmd)

  if (pinned) {
    await window.ztools.internal.unpinApp(cmd.path || '', undefined, cmd.name)
  } else {
    await window.ztools.internal.pinApp(JSON.parse(JSON.stringify(cmd)))
  }

  await loadSearchPinned()
}

function getAppMenuItems(cmd: Command): TagDropdownMenuItem[] {
  const items: TagDropdownMenuItem[] = []
  const disabled = isDirectAppCommandDisabled(cmd)

  items.push({
    key: 'open',
    label: '打开应用',
    icon: 'i-z-play'
  })

  if (isDirectAppCommand(cmd)) {
    items.push({
      key: 'custom-alias',
      label: '自定义别名',
      icon: 'i-z-alias'
    })
  }

  const superPinned = isAppPinnedToSuperPanel(cmd)
  items.push({
    key: 'pin-super-panel',
    label: superPinned ? '取消固定超级面板' : '固定到超级面板',
    icon: 'i-z-pin'
  })

  const pinned = isAppPinnedToSearch(cmd)
  items.push({
    key: 'pin-search',
    label: pinned ? '取消固定搜索' : '固定到搜索',
    icon: 'i-z-pin'
  })

  items.push({
    key: 'toggle',
    label: disabled ? '启用指令' : '禁用指令',
    icon: disabled ? 'i-z-check' : 'i-z-ban',
    danger: !disabled
  })

  return items
}

function openAppAliasShortcut(cmd: Command): void {
  if (!isDirectAppCommand(cmd)) return

  jumpFunctionShortcutsSetting({
    tab: 'alias',
    draftTarget: buildAppAliasDraftTarget(cmd)
  })
}

async function handleAppMenuSelect(key: string, cmd: Command): Promise<void> {
  if (key === 'open') {
    try {
      await window.ztools.internal.launch({
        path: cmd.path || '',
        type: cmd.type,
        name: cmd.name,
        param: {}
      })
    } catch (error) {
      console.error('打开应用失败:', error)
    }
  } else if (key === 'custom-alias') {
    if (!isDirectAppCommand(cmd)) return
    openAppAliasShortcut(cmd)
  } else if (key === 'pin-super-panel') {
    await toggleAppSuperPanelPin(cmd)
  } else if (key === 'pin-search') {
    await toggleAppSearchPin(cmd)
  } else if (key === 'toggle') {
    await toggleDirectAppCommandDisabled(cmd)
  }
}

// 内置插件名称列表（与主进程保持一致）
const INTERNAL_PLUGIN_NAMES = ['setting', 'system']

// 判断是否为内置插件
function isInternalPlugin(pluginName: string): boolean {
  return INTERNAL_PLUGIN_NAMES.includes(pluginName)
}

// 内置插件列表
const internalPlugins = computed(() => {
  return plugins.value.filter((p) => isInternalPlugin(p.name) && pluginMatchesQuery(p))
})

// 第三方插件列表
const thirdPartyPlugins = computed(() => {
  return plugins.value.filter((p) => !isInternalPlugin(p.name) && pluginMatchesQuery(p))
})

// 所有指令
const allCommands = computed(() => commands.value)
const allRegexCommands = computed(() => regexCommands.value)

// 统计
const appCount = computed(
  () => getFilteredSystemCommandsForSource({ subType: 'app', name: '系统应用' }).length
)

const settingCount = computed(
  () => getFilteredSystemCommandsForSource({ subType: 'system-setting', name: '系统设置' }).length
)

const localShortcutCount = computed(
  () => getFilteredSystemCommandsForSource({ subType: 'local-shortcut', name: '本地启动' }).length
)

const { value: searchQuery } = useZtoolsSubInput('', '搜索指令...')
const normalizedSearchQuery = computed(() => (searchQuery.value || '').trim().toLowerCase())
const isSearching = computed(() => normalizedSearchQuery.value.length > 0)

function includesQuery(value: unknown, query = normalizedSearchQuery.value): boolean {
  if (!query) return true
  return String(value || '')
    .toLowerCase()
    .includes(query)
}

function anyIncludesQuery(values: unknown[], query = normalizedSearchQuery.value): boolean {
  if (!query) return true
  return values.some((value) => includesQuery(value, query))
}

function systemSourceCommands(source: Source): Command[] {
  if (source.subType === 'app') {
    return allCommands.value.filter((c) => c.type === 'direct' && c.subType === 'app')
  }
  if (source.subType === 'system-setting') {
    return allCommands.value
      .filter((c) => c.type === 'direct' && c.subType === 'system-setting')
      .map((cmd) => ({
        ...cmd,
        icon: cmd.icon || settingsFillIcon
      }))
  }
  if (source.subType === 'local-shortcut') {
    return allCommands.value.filter((c) => c.type === 'direct' && c.subType === 'local-shortcut')
  }
  return []
}

function getFilteredSystemCommandsForSource(source: Source): Command[] {
  return weightedSearch(systemSourceCommands(source), searchQuery.value || '', [
    { value: (c) => c.name || '', weight: 10 },
    { value: (c) => c.path || '', weight: 3 }
  ])
}

function commandMatchesQuery(command: Command, plugin?: any): boolean {
  return anyIncludesQuery([
    command.name,
    command.path,
    command.featureCode,
    command.pluginExplain,
    command.pluginName,
    command.pluginTitle,
    command.matchCmd?.type,
    command.matchCmd?.label,
    command.matchCmd?.match,
    plugin?.name,
    plugin?.title,
    plugin?.description
  ])
}

function pluginMatchesQuery(plugin: any): boolean {
  if (!isSearching.value) return true

  return (
    anyIncludesQuery([plugin.name, plugin.title, plugin.description]) ||
    allCommands.value.some(
      (command) =>
        command.type === 'plugin' &&
        command.path === plugin.path &&
        commandMatchesQuery(command, plugin)
    ) ||
    allRegexCommands.value.some(
      (command) => command.path === plugin.path && commandMatchesQuery(command, plugin)
    )
  )
}

function sourceHasSearchResults(source: Source): boolean {
  if (!isSearching.value) return true
  if (source.subType) {
    return getFilteredSystemCommandsForSource(source).length > 0
  }
  return pluginMatchesQuery(source)
}

const visibleSources = computed<Source[]>(() => {
  const sources: Source[] = []
  if (appCount.value > 0) sources.push({ subType: 'app', name: '系统应用' })
  if (settingCount.value > 0) sources.push({ subType: 'system-setting', name: '系统设置' })
  if (localShortcutCount.value > 0) sources.push({ subType: 'local-shortcut', name: '本地启动' })
  sources.push(...internalPlugins.value, ...thirdPartyPlugins.value)
  return sources
})

const activeSource = computed<Source | null>(() => {
  if (!isSearching.value) return selectedSource.value
  if (selectedSource.value && sourceHasSearchResults(selectedSource.value)) {
    return selectedSource.value
  }
  return visibleSources.value[0] || null
})

function getCurrentSource(): Source | null {
  return activeSource.value || selectedSource.value
}

// 插件指令操作（共享逻辑）+ 与 direct/app 共享的禁用/固定状态
const {
  // 共享状态（direct/app 复用同一份）
  disabledCommands,
  superPanelPinned,
  searchPinned,
  saveDisabledCommands,
  loadSuperPanelPinned,
  loadSearchPinned,
  // 加载
  loadAll,
  loadPluginCommands,
  // 插件指令
  isCommandDisabled,
  getMenuItems,
  handleMenuSelect,
  handleMatchMenuSelect,
  // 匹配指令详情
  selectedMatchCommand,
  selectedMatchCommandDisabled,
  closeMatchCommandDetail,
  toggleSelectedMatchCommandDisabled
} = usePluginCommandActions({
  getPluginName: () => getCurrentSource()?.name,
  getPluginPath: () => getCurrentSource()?.path,
  getPluginTitle: () => getCurrentSource()?.title || getCurrentSource()?.name
})

// 当前选中来源的指令（系统应用/设置/本地启动）
const systemCommands = computed(() => {
  if (!activeSource.value) return []
  return systemSourceCommands(activeSource.value)
})

// 按 feature 分组的插件功能
const groupedFeatures = computed(() => {
  if (!activeSource.value || !activeSource.value.path) return []

  const source = activeSource.value
  const featureMap = new Map<string, Feature>()

  // 收集功能指令
  allCommands.value
    .filter((c) => c.type === 'plugin' && c.path === source.path && c.featureCode)
    .forEach((cmd) => {
      const key = cmd.featureCode || ''
      if (!featureMap.has(key)) {
        featureMap.set(key, {
          code: cmd.featureCode || '',
          name: cmd.name,
          explain: cmd.pluginExplain || '',
          icon: cmd.icon || '',
          textCmds: [],
          matchCmds: []
        })
      }
      const feature = featureMap.get(key)!
      if (cmd.cmdType === 'text') {
        // 对于功能指令，name 就是指令文本
        feature.textCmds.push({
          text: cmd.name,
          name: cmd.name
        })
      }
    })

  // 收集匹配指令
  allRegexCommands.value
    .filter((c) => c.path === source.path)
    .forEach((cmd) => {
      const key = cmd.featureCode || ''
      if (!featureMap.has(key)) {
        featureMap.set(key, {
          code: cmd.featureCode || '',
          name: cmd.name,
          explain: cmd.pluginExplain || '',
          icon: cmd.icon || '',
          textCmds: [],
          matchCmds: []
        })
      }
      const feature = featureMap.get(key)!
      feature.matchCmds.push({
        // regexCommand 的 cmdType 一定存在
        type: cmd.cmdType!,
        match: cmd.matchCmd || { type: '', match: '' },
        name: cmd.name
      })
    })

  return Array.from(featureMap.values())
})

const filteredSystemCommands = computed(() =>
  weightedSearch(systemCommands.value, searchQuery.value || '', [
    { value: (c) => c.name || '', weight: 10 },
    { value: (c) => c.path || '', weight: 3 }
  ])
)

// 搜索过滤后的分组功能（按指令名过滤）
const filteredGroupedFeatures = computed(() => {
  const query = (searchQuery.value || '').trim().toLowerCase()
  if (!query) return groupedFeatures.value
  return groupedFeatures.value
    .map((feature) => {
      const featureMatched = anyIncludesQuery([feature.code, feature.name, feature.explain], query)
      if (featureMatched) return feature

      return {
        ...feature,
        textCmds: feature.textCmds.filter((cmd) => anyIncludesQuery([cmd.name], query)),
        matchCmds: feature.matchCmds.filter((cmd) =>
          anyIncludesQuery([cmd.name, cmd.type, cmd.match?.type, cmd.match?.match], query)
        )
      }
    })
    .filter((f) => f.textCmds.length > 0 || f.matchCmds.length > 0)
})

const hasCommands = computed(
  () => filteredSystemCommands.value.length > 0 || filteredGroupedFeatures.value.length > 0
)

const textFeaturesCount = computed(() => {
  if (
    activeSource.value?.subType === 'app' ||
    activeSource.value?.subType === 'system-setting' ||
    activeSource.value?.subType === 'local-shortcut'
  ) {
    return filteredSystemCommands.value.length
  }
  // 统计有功能指令的功能数量
  return filteredGroupedFeatures.value.filter((f) => f.textCmds.length > 0).length
})

const matchFeaturesCount = computed(() => {
  // 统计有匹配指令的功能数量
  return filteredGroupedFeatures.value.filter((f) => f.matchCmds.length > 0).length
})

// 预计算每个插件的指令数量（一次遍历，避免 N 次全量 filter）
const pluginCommandCountMap = computed(() => {
  const map = new Map<string, number>()
  for (const c of allCommands.value) {
    if (c.type === 'plugin' && c.featureCode && c.path) {
      map.set(c.path, (map.get(c.path) || 0) + 1)
    }
  }
  for (const c of allRegexCommands.value) {
    if (c.featureCode && c.path) {
      map.set(c.path, (map.get(c.path) || 0) + 1)
    }
  }
  return map
})

function getPluginCommandCount(plugin: any): number {
  return pluginCommandCountMap.value.get(plugin.path) || 0
}

// 加载指令数据（包含 commands、regexCommands、plugins）
async function loadCommands(): Promise<void> {
  try {
    const result = await window.ztools.internal.getCommands()
    commands.value = result.commands
    regexCommands.value = result.regexCommands
    // 直接使用 getCommands 返回的 plugins，避免额外 IPC 请求
    if (result.plugins) {
      plugins.value = result.plugins
    }
  } catch (error) {
    console.error('加载指令数据失败:', error)
  }
}

// 选择来源
function selectSource(source: Source): void {
  selectedSource.value = source
  activeTab.value = 'text'
  // 切换来源后刷新指令快照：插件来源加载其 canonical 指令（供打开/固定/别名取 icon 等运行时字段），
  // 非插件来源（如系统应用）则清空缓存，避免残留上一个插件的数据。
  void loadPluginCommands()
}

// 初始化
onMounted(async () => {
  loading.value = true
  try {
    // 并行加载禁用指令、超级面板固定、搜索固定，以及插件指令快照
    await loadAll()
    // 加载指令数据（内含 plugins，用于列表展示与搜索过滤）
    await loadCommands()
    // 默认选中系统应用
    if (appCount.value > 0) {
      selectSource({ subType: 'app', name: '系统应用' })
    }
  } finally {
    loading.value = false
  }
})
</script>
<template>
  <div class="all-commands-container">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span class="loading-text">加载指令数据...</span>
    </div>

    <!-- 左侧：来源列表 -->
    <div v-show="!loading" class="sources-panel">
      <div class="panel-header">
        <h3>指令来源</h3>
      </div>
      <div class="sources-list">
        <!-- 内置分组标题 -->
        <div class="section-divider">
          <span>内置</span>
        </div>

        <!-- 系统应用 -->
        <div
          v-if="appCount > 0"
          :class="['source-item', { active: activeSource?.subType === 'app' }]"
          @click="selectSource({ subType: 'app', name: '系统应用' })"
        >
          <div class="i-z-monitor source-icon source-svg-icon font-size-18px" />
          <span class="source-name">系统应用</span>
          <span class="source-badge">{{ appCount }}</span>
        </div>

        <!-- 系统设置 -->
        <div
          v-if="settingCount > 0"
          :class="['source-item', { active: activeSource?.subType === 'system-setting' }]"
          @click="selectSource({ subType: 'system-setting', name: '系统设置' })"
        >
          <div class="i-z-settings source-icon source-svg-icon font-size-18px" />
          <span class="source-name">系统设置</span>
          <span class="source-badge">{{ settingCount }}</span>
        </div>

        <!-- 本地启动 -->
        <div
          v-if="localShortcutCount > 0"
          :class="['source-item', { active: activeSource?.subType === 'local-shortcut' }]"
          @click="selectSource({ subType: 'local-shortcut', name: '本地启动' })"
        >
          <div class="i-z-folder source-icon source-svg-icon font-size-18px" />
          <span class="source-name">本地启动</span>
          <span class="source-badge">{{ localShortcutCount }}</span>
        </div>

        <!-- 内置插件列表 -->
        <div
          v-for="plugin in internalPlugins"
          :key="plugin.path"
          :class="['source-item', { active: activeSource?.path === plugin.path }]"
          @click="selectSource(plugin)"
        >
          <AdaptiveIcon
            v-if="plugin.logo"
            :src="plugin.logo"
            class="source-icon plugin-icon"
            draggable="false"
          />
          <div v-else class="i-z-plugin source-icon source-svg-icon" />
          <span class="source-name">{{ plugin.title }}</span>
          <span class="source-badge">{{ getPluginCommandCount(plugin) }}</span>
        </div>

        <!-- 第三方插件分组标题 -->
        <div v-if="thirdPartyPlugins.length > 0" class="section-divider">
          <span>插件</span>
        </div>

        <!-- 第三方插件列表 -->
        <div
          v-for="plugin in thirdPartyPlugins"
          :key="plugin.path"
          :class="['source-item', { active: activeSource?.path === plugin.path }]"
          @click="selectSource(plugin)"
        >
          <AdaptiveIcon
            v-if="plugin.logo"
            :src="plugin.logo"
            class="source-icon plugin-icon"
            draggable="false"
          />
          <div v-else class="i-z-plugin source-icon source-svg-icon" />
          <span class="source-name">{{ plugin.title || plugin.name }}</span>
          <span class="source-badge">{{ getPluginCommandCount(plugin) }}</span>
        </div>
      </div>
    </div>

    <!-- 右侧：指令详情 -->
    <div v-show="!loading" class="commands-panel">
      <!-- 头部 -->
      <div class="panel-header">
        <!-- Tab 切换 -->
        <div v-if="hasCommands" class="tab-group">
          <button
            :class="['tab-btn', { active: activeTab === 'text' }]"
            @click="activeTab = 'text'"
          >
            功能指令
            <span class="tab-count">{{ textFeaturesCount }}</span>
          </button>
          <button
            :class="['tab-btn', { active: activeTab === 'match' }]"
            @click="activeTab = 'match'"
          >
            匹配指令
            <span class="tab-count">{{ matchFeaturesCount }}</span>
          </button>
        </div>
      </div>

      <!-- 指令列表 -->
      <div class="commands-content">
        <!-- 未选择来源 -->
        <div v-if="!activeSource" class="empty-state">
          <div class="i-z-search empty-icon" />
          <p>{{ isSearching ? '暂无匹配指令' : '从左侧选择一个来源查看指令' }}</p>
        </div>

        <!-- 功能指令 Tab -->
        <div v-else-if="activeTab === 'text'" class="command-list">
          <div v-if="textFeaturesCount === 0" class="empty-state">
            <div class="i-z-search empty-icon" />
            <p>暂无功能指令</p>
          </div>

          <!-- 系统应用/设置/本地启动：单个显示 -->
          <template
            v-if="
              activeSource?.subType === 'app' ||
              activeSource?.subType === 'system-setting' ||
              activeSource?.subType === 'local-shortcut'
            "
          >
            <CommandCard v-for="(cmd, index) in filteredSystemCommands" :key="index" :command="cmd">
              <template #action>
                <TagDropdown
                  :menu-items="getAppMenuItems(cmd)"
                  @select="(key) => handleAppMenuSelect(key, cmd)"
                >
                  <button class="card-more-btn" title="更多操作">
                    <div class="i-z-more font-size-16px" />
                  </button>
                </TagDropdown>
              </template>
            </CommandCard>
          </template>

          <!-- 插件：按 feature 分组显示 -->
          <template v-else>
            <FeatureCard
              v-for="feature in filteredGroupedFeatures"
              v-show="feature.textCmds.length > 0"
              :key="feature.code"
              :feature="feature"
            >
              <div v-for="(cmd, idx) in feature.textCmds" :key="idx" class="feature-command-row">
                <TagDropdown
                  :menu-items="
                    getMenuItems(
                      isCommandDisabled(activeSource?.name || '', feature.code, cmd.name, 'text'),
                      'text',
                      activeSource?.name || '',
                      feature.code,
                      cmd.name
                    )
                  "
                  @select="
                    (key) =>
                      handleMenuSelect(
                        key,
                        activeSource?.name || '',
                        feature.code,
                        cmd.name,
                        'text'
                      )
                  "
                >
                  <CommandTag
                    :command="cmd"
                    :disabled="
                      isCommandDisabled(activeSource?.name || '', feature.code, cmd.name, 'text')
                    "
                    show-arrow
                  />
                </TagDropdown>
              </div>
            </FeatureCard>
          </template>
        </div>

        <!-- 匹配指令 Tab -->
        <div v-else-if="activeTab === 'match'" class="command-list">
          <div v-if="matchFeaturesCount === 0" class="empty-state">
            <div class="i-z-search empty-icon" />
            <p>暂无匹配指令</p>
          </div>

          <!-- 插件：按 feature 分组显示 -->
          <FeatureCard
            v-for="feature in filteredGroupedFeatures"
            v-show="feature.matchCmds.length > 0"
            :key="feature.code"
            :feature="feature"
          >
            <TagDropdown
              v-for="(cmd, idx) in feature.matchCmds"
              :key="idx"
              :menu-items="
                getMenuItems(
                  isCommandDisabled(activeSource?.name || '', feature.code, cmd.name, cmd.type),
                  cmd.type,
                  activeSource?.name || '',
                  feature.code,
                  cmd.name
                )
              "
              @select="(key) => handleMatchMenuSelect(key, feature, cmd)"
            >
              <CommandTag
                :command="cmd"
                :disabled="
                  isCommandDisabled(activeSource?.name || '', feature.code, cmd.name, cmd.type)
                "
                show-arrow
              />
            </TagDropdown>
          </FeatureCard>
        </div>
      </div>
    </div>

    <MatchCommandDetailDialog
      :visible="!!selectedMatchCommand"
      :command="selectedMatchCommand?.command"
      :disabled="selectedMatchCommandDisabled"
      show-toggle-disabled
      @close="closeMatchCommandDetail"
      @toggle-disabled="toggleSelectedMatchCommandDisabled"
    />
  </div>
</template>

<style lang="less" scoped>
.all-commands-container {
  display: flex;
  height: 100%;
  background: var(--bg-color);
}

/* === 加载状态 === */
.loading-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: 12px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--divider-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  font-size: 13px;
  color: var(--text-color-secondary);
}

/* === 左侧面板 === */
.sources-panel {
  width: 220px;
  border-right: 1px solid var(--divider-color);
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

.panel-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--divider-color);
  background: var(--bg-color);
  height: 56px;
  display: flex;
  align-items: center;
  box-sizing: border-box;
}

.panel-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.sources-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.source-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-color);
}

.source-item:hover {
  background: var(--hover-bg);
}

.source-item.active {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.source-item.active .source-svg-icon {
  color: var(--primary-color);
}

.source-icon {
  width: 20px;
  height: 20px;
  margin-right: 10px;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.source-svg-icon {
  color: var(--text-secondary);
}

.plugin-icon {
  border-radius: 4px;
  object-fit: contain;
}

.source-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-badge {
  padding: 2px 6px;
  font-size: 11px;
  background: var(--control-bg);
  color: var(--text-secondary);
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
}

.source-item.active .source-badge {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.section-divider {
  margin: 12px 0 8px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* === 右侧面板 === */
.commands-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.commands-panel .panel-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--divider-color);
  background: var(--bg-color);
  height: 56px;
  box-sizing: border-box;
}

/* Tab 切换组 */
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

.tab-count {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--control-bg);
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

.tab-btn.active .tab-count {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

/* === 指令列表 === */
.commands-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  position: relative;
}

.command-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.command-card {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: default;
  transition: all 0.2s;
}

.command-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

/* Feature 卡片 */
.feature-card {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  cursor: default;
  transition: all 0.2s;
  gap: 8px;
}

.feature-card:hover {
  background: var(--hover-bg);
}

.feature-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.feature-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  overflow: hidden;
}

.feature-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.feature-icon .icon-emoji {
  font-size: 16px;
  line-height: 1;
}

.feature-icon .icon-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--control-bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
}

.feature-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  line-height: 1.4;
}

.feature-commands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.command-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(14, 165, 233, 0.15);
  border: 1px solid rgba(14, 165, 233, 0.35);
  border-radius: 4px;
  font-size: 12px;
  color: #0ea5e9;
  font-weight: 500;
  transition: all 0.2s;
  cursor: default;
  user-select: none;
}

.command-tag:hover {
  background: #0ea5e9;
  color: white;
  border-color: #0ea5e9;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

/* 暗色模式下的功能指令标签 */
@media (prefers-color-scheme: dark) {
  .command-tag {
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid rgba(56, 189, 248, 0.3);
    color: #7dd3fc;
  }

  .command-tag:hover {
    background: #38bdf8;
    color: #1f2937;
    border-color: #38bdf8;
  }
}

/* 统一的标签徽章 */
.tag-badge {
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.command-tag:hover .tag-badge {
  background: rgba(255, 255, 255, 0.35);
}

/* 暗色模式下的标签徽章 */
@media (prefers-color-scheme: dark) {
  .tag-badge {
    background: rgba(255, 255, 255, 0.15);
  }

  .command-tag:hover .tag-badge {
    background: rgba(255, 255, 255, 0.25);
  }
}

.command-icon {
  width: 36px;
  height: 36px;
  margin-right: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.command-icon img,
.command-icon .adaptive-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 6px;
}

/* 自适应图标样式由全局 CSS 处理（style.css） */

.icon-emoji {
  font-size: 24px;
}

.icon-placeholder {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: var(--primary-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 16px;
  font-weight: 600;
}

.command-details {
  flex: 1;
  min-width: 0;
}

.command-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 4px;
}

.command-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.meta-tag {
  padding: 3px 8px;
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
  background: var(--control-bg);
  color: var(--primary-color);
  border-radius: 4px;
  font-weight: 500;
}

.meta-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.meta-path {
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
  color: var(--text-secondary);
  opacity: 0.6;
  word-break: break-all;
  line-height: 1.4;
}

.match-rule {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.match-rule code {
  font-family: 'Consolas', 'Monaco', monospace;
  padding: 3px 8px;
  background: var(--control-bg);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-color);
  font-weight: 500;
}

.length-info {
  font-size: 11px;
  color: var(--text-secondary);
}

.type-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.badge-text {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

.badge-regex {
  background: var(--warning-light-bg);
  color: var(--warning-color);
}

.badge-over {
  background: var(--purple-light-bg);
  color: var(--purple-color);
}

.feature-command-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
  pointer-events: none;
  color: var(--text-secondary);
}

.empty-icon {
  width: 56px;
  height: 56px;
  font-size: 56px;
  margin-bottom: 16px;
  opacity: 0.5;
  color: var(--text-secondary);
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

/* === 系统应用操作按钮 === */
.card-more-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.card-more-btn:hover {
  background: var(--control-bg);
  color: var(--text-color);
}
</style>
