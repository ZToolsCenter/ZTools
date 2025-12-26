/**
 * 确认对话框配置选项
 */
export interface ConfirmDialogOptions {
  type: 'none' | 'info' | 'error' | 'question' | 'warning'
  buttons: string[]
  defaultId?: number
  cancelId?: number
  title: string
  message: string
  detail?: string
}
