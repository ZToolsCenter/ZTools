import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  screen: { getPrimaryDisplay: vi.fn() }
}))
vi.mock('../../src/main/managers/windowManager.js', () => ({
  default: { getMainWindow: vi.fn() }
}))

import internalApiRequestDialog from '../../src/main/api/plugin/internalApiRequestDialog'

/**
 * 执行宿主实际生成的弹窗脚本，用最小 DOM 外壳观察按钮状态和发送内容。
 * @param apis 弹窗默认勾选的申请通道
 * @returns 按钮状态、可触发 change 的勾选项和 IPC 发送记录
 */
function loadDialogScript(apis: string[]): {
  approve: { disabled: boolean; textContent: string }
  boxes: {
    value: string
    checked: boolean
    addEventListener: (event: string, handler: () => void) => Map<string, () => void>
  }[]
  handlers: Map<string, () => void>
  send: ReturnType<typeof vi.fn>
} {
  const renderer = internalApiRequestDialog as unknown as {
    generateDialogHTML: (
      item: { pluginName: string; entry: { apis: string[] } },
      isDark: boolean
    ) => string
  }
  const html = renderer.generateDialogHTML({ pluginName: 'test-plugin', entry: { apis } }, false)
  const buttons = new Map<string, { disabled: boolean; textContent: string }>()
  const handlers = new Map<string, () => void>()
  const send = vi.fn()
  const boxes = apis.map((value) => ({
    value,
    checked: true,
    addEventListener: (_event: string, handler: () => void) => handlers.set(value, handler)
  }))
  // 保留 HTML 的初始 disabled，避免测试夹具意外替宿主初始化按钮。
  const approve = {
    disabled: html.includes('popup-approve" disabled'),
    textContent: html.match(/data-testid="popup-approve"[^>]*>([^<]*)</)![1]
  }
  buttons.set('[data-testid="popup-approve"]', approve)
  for (const name of ['popup-reject', 'popup-later']) {
    buttons.set(`[data-testid="${name}"]`, { disabled: false, textContent: '' })
  }
  const document = {
    querySelector: (selector: string) => ({
      ...buttons.get(selector),
      get disabled() {
        return buttons.get(selector)!.disabled
      },
      set disabled(value: boolean) {
        buttons.get(selector)!.disabled = value
      },
      get textContent() {
        return buttons.get(selector)!.textContent
      },
      set textContent(value: string) {
        buttons.get(selector)!.textContent = value
      },
      addEventListener: (_event: string, handler: () => void) => handlers.set(selector, handler)
    }),
    querySelectorAll: () => boxes
  }
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  expect(script).toBeTruthy()
  runInNewContext(script!, { document, require: () => ({ ipcRenderer: { send } }) })
  return { approve, boxes, handlers, send }
}

describe('internal API request dialog initial selection', () => {
  it('enables approval immediately for all initially checked APIs', () => {
    const page = loadDialogScript(['internal:db-get', 'internal:db-put'])
    expect(page.approve.disabled).toBe(false)
    expect(page.approve.textContent).toBe('批准所选（2）')
    expect(page.send).not.toHaveBeenCalled()
    page.handlers.get('[data-testid="popup-approve"]')!()
    expect(page.send).toHaveBeenCalledWith('internal-api-request-dialog:resolve', {
      action: 'approve',
      apis: ['internal:db-get', 'internal:db-put']
    })
  })

  it('enables approval immediately for a single requested API', () => {
    const page = loadDialogScript(['internal:db-get'])
    expect(page.approve.disabled).toBe(false)
    expect(page.approve.textContent).toBe('批准所选（1）')
  })

  it('keeps partial approval limited to the selected API', () => {
    const page = loadDialogScript(['internal:db-get', 'internal:db-put'])
    page.boxes[1].checked = false
    page.handlers.get('internal:db-put')!()
    expect(page.approve.disabled).toBe(false)
    expect(page.approve.textContent).toBe('批准所选（1）')
    page.handlers.get('[data-testid="popup-approve"]')!()
    expect(page.send).toHaveBeenCalledWith('internal-api-request-dialog:resolve', {
      action: 'approve',
      apis: ['internal:db-get']
    })
  })

  it('disables approval when nothing is selected and enables it after reselection', () => {
    const page = loadDialogScript(['internal:db-get'])
    page.boxes[0].checked = false
    page.handlers.get('internal:db-get')!()
    expect(page.approve.disabled).toBe(true)
    page.handlers.get('[data-testid="popup-approve"]')!()
    expect(page.send).not.toHaveBeenCalled()
    page.boxes[0].checked = true
    page.handlers.get('internal:db-get')!()
    expect(page.approve.disabled).toBe(false)
    expect(page.approve.textContent).toBe('批准所选（1）')
  })

  it('keeps an empty request disabled without sending an approval', () => {
    const page = loadDialogScript([])
    expect(page.approve.disabled).toBe(true)
    expect(page.approve.textContent).toBe('批准所选')
    expect(page.send).not.toHaveBeenCalled()
  })
})
