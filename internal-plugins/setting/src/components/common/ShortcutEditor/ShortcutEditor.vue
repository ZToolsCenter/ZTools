<template>
  <DetailPanel
    :title="
      editingShortcut
        ? isAppShortcut
          ? '编辑应用快捷键'
          : '编辑全局快捷键'
        : isAppShortcut
          ? '添加应用快捷键'
          : '添加全局快捷键'
    "
    @back="emit('back')"
  >
    <div class="editor-wrapper">
      <div class="editor-content">
        <div class="editor-main">
          <div>
            <!-- 快捷键类型说明 -->
            <div v-if="isAppShortcut" class="form-notice">
              应用快捷键仅在 ZTools 窗口激活时生效，不会与其他应用冲突
            </div>

            <!-- 快捷键录制 -->
            <div class="form-item">
              <label class="form-label">快捷键</label>
              <HotkeyInput
                v-model="recordedShortcut"
                :platform="platform"
                placeholder="点击录制快捷键"
              />
              <span class="form-hint">点击上方输入框录制快捷键</span>
            </div>

            <!-- 预截图优化（仅 Windows 全局快捷键编辑页） -->
            <div v-if="!isAppShortcut && platform === 'win32'" class="form-item">
              <label class="form-label">预截图优化</label>
              <label class="toggle editor-toggle">
                <input v-model="preScreenshotOptimization" type="checkbox" />
                <span class="toggle-slider"></span>
              </label>
              <span class="form-hint">仅对截图类全局快捷键生效，触发后会优先预抓取屏幕首帧</span>
            </div>
          </div>

          <div class="editor-selector">
            <label class="form-label">目标指令</label>
            <CommandTargetSelector
              :options="targetOptions"
              :selected-command-id="currentTarget?.commandId || null"
              @select="handleSelectTarget"
              @escape="handleSelectorEscape"
            />
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <button class="btn" @click="emit('back')">取消</button>
        <button class="btn" :disabled="!recordedShortcut || !currentTarget" @click="handleSave">
          确定
        </button>
      </div>
    </div>
  </DetailPanel>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { HotkeyInput, DetailPanel } from '@/components'
import CommandTargetSelector from '@/views/ShortcutsSetting/components/CommandTargetSelector.vue'
import {
  buildShortcutTargetCandidates,
  normalizeShortcutTargetValue,
  type ShortcutsSettingShortcutTargetOption
} from '@/views/ShortcutsSetting/ShortcutsSetting'

interface GlobalShortcut {
  id: string
  shortcut: string
  target: string
  enabled: boolean
  preScreenshotOptimization?: boolean
}

const props = defineProps<{
  editingShortcut?: GlobalShortcut | null
  prefillTarget?: string
  targetOptions: ShortcutsSettingShortcutTargetOption[]
  isAppShortcut?: boolean
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'save', shortcut: string, target: string, preScreenshotOptimization: boolean): void
}>()

// 平台信息（用于区分 Alt/Option 显示）
const platform = ref<'darwin' | 'win32' | 'linux'>('darwin')

// 录制状态
const recordedShortcut = ref('')
const targetCommand = ref('')
const preScreenshotOptimization = ref(false)

const currentTarget = computed(() => resolveShortcutTargetOption(targetCommand.value))

// 初始化编辑数据
watch(
  () => props.editingShortcut,
  (newVal) => {
    if (newVal) {
      recordedShortcut.value = newVal.shortcut
      targetCommand.value = normalizeShortcutTargetValue(newVal.target)
      preScreenshotOptimization.value = newVal.preScreenshotOptimization ?? false
    } else {
      recordedShortcut.value = ''
      targetCommand.value = normalizeShortcutTargetValue(props.prefillTarget || '')
      preScreenshotOptimization.value = false
    }
  },
  { immediate: true }
)

watch(
  () => props.prefillTarget,
  (newVal) => {
    if (!props.editingShortcut) {
      targetCommand.value = normalizeShortcutTargetValue(newVal || '')
    }
  }
)

/**
 * 将存量快捷键目标字符串解析回当前可选的目标指令。
 */
function resolveShortcutTargetOption(
  rawTarget: string
): ShortcutsSettingShortcutTargetOption | null {
  const normalizedTarget = normalizeShortcutTargetValue(rawTarget)
  if (!normalizedTarget) {
    return null
  }

  return (
    props.targetOptions.find((item) =>
      buildShortcutTargetCandidates(item).includes(normalizedTarget)
    ) || null
  )
}

/**
 * 保存快捷键编辑结果，并优先回写当前目标的 canonical 字符串。
 */
function handleSave(): void {
  if (!recordedShortcut.value || !currentTarget.value) {
    return
  }

  emit(
    'save',
    recordedShortcut.value,
    currentTarget.value.value,
    !props.isAppShortcut && preScreenshotOptimization.value
  )
}

/**
 * 接收选择器选中的目标指令，并同步更新待保存字符串。
 */
function handleSelectTarget(target: ShortcutsSettingShortcutTargetOption): void {
  targetCommand.value = target.value
}

/**
 * 在目标选择器根层按下 Esc 时返回上一层详情面板。
 */
function handleSelectorEscape(): void {
  emit('back')
}

// 初始化平台信息
onMounted(() => {
  const pf = window.ztools.internal.getPlatform()
  if (pf === 'darwin' || pf === 'win32' || pf === 'linux') {
    platform.value = pf
  }
})
</script>

<style scoped>
.editor-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-content {
  flex: 1;
  padding: 20px 24px;
  min-height: 0;
  overflow: hidden;
}

.editor-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;
  height: 100%;
  min-height: 0;
}

.form-notice {
  padding: 12px 16px;
  margin-bottom: 20px;
  background: var(--primary-light-bg);
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  font-size: 13px;
  color: var(--primary-color);
  line-height: 1.5;
}

.form-item {
  margin-bottom: 24px;
}

.form-item:last-child {
  margin-bottom: 0;
}

.editor-toggle {
  display: inline-flex;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 8px;
}

.form-hint {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.editor-selector {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--divider-color);
  background: var(--bg-color);
}
</style>
