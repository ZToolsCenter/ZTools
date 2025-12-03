import { exec } from 'child_process'

export function launchApp(appPath: string): Promise<void> {
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
