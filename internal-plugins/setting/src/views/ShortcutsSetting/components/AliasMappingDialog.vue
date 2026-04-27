<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { AdaptiveIcon, DetailPanel } from '@/components'
import { weightedSearch } from '@/utils'
import type {
  ShortcutsSettingAliasCommandOption as AliasCommandOption,
  ShortcutsSettingAliasDialogState as AliasDialogState
} from '@/views/ShortcutsSetting/ShortcutsSetting'

const MAX_ICON_SIZE = 96
const ICON_OUTPUT_TYPE = 'image/png'
const ICON_OUTPUT_QUALITY = 0.92

interface AliasPluginOption {
  pluginName: string
  pluginTitle: string
  icon?: string
  commands: AliasCommandOption[]
}

const props = withDefaults(
  defineProps<{
    visible: boolean
    initialState: AliasDialogState | null
    targetOptions: AliasCommandOption[]
    saving?: boolean
  }>(),
  {
    saving: false
  }
)

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'save', value: AliasDialogState): void
  (e: 'cancel'): void
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const containerRef = ref<HTMLElement | null>(null)
const aliasInputRef = ref<HTMLInputElement | null>(null)
const mode = ref<AliasDialogState['mode']>('create')
const originalCommandId = ref<string | undefined>()
const originalAlias = ref<string | undefined>()
const alias = ref('')
const icon = ref<string | undefined>()
const target = ref<AliasCommandOption | null>(null)
const selectorQuery = ref('')
const selectedPluginName = ref<string | null>(null)

function focusAliasInput(select = true): void {
  nextTick(() => {
    const input =
      aliasInputRef.value ||
      (containerRef.value?.querySelector('input[type="text"]') as HTMLInputElement | null)

    input?.focus()
    if (select) {
      input?.select()
    }
  })
}

watch(
  () => props.initialState,
  (state) => {
    // 弹窗每次打开或切换编辑对象时，都用外部状态覆盖内部编辑态，避免残留上一次输入
    mode.value = state?.mode || 'create'
    originalCommandId.value = state?.originalCommandId
    originalAlias.value = state?.originalAlias
    alias.value = state?.alias || ''
    icon.value = state?.icon || undefined
    target.value = state?.target || null
    selectorQuery.value = ''
    selectedPluginName.value = null
  },
  { immediate: true }
)

watch(
  () => props.targetOptions,
  (options) => {
    // 目标列表变化后，如果当前选中的插件已失效，则退回插件列表，避免停留在无效子列表里
    if (
      selectedPluginName.value &&
      !options.some((item) => item.pluginName === selectedPluginName.value)
    ) {
      selectedPluginName.value = null
      selectorQuery.value = ''
    }
  }
)

const pluginOptions = computed<AliasPluginOption[]>(() => {
  const pluginMap = new Map<string, AliasPluginOption>()

  // 目标选择器采用两级结构：先按分组选择，再在分组内选具体指令。
  for (const item of props.targetOptions) {
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

  // 插件级搜索优先匹配插件标题，再兼顾插件名与内部指令名
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

  // 进入插件后，搜索范围收敛到该插件的可选指令列表
  return weightedSearch(commands, query, [
    { value: (item) => item.cmdName || '', weight: 10 },
    { value: (item) => item.label || '', weight: 8 },
    { value: (item) => item.subtitle || '', weight: 4 }
  ])
})

// 预览图标优先使用 alias 自定义图标，未设置时回退到目标指令图标
const displayIcon = computed(() => icon.value || target.value?.icon)
const dialogTitle = computed(() => (mode.value === 'edit' ? '编辑指令别名' : '添加指令别名'))
const selectorTitle = computed(() =>
  selectedPlugin.value ? `${selectedPlugin.value.pluginTitle} 的指令` : '所有可用目标'
)
const selectorPlaceholder = computed(() => (selectedPlugin.value ? '搜索该分组的指令' : '搜索分组'))

function handleCancel(): void {
  emit('cancel')
  emit('update:visible', false)
}

function handleSelectPlugin(pluginName: string): void {
  selectedPluginName.value = pluginName
  selectorQuery.value = ''
}

function handleBackToPlugins(): void {
  selectedPluginName.value = null
  selectorQuery.value = ''
}

function handleSelectorEscape(): void {
  if (selectedPluginName.value) {
    handleBackToPlugins()
    return
  }

  handleCancel()
}

function handleSelectTarget(nextTarget: AliasCommandOption): void {
  target.value = nextTarget
}

function handlePickIcon(): void {
  fileInputRef.value?.click()
}

function handleClearIcon(): void {
  icon.value = undefined
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('图标加载失败'))
    }
    img.src = objectUrl
  })
}

async function compressIcon(file: File): Promise<string> {
  const img = await loadImage(file)
  const scale = Math.min(1, MAX_ICON_SIZE / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('图标处理失败')
  }

  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL(ICON_OUTPUT_TYPE, ICON_OUTPUT_QUALITY)
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return

  try {
    // 上传图标先压缩成小尺寸 DataURL，避免 alias 文档过大导致持久化失败
    icon.value = await compressIcon(file)
  } catch (error) {
    console.error('处理别名图标失败:', error)
  }

  if (input) {
    // 清空 input，允许连续选择同一个文件时也能重新触发 change
    input.value = ''
  }
}

function handleSave(): void {
  emit('save', {
    mode: mode.value,
    originalCommandId: originalCommandId.value,
    originalAlias: originalAlias.value,
    alias: alias.value,
    icon: icon.value,
    target: target.value
  })
}

defineExpose({
  focusAliasInput
})
</script>

<template>
  <DetailPanel :title="dialogTitle" @back="handleCancel">
    <div ref="containerRef" class="alias-dialog-container">
      <div class="alias-dialog-content">
        <!-- alias 输入与图标设置区 -->
        <div class="alias-dialog-main">
          <div class="form-group">
            <label class="form-label">自定义别名</label>
            <input
              ref="aliasInputRef"
              v-model="alias"
              type="text"
              class="input"
              placeholder="输入自定义别名"
              @keyup.enter="handleSave"
              @keyup.escape="handleCancel"
            />
          </div>

          <div class="form-group">
            <label class="form-label">图标</label>
            <div class="icon-row">
              <div class="icon-preview">
                <AdaptiveIcon
                  v-if="displayIcon"
                  :src="displayIcon"
                  class="preview-img"
                  alt="别名图标"
                  draggable="false"
                />
                <div v-else class="icon-placeholder">
                  <div class="i-z-command font-size-22px" />
                </div>
              </div>
              <div class="btn-group flex gap-2">
                <button class="btn btn-sm" type="button" @click="handlePickIcon">上传图标</button>
                <button class="btn btn-sm" type="button" :disabled="!icon" @click="handleClearIcon">
                  清除自定义图标
                </button>
              </div>
            </div>
            <p class="form-hint">未上传时默认使用目标指令图标</p>
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              class="hidden-file-input"
              @change="handleFileChange"
            />
          </div>

          <div class="form-group">
            <label class="form-label">目标</label>
            <div v-if="target" class="target-card">
              <div class="icon-preview">
                <AdaptiveIcon
                  v-if="target.icon"
                  :src="target.icon"
                  class="target-card-icon"
                  alt="目标图标"
                  draggable="false"
                />
                <div v-else class="target-card-icon icon-placeholder">
                  <div class="i-z-command font-size-16px" />
                </div>
              </div>
              <div class="target-card-texts">
                <div class="target-card-title">{{ target.label }}</div>
                <div class="target-card-subtitle">{{ target.subtitle }}</div>
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
          </div>
        </div>

        <!-- 目标选择区：先选分组，再选指令 -->
        <div class="alias-dialog-selector">
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
                  { active: target?.commandId === item.commandId }
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

      <!-- 底部操作区 -->
      <div class="dialog-footer">
        <button class="btn" type="button" @click="handleCancel">取消</button>
        <button class="btn btn-solid" type="button" :disabled="saving" @click="handleSave">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
  </DetailPanel>
</template>

<style lang="less" scoped>
.alias-dialog-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.alias-dialog-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  padding: 20px 24px;
  gap: 20px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.alias-dialog-main {
  overflow-y: auto;
  padding-right: 4px;
}

.alias-dialog-selector {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: var(--card-bg);
  border: 1px solid var(--divider-color);
  border-radius: 12px;
  overflow: hidden;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 20px;

  &:last-child {
    margin-bottom: 0;
  }
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
}

.form-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.icon-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
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

.preview-img,
.target-card-icon,
.selector-item-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.hidden-file-input {
  display: none;
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

.selector-empty {
  padding: 12px;
  font-size: 12px;
  text-align: center;
  color: var(--text-secondary);
  background: var(--bg-color);
  border: 1px dashed var(--divider-color);
  border-radius: 10px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  background: var(--bg-color);
  border-top: 1px solid var(--divider-color);
}
</style>
