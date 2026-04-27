import { describe, it, expect } from 'vitest'
import {
  getCommandId,
  applySpecialConfig,
  calculateMatchScore
} from '../../src/renderer/src/stores/commandUtils'

// ========== getCommandId ==========

describe('getCommandId', () => {
  it('应生成完整格式的插件 ID', () => {
    const cmd = {
      name: '翻译',
      path: '/plugins/translate',
      pluginName: 'translate-plugin',
      featureCode: 'translate',
      cmdType: 'regex' as const
    }
    expect(getCommandId(cmd)).toBe('translate-plugin:translate:翻译:regex')
  })

  it('direct/app 应使用基于 path 的稳定 ID', () => {
    const cmd = {
      name: 'App',
      path: 'C:\\app.exe',
      type: 'direct' as const,
      subType: 'app' as const
    }
    expect(getCommandId(cmd)).toBe('direct:app:C:/app.exe')
  })

  it('cmdType 为 undefined 时插件应默认为 text', () => {
    const cmd = {
      name: '功能',
      path: '/plugin',
      pluginName: 'test',
      featureCode: 'feat'
    }
    expect(getCommandId(cmd)).toBe('test:feat:功能:text')
  })

  it('应正确处理 over 类型', () => {
    const cmd = {
      name: '超级面板',
      path: '/plugin',
      pluginName: 'sp',
      featureCode: 'panel',
      cmdType: 'over' as const
    }
    expect(getCommandId(cmd)).toBe('sp:panel:超级面板:over')
  })

  it('应将安装版和开发版同名命令使用不同 pluginName 区分', () => {
    const installed = getCommandId({
      name: '优秀待办',
      path: '/Applications/ExcellentTodo',
      pluginName: 'excellent-todo',
      featureCode: 'open'
    })
    const development = getCommandId({
      name: '优秀待办',
      path: '/workspace/excellent-todo',
      pluginName: 'excellent-todo__dev',
      featureCode: 'open'
    })

    expect(installed).not.toBe(development)
  })

  it('应将 Windows 反斜杠路径规范化为稳定 ID', () => {
    const winPath = getCommandId({
      name: '记事本',
      path: 'C:\\Windows\\System32\\notepad.exe',
      type: 'direct' as const,
      subType: 'app' as const
    })
    const normalizedPath = getCommandId({
      name: '记事本',
      path: 'C:/Windows/System32/notepad.exe',
      type: 'direct' as const,
      subType: 'app' as const
    })

    expect(winPath).toBe(normalizedPath)
  })

  it('应区分同名但不同路径的系统应用', () => {
    const first = getCommandId({
      name: '微信',
      path: 'C:\\Program Files\\Tencent\\WeChat.exe',
      type: 'direct' as const,
      subType: 'app' as const
    })
    const second = getCommandId({
      name: '微信',
      path: 'D:\\Portable\\WeChat.exe',
      type: 'direct' as const,
      subType: 'app' as const
    })

    expect(first).not.toBe(second)
  })
})

// ========== applySpecialConfig ==========

describe('applySpecialConfig', () => {
  const specialCommands = {
    'special:last-match': {
      name: '上次匹配',
      icon: 'arrow-icon',
      type: 'builtin'
    },
    'subType:system-setting': {
      icon: 'settings-icon'
    }
  }

  it('应通过 path 精确匹配并合并配置', () => {
    const cmd = { name: 'old', path: 'special:last-match', type: 'app' }
    const result = applySpecialConfig(cmd, specialCommands as any)
    expect(result.name).toBe('上次匹配')
    expect(result.icon).toBe('arrow-icon')
    expect(result.type).toBe('builtin')
    expect(result.path).toBe('special:last-match')
  })

  it('应通过 subType 匹配并合并配置', () => {
    const cmd = { name: '蓝牙设置', path: 'ms-settings:bluetooth', subType: 'system-setting' }
    const result = applySpecialConfig(cmd, specialCommands as any)
    expect(result.icon).toBe('settings-icon')
    expect(result.name).toBe('蓝牙设置')
  })

  it('path 匹配应优先于 subType 匹配', () => {
    const cmd = {
      name: 'test',
      path: 'special:last-match',
      subType: 'system-setting'
    }
    const result = applySpecialConfig(cmd, specialCommands as any)
    expect(result.name).toBe('上次匹配')
    expect(result.icon).toBe('arrow-icon')
  })

  it('无匹配时应原样返回', () => {
    const cmd = { name: 'Chrome', path: 'C:\\chrome.exe' }
    const result = applySpecialConfig(cmd, specialCommands as any)
    expect(result).toEqual(cmd)
  })

  it('不应修改原始对象', () => {
    const cmd = { name: 'old', path: 'special:last-match', type: 'app' }
    const original = { ...cmd }
    applySpecialConfig(cmd, specialCommands as any)
    expect(cmd).toEqual(original)
  })
})

// ========== calculateMatchScore ==========

describe('calculateMatchScore', () => {
  const makeMatch = (indices: Array<[number, number]>): any[] => [
    { indices, value: 'test', key: 'name' }
  ]

  it('完全匹配应返回 10000', () => {
    const score = calculateMatchScore('chrome', 'chrome', makeMatch([[0, 5]]))
    expect(score).toBe(10000)
  })

  it('完全匹配应不区分大小写', () => {
    const score = calculateMatchScore('Chrome', 'chrome', makeMatch([[0, 5]]))
    expect(score).toBe(10000)
  })

  it('前缀匹配应获得高分（>5000）', () => {
    const score = calculateMatchScore('chrome browser', 'chrome', makeMatch([[0, 5]]))
    expect(score).toBeGreaterThan(5000)
  })

  it('连续匹配应获得中等分数', () => {
    const score = calculateMatchScore('google chrome', 'chrome', makeMatch([[7, 12]]))
    expect(score).toBeGreaterThan(2000)
  })

  it('连续匹配靠前时分数应更高', () => {
    const scoreEarly = calculateMatchScore(
      'chrome browser extension',
      'chrome',
      makeMatch([[0, 5]])
    )
    const scoreLate = calculateMatchScore('google chrome browser', 'chrome', makeMatch([[7, 12]]))
    expect(scoreEarly).toBeGreaterThan(scoreLate)
  })

  it('无匹配信息时应返回 0', () => {
    expect(calculateMatchScore('chrome browser', 'firefox')).toBe(0)
    expect(calculateMatchScore('chrome browser', 'firefox', [])).toBe(0)
  })

  it('匹配长度占比越高分数越高', () => {
    const scoreShort = calculateMatchScore('a very long application name', 'a', makeMatch([[0, 0]]))
    const scoreLong = calculateMatchScore('chrome', 'chrom', makeMatch([[0, 4]]))
    expect(scoreLong).toBeGreaterThan(scoreShort)
  })
})
