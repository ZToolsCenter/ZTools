<script setup lang="ts">
import { computed, ref } from 'vue'

type MatchCommandType = 'regex' | 'over' | 'img' | 'files' | 'window' | string

interface MatchCommandDetail {
  type?: MatchCommandType
  label?: string
  name?: string
  match?: string | Record<string, any>
  regex?: string
  exclude?: string
  minLength?: number
  maxLength?: number
  fileType?: 'file' | 'directory'
  extensions?: string[]
  [key: string]: any
}

const props = withDefaults(
  defineProps<{
    visible: boolean
    command?: MatchCommandDetail | null
    disabled?: boolean
    showToggleDisabled?: boolean
  }>(),
  {
    command: null,
    disabled: false,
    showToggleDisabled: false
  }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggle-disabled'): void
}>()

const copied = ref(false)
const rawExpanded = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const typeMeta = computed(() => {
  const type = props.command?.type || 'unknown'
  const map: Record<string, { label: string; icon: string }> = {
    regex: { label: '文本匹配', icon: 'i-z-regex' },
    over: { label: '任意文本', icon: 'i-z-text' },
    img: { label: '图片匹配', icon: 'i-z-image' },
    files: { label: '文件匹配', icon: 'i-z-file' },
    window: { label: '窗口匹配', icon: 'i-z-window' }
  }

  return map[type] || { label: type, icon: 'i-z-info' }
})

const commandName = computed(() => props.command?.label || props.command?.name || '匹配指令')

const primaryRule = computed(() => {
  const command = props.command
  if (!command) return ''
  if (typeof command.match === 'string') return command.match
  if (command.regex) return command.regex
  if (command.type === 'window' && command.match) return JSON.stringify(command.match, null, 2)
  return ''
})

const ruleRows = computed(() => {
  const command = props.command
  if (!command) return []

  const rows: Array<{ label: string; value: string }> = []
  const type = command.type

  if (type === 'regex') {
    if (primaryRule.value) {
      rows.push({ label: '文本匹配', value: primaryRule.value })
    }
  } else if (type === 'over') {
    rows.push({
      label: '长度范围',
      value: `${command.minLength ?? 1}-${command.maxLength ?? 10000}`
    })
    if (command.exclude) {
      rows.push({ label: '排除规则', value: command.exclude })
    }
  } else if (type === 'img') {
    rows.push({ label: '匹配内容', value: '剪贴板图片' })
  } else if (type === 'files') {
    rows.push({
      label: '文件类型',
      value:
        command.fileType === 'directory'
          ? '文件夹'
          : command.fileType === 'file'
            ? '文件'
            : '文件或文件夹'
    })
    rows.push({
      label: '数量范围',
      value: `${command.minLength ?? 1}-${command.maxLength ?? 10000}`
    })
    if (command.extensions?.length) {
      rows.push({ label: '扩展名', value: command.extensions.join(', ') })
    }
    if (typeof command.match === 'string' && command.match) {
      rows.push({ label: '文件名匹配', value: command.match })
    }
  } else if (type === 'window') {
    const match = typeof command.match === 'object' ? command.match : {}
    const app = Array.isArray(match.app) ? match.app.join(', ') : ''
    const classNames = Array.isArray(match.class) ? match.class.join(', ') : ''

    if (app) rows.push({ label: '应用', value: app })
    if (match.title) rows.push({ label: '窗口标题', value: String(match.title) })
    if (classNames) rows.push({ label: '窗口类名', value: classNames })
  } else if (primaryRule.value) {
    rows.push({ label: '匹配规则', value: primaryRule.value })
  }

  return rows
})

const rawJson = computed(() => {
  if (!props.command) return ''
  try {
    return JSON.stringify(props.command, null, 2)
  } catch {
    return String(props.command)
  }
})

const copyText = computed(() => primaryRule.value || rawJson.value)

function close(): void {
  rawExpanded.value = false
  emit('close')
}

async function copyRule(): Promise<void> {
  if (!copyText.value) return
  try {
    await navigator.clipboard.writeText(copyText.value)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 1200)
  } catch (error) {
    console.error('复制匹配规则失败:', error)
  }
}
</script>

<template>
  <Transition name="match-dialog">
    <div v-if="visible && command" class="match-dialog-overlay" @click="close">
      <div class="match-dialog" @click.stop>
        <div class="dialog-header">
          <div class="header-chip">
            <div class="type-icon" :class="typeMeta.icon" />
            <span class="type-label">{{ typeMeta.label }}</span>
            <span class="breadcrumb-separator">›</span>
            <span class="command-label">{{ commandName }}</span>
          </div>
          <button class="icon-btn" title="关闭" @click="close">
            <span>×</span>
          </button>
        </div>

        <div class="dialog-content">
          <div v-if="ruleRows.length > 0" class="rule-list">
            <div v-for="row in ruleRows" :key="row.label" class="rule-row">
              <div class="rule-label">{{ row.label }}</div>
              <code>{{ row.value }}</code>
            </div>
          </div>

          <div class="raw-detail">
            <button class="raw-summary" type="button" @click="rawExpanded = !rawExpanded">
              <span>原始配置</span>
              <span class="raw-summary-arrow" :class="{ expanded: rawExpanded }">›</span>
            </button>
            <div class="raw-content" :class="{ expanded: rawExpanded }">
              <div class="raw-content-inner">
                <pre>{{ rawJson }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <div class="footer-actions">
            <button class="btn btn-secondary" @click="copyRule">
              {{ copied ? '已复制' : '复制规则' }}
            </button>
            <button
              v-if="showToggleDisabled"
              class="btn"
              :class="disabled ? 'btn-primary' : 'btn-danger'"
              @click="emit('toggle-disabled')"
            >
              {{ disabled ? '启用指令' : '禁用指令' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.match-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.35);
}

.match-dialog {
  width: min(640px, 90vw);
  max-height: min(500px, 84vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--dialog-bg, var(--bg-color));
  border: 1px solid var(--control-border);
  border-radius: 8px;
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.24);
  transform-origin: calc(100% - 28px) 28px;
  will-change: opacity, transform;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px 8px;
}

.header-chip {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
}

.type-icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-color);
  font-size: 17px;
}

.type-label {
  color: var(--text-color);
  font-size: 16px;
  font-weight: 500;
  white-space: nowrap;
}

.breadcrumb-separator {
  color: var(--text-secondary);
  font-size: 20px;
  line-height: 1;
}

.command-label {
  max-width: 260px;
  padding: 3px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--control-border);
  border-radius: 999px;
  color: var(--text-color);
  background: var(--bg-color);
  font-size: 16px;
}

.icon-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}

.icon-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.dialog-content {
  flex: 1;
  overflow: auto;
  padding: 4px 24px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rule-row {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  align-items: center;
  min-height: 48px;
  gap: 14px;
  padding: 9px 16px;
  border-radius: 6px;
  background: var(--control-bg);
}

.rule-label {
  color: var(--text-secondary);
  font-size: 14px;
}

.rule-row code {
  overflow-x: auto;
  padding: 0;
  color: var(--text-color);
  font-family: Consolas, Monaco, monospace;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre;
}

.raw-detail {
  border: 1px solid transparent;
  border-radius: 6px;
  overflow: hidden;
}

.raw-summary {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.raw-summary-arrow {
  display: inline-flex;
  transition: transform 0.18s ease;
}

.raw-summary-arrow.expanded {
  transform: rotate(90deg);
}

.raw-detail pre {
  max-height: 180px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
  color: var(--text-color);
  background: var(--control-bg);
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.raw-content {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 0.22s ease,
    opacity 0.18s ease;
}

.raw-content.expanded {
  grid-template-rows: 1fr;
  opacity: 1;
}

.raw-content-inner {
  min-height: 0;
  overflow: hidden;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 8px 24px 18px;
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn {
  min-width: 96px;
  padding: 8px 14px;
  border: 1px solid;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary {
  background: var(--control-bg);
  color: var(--text-color);
  border-color: var(--control-border);
}

.btn-secondary:hover {
  background: var(--hover-bg);
}

.btn-primary {
  background: var(--control-bg);
  color: var(--primary-color);
  border-color: color-mix(in srgb, var(--primary-color), transparent 35%);
}

.btn-primary:hover {
  background: var(--primary-light-bg);
}

.btn-danger {
  background: var(--control-bg);
  color: var(--danger-color, #ef4444);
  border-color: color-mix(in srgb, var(--danger-color, #ef4444), transparent 35%);
}

.btn-danger:hover {
  background: var(--danger-light-bg, rgba(239, 68, 68, 0.1));
}

.match-dialog-enter-active,
.match-dialog-leave-active {
  pointer-events: none;
}

.match-dialog-enter-active {
  animation: match-dialog-overlay-fade-in 0.25s ease-out forwards;
}

.match-dialog-leave-active {
  animation: match-dialog-overlay-fade-out 0.35s ease-in forwards;
}

.match-dialog-enter-active .match-dialog {
  animation: match-dialog-scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.match-dialog-leave-active .match-dialog {
  animation: match-dialog-collapse-to-close 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes match-dialog-overlay-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes match-dialog-overlay-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@keyframes match-dialog-scale-in {
  from {
    opacity: 0;
    transform: scale(0.85) translateY(20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes match-dialog-collapse-to-close {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0);
  }
}

@media (max-width: 640px) {
  .match-dialog-overlay {
    padding: 12px;
  }

  .dialog-header,
  .dialog-content,
  .dialog-footer {
    padding-left: 16px;
    padding-right: 16px;
  }

  .header-chip {
    max-width: 100%;
  }

  .type-label,
  .command-label {
    font-size: 15px;
  }

  .rule-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
</style>
