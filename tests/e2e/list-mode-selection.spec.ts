import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

/**
 * 使用隔离数据目录启动当前构建的 ZTools 测试实例。
 * @param dataRoot 测试实例专用数据目录。
 * @param legacyRoot 测试实例专用旧数据目录。
 * @returns 已启动的 Electron 应用实例。
 */
async function launchTestApp(dataRoot: string, legacyRoot: string): Promise<ElectronApplication> {
  return await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      ZTOOLS_DATA_ROOT: dataRoot,
      ZTOOLS_E2E: '1',
      ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
      ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
    }
  })
}

test('列表模式下悬停项的键盘选中态清晰可辨', async ({ browserName: _browserName }, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-playwright-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  const screenshotPath = testInfo.outputPath('list-mode-hover-selected.png')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const page = await electronApp.firstWindow()
    const searchInput = page.locator('.search-input')

    // 先等待主渲染进程完成挂载，避免模式切换事件早于监听器注册。
    await expect(searchInput).toBeVisible()
    await page.emulateMedia({ colorScheme: 'dark' })
    await searchInput.fill('设置')

    // 重复发送模式切换事件，确保启动阶段的 IPC 时序不会让用例偶发失败。
    await expect
      .poll(
        async () => {
          await electronApp!.evaluate(({ BrowserWindow }) => {
            for (const window of BrowserWindow.getAllWindows()) {
              if (window.webContents.getURL().includes('out/renderer/index.html')) {
                window.webContents.send('update-search-mode', 'list')
              }
            }
          })
          return await page.locator('.list-item').count()
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThan(1)

    const rows = page.locator('.list-item')
    const selectedRow = rows.nth(1)
    const hoverOnlyRow = rows.nth(2)

    // 将鼠标停在第二行，再用键盘把选中态移动到同一行。
    await selectedRow.hover()
    await page.keyboard.press('ArrowDown')
    await expect(selectedRow).toHaveClass(/selected/)

    await hoverOnlyRow.hover()
    const hoverOnlyStyles = await hoverOnlyRow.evaluate((element) => {
      const style = getComputedStyle(element)
      return { backgroundColor: style.backgroundColor }
    })

    await selectedRow.hover()
    await page.waitForTimeout(200)
    const selectedStyles = await selectedRow.evaluate((element) => {
      const style = getComputedStyle(element)
      return { backgroundColor: style.backgroundColor }
    })

    // 将两种背景合成到列表暗色底上，量化选中态与 hover 态的可辨识度。
    const backgroundDistance = await selectedRow.evaluate((element, hoverBackground) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建颜色采样画布')

      const sample = (color: string): [number, number, number, number] => {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
        return [red, green, blue, alpha / 255]
      }

      const composite = (
        foreground: [number, number, number, number],
        background: [number, number, number]
      ): [number, number, number] => {
        const alpha = foreground[3]
        return [
          foreground[0] * alpha + background[0] * (1 - alpha),
          foreground[1] * alpha + background[1] * (1 - alpha),
          foreground[2] * alpha + background[2] * (1 - alpha)
        ]
      }

      const base: [number, number, number] = [48, 49, 51]
      const selected = composite(sample(getComputedStyle(element).backgroundColor), base)
      const hover = composite(sample(hoverBackground), base)
      return Math.hypot(selected[0] - hover[0], selected[1] - hover[1], selected[2] - hover[2])
    }, hoverOnlyStyles.backgroundColor)

    // 截图只覆盖当前可见窗口，作为问题修复前后的视觉证据。
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach('list-mode-hover-selected', {
      path: screenshotPath,
      contentType: 'image/png'
    })

    expect(selectedStyles.backgroundColor).not.toBe(hoverOnlyStyles.backgroundColor)
    expect(backgroundDistance).toBeGreaterThan(25)
  } finally {
    // 无论断言是否失败都关闭隔离实例并清理测试数据。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
