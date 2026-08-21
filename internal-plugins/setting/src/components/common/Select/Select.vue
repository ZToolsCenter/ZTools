<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import { useOverlayPosition } from '../shared/useOverlayPosition'
import type {
  SelectEmits,
  SelectModelValue,
  SelectOption,
  SelectProps,
  SelectSelectedItem,
  SelectSingleModelValue,
  SelectTriggerProps,
  SelectTriggerSlotProps,
  SelectValueType
} from './Select'

const props = withDefaults(defineProps<SelectProps>(), {
  placeholder: '请选择',
  multiple: false,
  clearable: false,
  disabled: false,
  readonly: false,
  size: 'medium',
  message: '',
  mode: 'default',
  show: undefined,
  defaultShow: false,
  placement: 'bottom-start',
  autoAdjustPlacement: true,
  to: 'body'
})

const emit = defineEmits<SelectEmits>()
const slots = defineSlots<{
  trigger?: (props: SelectTriggerSlotProps) => any
}>()
const runtimeSlots = useSlots()

void slots

const selectRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const tagInputRef = ref<HTMLInputElement | null>(null)
const tagInputValue = ref('')

const isTagsMode = computed(() => props.mode === 'tags')
const isMultiple = computed(() => props.multiple || isTagsMode.value)

/**
 * 将外部传入的模型值规范化为单选或多选形态，保证内部统一处理。
 * @param value 外部传入值
 * @param multiple 是否多选
 * @returns 规范化后的单值或数组
 */
function normalizeSelectValue(
  value: SelectModelValue | undefined,
  multiple: boolean
): SelectModelValue {
  if (multiple) {
    if (Array.isArray(value)) {
      return [...value]
    }

    if (value === undefined || value === null || value === '') {
      return []
    }

    return [value]
  }

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  if (value === undefined) {
    return null
  }

  return value
}

const uncontrolledValue = ref<SelectModelValue>(
  normalizeSelectValue(
    props.modelValue !== undefined ? props.modelValue : props.defaultModelValue,
    isMultiple.value
  )
)
const uncontrolledShow = ref(props.show !== undefined ? props.show : props.defaultShow)

const mergedValue = computed<SelectModelValue>(() => {
  return props.modelValue !== undefined
    ? normalizeSelectValue(props.modelValue, isMultiple.value)
    : uncontrolledValue.value
})
const mergedShow = computed(() => (props.show === undefined ? uncontrolledShow.value : props.show))
const isInteractive = computed(() => !props.disabled && !props.readonly)
const teleportTarget = computed(() => (props.to === false ? 'body' : (props.to ?? 'body')))
const hasCustomTrigger = computed(() => !!runtimeSlots.trigger)

watch(
  () => props.modelValue,
  (value) => {
    if (value !== undefined) {
      uncontrolledValue.value = normalizeSelectValue(value, isMultiple.value)
    }
  }
)

watch(
  () => props.show,
  (value) => {
    if (value !== undefined) {
      uncontrolledShow.value = value
    }
  }
)

watch(isMultiple, (multiple) => {
  const normalizedPropValue = normalizeSelectValue(props.modelValue, multiple)
  const normalizedUncontrolledValue = normalizeSelectValue(uncontrolledValue.value, multiple)

  uncontrolledValue.value =
    props.modelValue !== undefined ? normalizedPropValue : normalizedUncontrolledValue
})

const selectClasses = computed(() => [
  'z-select',
  `select--${props.size}`,
  {
    open: mergedShow.value,
    'is-disabled': props.disabled,
    'is-readonly': props.readonly,
    'is-success': props.status === 'success',
    'is-warning': props.status === 'warning',
    'is-error': props.status === 'error',
    'is-multiple': isMultiple.value,
    'is-tags': isTagsMode.value,
    'has-clear': showClear.value,
    'is-custom-trigger': hasCustomTrigger.value
  }
])

const selectedValues = computed<SelectValueType[]>(() => {
  const value = mergedValue.value

  if (Array.isArray(value)) {
    return value
  }

  if (value === '' || value === null || value === undefined) {
    return []
  }

  return [value]
})

const singleValue = computed<SelectValueType | undefined>(() => selectedValues.value[0])
const selectedLabel = computed(() => {
  const selected = props.options.find((opt) => opt.value === singleValue.value)
  return selected ? selected.label : props.placeholder
})

const selectedItems = computed<SelectSelectedItem[]>(() =>
  selectedValues.value.map((value) => {
    const option = props.options.find((opt) => opt.value === value)
    return {
      label: option?.label ?? String(value),
      value
    }
  })
)

const visibleSelectedItems = computed(() => {
  if (typeof props.maxTagCount !== 'number' || props.maxTagCount < 0) {
    return selectedItems.value
  }

  return selectedItems.value.slice(0, props.maxTagCount)
})

const hiddenTagCount = computed(
  () => selectedItems.value.length - visibleSelectedItems.value.length
)
const hasValue = computed(() => selectedValues.value.length > 0)
const showClear = computed(() => props.clearable && isInteractive.value && hasValue.value)

const { resolvedPlacement, panelStyle, containsTarget, scheduleUpdate } = useOverlayPosition({
  visible: mergedShow,
  triggerRef: selectRef,
  anchorRef: triggerRef,
  panelRef,
  placement: computed(() => props.placement),
  autoAdjustPlacement: computed(() => props.autoAdjustPlacement),
  width: computed(() => 'trigger')
})

/**
 * 将一次面板定位刷新推迟到下一帧执行。
 * @returns 无返回值
 */
function scheduleOverlayUpdate(): void {
  nextTick(() => scheduleUpdate())
}

/**
 * 切换菜单显隐，并同步对外事件；受交互性与可见状态约束。
 * @param visible 目标可见状态
 * @returns 无返回值
 */
function setOpen(visible: boolean): void {
  if (!isInteractive.value && visible) return
  if (mergedShow.value === visible) return

  if (props.show === undefined) {
    uncontrolledShow.value = visible
  }

  emit('update:show', visible)
  emit('visible-change', visible)
}

/**
 * 打开菜单；标签模式下聚焦输入框。
 * @returns 无返回值
 */
function openMenu(): void {
  if (isTagsMode.value) {
    focusTagInput()
  }

  setOpen(true)
}

/**
 * 关闭菜单。
 * @returns 无返回值
 */
function closeMenu(): void {
  setOpen(false)
}

/**
 * 在下一帧聚焦标签输入框；非标签模式不做任何事。
 * @returns 无返回值
 */
function focusTagInput(): void {
  if (!isTagsMode.value) return
  nextTick(() => tagInputRef.value?.focus())
}

/**
 * 切换菜单展开状态；标签模式下始终执行打开。
 * @returns 无返回值
 */
function toggleSelect(): void {
  if (!isInteractive.value) return

  if (isTagsMode.value) {
    openMenu()
    return
  }

  setOpen(!mergedShow.value)
}

/**
 * 判断给定值是否处于当前选中集合中。
 * @param value 待判断的值
 * @returns 是否已选中
 */
function isSelected(value: SelectValueType): boolean {
  return selectedValues.value.includes(value)
}

/**
 * 同步内部非受控值并对外发出更新与 change 事件。
 * @param value 新值
 * @returns 无返回值
 */
function updateValue(value: SelectModelValue): void {
  if (props.modelValue === undefined) {
    uncontrolledValue.value = normalizeSelectValue(value, isMultiple.value)
  }

  emit('update:modelValue', value)
  emit('change', value)
}

/**
 * 以单选形态发出新值。
 * @param value 新的单选值
 * @returns 无返回值
 */
function emitSingleValue(value: SelectSingleModelValue): void {
  updateValue(value)
}

/**
 * 以多选形态发出新值数组。
 * @param value 新的多选值数组
 * @returns 无返回值
 */
function emitMultipleValue(value: SelectValueType[]): void {
  updateValue(value)
}

/**
 * 处理选项点击：多选下增删该值并保持展开，单选下选中并关闭。
 * @param option 被点击的选项
 * @returns 无返回值
 */
function selectOption(option: SelectOption): void {
  if (!isInteractive.value || option.disabled) return

  if (isMultiple.value) {
    const nextValues = isSelected(option.value)
      ? selectedValues.value.filter((value) => value !== option.value)
      : [...selectedValues.value, option.value]
    emitMultipleValue(nextValues)
    focusTagInput()
    scheduleOverlayUpdate()
    return
  }

  emitSingleValue(option.value)
  setOpen(false)
}

/**
 * 从选中集合中移除一个值，并发出移除事件。
 * @param value 要移除的值
 * @returns 无返回值
 */
function removeValue(value: SelectValueType): void {
  if (!isInteractive.value) return
  emitMultipleValue(selectedValues.value.filter((item) => item !== value))
  emit('tag-remove', value)
  focusTagInput()
  scheduleOverlayUpdate()
}

/**
 * 清空当前选择并重置输入框。
 * @returns 无返回值
 */
function handleClear(): void {
  if (isMultiple.value) {
    emitMultipleValue([])
  } else {
    emitSingleValue(null)
  }

  emit('clear')
  tagInputValue.value = ''
  scheduleOverlayUpdate()
}

/**
 * 转发菜单滚动事件。
 * @param event 滚动事件
 * @returns 无返回值
 */
function handleMenuScroll(event: Event): void {
  emit('scroll', event)
}

/**
 * 提交标签输入：匹配已有选项则选中，否则以输入文本创建新值。
 * @returns 无返回值
 */
function commitTagInput(): void {
  if (!isInteractive.value || !isTagsMode.value) return

  const text = tagInputValue.value.trim()
  if (!text) return

  const matchedOption = props.options.find(
    (option) => !option.disabled && (option.label === text || String(option.value) === text)
  )
  const value = matchedOption?.value ?? text

  if (!selectedValues.value.includes(value)) {
    emitMultipleValue([...selectedValues.value, value])
    if (!matchedOption) {
      emit('tag-create', text)
    }
  }

  tagInputValue.value = ''
  setOpen(true)
  scheduleOverlayUpdate()
}

/**
 * 标签输入键盘处理：Enter 提交、Backspace 删除末项、Escape 关闭。
 * @param event 键盘事件
 * @returns 无返回值
 */
function handleTagInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (!event.isComposing) {
      commitTagInput()
    }
    return
  }

  if (event.key === 'Backspace' && tagInputValue.value === '' && selectedValues.value.length > 0) {
    removeValue(selectedValues.value[selectedValues.value.length - 1])
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    setOpen(false)
  }
}

/**
 * 触发器键盘处理：Enter/Space 切换，Escape 关闭。
 * @param event 键盘事件
 * @returns 无返回值
 */
function handleTriggerKeydown(event: KeyboardEvent): void {
  if (!isInteractive.value) return

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleSelect()
    return
  }

  if (event.key === 'Escape') {
    setOpen(false)
  }
}

/**
 * 记录自定义触发器的 DOM 元素引用，供定位 composable 使用。
 * @param element 触发器元素；卸载时为 null
 * @returns 无返回值
 */
function setTriggerRef(element: HTMLElement | null): void {
  triggerRef.value = element
}

const triggerProps = computed<SelectTriggerProps>(() => ({
  role: 'combobox',
  tabindex: props.disabled ? -1 : 0,
  'aria-haspopup': 'listbox',
  'aria-expanded': mergedShow.value ? 'true' : 'false',
  'aria-disabled': props.disabled ? 'true' : undefined,
  'aria-readonly': props.readonly ? 'true' : undefined,
  'aria-invalid': props.status === 'error' ? 'true' : undefined,
  onClick: toggleSelect
}))

const triggerSlotProps = computed<SelectTriggerSlotProps>(() => ({
  visible: mergedShow.value,
  selectedLabel: selectedLabel.value,
  selectedValues: selectedValues.value,
  selectedItems: selectedItems.value,
  hasValue: hasValue.value,
  disabled: props.disabled,
  readonly: props.readonly,
  multiple: isMultiple.value,
  triggerProps: triggerProps.value,
  setTriggerRef,
  openMenu,
  closeMenu,
  toggleMenu: toggleSelect
}))

/**
 * 文档级指针按下处理：菜单展开且点击落在触发器或面板之外时关闭。
 * @param event 指针事件
 * @returns 无返回值
 */
function handleDocumentPointerDown(event: PointerEvent): void {
  if (!mergedShow.value || containsTarget(event.target)) {
    return
  }

  setOpen(false)
}

/**
 * 文档级键盘处理：菜单展开时按 Escape 关闭。
 * @param event 键盘事件
 * @returns 无返回值
 */
function handleDocumentKeydown(event: KeyboardEvent): void {
  if (mergedShow.value && event.key === 'Escape') {
    setOpen(false)
  }
}

watch(
  () => [mergedValue.value, tagInputValue.value, props.options.length, mergedShow.value] as const,
  () => {
    if (mergedShow.value) {
      scheduleOverlayUpdate()
    }
  },
  { flush: 'post' }
)

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<template>
  <div ref="selectRef" :class="selectClasses">
    <slot v-if="hasCustomTrigger" name="trigger" v-bind="triggerSlotProps" />
    <div
      v-else
      ref="triggerRef"
      class="select-trigger"
      role="combobox"
      :tabindex="disabled ? -1 : 0"
      aria-haspopup="listbox"
      :aria-expanded="mergedShow"
      :aria-disabled="disabled ? 'true' : undefined"
      :aria-readonly="readonly ? 'true' : undefined"
      :aria-invalid="status === 'error' ? 'true' : undefined"
      @click="toggleSelect"
      @keydown="handleTriggerKeydown"
    >
      <div class="select-selection">
        <span v-if="!isMultiple" class="select-value">{{ selectedLabel }}</span>
        <template v-else>
          <span v-if="!hasValue && !isTagsMode" class="select-placeholder">{{ placeholder }}</span>
          <span v-for="item in visibleSelectedItems" :key="item.value" class="select-tag">
            <span class="select-tag-label">{{ item.label }}</span>
            <button
              v-if="isInteractive"
              class="select-tag-close"
              type="button"
              aria-label="移除标签"
              @click.stop="removeValue(item.value)"
            >
              ×
            </button>
          </span>
          <span v-if="hiddenTagCount > 0" class="select-tag select-tag-more">
            +{{ hiddenTagCount }}
          </span>
          <input
            v-if="isTagsMode"
            ref="tagInputRef"
            v-model="tagInputValue"
            class="select-tag-input"
            type="text"
            :placeholder="hasValue ? '' : placeholder"
            :disabled="disabled"
            :readonly="readonly"
            @click.stop="setOpen(true)"
            @keydown.stop="handleTagInputKeydown"
          />
        </template>
      </div>

      <button
        v-if="showClear"
        class="select-clear"
        type="button"
        aria-label="清空选择"
        @click.stop="handleClear"
      >
        ×
      </button>

      <svg
        class="select-arrow"
        :class="{ rotate: mergedShow }"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M4 6L8 10L12 6"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <Teleport :to="teleportTarget" :disabled="props.to === false">
      <Transition name="select-menu">
        <div
          v-if="mergedShow"
          ref="panelRef"
          class="select-menu"
          :data-placement="resolvedPlacement"
          :style="panelStyle"
          role="listbox"
          :aria-multiselectable="isMultiple ? 'true' : undefined"
          @scroll="handleMenuScroll"
        >
          <div
            v-for="option in options"
            :key="option.value"
            class="select-item"
            :class="{ active: isSelected(option.value), disabled: option.disabled }"
            role="option"
            :aria-selected="isSelected(option.value)"
            :aria-disabled="option.disabled ? 'true' : undefined"
            @click="selectOption(option)"
          >
            <span class="select-item-label">{{ option.label }}</span>
            <svg
              v-if="isSelected(option.value)"
              class="select-item-check"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M13 4L6 11L3 8"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
        </div>
      </Transition>
    </Teleport>

    <div v-if="message" class="select-footer">
      <span class="select-message">{{ message }}</span>
    </div>
  </div>
</template>

<style scoped>
.z-select {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  min-width: 150px;
  color: var(--text-color);
}

.z-select.is-custom-trigger {
  min-width: 0;
}

.select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--control-bg);
  border: 2px solid var(--control-border);
  border-radius: 6px;
  color: var(--text-color);
  cursor: pointer;
  transition: all 0.2s;
  outline: none;
  user-select: none;
  box-sizing: border-box;
}

.select-trigger:hover {
  background: var(--hover-bg);
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
}

.z-select.open .select-trigger,
.select-trigger:focus-visible {
  background: var(--active-bg);
  border-color: color-mix(in srgb, var(--primary-color), black 15%);
  box-shadow: 0 0 0 3px var(--primary-light-bg);
}

.z-select.is-disabled:not(.is-custom-trigger) {
  opacity: 0.5;
  cursor: not-allowed;
}

.z-select.is-disabled .select-trigger,
.z-select.is-disabled.is-custom-trigger {
  cursor: not-allowed;
}

.z-select.is-readonly .select-trigger {
  cursor: default;
}

.z-select.is-success {
  --select-status-color: var(--success-color);
  --select-status-bg: var(--success-light-bg);
}

.z-select.is-warning {
  --select-status-color: var(--warning-color);
  --select-status-bg: var(--warning-light-bg);
}

.z-select.is-error {
  --select-status-color: var(--danger-color);
  --select-status-bg: var(--danger-light-bg);
}

.z-select.is-success .select-trigger,
.z-select.is-success .select-trigger:hover,
.z-select.is-warning .select-trigger,
.z-select.is-warning .select-trigger:hover,
.z-select.is-error .select-trigger,
.z-select.is-error .select-trigger:hover {
  border-color: color-mix(in srgb, var(--select-status-color), black 15%);
}

.z-select.is-success.open .select-trigger,
.z-select.is-success .select-trigger:focus-visible,
.z-select.is-warning.open .select-trigger,
.z-select.is-warning .select-trigger:focus-visible,
.z-select.is-error.open .select-trigger,
.z-select.is-error .select-trigger:focus-visible {
  box-shadow: 0 0 0 3px var(--select-status-bg);
}

.select--small .select-trigger {
  min-height: 28px;
  padding: 3px 10px;
  font-size: 12px;
}

.select--medium .select-trigger {
  min-height: 34px;
  padding: 5px 12px;
  font-size: 14px;
}

.select--large .select-trigger {
  min-height: 40px;
  padding: 8px 14px;
  font-size: 15px;
}

.select-selection {
  flex: 1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.select-value,
.select-placeholder {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.select-placeholder {
  color: var(--placeholder-color);
}

.select-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid color-mix(in srgb, var(--primary-color), transparent 65%);
  border-radius: 4px;
  background: var(--primary-light-bg);
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
}

.select-tag-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-tag-more {
  color: var(--text-secondary);
  border-color: color-mix(in srgb, var(--text-secondary), transparent 70%);
  background: color-mix(in srgb, var(--text-secondary), transparent 88%);
}

.select-tag-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 2px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: currentColor;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.75;
  transition: all 0.2s;
}

.select-tag-close:hover {
  background: color-mix(in srgb, currentColor, transparent 85%);
  opacity: 1;
}

.select-tag-input {
  flex: 1;
  min-width: 72px;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.5;
}

.select-tag-input::placeholder {
  color: var(--placeholder-color);
}

.select-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.2s;
}

.select-clear:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.select-arrow {
  flex-shrink: 0;
  color: var(--text-secondary);
  transition: transform 0.2s;
}

.select-arrow.rotate {
  transform: rotate(180deg);
}

.select-menu {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 10000;
  min-width: 150px;
  max-height: 300px;
  overflow-y: auto;
  visibility: hidden;
  background: rgba(255, 255, 255, 0.98);
  border: 2px solid var(--control-border);
  border-radius: 6px;
  backdrop-filter: blur(100px) saturate(200%) brightness(110%);
  -webkit-backdrop-filter: blur(100px) saturate(200%) brightness(110%);
}

/* 菜单 Teleport 到 body 后脱离组件作用域，但 Vue 3 的 data-v 哈希仍作用于 teleport 根，
   因此 scoped 规则同样生效；暗色按插件约定走 prefers-color-scheme，不使用 html.dark */
@media (prefers-color-scheme: dark) {
  .select-menu {
    background: rgba(48, 48, 48, 0.98);
  }
}

.select-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 16px;
  color: var(--text-color);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.select-item:hover {
  background: var(--hover-bg);
}

.select-item.active {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.select-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.select-item.disabled:hover {
  background: transparent;
}

.select-item-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.select-item-check {
  flex-shrink: 0;
  color: var(--primary-color);
}

.select-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 18px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.select-message {
  flex: 1;
  min-width: 0;
}

.z-select.is-success .select-message {
  color: var(--success-color);
}

.z-select.is-warning .select-message {
  color: var(--warning-color);
}

.z-select.is-error .select-message {
  color: var(--danger-color);
}

.select-menu {
  --select-menu-offset-x: 0px;
  --select-menu-offset-y: -4px;
}

.select-menu[data-placement^='top'] {
  --select-menu-offset-y: 4px;
}

.select-menu[data-placement^='left'] {
  --select-menu-offset-x: 4px;
  --select-menu-offset-y: 0px;
}

.select-menu[data-placement^='right'] {
  --select-menu-offset-x: -4px;
  --select-menu-offset-y: 0px;
}

.select-menu-enter-active {
  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out;
}

.select-menu-leave-active {
  transition:
    opacity 0.1s ease-in,
    transform 0.1s ease-in;
}

.select-menu-enter-from,
.select-menu-leave-to {
  opacity: 0;
  transform: translate(var(--select-menu-offset-x), var(--select-menu-offset-y));
}

.select-menu-enter-to,
.select-menu-leave-from {
  opacity: 1;
  transform: translate(0, 0);
}
</style>
