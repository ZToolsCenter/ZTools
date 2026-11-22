import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

test('万条名称在真实 IPC 与 Worker 链路中返回完整排名并记录延迟', async ({
  playwright: _playwright
}, testInfo) => {
  test.setTimeout(60000)
  // 缩短合成路径，避免一万条夹具超过存储层单文档 1 MB 上限。
  const dataRoot = await fs.mkdtemp(
    path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'zs-')
  )
  let app: ElectronApplication | undefined
  await fs.mkdir(path.join(dataRoot, 'legacy'))
  try {
    app = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])
        ),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: path.join(dataRoot, 'legacy'),
        ZTOOLS_E2E: '1',
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    const page = await app.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    const report = await page.evaluate(async (dataRoot) => {
      const labels = [
        '微信',
        '微信 OCR',
        '重庆天气',
        '银行助手',
        '音乐播放器',
        'Visual Studio Code',
        'HTTPServer',
        '女娲工具',
        '长截图',
        '重行长乐重行长乐'
      ]
      // 所有启动目标均为临时路径，仅进行名称查询，绝不执行这些合成目标。
      const saved = await window.ztools.dbPut(
        'local-shortcuts',
        Array.from({ length: 10000 }, (_, i) => ({
          name: labels[i % labels.length] + String(i).padStart(5, '0'),
          path: dataRoot + '/fixture/' + i,
          type: 'file'
        }))
      )
      if (!saved?.ok) throw new Error('基准夹具写入失败：' + JSON.stringify(saved))
      const catalogNames = (await window.ztools.commands.getCatalog()).length
      if (catalogNames < 10000) throw new Error('基准目录未包含夹具：' + catalogNames)
      const results: Record<string, { hits: number; p50: number; p95: number; p99: number }> = {}
      let requestId = 0
      for (const [kind, query] of Object.entries({
        chinese: '微信',
        full: 'weixin',
        alternative: 'zhongqing',
        mixed: 'wei信',
        missing: 'notfoundanything'
      })) {
        const samples: number[] = []
        let hits = 0
        for (let i = 0; i < 30; i++) {
          const started = performance.now()
          const result = await window.ztools.commands.query({
            sessionId: 'large-ipc-benchmark',
            requestId: ++requestId,
            context: { searchQuery: query, pastedText: null, pastedImage: null, pastedFiles: null }
          })
          if (result.error) throw new Error(result.error)
          if (i >= 5) samples.push(performance.now() - started)
          hits = result.bestSearchResults.filter((item) =>
            item.path.startsWith(dataRoot + '/fixture/')
          ).length
          // 基准没有展示生命周期，消费完立即释放执行快照，避免测量结果保留成本。
          window.ztools.commands.releaseSearch(result.sessionId, result.requestId)
        }
        samples.sort((a, b) => a - b)
        results[kind] = { hits, p50: samples[12], p95: samples[23], p99: samples[24] }
      }
      return { fixtureNames: 10000, catalogNames, samplesPerCategory: 25, results }
    }, dataRoot)
    expect(report.results.chinese.hits).toBe(2000)
    expect(report.results.full.hits).toBe(2000)
    expect(report.results.alternative.hits).toBe(1000)
    expect(report.results.mixed.hits).toBe(2000)
    expect(report.results.missing.hits).toBe(0)
    const reportPath = testInfo.outputPath('search-large-ipc-latency.json')
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    await testInfo.attach('search-large-ipc-latency.json', {
      path: reportPath,
      contentType: 'application/json'
    })
  } finally {
    await app?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('统一搜索支持规则与别名更新、线程超时恢复，面板不依赖主渲染线程', async ({
  playwright: _playwright
}, testInfo) => {
  test.setTimeout(60000)
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-command-e2e-'))
  const pluginRoot = path.join(dataRoot, 'fixture-plugin')
  const payloadFile = path.join(dataRoot, 'entered.json')
  const features = [
    { code: 'quick', mainHide: true, cmds: ['Quick Command'] },
    { code: 'push', mainHide: true, mainPush: true, cmds: ['Push'] },
    { code: 'cq', mainHide: true, mainPush: true, cmds: ['重庆'] },
    { code: 'weather', cmds: ['😀重庆天气'] },
    { code: 'bank', cmds: ['银行助手'] },
    { code: 'music', cmds: ['音乐播放器'] },
    { code: 'english', cmds: ['Visual Studio Code'] },
    { code: 'regex', cmds: [{ type: 'regex', label: 'Regex Command', match: '/abc/i' }] },
    {
      code: 'window',
      mainHide: true,
      cmds: [{ type: 'window', label: 'Window Command', match: { app: ['Fixture.app'] } }]
    },
    { code: 'dangerous', cmds: [{ type: 'regex', label: 'Slow Rule', match: '/^(a+)+$/' }] }
  ]
  let app: ElectronApplication | undefined
  await fs.mkdir(pluginRoot, { recursive: true })
  await fs.mkdir(path.join(dataRoot, 'legacy'), { recursive: true })
  await fs.writeFile(
    path.join(pluginRoot, 'plugin.json'),
    JSON.stringify({
      name: 'command-fixture',
      title: 'Command Fixture',
      version: '1.0.0',
      preload: 'preload.js',
      features
    })
  )
  await fs.writeFile(
    path.join(pluginRoot, 'preload.js'),
    `
    const save = action => require('node:fs').writeFileSync(${JSON.stringify(payloadFile)}, JSON.stringify(action))
    window.exports = {
      quick: { mode: 'none', args: { enter: save } },
      window: { mode: 'none', args: { enter: save } },
      push: { mode: 'none', args: { enter: save } },
      cq: { mode: 'none', args: { enter: save } }
    }
    ztools.onMainPush(action => [{ text: action.payload }], () => true)
  `
  )
  try {
    app = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])
        ),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: path.join(dataRoot, 'legacy'),
        ZTOOLS_E2E: '1',
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    const page = await app.firstWindow()
    await expect(page.locator('.search-input')).toBeVisible()
    // 插件夹具仅写入隔离的宿主注册表，不安装插件或启动真实系统应用。
    await page.evaluate(
      async (plugin) => {
        const current = (await window.ztools.dbGet('plugins')) || []
        await window.ztools.dbPut('plugins', [...current, plugin])
      },
      {
        name: 'command-fixture',
        title: 'Command Fixture',
        version: '1.0.0',
        path: pluginRoot,
        features
      }
    )
    await page.locator('.search-input').fill('Quick')
    await expect(
      page.locator('.app-item, .list-item').filter({ hasText: 'Quick Command' }).first()
    ).toBeVisible()

    // 延迟实际 IPC 回复，稳定复现快速输入期间的空列表和窗口收缩问题。
    const quickItem = page
      .locator('.app-item, .list-item')
      .filter({ hasText: 'Quick Command' })
      .first()
    const originalMarkup = await quickItem.innerHTML()
    const originalHeight = await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('/index.html'))!
          .getSize()[1]
    )
    await app.evaluate(({ ipcMain }) => {
      const original = (ipcMain as any)._invokeHandlers.get('commands:query')
      const probe = {
        original,
        releases: new Map<string, () => void>(),
        resizeRequests: [] as number[],
        onResize: (_event: unknown, height: number) => {
          probe.resizeRequests.push(height)
        }
      }
      ;(globalThis as any).__searchDisplayProbe = probe
      ipcMain.on('resize-window', probe.onResize)
      ipcMain.removeHandler('commands:query')
      ipcMain.handle('commands:query', async (event, request) => {
        const result = await original(event, request)
        if (
          request.sessionId.startsWith('main-') &&
          ['Quick C', 'Quick Co', 'Quick Com'].includes(request.context.searchQuery) &&
          !probe.releases.has(request.context.searchQuery)
        ) {
          await new Promise<void>((resolve) => {
            probe.releases.set(request.context.searchQuery, resolve)
          })
        }
        return result
      })
    })
    await page.evaluate(() => {
      const container = document.querySelector('.scrollable-content')!
      const probe = { disappeared: false, observer: null as MutationObserver | null }
      probe.observer = new MutationObserver(() => {
        if (
          !Array.from(container.querySelectorAll('.app-item, .list-item')).some((item) =>
            item.textContent?.includes('Quick Command')
          )
        )
          probe.disappeared = true
      })
      probe.observer.observe(container, { childList: true, subtree: true })
      ;(window as any).__searchDisplayProbe = probe
    })
    await page.locator('.search-input').fill('Quick C')
    await expect
      .poll(() =>
        app!.evaluate(() => (globalThis as any).__searchDisplayProbe.releases.has('Quick C'))
      )
      .toBe(true)
    await expect(quickItem).toBeVisible()
    expect(await quickItem.innerHTML()).toBe(originalMarkup)
    expect(
      await app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().includes('/index.html'))!
            .getSize()[1]
      )
    ).toBe(originalHeight)
    expect(
      await app.evaluate(() => (globalThis as any).__searchDisplayProbe.resizeRequests)
    ).toEqual([])

    // 连续输入的新回复先到达，旧回复不能回退列表或高亮。
    await page.locator('.search-input').fill('Quick Co')
    await expect
      .poll(() =>
        app!.evaluate(() => (globalThis as any).__searchDisplayProbe.releases.has('Quick Co'))
      )
      .toBe(true)
    expect(await quickItem.innerHTML()).toBe(originalMarkup)
    await app.evaluate(() => (globalThis as any).__searchDisplayProbe.releases.get('Quick Co')())
    await expect(quickItem.locator('.highlight')).toHaveText('Quick Co')
    await app.evaluate(() => (globalThis as any).__searchDisplayProbe.releases.get('Quick C')())
    // 连续帧核对旧回复处理后的展示，并记录整个查询期间是否出现空列表。
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    )
    await expect(quickItem.locator('.highlight')).toHaveText('Quick Co')
    expect(await page.evaluate(() => (window as any).__searchDisplayProbe.disappeared)).toBe(false)
    await page.evaluate(() => (window as any).__searchDisplayProbe.observer.disconnect())

    // 下一轮在主进程已经完成但页面仍显示旧结果，实际点击必须启动旧展示的输入。
    await page.locator('.search-input').fill('Quick Com')
    await expect
      .poll(() =>
        app!.evaluate(() => (globalThis as any).__searchDisplayProbe.releases.has('Quick Com'))
      )
      .toBe(true)
    await expect(quickItem.locator('.highlight')).toHaveText('Quick Co')
    try {
      await quickItem.click()
      await expect
        .poll(async () => {
          try {
            return JSON.parse(await fs.readFile(payloadFile, 'utf8'))
          } catch {
            return null
          }
        })
        .toMatchObject({ code: 'quick', type: 'text', payload: 'Quick Co' })
    } finally {
      // 无论启动断言是否成功都恢复真实查询处理器，避免门控污染后续宿主操作。
      await app.evaluate(({ ipcMain }) => {
        const probe = (globalThis as any).__searchDisplayProbe
        for (const release of probe.releases.values()) release()
        ipcMain.removeHandler('commands:query')
        ipcMain.handle('commands:query', probe.original)
        ipcMain.removeListener('resize-window', probe.onResize)
        delete (globalThis as any).__searchDisplayProbe
      })
    }
    // 实际启动会进入插件状态；重新显示宿主并走真实返回按钮恢复搜索视图。
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('/index.html')
      )!
      main.show()
      main.focus()
    })
    await page.getByRole('button', { name: '返回搜索' }).click()
    await expect(page.locator('.search-input')).toBeVisible()

    // 实际 Worker 与页面共用评分和原文映射，OCR 偏好加分允许超过完整名称。
    await page.evaluate(async (dataRoot) => {
      await window.ztools.dbPut('local-shortcuts', [
        { name: '微信', path: dataRoot + '/WeChat.app', type: 'file' },
        { name: '微信 OCR', path: dataRoot + '/OCR.app', type: 'file' }
      ])
      await window.ztools.dbPut('search-preference', {
        微信: { path: dataRoot + '/OCR.app', name: '微信 OCR', featureCode: '' }
      })
    }, dataRoot)
    const workerChecks = await page.evaluate(async () => {
      const results = [] as Array<{ query: string; names: string[]; ranges: string[][] }>
      for (const [i, query] of [
        '微信',
        'wxocr',
        'zq',
        'zhongqing',
        'yinxing',
        'bofang',
        'vsc',
        'wei信'
      ].entries()) {
        const result = await window.ztools.commands.query({
          sessionId: 'six-fields',
          requestId: i + 1,
          context: { searchQuery: query, pastedText: null, pastedImage: null, pastedFiles: null }
        })
        if (result.error) throw new Error(result.error)
        if (
          JSON.stringify(
            result.allListModeResults
              .slice(0, result.bestSearchResults.length)
              .map((item) => item.resultId)
          ) !== JSON.stringify(result.bestSearchResults.map((item) => item.resultId))
        )
          throw new Error('列表与聚合名称排序不一致：' + query)
        results.push({
          query,
          names: result.bestSearchResults.map((item) => item.name),
          ranges: result.bestSearchResults.map((item) =>
            (item.highlightRanges || []).map(([start, end]) => item.name.slice(start, end + 1))
          )
        })
        window.ztools.commands.releaseSearch(result.sessionId, result.requestId)
      }
      return results
    })
    // 同名不同路径继续共存，排序只看总分，不能在返回时再次强制全名置顶。
    expect(workerChecks[0].names[0]).toBe('微信 OCR')
    expect(workerChecks[0].names).toContain('微信')
    expect(workerChecks[1].names).toContain('微信 OCR')
    for (const check of workerChecks.slice(2, 4)) {
      expect(check.names).toContain('😀重庆天气')
      expect(check.ranges[check.names.indexOf('😀重庆天气')]).toEqual(['重庆'])
    }
    expect(workerChecks[4].names).toContain('银行助手')
    expect(workerChecks[5].ranges[workerChecks[5].names.indexOf('音乐播放器')]).toEqual(['播放'])
    expect(workerChecks[6].ranges[workerChecks[6].names.indexOf('Visual Studio Code')]).toEqual([
      'V',
      'S',
      'C'
    ])
    expect(workerChecks[7].names[0]).toBe('微信')
    for (const [query, name, marks] of [
      ['bofang', '音乐播放器', ['播放']],
      ['zq', '😀重庆天气', ['重庆']],
      ['vsc', 'Visual Studio Code', ['V', 'S', 'C']]
    ] as Array<[string, string, string[]]>) {
      await page.locator('.search-input').fill(query)
      await expect(
        page
          .locator('.app-item, .list-item')
          .filter({ hasText: name })
          .first()
          .locator('.highlight')
      ).toHaveText(marks)
    }
    // IPC 测量包含 renderer、主进程会话处理、Worker 以及返回序列化。
    const ipcSamples = await page.evaluate(async () => {
      const samples: number[] = []
      for (let i = 0; i < 30; i++) {
        const started = performance.now()
        const result = await window.ztools.commands.query({
          sessionId: 'ipc-benchmark',
          requestId: i + 1,
          context: {
            searchQuery: ['微信', 'wxocr', 'zq', 'wei信', 'bofang'][i % 5],
            pastedText: null,
            pastedImage: null,
            pastedFiles: null
          }
        })
        if (result.error) throw new Error(result.error)
        if (i >= 5) samples.push(performance.now() - started)
        window.ztools.commands.releaseSearch(result.sessionId, result.requestId)
      }
      return samples.sort((a, b) => a - b)
    })
    await testInfo.attach('search-ipc-latency.json', {
      body: JSON.stringify({
        count: ipcSamples.length,
        p50: ipcSamples[12],
        p95: ipcSamples[23],
        p99: ipcSamples[24]
      }),
      contentType: 'application/json'
    })

    const regex = await page.evaluate(() =>
      window.ztools.commands.query({
        sessionId: 'test-regex',
        requestId: 1,
        context: { searchQuery: 'ABC', pastedText: null, pastedImage: null, pastedFiles: null }
      })
    )
    expect(regex.bestMatches.some((item) => item.name === 'Regex Command')).toBe(true)
    await page.evaluate(() => window.ztools.commands.releaseSearch('test-regex', 1))
    await page.evaluate(async () => {
      await window.ztools.dbPut('command-aliases', {
        'command-fixture:quick:Quick Command:text': [{ alias: 'Renamed Alias' }]
      })
    })
    await page.locator('.search-input').fill('Renamed')
    await expect(
      page.locator('.app-item, .list-item').filter({ hasText: 'Renamed Alias' }).first()
    ).toBeVisible()

    // 真实 Worker 执行灾难性回溯，主进程预算必须终止线程并恢复下一次查询。
    const timeout = await page.evaluate(() =>
      window.ztools.commands.query({
        sessionId: 'test-timeout',
        requestId: 1,
        context: {
          searchQuery: 'a'.repeat(28) + '!',
          pastedText: null,
          pastedImage: null,
          pastedFiles: null
        }
      })
    )
    expect(timeout.error).toContain('超时')
    const recovered = await page.evaluate(() =>
      window.ztools.commands.query({
        sessionId: 'test-timeout',
        requestId: 2,
        context: { searchQuery: 'Quick', pastedText: null, pastedImage: null, pastedFiles: null }
      })
    )
    expect(recovered.error).toBeUndefined()
    expect(recovered.bestSearchResults.some((item) => item.name === 'Quick Command')).toBe(true)
    await page.evaluate(() => window.ztools.commands.releaseSearch('test-timeout', 2))

    await page.evaluate(() => window.ztools.dbPut('enabled-main-push-plugin', ['command-fixture']))
    const alternatePush = await page.evaluate(() =>
      window.ztools.commands.query({
        sessionId: 'alternate-push',
        requestId: 1,
        context: {
          searchQuery: 'zhongqing hello',
          pastedText: null,
          pastedImage: null,
          pastedFiles: null
        }
      })
    )
    expect(alternatePush.mainPushCandidates.some((item) => item.featureCode === 'cq')).toBe(true)
    await page.evaluate(() => window.ztools.commands.releaseSearch('alternate-push', 1))
    const dynamic = await page.evaluate(async () => {
      const sessions = ['push-one', 'push-two']
      const groups: Record<string, any> = {}
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          remove()
          reject(new Error('动态搜索未返回'))
        }, 10000)
        const remove = window.ztools.commands.onSearchUpdate((update) => {
          if (!sessions.includes(update.sessionId)) return
          groups[update.sessionId] = update.group
          if (Object.keys(groups).length === 2) {
            clearTimeout(timer)
            remove()
            resolve()
          }
        })
        void Promise.all(
          sessions.map((sessionId, index) =>
            window.ztools.commands.query({
              sessionId,
              requestId: 1,
              context: {
                searchQuery: 'Push ' + index,
                pastedText: null,
                pastedImage: null,
                pastedFiles: null
              }
            })
          )
        ).catch(reject)
      })
      return groups
    })
    const runningViews = await app.evaluate(
      ({ webContents }) =>
        webContents
          .getAllWebContents()
          .filter((contents) => contents.getURL().includes('hideWindow')).length
    )
    expect(runningViews).toBe(1)
    for (const sessionId of ['push-one', 'push-two']) {
      const group = dynamic[sessionId]
      const launched = await page.evaluate(
        ({ sessionId, group }) =>
          window.ztools.commands.execute({
            sessionId,
            requestId: 1,
            resultId: group.resultId,
            option: group.items[0]
          }),
        { sessionId, group }
      )
      expect(launched.success).toBe(true)
      // 同一文本功能再次进入必须使用该组查询快照，不能仅聚焦或串入另一会话。
      await expect
        .poll(async () => {
          try {
            return JSON.parse(await fs.readFile(payloadFile, 'utf8'))
          } catch {
            return null
          }
        })
        .toMatchObject({
          code: 'push',
          type: 'text',
          payload: group.items[0].text,
          option: { text: group.items[0].text },
          from: 'main'
        })
      await page.evaluate(
        (sessionId) => window.ztools.commands.releaseSearch(sessionId, 1),
        sessionId
      )
    }

    // 用真实面板页面消费 A，暂不向它交付已经算出的 B，验证点击仍绑定 A 的窗口信息。
    const panelOpening = app.waitForEvent('window')
    await app.evaluate(({ BrowserWindow }, root) => {
      const panel = new BrowserWindow({
        width: 250,
        height: 400,
        show: true,
        webPreferences: {
          preload: root + '/out/preload/index.js',
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      ;(globalThis as any).__snapshotPanelId = panel.id
      void panel.loadFile(root + '/out/renderer/super-panel.html')
    }, projectRoot)
    const snapshotPanel = await panelOpening
    await expect(snapshotPanel.locator('.super-panel')).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.fromId((globalThis as any).__snapshotPanelId)!.webContents.send(
        'super-panel-data',
        { type: 'pinned', commands: [], windowInfo: null }
      )
    })
    await expect(snapshotPanel.locator('.super-panel .empty-text')).toHaveText('暂无固定项目')
    await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
      const panel = BrowserWindow.fromId((globalThis as any).__snapshotPanelId)!
      const result = await (ipcMain as any)._invokeHandlers.get(
        'super-panel:search-window-commands'
      )({ sender: panel.webContents }, { app: 'Fixture.app', title: 'Visible Window A' })
      if (!result.results.some((item) => item.name === 'Window Command'))
        throw new Error('面板窗口 A 未命中夹具')
      // 测试窗口独立于管理器，消费它的待发队列后手动交付真实返回值，模拟已展示 A。
      ipcMain.emit('super-panel:ready', { sender: panel.webContents })
      panel.webContents.send('super-panel-window-commands-data', {
        results: result.results,
        snapshot: { sessionId: 'window', requestId: result.requestId }
      })
    })
    await snapshotPanel.locator('[title="窗口匹配"]').click()
    const oldWindowCommand = snapshotPanel
      .locator('.window-match-panel .list-item')
      .filter({ hasText: 'Window Command' })
    await expect(oldWindowCommand).toBeVisible()
    const newerWindowRequest = await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
      const panel = BrowserWindow.fromId((globalThis as any).__snapshotPanelId)!
      const result = await (ipcMain as any)._invokeHandlers.get(
        'super-panel:search-window-commands'
      )({ sender: panel.webContents }, { app: 'Fixture.app', title: 'Pending Window B' })
      // B 保持在管理器的待发队列，实际页面仍只展示 A 的命令与快照。
      return result.requestId as number
    })
    await oldWindowCommand.click()
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await fs.readFile(payloadFile, 'utf8'))
        } catch {
          return null
        }
      })
      .toMatchObject({
        code: 'window',
        type: 'window',
        payload: { app: 'Fixture.app', title: 'Visible Window A' }
      })
    await snapshotPanel.evaluate((requestId) => {
      window.ztools.superPanelReleaseSearch({ sessionId: 'window', requestId })
    }, newerWindowRequest)
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const panel = BrowserWindow.fromId((globalThis as any).__snapshotPanelId)!
      ipcMain.emit('super-panel:ready', { sender: panel.webContents })
      // 清空实际展示触发页面释放 A，避免测试绕过新的消费生命周期。
      panel.webContents.send('super-panel-window-commands-data', { results: [] })
    })
    await snapshotPanel.locator('[title="窗口匹配"]').click()
    await expect(snapshotPanel.locator('.window-match-panel .list-item')).toHaveCount(0)
    await snapshotPanel.close()
    await app.evaluate(() => {
      delete (globalThis as any).__snapshotPanelId
    })

    const independent = await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
      const main = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('/index.html')
      )!
      main.hide()
      // 故意阻塞主窗口页面；主进程直接调用实际面板 IPC 适配器完成查询与启动。
      const blocked = main.webContents.executeJavaScript(
        'const stop = Date.now() + 5000; while (Date.now() < stop) {}'
      )
      const started = Date.now()
      const invoke = (ipcMain as any)._invokeHandlers
      const windowResult = await invoke.get('super-panel:search-window-commands')(
        { sender: main.webContents },
        { app: 'Fixture.app', title: 'Fixture Document' }
      )
      const command = windowResult.results.find((item) => item.name === 'Window Command')
      if (!command) throw new Error('面板窗口规则未命中')
      const launch = await invoke.get('super-panel:launch')({ sender: main.webContents }, command, {
        sessionId: 'window',
        requestId: windowResult.requestId
      })
      const elapsed = Date.now() - started
      const visible = main.isVisible()
      ipcMain.emit(
        'super-panel:release-search',
        { sender: main.webContents },
        { sessionId: 'window', requestId: windowResult.requestId }
      )
      await blocked
      return { launch, elapsed, visible }
    })
    expect(independent.launch.success).toBe(true)
    expect(independent.elapsed).toBeLessThan(2500)
    expect(independent.visible).toBe(false)
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await fs.readFile(payloadFile, 'utf8'))
        } catch {
          return null
        }
      })
      .toMatchObject({
        code: 'window',
        type: 'window',
        payload: { app: 'Fixture.app', title: 'Fixture Document' }
      })
  } finally {
    await app?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('超级面板固定本地指令后点击进入启动器并写入历史', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-panel-launch-e2e-'))
  const fixturePath = path.join(dataRoot, 'WeChat.app')
  let app: ElectronApplication | undefined
  await fs.mkdir(path.join(dataRoot, 'legacy'))
  try {
    app = await electron.launch({
      args: [projectRoot],
      cwd: projectRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])
        ),
        ZTOOLS_DATA_ROOT: dataRoot,
        ZTOOLS_LEGACY_USER_DATA_PATH: path.join(dataRoot, 'legacy'),
        ZTOOLS_E2E: '1',
        ZTOOLS_SETTING_DEV_SERVER_URL: 'http://127.0.0.1:15177'
      }
    })
    const main = await app.firstWindow()
    await expect(main.locator('.search-input')).toBeVisible()
    // 只替换系统打开动作，其余目录解析、固定、IPC 和历史处理均走真实宿主。
    await app.evaluate(({ shell }) => {
      ;(globalThis as any).__panelOpenedPaths = []
      shell.openPath = async (target) => {
        ;(globalThis as any).__panelOpenedPaths.push(target)
        return ''
      }
    })
    const pinned = await main.evaluate(async (fixturePath) => {
      await window.ztools.dbPut('local-shortcuts', [
        { name: '微信', path: fixturePath, type: 'file' }
      ])
      const command = (await window.ztools.commands.getCatalog()).find(
        (item) => item.path === fixturePath
      )!
      const result = await window.ztools.pinToSuperPanel(command)
      if (!result.success) throw new Error(result.error)
      return window.ztools.getSuperPanelPinned()
    }, fixturePath)
    expect(pinned).toHaveLength(1)
    expect(pinned[0]).toMatchObject({ name: '微信', featureCode: '', type: 'direct' })
    const opening = app.waitForEvent('window')
    await app.evaluate(
      ({ BrowserWindow }, { projectRoot, pinned }) => {
        const panel = new BrowserWindow({
          width: 250,
          height: 400,
          show: true,
          webPreferences: {
            preload: projectRoot + '/out/preload/index.js',
            contextIsolation: true,
            nodeIntegration: false
          }
        })
        panel.loadFile(projectRoot + '/out/renderer/super-panel.html')
        panel.webContents.once('did-finish-load', () => {
          panel.webContents.send('super-panel-data', { type: 'pinned', commands: pinned })
        })
      },
      { projectRoot, pinned }
    )
    const panel = await opening
    await panel.locator('.grid-item').filter({ hasText: '微信' }).click()
    await expect
      .poll(() => app!.evaluate(() => (globalThis as any).__panelOpenedPaths))
      .toEqual([fixturePath])
    await expect
      .poll(() => main.evaluate(() => window.ztools.dbGet('command-history')))
      .toEqual(
        expect.arrayContaining([expect.objectContaining({ name: '微信', path: fixturePath })])
      )
  } finally {
    await app?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
