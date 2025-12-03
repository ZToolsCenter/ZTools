import { clipboard, Notification } from 'electron'
import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

// 截图方法windows
export const screenWindow = (cb: (image: string) => void): void => {
  // const url = path.resolve(__static, 'ScreenCapture.exe');
  // const screen_window = execFile(url);
  // screen_window.on('exit', (code) => {
  //   if (code) {
  //     const image = clipboard.readImage();
  //     cb && cb(image.isEmpty() ? '' : image.toDataURL());
  //   }
  // });
  new Notification({
    title: '暂不支持',
    body: 'Windows 系统截图暂不支持，我们将会尽快更新！'
  }).show()
  cb('')
}

// 截图方法mac
export const handleScreenShots = (cb: (image: string) => void): void => {
  const tmpPath = path.join(os.tmpdir(), `screenshot_${Date.now()}.png`)
  exec(`screencapture -i -r "${tmpPath}"`, () => {
    if (fs.existsSync(tmpPath)) {
      try {
        const imageBuffer = fs.readFileSync(tmpPath)
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`
        cb(base64Image)
        fs.unlinkSync(tmpPath)
      } catch {
        cb('')
      }
    } else {
      cb('')
    }
  })
}

export const screenCapture = (): Promise<string> => {
  return new Promise((resolve) => {
    // 接收到截图后的执行程序
    clipboard.writeText('')
    if (process.platform === 'darwin') {
      handleScreenShots((image) => {
        resolve(image)
      })
    } else if (process.platform === 'win32') {
      screenWindow((image) => {
        resolve(image)
      })
    } else {
      new Notification({
        title: '兼容性支持度不够',
        body: 'Linux 系统截图暂不支持，我们将会尽快更新！'
      }).show()
      resolve('')
    }
  })
}
