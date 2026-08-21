import type { PopoverPlacement, PopoverTeleportTarget } from '../shared/useOverlayPosition'

export type SelectValueType = string | number
export type SelectSingleModelValue = SelectValueType | null
export type SelectModelValue = SelectSingleModelValue | SelectValueType[]
export type SelectSize = 'small' | 'medium' | 'large'
export type SelectStatus = 'success' | 'warning' | 'error'
export type SelectMode = 'default' | 'tags'

export interface SelectOption {
  label: string
  value: SelectValueType
  disabled?: boolean
}

export interface SelectSelectedItem {
  label: string
  value: SelectValueType
}

export interface SelectTriggerProps {
  role: 'combobox'
  tabindex: number
  'aria-haspopup': 'listbox'
  'aria-expanded': 'true' | 'false'
  'aria-disabled'?: 'true'
  'aria-readonly'?: 'true'
  'aria-invalid'?: 'true'
  onClick: () => void
}

export interface SelectTriggerSlotProps {
  visible: boolean
  selectedLabel: string
  selectedValues: SelectValueType[]
  selectedItems: SelectSelectedItem[]
  hasValue: boolean
  disabled: boolean
  readonly: boolean
  multiple: boolean
  triggerProps: SelectTriggerProps
  setTriggerRef: (element: HTMLElement | null) => void
  openMenu: () => void
  closeMenu: () => void
  toggleMenu: () => void
}

export interface SelectProps {
  modelValue?: SelectModelValue
  defaultModelValue?: SelectModelValue
  options: readonly SelectOption[]
  placeholder?: string
  multiple?: boolean
  clearable?: boolean
  disabled?: boolean
  readonly?: boolean
  size?: SelectSize
  status?: SelectStatus
  message?: string
  maxTagCount?: number
  mode?: SelectMode
  show?: boolean
  defaultShow?: boolean
  placement?: PopoverPlacement
  autoAdjustPlacement?: boolean
  to?: PopoverTeleportTarget
}

export interface SelectEmits {
  (e: 'update:modelValue', value: SelectModelValue): void
  (e: 'change', value: SelectModelValue): void
  (e: 'update:show', value: boolean): void
  (e: 'clear'): void
  (e: 'scroll', event: Event): void
  (e: 'visible-change', visible: boolean): void
  (e: 'tag-create', value: string): void
  (e: 'tag-remove', value: SelectValueType): void
}
