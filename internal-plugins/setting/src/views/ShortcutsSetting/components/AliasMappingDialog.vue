<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { AdaptiveIcon, DetailPanel } from '@/components'
import CommandTargetSelector from './CommandTargetSelector.vue'
import type {
  ShortcutsSettingAliasCommandOption as AliasCommandOption,
  ShortcutsSettingAliasDialogState as AliasDialogState
} from '@/views/ShortcutsSetting/ShortcutsSetting'

const MAX_ICON_SIZE = 96
const ICON_OUTPUT_TYPE = 'image/png'
const ICON_OUTPUT_QUALITY = 0.92

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
  },
  { immediate: true }
)

// 预览图标优先使用 alias 自定义图标，未设置时回退到目标指令图标
const displayIcon = computed(() => icon.value || target.value?.icon)
const dialogTitle = computed(() => (mode.value === 'edit' ? '编辑指令别名' : '添加指令别名'))

function handleCancel(): void {
  emit('cancel')
  emit('update:visible', false)
}

/**
 * 接收共享目标选择器回传的目标指令。
 */
function handleSelectTarget(nextTarget: AliasCommandOption): void {
  target.value = nextTarget
}

/**
 * 在目标选择器根层按下 Esc 时关闭当前 alias 对话框。
 */
function handleSelectorEscape(): void {
  handleCancel()
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
        </div>

        <!-- 目标选择区：先选分组，再选指令 -->
        <div class="alias-dialog-selector">
          <label class="form-label">目标</label>
          <CommandTargetSelector
            :options="targetOptions"
            :selected-command-id="target?.commandId || null"
            :selected-option="target"
            @select="handleSelectTarget"
            @escape="handleSelectorEscape"
          />
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

.alias-dialog-main,
.alias-dialog-selector {
  min-height: 0;
}

.alias-dialog-main {
  overflow-y: auto;
  padding-right: 4px;
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
.icon-placeholder {
  width: 64px;
  height: 64px;
  border-radius: 14px;
}

.icon-preview,
.icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--control-bg);
  border: 1px solid var(--divider-color);
}

.preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.hidden-file-input {
  display: none;
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
