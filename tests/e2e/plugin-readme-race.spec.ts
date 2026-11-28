import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

/**
 * 在真实设置插件视图中执行脚本，视图未就绪时返回空值供轮询。
 * @param electronApp 隔离的 Electron 测试实例。
 * @param script 设置插件页面中执行的脚本。
 * @returns 脚本结果，或视图未就绪时的 null。
 */
async function executeInSettings(electronApp: ElectronApplication, script: string): Promise<any> {
  return electronApp.evaluate(async ({ webContents }, source) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().startsWith('http://127.0.0.1:15177'))
    if (!contents || contents.isLoading()) return null
    return contents.executeJavaScript(source)
  }, script)
}

test('同一详情组件切换插件时，迟到的旧 README 不会覆盖新插件', async ({
  browserName: _browserName
}) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-readme-race-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null
  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    // 只使用源码入口和临时数据，插件列表与 README 使用可控夹具，避免访问真实市场。
    electronApp = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] =>
            Boolean(entry[1])
          )
        ),
        ZTOOLS_E2E: '1',
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    const page = await electronApp.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    await electronApp.evaluate(({ ipcMain }) => {
      const plugins = [
        { name: 'readme-race-a', title: '竞态插件甲', description: '慢响应', version: '1.0.0' },
        { name: 'readme-race-b', title: '竞态插件乙', description: '快响应', version: '1.0.0' }
      ]
      for (const channel of [
        'internal:get-plugins',
        'internal:fetch-plugin-market',
        'internal:get-plugin-readme'
      ]) {
        ipcMain.removeHandler(channel)
      }
      ipcMain.handle('internal:get-plugins', () => [])
      ipcMain.handle('internal:fetch-plugin-market', () => ({
        success: true,
        data: plugins,
        storefront: { sections: [{ type: 'fixed', title: '竞态验证', plugins }] }
      }))
      // 插件甲的 README 刻意晚到，模拟用户切换到插件乙之后才返回的旧请求。
      ipcMain.handle('internal:get-plugin-readme', async (_event, name: string) => {
        if (name === 'readme-race-a') {
          await new Promise((resolve) => setTimeout(resolve, 1500))
          return { success: true, content: '# 插件甲的详情' }
        }
        return { success: true, content: '# 插件乙的详情' }
      })
    })

    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() => executeInSettings(electronApp!, 'document.body.innerText'))
      .toContain('开机自动启动')
    await executeInSettings(
      electronApp,
      `Array.from(document.querySelectorAll('.menu-item'))
      .find((item) => item.textContent.includes('插件市场')).click()`
    )
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `Array.from(document.querySelectorAll('.plugin-card')).map((item) => item.textContent).join('|')`
        )
      )
      .toContain('竞态插件乙')

    // 打开插件甲后立即在同一个详情组件内切换到插件乙，复现通知跳转等就地切换场景。
    await executeInSettings(
      electronApp,
      `Array.from(document.querySelectorAll('.plugin-card'))
      .find((item) => item.textContent.includes('竞态插件甲')).click()`
    )
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `document.querySelector('.plugin-market .detail-title')?.textContent || ''`
        )
      )
      .toContain('竞态插件甲')
    const switched = await executeInSettings(
      electronApp,
      `(() => {
      const state = document.querySelector('.plugin-market').__vueParentComponent?.setupState
      const next = state?.pluginMap?.get('readme-race-b')
      if (!state || !next) return false
      state.selectedPlugin = next
      return true
    })()`
    )
    expect(switched).toBe(true)

    // 等待新插件 README 正文出现，再等过旧请求的返回时间。
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `document.querySelector('.markdown-content')?.textContent || ''`
        )
      )
      .toContain('插件乙的详情')
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const text = await executeInSettings(
      electronApp,
      `document.querySelector('.markdown-content')?.textContent || ''`
    )
    expect(text).toContain('插件乙的详情')
    expect(text).not.toContain('插件甲的详情')
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
