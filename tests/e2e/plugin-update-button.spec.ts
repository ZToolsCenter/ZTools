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

/**
 * 等待插件正文完成绘制后仅截取当前可见的插件视图。
 * @param electronApp 隔离的 Electron 测试实例。
 * @param outputPath 当前测试的截图输出路径。
 * @returns 截图写入完成后结束的 Promise。
 */
async function captureSettingsScreenshot(
  electronApp: ElectronApplication,
  outputPath: string
): Promise<void> {
  // DOM 断言通过后仍需等待合成帧，避免 capturePage 返回上一帧按钮或进度。
  await executeInSettings(
    electronApp,
    `(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await new Promise((resolve) => setTimeout(resolve, 350))
  })()`
  )
  const screenshot = await electronApp.evaluate(async ({ webContents }) => {
    const contents = webContents
      .getAllWebContents()
      .find((item) => item.getURL().startsWith('http://127.0.0.1:15177'))!
    return (await contents.capturePage()).toPNG().toString('base64')
  })
  await fs.writeFile(outputPath, Buffer.from(screenshot, 'base64'))
}

test('更新标签可直接升级插件，防止重复提交并允许失败重试', async ({
  browserName: _browserName
}, testInfo) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-update-button-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null
  await fs.mkdir(legacyRoot, { recursive: true })

  try {
    // 只使用源码入口和临时数据，市场与安装 IPC 使用可控夹具避免真实下载。
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
    await electronApp.evaluate(({ ipcMain }, root) => {
      const installed = ['升级测试甲', '升级测试乙'].map((title, index) => ({
        name: `update-button-${index}`,
        title,
        description: '验证更新标签直接升级',
        version: '1.0.0',
        path: `${root}/fixture-${index}`
      }))
      const market = installed.map((plugin) => ({
        name: plugin.name,
        title: plugin.title,
        version: '2.0.0'
      }))
      const state = {
        installed,
        market,
        calls: [] as any[],
        cancellations: [] as string[],
        resolve: null as any
      }
      ;(globalThis as any).__updateButtonFixture = state
      for (const channel of [
        'internal:get-plugins',
        'internal:fetch-plugin-market',
        'internal:install-plugin-from-market',
        'internal:cancel-plugin-market-download'
      ]) {
        ipcMain.removeHandler(channel)
      }
      ipcMain.handle('internal:get-plugins', () => state.installed)
      ipcMain.handle('internal:fetch-plugin-market', () => ({
        success: true,
        data: state.market,
        storefront: { sections: [{ type: 'fixed', title: '升级验证', plugins: state.market }] }
      }))
      ipcMain.handle('internal:cancel-plugin-market-download', (_event, taskId: string) => {
        state.cancellations.push(taskId)
        state.resolve('cancelled')
        return { success: true }
      })
      ipcMain.handle('internal:install-plugin-from-market', (event, plugin) => {
        state.calls.push(plugin)
        event.sender.send('plugin-market-download-progress', {
          pluginName: plugin.name,
          taskId: `fixture-${state.calls.length}`,
          status: 'downloading',
          progress: null
        })
        return new Promise((resolve) => {
          state.resolve = (succeeded: boolean | 'cancelled') => {
            if (succeeded === 'cancelled') {
              resolve({ success: false, cancelled: true, error: '已取消下载' })
            } else if (succeeded) {
              const target = state.installed.find((item) => item.name === plugin.name)!
              target.version = plugin.version
              resolve({ success: true, plugin: target })
            } else {
              resolve({ success: false, error: '测试安装失败' })
            }
          }
        })
      })
    }, dataRoot)

    await page.locator('.search-input').fill('通用设置')
    await page.locator('.app-item, .list-item').filter({ hasText: '通用设置' }).first().click()
    await expect
      .poll(() => executeInSettings(electronApp!, 'document.body.innerText'))
      .toContain('开机自动启动')
    await executeInSettings(
      electronApp,
      `Array.from(document.querySelectorAll('.menu-item'))
      .find((item) => item.textContent.includes('已安装插件')).click()`
    )
    await expect
      .poll(() => executeInSettings(electronApp!, 'document.body.innerText'))
      .toContain('升级测试甲')
    await expect
      .poll(() =>
        executeInSettings(electronApp!, `document.querySelectorAll('.plugin-update-dot').length`)
      )
      .toBe(2)

    // 全部标签不显示升级按钮；进入更新标签后才显示，并验证实际图标绘制。
    expect(
      await executeInSettings(electronApp, `document.querySelectorAll('.upgrade-btn').length`)
    ).toBe(0)
    await executeInSettings(electronApp, `document.querySelectorAll('.tab-btn')[2].click()`)
    await expect
      .poll(() =>
        executeInSettings(electronApp!, `document.querySelectorAll('.upgrade-btn').length`)
      )
      .toBe(2)
    expect(
      await executeInSettings(
        electronApp,
        `(() => {
      const button = document.querySelector('.upgrade-btn button')
      const icon = button.querySelector('.center-icon svg')
      return { title: button.title, width: getComputedStyle(button).width,
        height: getComputedStyle(button).height, iconWidth: icon.getAttribute('width'),
        paths: Array.from(icon.querySelectorAll('path')).map((item) => item.getAttribute('d')) }
    })()`
      )
    ).toMatchObject({
      title: '升级到 v2.0.0',
      width: '36px',
      height: '36px',
      iconWidth: '18',
      paths: ['M12 19V5', 'M5 12L12 5L19 12', 'M5 21H19']
    })
    await captureSettingsScreenshot(electronApp, testInfo.outputPath('plugin-update-buttons.png'))

    // 当前按钮进入取消状态，其他插件升级按钮被禁用，防止并发安装。
    await executeInSettings(
      electronApp,
      `(() => {
      const button = document.querySelector('.upgrade-btn button')
      button.click()
      document.querySelectorAll('.upgrade-btn button')[1].click()
    })()`
    )
    await expect
      .poll(() =>
        electronApp!.evaluate(() => (globalThis as any).__updateButtonFixture.calls.length)
      )
      .toBe(1)
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `(() => {
      const button = document.querySelector('.upgrade-btn button')
      return { disabled: button.disabled, busy: button.getAttribute('aria-busy'),
        animation: getComputedStyle(button.firstElementChild).animationName,
        listVisible: document.querySelector('.scrollable-content').style.display !== 'none' }
    })()`
        )
      )
      .toMatchObject({
        disabled: false,
        busy: 'true',
        animation: expect.stringContaining('spin'),
        listVisible: true
      })
    await executeInSettings(electronApp, `document.querySelector('.btn-more').click()`)
    expect(
      await executeInSettings(
        electronApp,
        `Array.from(document.querySelectorAll('.more-menu-item'))
      .find((item) => item.textContent.includes('全部更新')).disabled`
      )
    ).toBe(true)
    await executeInSettings(electronApp, `document.querySelector('.btn-more').click()`)

    // 使用真实 IPC 进度通道验证圆环进度和居中的取消叉号。
    await electronApp.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().startsWith('http://127.0.0.1:15177'))!
      contents.send('plugin-market-download-progress', {
        pluginName: 'update-button-0',
        taskId: 'fixture-1',
        status: 'downloading',
        progress: 45
      })
    })
    await expect
      .poll(() =>
        executeInSettings(electronApp!, `document.querySelector('.upgrade-btn button').title`)
      )
      .toBe('取消下载')
    expect(
      Number(
        await executeInSettings(
          electronApp,
          `document.querySelector('.progress-value').getAttribute('stroke-dashoffset')`
        )
      )
    ).toBeCloseTo(2 * Math.PI * 10 * 0.55)
    expect(
      await executeInSettings(
        electronApp,
        `(() => {
      const button = document.querySelector('.upgrade-btn button')
      const ring = button.querySelector('.progress-ring').getBoundingClientRect()
      const label = button.querySelector('.cancel-icon').getBoundingClientRect()
      return { width: button.getBoundingClientRect().width,
        cancelStrokes: button.querySelectorAll('.cancel-icon span').length,
        text: button.textContent.trim(),
        centered: Math.abs(label.left + label.width / 2 - ring.left - ring.width / 2) < 1
          && Math.abs(label.top + label.height / 2 - ring.top - ring.height / 2) < 1,
        inside: label.left >= ring.left && label.right <= ring.right
          && label.top >= ring.top && label.bottom <= ring.bottom }
    })()`
      )
    ).toEqual({ width: 36, cancelStrokes: 2, text: '', centered: true, inside: true })
    await captureSettingsScreenshot(electronApp, testInfo.outputPath('plugin-update-progress.png'))

    // 点击叉号真正发出取消 IPC，保留旧版本且不显示升级失败提示。
    await executeInSettings(electronApp, `document.querySelector('.upgrade-btn button').click()`)
    await expect
      .poll(() =>
        electronApp!.evaluate(() => (globalThis as any).__updateButtonFixture.cancellations)
      )
      .toEqual(['fixture-1'])
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `document.querySelector('.upgrade-btn button').getAttribute('aria-busy')`
        )
      )
      .toBe('false')
    expect(await executeInSettings(electronApp, 'document.body.innerText')).not.toContain(
      '升级失败'
    )
    expect(
      await executeInSettings(electronApp, `document.querySelector('.plugin-version').textContent`)
    ).toBe('v1.0.0')
    await executeInSettings(electronApp, `document.querySelector('.upgrade-btn button').click()`)
    await expect
      .poll(() =>
        electronApp!.evaluate(() => (globalThis as any).__updateButtonFixture.calls.length)
      )
      .toBe(2)
    await electronApp.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().startsWith('http://127.0.0.1:15177'))!
      contents.send('plugin-market-download-progress', {
        pluginName: 'update-button-0',
        taskId: 'fixture-2',
        status: 'installing',
        progress: 100
      })
    })
    await expect
      .poll(() =>
        executeInSettings(electronApp!, `document.querySelector('.upgrade-btn button').title`)
      )
      .toBe('安装中')
    expect(
      await executeInSettings(electronApp, `document.querySelector('.upgrade-btn button').disabled`)
    ).toBe(true)
    await executeInSettings(electronApp, `document.querySelector('.upgrade-btn button').click()`)
    expect(
      await electronApp.evaluate(
        () => (globalThis as any).__updateButtonFixture.cancellations.length
      )
    ).toBe(1)

    // 安装失败应保留当前插件与更新数量，并恢复按钮供重试。
    await electronApp.evaluate(() => (globalThis as any).__updateButtonFixture.resolve(false))
    await expect
      .poll(() => executeInSettings(electronApp!, 'document.body.innerText'))
      .toContain('测试安装失败')
    await expect
      .poll(() =>
        executeInSettings(electronApp!, `document.querySelector('.upgrade-btn button').disabled`)
      )
      .toBe(false)
    expect(
      await executeInSettings(electronApp, `document.querySelectorAll('.upgrade-btn').length`)
    ).toBe(2)

    // 重试成功后刷新真实列表组件，当前插件退出更新列表，全部标签显示新版本。
    await executeInSettings(electronApp, `document.querySelector('.upgrade-btn button').click()`)
    await expect
      .poll(() =>
        electronApp!.evaluate(() => (globalThis as any).__updateButtonFixture.calls.length)
      )
      .toBe(3)
    expect(
      await electronApp.evaluate(() => (globalThis as any).__updateButtonFixture.calls[2])
    ).toMatchObject({ name: 'update-button-0', version: '2.0.0' })
    await electronApp.evaluate(() => (globalThis as any).__updateButtonFixture.resolve(true))
    await expect
      .poll(() =>
        executeInSettings(electronApp!, `document.querySelectorAll('.upgrade-btn').length`)
      )
      .toBe(1)
    expect(
      await executeInSettings(
        electronApp,
        `document.querySelectorAll('.tab-count')[2].textContent.trim()`
      )
    ).toBe('1')
    expect(
      await executeInSettings(electronApp, `document.querySelector('.plugin-item').textContent`)
    ).toContain('升级测试乙')
    await executeInSettings(electronApp, `document.querySelectorAll('.tab-btn')[0].click()`)
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `Array.from(document.querySelectorAll('.plugin-item'))
      .find((item) => item.textContent.includes('升级测试甲')).querySelector('.plugin-version').textContent`
        )
      )
      .toBe('v2.0.0')

    // 市场卡片直接升级时也使用相同圆环，且不会意外进入插件详情。
    await executeInSettings(
      electronApp,
      `Array.from(document.querySelectorAll('.menu-item'))
      .find((item) => item.textContent.includes('插件市场')).click()`
    )
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `document.querySelector('.plugin-card .upgrade-icon-btn')?.closest('.plugin-card').textContent`
        )
      )
      .toContain('升级测试乙')
    await executeInSettings(
      electronApp,
      `document.querySelector('.plugin-card .upgrade-icon-btn').click()`
    )
    await expect
      .poll(() =>
        executeInSettings(electronApp!, `document.querySelector('.dialog-message')?.textContent`)
      )
      .toContain('发现新版本')
    await executeInSettings(
      electronApp,
      `document.querySelector('.dialog-footer .btn-warning').click()`
    )
    await expect
      .poll(() =>
        electronApp!.evaluate(() => (globalThis as any).__updateButtonFixture.calls.length)
      )
      .toBe(4)
    await electronApp.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((item) => item.getURL().startsWith('http://127.0.0.1:15177'))!
      contents.send('plugin-market-download-progress', {
        pluginName: 'update-button-1',
        taskId: 'fixture-4',
        status: 'downloading',
        progress: 60
      })
    })
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `(() => {
      const button = document.querySelector('.plugin-card .upgrade-icon-btn')
      return { title: button.title, disabled: button.disabled,
        cancelStrokes: button.querySelectorAll('.cancel-icon span').length,
        offset: Number(button.querySelector('.progress-value').getAttribute('stroke-dashoffset')),
        detailOpen: !!document.querySelector('.detail-panel') }
    })()`
        )
      )
      .toEqual({
        title: '取消下载',
        disabled: false,
        cancelStrokes: 2,
        offset: 2 * Math.PI * 10 * 0.4,
        detailOpen: false
      })
    await captureSettingsScreenshot(
      electronApp,
      testInfo.outputPath('market-card-upgrade-progress.png')
    )

    // 进入详情后继承同一下载任务和进度，取消后列表中的升级箭头也恢复。
    await executeInSettings(
      electronApp,
      `document.querySelector('.plugin-card .upgrade-icon-btn').closest('.plugin-card').click()`
    )
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `document.querySelector('.detail-actions .upgrade-icon-btn')?.title`
        )
      )
      .toBe('取消下载')
    expect(
      Number(
        await executeInSettings(
          electronApp,
          `document.querySelector('.detail-actions .progress-value').getAttribute('stroke-dashoffset')`
        )
      )
    ).toBeCloseTo(2 * Math.PI * 10 * 0.4)
    await executeInSettings(
      electronApp,
      `document.querySelector('.detail-actions .upgrade-icon-btn').click()`
    )
    await expect
      .poll(() =>
        electronApp!.evaluate(() => (globalThis as any).__updateButtonFixture.cancellations)
      )
      .toEqual(['fixture-1', 'fixture-4'])
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `document.querySelector('.detail-actions .upgrade-icon-btn').getAttribute('aria-busy')`
        )
      )
      .toBe('false')
    await executeInSettings(
      electronApp,
      `document.querySelector('.detail-panel .back-btn').click()`
    )
    await expect
      .poll(() =>
        executeInSettings(
          electronApp!,
          `document.querySelector('.plugin-card .upgrade-icon-btn').title`
        )
      )
      .toBe('升级到 v2.0.0')
  } finally {
    // 仅关闭本次实例并清理本次创建的数据目录。
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
