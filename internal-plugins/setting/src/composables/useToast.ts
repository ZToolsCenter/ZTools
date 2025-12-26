import { ref, type Ref } from 'vue'

interface ToastOptions {
  message: string
  type?: 'success' | 'error' | 'warning' | 'info'
  duration?: number
}

interface ToastState {
  visible: boolean
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  duration: number
}

interface ConfirmOptions {
  title?: string
  message: string
  type?: 'info' | 'warning' | 'danger'
  confirmText?: string
  cancelText?: string
}

interface ConfirmState {
  visible: boolean
  title: string
  message: string
  type: 'info' | 'warning' | 'danger'
  confirmText: string
  cancelText: string
  resolve: ((value: boolean) => void) | null
}

const toastState = ref<ToastState>({
  visible: false,
  message: '',
  type: 'info',
  duration: 3000
})

const confirmState = ref<ConfirmState>({
  visible: false,
  title: '确认操作',
  message: '',
  type: 'info',
  confirmText: '确定',
  cancelText: '取消',
  resolve: null
})

export function useToast(): {
  toastState: Ref<ToastState>
  confirmState: Ref<ConfirmState>
  show: (options: ToastOptions) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
  hide: () => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
  handleConfirm: () => void
  handleCancel: () => void
} {
  const show = (options: ToastOptions): void => {
    toastState.value = {
      visible: true,
      message: options.message,
      type: options.type || 'info',
      duration: options.duration || 3000
    }
  }

  const success = (message: string, duration = 3000): void => {
    show({ message, type: 'success', duration })
  }

  const error = (message: string, duration = 3000): void => {
    show({ message, type: 'error', duration })
  }

  const warning = (message: string, duration = 3000): void => {
    show({ message, type: 'warning', duration })
  }

  const info = (message: string, duration = 3000): void => {
    show({ message, type: 'info', duration })
  }

  const hide = (): void => {
    toastState.value.visible = false
  }

  // 确认对话框
  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      confirmState.value = {
        visible: true,
        title: options.title || '确认操作',
        message: options.message,
        type: options.type || 'info',
        confirmText: options.confirmText || '确定',
        cancelText: options.cancelText || '取消',
        resolve
      }
    })
  }

  const handleConfirm = (): void => {
    if (confirmState.value.resolve) {
      confirmState.value.resolve(true)
    }
    confirmState.value.visible = false
  }

  const handleCancel = (): void => {
    if (confirmState.value.resolve) {
      confirmState.value.resolve(false)
    }
    confirmState.value.visible = false
  }

  return {
    toastState,
    confirmState,
    show,
    success,
    error,
    warning,
    info,
    hide,
    confirm,
    handleConfirm,
    handleCancel
  }
}
