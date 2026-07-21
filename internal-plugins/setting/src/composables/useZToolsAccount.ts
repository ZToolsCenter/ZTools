export const ONLINE_SYNC_SERVER_URL = 'wss://z-tools.top'
export const ACCOUNT_CHANGED_EVENT = 'ztools-account-changed'

export interface ZToolsLoginPayload {
  username: string
  password: string
  captchaVerifyParam?: string
}

export interface ZToolsLoginResult {
  isNew: boolean
}

export interface DefaultDataImportPromptHandlers {
  confirm: (options: {
    title?: string
    message: string
    type?: 'info' | 'warning' | 'danger'
    confirmText?: string
    cancelText?: string
  }) => Promise<boolean>
  success?: (message: string) => void
  error?: (message: string) => void
}

export function notifyAccountChanged(): void {
  window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT))
}

export async function loginZToolsAccount(payload: ZToolsLoginPayload): Promise<ZToolsLoginResult> {
  const loginResult = await window.ztools.internal.syncLogin({
    serverUrl: ONLINE_SYNC_SERVER_URL,
    username: payload.username,
    password: payload.password,
    captchaVerifyParam: payload.captchaVerifyParam
  })
  if (!loginResult.success || !loginResult.token) {
    throw new Error(loginResult.error || '登录失败')
  }

  const configResult = await window.ztools.internal.syncGetConfig()
  const currentConfig = configResult.success ? configResult.config : null
  await window.ztools.internal.syncSaveConfig({
    enabled: Boolean(currentConfig?.enabled),
    serverUrl: ONLINE_SYNC_SERVER_URL,
    token: loginResult.token,
    refreshToken: loginResult.refreshToken || '',
    syncInterval: currentConfig?.syncInterval || 30,
    username: payload.username
  })

  notifyAccountChanged()
  return {
    isNew: Boolean(loginResult.isNew)
  }
}

export async function promptDefaultDataImportAfterLogin(
  handlers: DefaultDataImportPromptHandlers
): Promise<void> {
  const statusResult = await window.ztools.internal.syncGetDefaultImportStatus()
  if (!statusResult.success || !statusResult.status?.pending) return

  const confirmed = await handlers.confirm({
    title: '导入本机数据',
    message: `检测到未登录状态下已有 ${statusResult.status.defaultDocCount} 条本机数据。是否导入到当前登录账号？\n\n导入后，这些数据会参与当前账号的云同步。`,
    type: 'info',
    confirmText: '导入到当前账号',
    cancelText: '不导入'
  })

  if (!confirmed) {
    const skipped = await window.ztools.internal.syncSkipDefaultImport()
    if (!skipped.success) {
      handlers.error?.(skipped.error || '保存导入选择失败')
    }
    return
  }

  const imported = await window.ztools.internal.syncImportDefaultData()
  if (!imported.success) {
    handlers.error?.(imported.error || '导入本机数据失败')
    return
  }

  handlers.success?.(`已导入 ${imported.result?.importedDocs || 0} 条本机数据`)
  notifyAccountChanged()
}
