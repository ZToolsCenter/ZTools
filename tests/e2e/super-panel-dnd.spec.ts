import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(__dirname, '../..')

interface TestCommand {
  name: string
  path: string
  type: 'builtin'
  cmdType: 'text'
  icon?: string
}

interface TestFolder {
  isFolder: true
  id: string
  name: string
  items: TestCommand[]
}

type TestPinnedItem = TestCommand | TestFolder

/**
 * 启动一个使用临时数据目录的 Electron 测试实例。
 * @param dataRoot 测试实例数据目录
 * @param legacyRoot 隔离的旧数据目录
 * @returns 已启动的 Electron 应用
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

/**
 * 创建一组带有稳定名称和路径的超级面板测试数据。
 * @param includeFolder 是否包含已有文件夹
 * @returns 可直接发送到超级面板的固定项目列表
 */
function createPinnedItems(includeFolder = true): TestPinnedItem[] {
  const command = (name: string): TestCommand => ({
    name,
    path: `e2e:${name}`,
    type: 'builtin',
    cmdType: 'text'
  })
  const items: TestPinnedItem[] = [command('Alpha'), command('Beta'), command('Gamma')]
  if (includeFolder) {
    items.push({
      isFolder: true,
      id: 'folder-e2e',
      name: 'Existing Folder',
      items: [command('Delta'), command('Epsilon')]
    })
  }
  return items
}

/**
 * 在隔离 Electron 实例中创建超级面板窗口并注入固定项目。
 * @param electronApp 当前测试实例
 * @param commands 要显示的固定项目
 * @returns 已加载超级面板页面
 */
async function openSuperPanel(
  electronApp: ElectronApplication,
  commands: TestPinnedItem[]
): Promise<Page> {
  // 先消费主窗口，避免测试实例启动较慢时 waitForEvent 抓到它。
  await electronApp.firstWindow()
  const panelPromise = electronApp.waitForEvent('window')
  await electronApp.evaluate(
    ({ BrowserWindow }, options) => {
      const panel = new BrowserWindow({
        width: 250,
        height: 400,
        show: true,
        frame: false,
        webPreferences: {
          preload: options.preload,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: false
        }
      })
      panel.loadFile(options.html)
      panel.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          panel.webContents.send('super-panel-data', {
            type: 'pinned',
            commands: options.commands,
            windowInfo: null
          })
        }, 150)
      })
    },
    {
      html: path.join(projectRoot, 'out/renderer/super-panel.html'),
      preload: path.join(projectRoot, 'out/preload/index.js'),
      commands
    }
  )
  const panel = await panelPromise
  await expect(panel.locator('.super-panel')).toBeVisible()
  await expect(panel.locator('.grid-item').first()).toBeVisible()
  // 记录初始快照，以便验证预览和取消不会写入数据库。
  await panel.evaluate((items) => window.ztools.updateSuperPanelPinnedOrder(items), commands)
  return panel
}

/**
 * 将一个宫格项目拖动到另一个宫格项目的中心。
 * @param page 超级面板页面
 * @param sourceName 来源项目名称
 * @param targetName 目标项目名称
 * @returns 拖拽操作完成后结束的 Promise
 * @throws 无法读取项目边界时抛错
 */
async function dragItemToItem(page: Page, sourceName: string, targetName: string): Promise<void> {
  await dragItemToItemAt(page, sourceName, targetName, 'center')
}

/**
 * 将一个宫格项目拖动到另一个宫格项目的指定区域。
 * @param page 超级面板页面
 * @param sourceName 来源项目名称
 * @param targetName 目标项目名称
 * @param position 目标区域，支持中心或左上边缘
 * @returns 拖拽操作完成后结束的 Promise
 */
async function dragItemToItemAt(
  page: Page,
  sourceName: string,
  targetName: string,
  position: 'center' | 'top-left'
): Promise<void> {
  const source = page.locator('.grid-item').filter({ hasText: sourceName }).first()
  const target = page.locator('.grid-item').filter({ hasText: targetName }).first()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('无法获取拖拽项目边界')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(260)
  const targetX = position === 'center' ? targetBox.x + targetBox.width / 2 : targetBox.x + 3
  const targetY = position === 'center' ? targetBox.y + targetBox.height / 2 : targetBox.y + 3
  await page.mouse.move(targetX, targetY, {
    steps: 1
  })
  await page.waitForTimeout(500)
  await page.mouse.up()
}

/**
 * 快速越过目标再进入下一槽位，使尾随空槽移动到目标位置。
 * @param page 超级面板页面
 * @param sourceName 来源项目名称
 * @param targetName 目标项目名称
 * @returns 拖拽操作完成后结束的 Promise
 * @throws 无法读取项目边界时抛错
 */
async function dragItemToItemQuickly(
  page: Page,
  sourceName: string,
  targetName: string
): Promise<void> {
  const source = page.locator('.grid-item').filter({ hasText: sourceName }).first()
  const target = page.locator('.grid-item').filter({ hasText: targetName }).first()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('无法获取快速排序项目边界')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(80)
  // 先到目标，再向后跨一格；末尾之后的空白区域代表追加。
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
  const grid = await page.locator('.pinned-grid').boundingBox()
  if (!grid) throw new Error('无法获取网格边界')
  const nextX = targetBox.x + targetBox.width + 4
  await page.mouse.move(
    nextX < grid.x + grid.width - 8 ? nextX : grid.x + 8 + targetBox.width / 2,
    nextX < grid.x + grid.width - 8
      ? targetBox.y + targetBox.height / 2
      : targetBox.y + targetBox.height + 4
  )
  await page.waitForTimeout(40)
  await page.mouse.up()
}

/**
 * 将文件夹弹窗内的第一个项目越过第二个项目，插入末尾空槽。
 * @param page 超级面板页面
 * @param sourceName 来源项目名称
 * @param targetName 目标项目名称
 * @returns 拖拽操作完成后结束的 Promise
 * @throws 无法读取项目边界时抛错
 */
async function dragFolderItemToItem(
  page: Page,
  sourceName: string,
  targetName: string
): Promise<void> {
  const source = page
    .locator('.folder-popup-grid .grid-item')
    .filter({ hasText: sourceName })
    .first()
  const target = page
    .locator('.folder-popup-grid .grid-item')
    .filter({ hasText: targetName })
    .first()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('无法获取文件夹弹窗拖拽项目边界')

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(120)
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 16
  })
  // 文件夹同样在离开目标后才让出目标槽位。
  await page.mouse.move(targetBox.x + targetBox.width + 4, targetBox.y + targetBox.height / 2)
  await page.waitForTimeout(180)
  await page.mouse.up()
}

/**
 * 读取超级面板持久化后的固定项目。
 * @param page 超级面板页面
 * @returns 当前数据库中的固定项目
 */
async function readPersistedItems(page: Page): Promise<TestPinnedItem[]> {
  return (await page.evaluate(() => window.ztools.dbGet('super-panel-pinned'))) as TestPinnedItem[]
}

/**
 * 为拖拽边界用例提供独立数据目录和源码 Electron 窗口。
 * @param items 用例初始项目
 * @param run 在隔离面板上运行的断言
 * @returns 用例与资源清理完成后结束的 Promise
 */
async function withPanel(
  items: TestPinnedItem[],
  run: (panel: Page, app: ElectronApplication) => Promise<void>
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-panel-relaunch-'))
  const legacy = path.join(root, 'legacy')
  let app: ElectronApplication | null = null
  try {
    await fs.mkdir(legacy, { recursive: true })
    app = await launchTestApp(root, legacy)
    await run(await openSuperPanel(app, items), app)
  } finally {
    // 只关闭本次 Electron、删除本次临时目录。
    await app?.close()
    await fs.rm(root, { recursive: true, force: true })
  }
}

/**
 * 在指定网格中按住项目并返回初始几何，供连续路径测试使用。
 * @param panel 超级面板页面
 * @param name 项目名称
 * @param grid 网格选择器
 * @returns 项目中心和尺寸
 * @throws 找不到项目边界时抛错
 */
async function pressItem(
  panel: Page,
  name: string,
  grid = '.pinned-grid'
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await panel
    .locator(`${grid} .grid-item`)
    .filter({ hasText: name })
    .first()
    .boundingBox()
  if (!box) throw new Error('找不到按压项目边界')
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    width: box.width,
    height: box.height
  }
  await panel.mouse.move(point.x, point.y)
  await panel.mouse.down()
  return point
}

test('末位项目停留 350ms 提示合并，预览不写库且松手保存', async () => {
  const initial = createPinnedItems(false)
  await withPanel(initial, async (panel) => {
    const gamma = await panel.locator('.pinned-grid .grid-item').nth(2).boundingBox()
    if (!gamma) throw new Error('缺少末位项目')
    await pressItem(panel, 'Alpha')
    await panel.mouse.move(gamma.x + gamma.width / 2, gamma.y + gamma.height / 2)
    await expect(panel.locator('.drag-preview')).toBeVisible()
    await expect(panel.locator('.merge-target')).toHaveCount(0)
    await expect(panel.locator('.merge-target .grid-name')).toHaveText('Gamma')
    expect(await readPersistedItems(panel)).toEqual(initial)
    await panel.screenshot({ path: test.info().outputPath('merge-preview.png') })
    await panel.mouse.up()
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([
        { name: 'Beta' },
        { isFolder: true, items: [{ name: 'Gamma' }, { name: 'Alpha' }] }
      ])
    await expect(panel.locator('.drag-preview')).toHaveCount(0)
    await expect(panel.locator('.folder-popup-panel')).toHaveCount(0)
  })
})

test('停留目标离开后清除合并反馈，回到空槽松手不会合并', async () => {
  const initial = createPinnedItems(false)
  await withPanel(initial, async (panel) => {
    const point = await pressItem(panel, 'Alpha')
    await panel.mouse.move(point.x + point.width + 2, point.y)
    await expect(panel.locator('.merge-target .grid-name')).toHaveText('Beta')
    await panel.mouse.move(point.x, point.y)
    await expect(panel.locator('.merge-target')).toHaveCount(0)
    await panel.waitForTimeout(400)
    await panel.mouse.up()
    expect(await readPersistedItems(panel)).toEqual(initial)
    await expect(panel.locator('.folder-icon')).toHaveCount(0)
  })
})

for (const reason of ['Escape', 'pointercancel', 'blur', 'data'] as const) {
  test(`拖拽通过 ${reason} 中断时清理预览且不写回旧列表`, async () => {
    const initial = createPinnedItems()
    await withPanel(initial, async (panel, app) => {
      const point = await pressItem(panel, 'Alpha')
      await panel.mouse.move(point.x + point.width + 2, point.y)
      await expect(panel.locator('.merge-target .grid-name')).toHaveText('Beta')
      if (reason === 'Escape') await panel.keyboard.press('Escape')
      else if (reason === 'data') {
        await app.evaluate(
          ({ webContents }, commands) => {
            webContents
              .getAllWebContents()
              .find((entry) => entry.getURL().includes('super-panel.html'))
              ?.send('super-panel-data', { type: 'pinned', commands, windowInfo: null })
          },
          [initial[3]]
        )
      } else {
        await panel.evaluate((type) => window.dispatchEvent(new Event(type)), reason)
      }
      await expect(panel.locator('.drag-preview')).toHaveCount(0)
      await expect(panel.locator('.merge-target')).toHaveCount(0)
      await panel.mouse.up()
      expect(await readPersistedItems(panel)).toEqual(initial)
      // 下一次点击仍可用，不能残留旧源项身份或捕获状态。
      await panel.locator('.pinned-grid .grid-item').filter({ hasText: 'Existing Folder' }).click()
      await expect(panel.locator('.folder-popup-grid .grid-item')).toHaveCount(2)
    })
  })
}

for (const merge of [false, true]) {
  test(`文件夹拖出后${merge ? '接续合并' : '插入顶层末尾'}，源文件夹自动解散`, async () => {
    const initial = createPinnedItems()
    await withPanel(initial, async (panel) => {
      await panel.locator('.pinned-grid .grid-item').filter({ hasText: 'Existing Folder' }).click()
      await expect(panel.locator('.folder-popup-grid .grid-item')).toHaveCount(2)
      await panel.waitForTimeout(300)
      const beta = await panel.locator('.pinned-grid .grid-item').nth(1).boundingBox()
      if (!beta) throw new Error('缺少合并目标')
      await pressItem(panel, 'Delta', '.folder-popup-grid')
      // 从弹窗直接跨到顶层；原文件夹数据仍保留到松手。
      await panel.mouse.move(beta.x + beta.width / 2, beta.y + beta.height / 2)
      await expect(panel.locator('.folder-popup-overlay')).toHaveClass(/dragged-out/)
      expect(await readPersistedItems(panel)).toEqual(initial)
      if (merge) await expect(panel.locator('.merge-target .grid-name')).toHaveText('Beta')
      else await panel.mouse.move(beta.x + beta.width / 2, beta.y + beta.height * 2.5)
      await panel.screenshot({ path: test.info().outputPath('folder-drag-out.png') })
      await panel.mouse.up()
      await expect(panel.locator('.folder-popup-panel')).toHaveCount(0)
      await expect
        .poll(() => readPersistedItems(panel))
        .toMatchObject(
          merge
            ? [
                { name: 'Alpha' },
                { isFolder: true, items: [{ name: 'Beta' }, { name: 'Delta' }] },
                { name: 'Gamma' },
                { name: 'Epsilon' }
              ]
            : [
                { name: 'Alpha' },
                { name: 'Beta' },
                { name: 'Gamma' },
                { name: 'Epsilon' },
                { name: 'Delta' }
              ]
        )
    })
  })
}

test('文件夹拖出后 Escape 取消会恢复原弹窗和所有项目', async () => {
  const initial = createPinnedItems()
  await withPanel(initial, async (panel) => {
    await panel.locator('.pinned-grid .grid-item').filter({ hasText: 'Existing Folder' }).click()
    await expect(panel.locator('.folder-popup-grid .grid-item')).toHaveCount(2)
    await panel.waitForTimeout(300)
    await pressItem(panel, 'Delta', '.folder-popup-grid')
    await panel.mouse.move(125, 90)
    await expect(panel.locator('.folder-popup-overlay')).toHaveClass(/dragged-out/)
    await panel.keyboard.press('Escape')
    await panel.mouse.up()
    await expect(panel.locator('.folder-popup-overlay')).not.toHaveClass(/dragged-out/)
    await expect(panel.locator('.folder-popup-grid .grid-item')).toHaveCount(2)
    expect(await readPersistedItems(panel)).toEqual(initial)
  })
})

test('跨行拖拽在底部自动滚动，取消后原顺序保持不变', async () => {
  const initial: TestPinnedItem[] = Array.from({ length: 24 }, (_, index) => ({
    name: `Item ${index}`,
    path: `e2e:item-${index}`,
    type: 'builtin',
    cmdType: 'text'
  }))
  await withPanel(initial, async (panel) => {
    const grid = panel.locator('.pinned-grid')
    const box = await grid.boundingBox()
    if (!box) throw new Error('缺少滚动容器')
    await pressItem(panel, 'Item 0')
    await panel.mouse.move(box.x + box.width / 2, box.y + box.height - 10, { steps: 12 })
    await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(100)
    await panel.keyboard.press('Escape')
    await panel.mouse.up()
    expect(await readPersistedItems(panel)).toEqual(initial)
    const stopped = await grid.evaluate((element) => element.scrollTop)
    await panel.waitForTimeout(100)
    expect(await grid.evaluate((element) => element.scrollTop)).toBe(stopped)
  })
})

test('拖动普通项目到普通项目会创建文件夹并保存', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-merge-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems(false))
    await dragItemToItem(panel, 'Alpha', 'Beta')

    await expect(panel.locator('.folder-icon')).toHaveCount(1)
    await expect(panel.locator('.grid-item')).toHaveCount(2)
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([
        { isFolder: true, items: [{ name: 'Beta' }, { name: 'Alpha' }] },
        { name: 'Gamma' }
      ])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('拖动普通项目到已有文件夹会加入文件夹', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-folder-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems())
    await dragItemToItem(panel, 'Gamma', 'Existing Folder')

    await expect(panel.locator('.grid-item')).toHaveCount(3)
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([
        { name: 'Alpha' },
        { name: 'Beta' },
        { isFolder: true, items: [{ name: 'Delta' }, { name: 'Epsilon' }, { name: 'Gamma' }] }
      ])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('合并后打开文件夹可以看到完整的项目内容', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-cross-list-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems())
    await dragItemToItem(panel, 'Gamma', 'Existing Folder')
    await panel.waitForTimeout(180)
    await panel.locator('.grid-item').filter({ hasText: 'Existing Folder' }).click()
    await expect(panel.locator('.folder-popup-panel')).toBeVisible()
    await expect(panel.locator('.folder-popup-grid .grid-item')).toHaveCount(3)
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([
        { name: 'Alpha' },
        { name: 'Beta' },
        { isFolder: true, items: [{ name: 'Delta' }, { name: 'Epsilon' }, { name: 'Gamma' }] }
      ])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('文件夹拖动只会调整顶层顺序，不会产生嵌套文件夹', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-reorder-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems())
    await dragItemToItemQuickly(panel, 'Existing Folder', 'Alpha')

    await expect(panel.locator('.folder-icon')).toHaveCount(1)
    await expect(panel.locator('.grid-item')).toHaveCount(4)
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([
        { isFolder: true, items: [{ name: 'Delta' }, { name: 'Epsilon' }] },
        { name: 'Alpha' },
        { name: 'Beta' },
        { name: 'Gamma' }
      ])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('普通项目拖到目标左上边缘仍然可以稳定合并', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-edge-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems(false))
    await dragItemToItemAt(panel, 'Alpha', 'Beta', 'top-left')

    await expect(panel.locator('.folder-icon')).toHaveCount(1)
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([
        { isFolder: true, items: [{ name: 'Beta' }, { name: 'Alpha' }] },
        { name: 'Gamma' }
      ])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('多段移动后回到目标仍能识别合并', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-multistep-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems(false))
    const source = panel.locator('.grid-item').filter({ hasText: 'Alpha' }).first()
    const target = panel.locator('.grid-item').filter({ hasText: 'Beta' }).first()
    const other = panel.locator('.grid-item').filter({ hasText: 'Gamma' }).first()
    const sourceBox = await source.boundingBox()
    const targetBox = await target.boundingBox()
    const otherBox = await other.boundingBox()
    if (!sourceBox || !targetBox || !otherBox) throw new Error('无法获取多段拖拽项目边界')

    await pageMouseDragWithWaypoints(panel, sourceBox, [
      { x: otherBox.x + otherBox.width / 2, y: otherBox.y + otherBox.height / 2 },
      { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }
    ])

    await expect(panel.locator('.folder-icon')).toHaveCount(1)
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([
        { isFolder: true, items: [{ name: 'Beta' }, { name: 'Alpha' }] },
        { name: 'Gamma' }
      ])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('普通项目快速越过末尾项目会排序而不是合并', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-sort-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems(false))
    await dragItemToItemQuickly(panel, 'Alpha', 'Gamma')

    await expect(panel.locator('.folder-icon')).toHaveCount(0)
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([{ name: 'Beta' }, { name: 'Gamma' }, { name: 'Alpha' }])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('普通项目从后往前移动后按尾随空槽排序', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-reverse-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems(false))
    await dragItemToItemQuickly(panel, 'Gamma', 'Alpha')

    await expect(panel.locator('.folder-icon')).toHaveCount(0)
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([{ name: 'Gamma' }, { name: 'Alpha' }, { name: 'Beta' }])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('排序拖动过程中中间项目会使用固定槽位平滑让位', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-animation-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems(false))
    const source = panel.locator('.grid-item').filter({ hasText: 'Alpha' }).first()
    const target = panel.locator('.grid-item').filter({ hasText: 'Gamma' }).first()
    const sourceBox = await source.boundingBox()
    const targetBox = await target.boundingBox()
    if (!sourceBox || !targetBox) throw new Error('无法获取排序动画项目边界')

    await panel.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
    await panel.mouse.down()
    await panel.waitForTimeout(80)
    await panel.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 8
    })
    await panel.waitForTimeout(40)

    await expect(panel.locator('.drag-preview')).toBeVisible()
    const beta = panel.locator('.grid-item').filter({ hasText: 'Beta' }).first()
    await expect
      .poll(() => beta.evaluate((element) => (element as HTMLElement).style.transform))
      .toContain('translate3d')
    await expect
      .poll(() => beta.evaluate((element) => (element as HTMLElement).style.transitionDuration))
      .toBe('300ms')

    await panel.mouse.up()
    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([{ name: 'Beta' }, { name: 'Alpha' }, { name: 'Gamma' }])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

/**
 * 按多个中间点执行一次鼠标拖拽。
 * @param page 超级面板页面
 * @param sourceBox 来源项目边界
 * @param waypoints 拖拽经过的中间点
 * @returns 拖拽操作完成后结束的 Promise
 */
async function pageMouseDragWithWaypoints(
  page: Page,
  sourceBox: { x: number; y: number; width: number; height: number },
  waypoints: Array<{ x: number; y: number }>
): Promise<void> {
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(120)
  for (const waypoint of waypoints) {
    await page.mouse.move(waypoint.x, waypoint.y)
    await page.waitForTimeout(500)
  }
  await page.mouse.up()
}

test('轻微点击文件夹仍然打开弹窗，不会误判为拖拽', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-click-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems())
    const folder = panel.locator('.grid-item').filter({ hasText: 'Existing Folder' }).first()
    const box = await folder.boundingBox()
    if (!box) throw new Error('无法获取文件夹边界')

    await panel.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await panel.mouse.down()
    await panel.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 2)
    await panel.mouse.up()

    await expect(panel.locator('.folder-popup-panel')).toBeVisible()
    await expect(panel.locator('.folder-popup-grid .grid-item')).toHaveCount(2)
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})

test('文件夹弹窗内拖动项目会调整顺序并保存', async () => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-super-panel-dnd-folder-sort-'))
  const legacyRoot = path.join(dataRoot, 'legacy')
  let electronApp: ElectronApplication | null = null

  await fs.mkdir(legacyRoot, { recursive: true })
  try {
    electronApp = await launchTestApp(dataRoot, legacyRoot)
    const panel = await openSuperPanel(electronApp, createPinnedItems())
    await panel.locator('.grid-item').filter({ hasText: 'Existing Folder' }).click()
    await expect(panel.locator('.folder-popup-panel')).toBeVisible()
    await panel.waitForTimeout(320)
    await dragFolderItemToItem(panel, 'Delta', 'Epsilon')

    await expect
      .poll(() => readPersistedItems(panel))
      .toMatchObject([
        { name: 'Alpha' },
        { name: 'Beta' },
        { name: 'Gamma' },
        { isFolder: true, items: [{ name: 'Epsilon' }, { name: 'Delta' }] }
      ])
  } finally {
    await electronApp?.close()
    await fs.rm(dataRoot, { recursive: true, force: true })
  }
})
