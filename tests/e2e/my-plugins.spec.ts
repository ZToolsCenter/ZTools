import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import AdmZip from 'adm-zip'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * 在真实设置 WebContentsView 中读取界面或触发用户操作。
 * @param app 隔离的源码 Electron 实例。
 * @param script 设置页中运行的脚本。
 * @returns 脚本结果，视图尚未就绪时返回 null。
 */
function settings(app: ElectronApplication, script: string): Promise<any> {
  return app.evaluate(({ webContents }, source) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => wc.getURL().startsWith('http://127.0.0.1:15177'))
    return view && !view.isLoading() ? view.executeJavaScript(source) : null
  }, script)
}

test('个人中心保留市场安装历史，过滤平台并批量重装', async ({
  browserName: _browserName
}, testInfo) => {
  const root = path.resolve(__dirname, '../..')
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-history-'))
  const items = ['甲', '乙', '丙', '异平台'].map((title, i) => ({
    name: 'history-' + i,
    title: '历史插件' + title,
    logo:
      'http://127.0.0.1:15177/src/assets/market/' +
      ['text', 'media', 'system', 'network'][i] +
      '.png',
    version: '1.0.0',
    platform: [i === 3 ? (process.platform === 'win32' ? 'darwin' : 'win32') : process.platform]
  }))
  const packages = new Map<string, Buffer>()
  for (const item of items) {
    const zip = new AdmZip()
    zip.addFile(
      'plugin.json',
      Buffer.from(
        JSON.stringify({
          ...item,
          main: 'index.html',
          features: [{ code: 'open', cmds: [item.title] }]
        })
      )
    )
    zip.addFile('index.html', Buffer.from(item.name))
    packages.set('/' + item.name, zip.toBuffer())
  }
  // 仅替换商店目录和账号资料响应，下载、安装、卸载和账号库均走真实代码。
  let pauseDownload = false
  const server = createServer((req, res) => {
    const body = packages.get(req.url || '')
    // 暂停在可测量的中间进度，直到测试通过界面取消下载。
    if (pauseDownload && req.url === '/history-2' && body) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': body.length
      })
      res.write(body.subarray(0, Math.floor(body.length / 2)))
      return
    }
    res.end(body)
  })
  let app: ElectronApplication | undefined
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
    const catalog = items.map((item) => ({ ...item, downloadUrl: base + '/' + item.name }))
    const legacy = path.join(dataRoot, 'legacy')
    await fs.mkdir(legacy)
    app = await electron.launch({
      cwd: root,
      args: [root],
      env: {
        ...(process.env as Record<string, string>),
        ZTOOLS_E2E: '1',
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: legacy,
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain }, data) => {
      for (const [channel, result] of Object.entries({
        'internal:fetch-plugin-market': { success: true, data },
        'sync:get-account-profile': { success: true, profile: { uid: 'history-user' } },
        'sync:get-account-stats': { success: true, stats: {} }
      })) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, () => result)
      }
    }, catalog)
    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect.poll(() => settings(app!, 'document.body.innerText')).toContain('开机自动启动')
    const api = 'window.ztools.internal'
    expect(
      await settings(app, api + '.accountSaveSession({username:"history-user",token:"fixture"})')
    ).toMatchObject({ success: true })
    await settings(app, 'window.dispatchEvent(new Event("ztools-account-changed"))')
    await expect.poll(() => settings(app!, 'document.body.innerText')).toContain('查看个人中心')
    for (const item of catalog.slice(0, 3)) {
      const result = await settings(
        app,
        api + '.installPluginFromMarket(' + JSON.stringify(item) + ')'
      )
      expect(result).toMatchObject({ success: true })
      if (item !== catalog[0]) {
        expect(
          await settings(app, api + '.deletePlugin(' + JSON.stringify(result.plugin.path) + ')')
        ).toMatchObject({ success: true })
      }
    }
    // 模拟另一平台同步而来的记录，包括不适用于本机的市场插件。
    await settings(
      app,
      api +
        '.dbPut("market-install-history/history-3",' +
        JSON.stringify({
          ...items[3],
          installedOn: items[3].platform[0],
          installedAt: new Date().toISOString()
        }) +
        ')'
    )
    await settings(app, 'document.querySelector(".account-dock").click()')
    await expect.poll(() => settings(app!, 'document.body.innerText')).toContain('我的插件')
    await settings(app, 'document.querySelector(".plugins-entry").click()')
    await expect
      .poll(() => settings(app!, 'document.querySelectorAll(".history li time").length'))
      .toBe(3)
    expect(await settings(app, 'document.querySelector(".history").innerText')).not.toContain(
      '异平台'
    )
    const actions =
      'Array.from(document.querySelectorAll(".history .download-btn, .history .open-btn"), b => b.title).sort()'
    expect(await settings(app, actions)).toEqual(['下载', '下载', '打开'])
    // 勾选框独立操作；点击同一行的插件图标才进入对应的市场详情。
    await settings(app, 'document.querySelector(".history li input").click()')
    expect(await settings(app, 'document.querySelector(".toolbar button").innerText')).toContain(
      '1'
    )
    await settings(app, 'document.querySelector(".history li .logo").click()')
    await expect
      .poll(() =>
        settings(app!, 'document.querySelector(".plugin-market .detail-title")?.textContent')
      )
      .toContain('历史插件丙')
    await settings(app, 'document.querySelector(".account-dock").click()')
    await expect.poll(() => settings(app!, '!!document.querySelector(".plugins-entry")')).toBe(true)
    await settings(app, 'document.querySelector(".plugins-entry").click()')
    await expect.poll(() => settings(app!, actions)).toEqual(['下载', '下载', '打开'])
    const originalTimes = await settings(
      app,
      'Array.from(document.querySelectorAll(".history time"), t => t.dateTime)'
    )
    await expect
      .poll(() =>
        settings(
          app!,
          'Array.from(document.querySelectorAll(".history img")).filter(img => img.naturalWidth > 0).length'
        )
      )
      .toBe(3)
    await settings(app, 'document.querySelector(".toolbar input").click()')
    await expect
      .poll(() => settings(app!, 'document.querySelector(".toolbar button").innerText'))
      .toContain('2')
    const screenshot = await app.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL().startsWith('http://127.0.0.1:15177'))!
      return (await view.capturePage()).toPNG().toString('base64')
    })
    await fs.writeFile(testInfo.outputPath('my-plugins.png'), Buffer.from(screenshot, 'base64'))
    // 单项下载必须显示宿主上报的具体进度；取消后恢复图标且保留首次安装时间。
    pauseDownload = true
    await settings(app, 'document.querySelector(".history .download-btn").click()')
    const ring = 'document.querySelector(".history button[title=取消下载] .progress-value")'
    await expect
      .poll(() =>
        settings(app!, 'Math.round(Number(' + ring + '?.getAttribute("stroke-dashoffset")))')
      )
      .toBe(31)
    await settings(app, 'document.querySelector(".history button[title=取消下载]").click()')
    await expect.poll(() => settings(app!, actions)).toEqual(['下载', '下载', '打开'])
    pauseDownload = false
    // 损坏一个夹具包，验证部分失败时仍处理后续插件，并能独立重试。
    const goodPackage = packages.get('/history-2')!
    packages.set('/history-2', Buffer.from('invalid package'))
    await settings(app, 'document.querySelector(".toolbar button").click()')
    await expect.poll(() => settings(app!, actions)).toEqual(['下载', '打开', '打开'])
    await expect
      .poll(() => settings(app!, 'document.querySelector(".history li [role=alert]")?.innerText'))
      .toContain('无效')
    packages.set('/history-2', goodPackage)
    await settings(app, 'document.querySelector(".history button[title=下载]").click()')
    await expect.poll(() => settings(app!, actions)).toEqual(['打开', '打开', '打开'])
    expect(await settings(app, api + '.getMarketInstallHistory()')).toHaveLength(4)
    expect(
      await settings(app, 'Array.from(document.querySelectorAll(".history time"), t => t.dateTime)')
    ).toEqual(originalTimes)
    const history = await settings(app, api + '.getMarketInstallHistory()')
    expect(
      await settings(app, api + '.installPluginFromMarket(' + JSON.stringify(catalog[0]) + ')')
    ).toMatchObject({ success: true })
    expect(await settings(app, api + '.getMarketInstallHistory()')).toEqual(history)

    // 模拟收到另一台设备更早的记录，停留在列表页即可看到合并后的时间。
    const oldTime = '2024-03-01T12:00:00.000Z'
    const synced = {
      ...history.find((entry: { name: string }) => entry.name === 'history-0'),
      installedAt: oldTime
    }
    await settings(
      app,
      api +
        '.dbPut("market-install-history/history-0/' +
        oldTime +
        '",' +
        JSON.stringify(synced) +
        ')'
    )
    await app.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((wc) => wc.getURL().startsWith('http://127.0.0.1:15177'))!
      contents.send('sync:status-changed', { marketInstallHistoryChanged: true })
    })
    await expect
      .poll(() =>
        settings(app!, 'Array.from(document.querySelectorAll(".history time"), t => t.dateTime)')
      )
      .toContain(oldTime)

    // 通过真实账号空间切换，验证其他账号看不到原账号的历史。
    await settings(
      app,
      api + '.accountSaveSession({username:"other-history-user",token:"fixture"})'
    )
    expect(await settings(app, api + '.getMarketInstallHistory()')).toEqual([])
    await settings(app, api + '.accountSaveSession({username:"history-user",token:"fixture"})')
    expect(await settings(app, api + '.getMarketInstallHistory()')).toHaveLength(4)

    // 点击已安装项并检查真正启动的插件正文。
    await settings(app, 'document.querySelector(".history .open-btn").click()')
    await expect
      .poll(() =>
        app!.evaluate(async ({ webContents }) => {
          const plugin = webContents
            .getAllWebContents()
            .find((wc) => /history-[012]\/index\.html/.test(wc.getURL()))
          return plugin && !plugin.isLoading()
            ? plugin.executeJavaScript('document.body.innerText')
            : null
        })
      )
      .toMatch(/^history-[012]$/)
  } finally {
    await app?.close()
    server.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
