<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AdaptiveIcon } from '@/components'
import { weightedSearch } from '@/utils'
import type { ShortcutsSettingCommandTargetOptionBase } from '@/views/ShortcutsSetting/ShortcutsSetting'

interface TargetPluginOption {
  pluginName: string
  pluginTitle: string
  icon?: string
  commands: ShortcutsSettingCommandTargetOptionBase[]
}

const props = defineProps<{
  options: ShortcutsSettingCommandTargetOptionBase[]
  selectedCommandId?: string | null
  selectedOption?: ShortcutsSettingCommandTargetOptionBase | null
}>()

const emit = defineEmits<{
  (e: 'select', value: ShortcutsSettingCommandTargetOptionBase): void
  (e: 'escape'): void
}>()

const selectorQuery = ref('')
const selectedPluginName = ref<string | null>(null)

const currentTarget = computed(
  () =>
    props.options.find((item) => item.commandId === props.selectedCommandId) ||
    props.selectedOption ||
    null
)

const pluginOptions = computed<TargetPluginOption[]>(() => {
  const pluginMap = new Map<string, TargetPluginOption>()

  // 将扁平目标列表整理成“分组 -> 指令”的两级选择结构。
  for (const item of props.options) {
    const existing = pluginMap.get(item.pluginName)
    if (existing) {
      existing.commands.push(item)
      if (!existing.icon && item.icon) {
        existing.icon = item.icon
      }
      continue
    }

    pluginMap.set(item.pluginName, {
      pluginName: item.pluginName,
      pluginTitle: item.groupTitle,
      icon: item.icon,
      commands: [item]
    })
  }

  return Array.from(pluginMap.values())
    .map((plugin) => ({
      ...plugin,
      commands: [...plugin.commands].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    }))
    .sort((a, b) => a.pluginTitle.localeCompare(b.pluginTitle, 'zh-CN'))
})

const selectedPlugin = computed(
  () => pluginOptions.value.find((item) => item.pluginName === selectedPluginName.value) || null
)

const filteredPlugins = computed(() => {
  const query = selectorQuery.value.trim()
  if (!query) {
    return pluginOptions.value
  }

  // 分组级搜索优先命中分组标题，再兼顾插件名与分组内指令名。
  return weightedSearch(pluginOptions.value, query, [
    { value: (item) => item.pluginTitle || '', weight: 10 },
    { value: (item) => item.pluginName || '', weight: 6 },
    { value: (item) => item.commands.map((command) => command.cmdName).join(' '), weight: 2 }
  ])
})

const filteredPluginCommands = computed(() => {
  const commands = selectedPlugin.value?.commands || []
  const query = selectorQuery.value.trim()
  if (!query) {
    return commands
  }

  // 进入分组后，只在当前分组内搜索可选指令。
  return weightedSearch(commands, query, [
    { value: (item) => item.cmdName || '', weight: 10 },
    { value: (item) => item.label || '', weight: 8 },
    { value: (item) => item.subtitle || '', weight: 4 }
  ])
})

const selectorTitle = computed(() =>
  selectedPlugin.value ? `${selectedPlugin.value.pluginTitle} 的指令` : '所有可用目标'
)
const selectorPlaceholder = computed(() => (selectedPlugin.value ? '搜索该分组的指令' : '搜索分组'))

watch(
  () => props.options,
  (options) => {
    // 目标列表变化后，若当前分组已失效，则退回分组列表避免停留在空子页。
    if (
      selectedPluginName.value &&
      !options.some((item) => item.pluginName === selectedPluginName.value)
    ) {
      selectedPluginName.value = null
      selectorQuery.value = ''
    }
  }
)

/**
 * 进入某个目标分组，显示其下的指令列表。
 */
function handleSelectPlugin(pluginName: string): void {
  selectedPluginName.value = pluginName
  selectorQuery.value = ''
}

/**
 * 返回分组列表，并清空当前分组内的搜索关键字。
 */
function handleBackToPlugins(): void {
  selectedPluginName.value = null
  selectorQuery.value = ''
}

/**
 * 处理选择器中的 Esc，优先返回上一级分组列表。
 */
function handleSelectorEscape(): void {
  if (selectedPluginName.value) {
    handleBackToPlugins()
    return
  }

  emit('escape')
}

/**
 * 将用户选中的目标指令回传给父组件。
 */
function handleSelectTarget(target: ShortcutsSettingCommandTargetOptionBase): void {
  emit('select', target)
}
</script>

<template>
  <div class="command-target-selector">
    <div v-if="currentTarget" class="target-card">
      <div class="icon-preview">
        <AdaptiveIcon
          v-if="currentTarget.icon"
          :src="currentTarget.icon"
          class="target-card-icon"
          alt="目标图标"
          draggable="false"
        />
        <div v-else class="target-card-icon icon-placeholder">
          <div class="i-z-command font-size-16px" />
        </div>
      </div>
      <div class="target-card-texts">
        <div class="target-card-title">{{ currentTarget.label }}</div>
        <div class="target-card-subtitle">{{ currentTarget.subtitle }}</div>
      </div>
    </div>
    <div v-else class="target-card target-card-empty">
      <div class="icon-preview">
        <div class="icon-placeholder">
          <div class="i-z-command font-size-16px" />
        </div>
      </div>
      <div class="target-card-texts">
        <div class="target-card-title">请选择目标指令</div>
        <div class="target-card-subtitle">先选分组，再选指令</div>
      </div>
    </div>

    <div class="selector-panel">
      <div class="selector-header">
        <div class="selector-title">{{ selectorTitle }}</div>
        <button
          v-if="selectedPlugin"
          class="selector-back"
          type="button"
          @click="handleBackToPlugins"
        >
          返回分组列表
        </button>
      </div>

      <input
        v-model="selectorQuery"
        type="text"
        class="input"
        :placeholder="selectorPlaceholder"
        @keyup.escape="handleSelectorEscape"
      />

      <div class="selector-list">
        <template v-if="selectedPlugin">
          <button
            v-for="item in filteredPluginCommands"
            :key="item.commandId"
            :class="[
              'selector-item',
              'command-selector-item',
              { active: selectedCommandId === item.commandId }
            ]"
            type="button"
            @click="handleSelectTarget(item)"
          >
            <div class="icon-preview">
              <AdaptiveIcon
                v-if="item.icon"
                :src="item.icon"
                class="selector-item-icon"
                alt="指令图标"
                draggable="false"
              />
              <div v-else class="selector-item-icon icon-placeholder">
                <div class="i-z-command font-size-14px" />
              </div>
            </div>
            <div class="selector-item-texts">
              <div class="selector-item-title">{{ item.cmdName }}</div>
              <div class="selector-item-subtitle">{{ item.subtitle }}</div>
            </div>
          </button>
          <div v-if="filteredPluginCommands.length === 0" class="selector-empty">
            暂无匹配的指令
          </div>
        </template>

        <template v-else>
          <button
            v-for="plugin in filteredPlugins"
            :key="plugin.pluginName"
            class="selector-item plugin-selector-item"
            type="button"
            @click="handleSelectPlugin(plugin.pluginName)"
          >
            <div class="icon-preview">
              <AdaptiveIcon
                v-if="plugin.icon"
                :src="plugin.icon"
                class="selector-item-icon"
                alt="分组图标"
                draggable="false"
              />
              <div v-else class="selector-item-icon icon-placeholder">
                <div class="i-z-command font-size-14px" />
              </div>
            </div>
            <div class="selector-item-texts">
              <div class="selector-item-title">{{ plugin.pluginTitle }}</div>
              <div class="selector-item-subtitle">{{ plugin.commands.length }} 个指令</div>
            </div>
          </button>
          <div v-if="filteredPlugins.length === 0" class="selector-empty">暂无匹配的分组</div>
        </template>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.command-target-selector {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.selector-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
  background: var(--card-bg);
  border: 1px solid var(--divider-color);
  border-radius: 12px;
}

.target-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--card-bg);
  border: 1px solid var(--divider-color);
  border-radius: 10px;

  &-empty {
    color: var(--text-secondary);
  }

  &-texts {
    min-width: 0;
    flex: 1;
  }

  &-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
  }

  &-subtitle {
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--text-secondary);
  }
}

.selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.selector-title {
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.selector-back {
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 12px;
}

.selector-list {
  min-height: 0;
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 8px;
}

.selector-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  background: var(--bg-color);
  border: 1px solid var(--divider-color);
  border-radius: 10px;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease;

  &:hover {
    background: var(--hover-bg);
    border-color: var(--primary-color);
  }

  &.active {
    background: var(--primary-light-bg);
    border-color: var(--primary-color);
  }

  &-texts {
    min-width: 0;
    flex: 1;
  }

  &-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color);
  }

  &-subtitle {
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--text-secondary);
  }
}

.icon-preview,
.icon-placeholder,
.target-card-icon,
.selector-item-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  flex-shrink: 0;
}

.icon-preview,
.icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--control-bg);
  border: 1px solid var(--divider-color);
}

.target-card-icon,
.selector-item-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.selector-empty {
  padding: 12px;
  font-size: 12px;
  text-align: center;
  color: var(--text-secondary);
  background: var(--bg-color);
  border: 1px dashed var(--divider-color);
  border-radius: 10px;
}
</style>
