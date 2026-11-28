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

test('插件 README 渲染前会消毒，恶意脚本不会在设置插件中执行', async ({
  browserName: _browserName
}) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-readme-sanitize-'))
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
      // README 同时覆盖事件属性、脚本标签、javascript 链接与正常 Markdown 内容。
      const readme = [
        '# README 消毒验证',
        '',
        '正常段落与 **加粗** 文本。',
        '',
        '<img src="x" onerror="window.__readmeXss = (window.__readmeXss || 0) + 1">',
        '',
        '<script>window.__readmeXss = (window.__readmeXss || 0) + 1</script>',
        '',
        '<a href="javascript:window.__readmeXss = 1" id="evil-link">恶意链接</a>',
        '',
        '[正常链接](https://example.com/safe)'
      ].join('\n')
      const plugin = {
        name: 'readme-sanitize-fixture',
        title: 'README 消毒夹具',
        description: '验证 README 消毒',
        version: '1.0.0'
      }
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
        data: [plugin],
        storefront: { sections: [{ type: 'fixed', title: '消毒验证', plugins: [plugin] }] }
      }))
      ipcMain.handle('internal:get-plugin-readme', () => ({ success: true, content: readme }))
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
        executeInSettings(electronApp!, `document.querySelector('.plugin-card')?.textContent || ''`)
      )
      .toContain('README 消毒夹具')
    await executeInSettings(electronApp, `document.querySelector('.plugin-card').click()`)

    // 等待 README 正文中的稳定特征出现后再检查，避免只命中标题或侧栏。
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `document.querySelector('.markdown-content')?.textContent || ''`
        )
      )
      .toContain('README 消毒验证')
    // 给 img 的 onerror 留出触发时间，未消毒时它会在加载失败后异步执行。
    await new Promise((resolve) => setTimeout(resolve, 800))

    const result = await executeInSettings(
      electronApp,
      `(() => {
      const root = document.querySelector('.markdown-content')
      return {
        xssFlag: window.__readmeXss ?? null,
        scripts: root.querySelectorAll('script').length,
        inlineHandlers: root.querySelectorAll('[onerror], [onclick], [onload]').length,
        jsLinks: Array.from(root.querySelectorAll('a')).filter((item) =>
          /^\\s*javascript:/i.test(item.getAttribute('href') || '')
        ).length,
        safeLink: root.querySelector('a[href="https://example.com/safe"]')?.textContent || '',
        bold: root.querySelector('strong')?.textContent || ''
      }
    })()`
    )
    expect(result).toEqual({
      xssFlag: null,
      scripts: 0,
      inlineHandlers: 0,
      jsLinks: 0,
      safeLink: '正常链接',
      bold: '加粗'
    })
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
