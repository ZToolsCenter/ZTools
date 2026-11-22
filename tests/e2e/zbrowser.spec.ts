import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')
const settingsUrl = 'http://127.0.0.1:15177'

for (const packaged of [false, true]) {
  test(`zbrowser 在${packaged ? '安装包资源布局' : '开发模式'}中可启动 runner 并执行网页操作`, async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-zbrowser-e2e-'))
    const legacyRoot = path.join(dataRoot, 'legacy')
    const resourcesRoot = path.join(dataRoot, '安装目录 with spaces', 'resources')
    let electronApp: ElectronApplication | null = null
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>ZBrowser E2E</title><body>runner 页面加载成功</body>')
    })

    try {
      // 本地网页消除外网波动；所有应用数据与安装包样本都限定在临时目录。
      await fs.mkdir(legacyRoot, { recursive: true })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('测试网页服务器未启动')
      const targetUrl = `http://127.0.0.1:${address.port}/`

      if (packaged) {
        // 仅在 asarUnpack 实际保留的目录中提供 runner，旧路径不能意外命中。
        const runnerPath = path.join(
          resourcesRoot,
          'app.asar.unpacked',
          'resources',
          'zbrowser',
          'runner.js'
        )
        await fs.mkdir(path.dirname(runnerPath), { recursive: true })
        await fs.copyFile(path.join(projectRoot, 'resources', 'zbrowser', 'runner.js'), runnerPath)
        await expect(fs.access(path.join(resourcesRoot, 'zbrowser', 'runner.js'))).rejects.toThrow()
      }

      // 启动源码 Electron，而非打包应用，避免触碰真实用户数据。
      electronApp = await electron.launch({
        args: [projectRoot],
        cwd: projectRoot,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] =>
              Boolean(entry[1])
            )
          ),
          ZTOOLS_DATA_ROOT: dataRoot,
          ZTOOLS_E2E: '1',
          ZTOOLS_LEGACY_USER_DATA_PATH: legacyRoot,
          ZTOOLS_SETTING_DEV_SERVER_URL: settingsUrl
        }
      })
      const page = await electronApp.firstWindow()
      const searchInput = page.locator('.search-input')
      await expect(searchInput).toBeVisible()
      await searchInput.fill('通用设置')
      const settingsResult = page
        .locator('.app-item, .list-item')
        .filter({ hasText: '通用设置' })
        .first()
      await expect(settingsResult).toBeVisible()
      await settingsResult.click()
      await expect
        .poll(() =>
          electronApp!.evaluate(async ({ webContents }, url) => {
            const plugin = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(url))
            if (!plugin || plugin.isLoading()) return ''
            return plugin.executeJavaScript('document.body.innerText')
          }, settingsUrl)
        )
        .toContain('开机自动启动')

      // 通过真实插件 API、IPC 和子进程执行器覆盖两种资源路径分支。
      const result = await electronApp.evaluate(
        async ({ app, BrowserWindow, webContents }, options) => {
          const plugin = webContents
            .getAllWebContents()
            .find((wc) => wc.getURL().startsWith(options.settingsUrl))
          if (!plugin) throw new Error('未找到设置插件 WebContentsView')
          const packagedDescriptor = Object.getOwnPropertyDescriptor(app, 'isPackaged')
          const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

          try {
            // 页面就绪后才模拟安装状态，避免改变源码应用的启动和插件加载流程。
            if (options.packaged) {
              Object.defineProperty(app, 'isPackaged', { configurable: true, value: true })
              Object.defineProperty(process, 'resourcesPath', {
                configurable: true,
                value: options.resourcesRoot
              })
            }
            const data = await plugin.executeJavaScript(`
              window.ztools.zbrowser
                .goto(${JSON.stringify(options.targetUrl)})
                .evaluate(() => ({ title: document.title, text: document.body.innerText }))
                .run({ show: true, width: 900, height: 600 })
            `)
            const win = BrowserWindow.getAllWindows().find(
              (window) => window.webContents.getURL() === options.targetUrl
            )
            return { data, visible: win?.isVisible(), bounds: win?.getBounds() }
          } finally {
            // 即使 runner 失败，也恢复环境属性，保证应用关闭仍使用原始源码状态。
            if (options.packaged) {
              if (packagedDescriptor) Object.defineProperty(app, 'isPackaged', packagedDescriptor)
              else Reflect.deleteProperty(app, 'isPackaged')
              if (resourcesDescriptor)
                Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
              else Reflect.deleteProperty(process, 'resourcesPath')
            }
          }
        },
        { packaged, resourcesRoot, targetUrl, settingsUrl }
      )
      expect(result.data).toEqual([
        { title: 'ZBrowser E2E', text: 'runner 页面加载成功' },
        expect.objectContaining({ url: targetUrl, title: 'ZBrowser E2E', width: 900, height: 600 })
      ])
      expect(result.visible).toBe(true)
      expect(result.bounds).toMatchObject({ width: 900, height: 600 })
    } finally {
      // 只关闭本用例实例与服务器，并回收本用例创建的数据和资源样本。
      await electronApp?.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      await fs.rm(dataRoot, { recursive: true, force: true })
    }
  })
}
