import { exec } from 'child_process'
import { dialog } from 'electron'
import type { ConfirmDialogOptions } from './types'

export async function launchApp(
  appPath: string,
  confirmDialog?: ConfirmDialogOptions
): Promise<void> {
  // 如果需要确认，先显示确认对话框
  if (confirmDialog) {
    const result = await dialog.showMessageBox({
      type: confirmDialog.type,
      buttons: confirmDialog.buttons,
      defaultId: confirmDialog.defaultId ?? 0,
      cancelId: confirmDialog.cancelId ?? 0,
      title: confirmDialog.title,
      message: confirmDialog.message,
      detail: confirmDialog.detail,
      noLink: true
    })

    // 如果用户点击取消按钮，则不执行
    if (result.response === confirmDialog.cancelId) {
      console.log('用户取消了操作')
      return
    }
  }

  // TODO: 考虑改用 shell.openPath() 以保持与 Windows 实现一致，需要 Mac 环境测试
  return new Promise((resolve, reject) => {
    exec(`open "${appPath}"`, (error) => {
      if (error) {
        console.error('启动应用失败:', error)
        reject(error)
      } else {
        console.log(`成功启动应用: ${appPath}`)
        resolve()
      }
    })
  })
}
