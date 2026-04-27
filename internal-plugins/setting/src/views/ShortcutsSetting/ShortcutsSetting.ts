import { router } from '@/router'
import type { HistoryState } from 'vue-router'

export type ShortcutsSettingTab = 'global' | 'app' | 'alias'

/**
 * 从“所有指令”页跳转到 alias 设置页时携带的草稿目标
 * 这里只保留构造 alias 所需的最小字段，避免把完整 command 塞进路由状态
 */
export interface ShortcutsSettingAliasDraftTarget extends HistoryState {
  commandId: string
  type: 'plugin' | 'direct'
  subType?: 'app' | 'system-setting' | 'local-shortcut'
  path?: string
  groupKey: string
  groupTitle: string
  featureCode: string
  subtitle: string
  pluginName: string
  pluginTitle: string
  cmdName: string
  cmdType: 'text' | 'window'
  icon?: string
}

/**
 * alias 目标选择器中使用的指令选项
 */
export interface ShortcutsSettingAliasCommandOption extends ShortcutsSettingAliasDraftTarget {
  label: string
}

/**
 * alias 对话框状态
 * create/edit 共用同一结构，编辑态通过 originalCommandId / originalAlias 回溯旧映射
 */
export interface ShortcutsSettingAliasDialogState {
  mode: 'create' | 'edit'
  originalCommandId?: string
  originalAlias?: string
  alias: string
  icon?: string
  target: ShortcutsSettingAliasCommandOption | null
}

export interface ShortcutsSettingJumpFunction extends HistoryState {
  /**
   * 设置快捷键设置路径，传这个参数会直接打开快捷键设置页面
   */
  payload?: string
  /**
   * 类型
   */
  type?: string
  /**
   * 默认打开的 tab
   */
  tab?: ShortcutsSettingTab
  /**
   * 指令别名草稿目标
   * 由 AllCommandsSetting 透传，用于进入 alias tab 后直接预选目标指令
   */
  draftTarget?: ShortcutsSettingAliasDraftTarget
}

/**
 * 快捷键跳转功能
 * @param config
 */
export function jumpFunctionShortcutsSetting(config: ShortcutsSettingJumpFunction): void {
  void router.replace({
    name: 'Shortcuts',
    query: { _t: Date.now() },
    state: { ...config }
  })
}
