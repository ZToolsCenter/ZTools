import { describe, it, expect } from 'vitest'
import {
  findCommandIndex,
  filterOutCommand,
  hasCommand
} from '../../src/main/api/renderer/commandMatchers'

// ========== findCommandIndex ==========

describe('findCommandIndex', () => {
  const list = [
    { name: '原神', path: 'C:\\launcher.exe', type: 'direct', subType: 'app' },
    { name: '米哈游启动器', path: 'C:\\launcher.exe', type: 'direct', subType: 'app' },
    { name: 'Chrome', path: 'C:\\chrome.exe', type: 'direct', subType: 'app' },
    { name: '旧版记事本', path: 'C:\\notepad.exe', type: 'app' },
    {
      name: '翻译',
      path: '/plugins/translate',
      type: 'plugin',
      featureCode: 'translate',
      pluginName: 'translate'
    },
    {
      name: '词典',
      path: '/plugins/translate',
      type: 'plugin',
      featureCode: 'dict',
      pluginName: 'translate'
    },
    {
      name: '翻译',
      path: '/workspace/translate',
      type: 'plugin',
      featureCode: 'translate',
      pluginName: 'translate__dev'
    }
  ]

  describe('direct/app 类型', () => {
    it('应同时匹配 name 和 path', () => {
      const idx = findCommandIndex(list, 'C:\\launcher.exe', 'app', undefined, '原神')
      expect(idx).toBe(0)
    })

    it('应区分同路径不同名的应用', () => {
      const idx = findCommandIndex(list, 'C:\\launcher.exe', 'app', undefined, '米哈游启动器')
      expect(idx).toBe(1)
    })

    it('路径匹配但名称不匹配时应返回 -1', () => {
      const idx = findCommandIndex(list, 'C:\\launcher.exe', 'app', undefined, '不存在的名称')
      expect(idx).toBe(-1)
    })

    it('未传 name 时应降级为仅匹配 path', () => {
      const idx = findCommandIndex(list, 'C:\\launcher.exe', 'app')
      expect(idx).toBe(0)
    })

    it('应兼容旧版 type: app 的 direct/app 记录', () => {
      const idx = findCommandIndex(list, 'C:\\notepad.exe', 'app', undefined, '旧版记事本')
      expect(idx).toBe(3)
    })
  })

  describe('插件类型', () => {
    it('应匹配 path + featureCode', () => {
      const idx = findCommandIndex(list, '/plugins/translate', 'plugin', 'translate')
      expect(idx).toBe(4)
    })

    it('应区分同路径不同 featureCode 的插件', () => {
      const idx = findCommandIndex(list, '/plugins/translate', 'plugin', 'dict')
      expect(idx).toBe(5)
    })

    it('featureCode 不匹配时应返回 -1', () => {
      const idx = findCommandIndex(list, '/plugins/translate', 'plugin', 'nonexistent')
      expect(idx).toBe(-1)
    })

    it('应按 pluginName（含__dev后缀）区分安装版与开发版', () => {
      const idx = findCommandIndex(list, '/anywhere', 'plugin', 'translate', 'translate__dev')
      expect(idx).toBe(6)
    })
  })

  it('列表为空时应返回 -1', () => {
    expect(findCommandIndex([], 'any', 'app', undefined, 'any')).toBe(-1)
  })
})

// ========== filterOutCommand ==========

describe('filterOutCommand', () => {
  describe('direct/app 类型', () => {
    it('应只过滤匹配 name + path 的项', () => {
      const list = [
        { name: '原神', path: 'C:\\launcher.exe', type: 'direct', subType: 'app' },
        { name: '米哈游启动器', path: 'C:\\launcher.exe', type: 'direct', subType: 'app' },
        { name: 'Chrome', path: 'C:\\chrome.exe', type: 'direct', subType: 'app' }
      ]
      const result = filterOutCommand(list, 'C:\\launcher.exe', undefined, '原神')
      expect(result).toHaveLength(2)
      expect(result.map((i) => i.name)).toEqual(['米哈游启动器', 'Chrome'])
    })

    it('没有 name 参数时应按纯路径匹配', () => {
      const list = [
        { name: '原神', path: 'C:\\launcher.exe', type: 'direct', subType: 'app' },
        { name: '米哈游启动器', path: 'C:\\launcher.exe', type: 'direct', subType: 'app' }
      ]
      const result = filterOutCommand(list, 'C:\\launcher.exe')
      expect(result).toHaveLength(0)
    })

    it('应兼容删除旧版 type: app 的 direct/app 记录', () => {
      const list = [
        { name: '旧版记事本', path: 'C:\\notepad.exe', type: 'app' },
        { name: '新版记事本', path: 'C:\\notepad.exe', type: 'direct', subType: 'app' }
      ]
      const result = filterOutCommand(list, 'C:\\notepad.exe', undefined, '旧版记事本')
      expect(result).toEqual([
        { name: '新版记事本', path: 'C:\\notepad.exe', type: 'direct', subType: 'app' }
      ])
    })
  })

  describe('插件类型', () => {
    it('应只过滤匹配 path + featureCode 的插件', () => {
      const list = [
        {
          name: '翻译',
          path: '/plugins/translate',
          type: 'plugin',
          featureCode: 'translate',
          pluginName: 'translate'
        },
        {
          name: '词典',
          path: '/plugins/translate',
          type: 'plugin',
          featureCode: 'dict',
          pluginName: 'translate'
        }
      ]
      const result = filterOutCommand(list, '/plugins/translate', 'translate')
      expect(result).toHaveLength(1)
      expect(result[0].featureCode).toBe('dict')
    })

    it('应按 pluginName(__dev 后缀) 区分安装版与开发版，仅删除对应变体', () => {
      const list = [
        {
          name: '优秀待办',
          path: '/Applications/ExcellentTodo',
          type: 'plugin',
          featureCode: 'open',
          pluginName: 'excellent-todo'
        },
        {
          name: '优秀待办',
          path: '/workspace/excellent-todo',
          type: 'plugin',
          featureCode: 'open',
          pluginName: 'excellent-todo__dev'
        }
      ]
      const result = filterOutCommand(list, '/anywhere', 'open', 'excellent-todo__dev')
      expect(result).toHaveLength(1)
      expect(result[0].pluginName).toBe('excellent-todo')
    })
  })
})

// ========== hasCommand ==========

describe('hasCommand', () => {
  const list = [
    { name: '原神', path: 'C:\\launcher.exe', type: 'direct', subType: 'app' },
    { name: '米哈游启动器', path: 'C:\\launcher.exe', type: 'direct', subType: 'app' },
    {
      name: '翻译',
      path: '/plugins/translate',
      type: 'plugin',
      featureCode: 'translate',
      pluginName: 'translate'
    },
    {
      name: '翻译',
      path: '/workspace/translate',
      type: 'plugin',
      featureCode: 'translate',
      pluginName: 'translate__dev'
    }
  ]

  it('应找到匹配 name + path 的 direct/app 项', () => {
    expect(hasCommand(list, 'C:\\launcher.exe', undefined, '原神')).toBe(true)
  })

  it('应区分同路径不同名的应用', () => {
    expect(hasCommand(list, 'C:\\launcher.exe', undefined, '米哈游启动器')).toBe(true)
    expect(hasCommand(list, 'C:\\launcher.exe', undefined, '不存在')).toBe(false)
  })

  it('应找到匹配 path + featureCode 的插件项', () => {
    expect(hasCommand(list, '/plugins/translate', 'translate')).toBe(true)
    expect(hasCommand(list, '/plugins/translate', 'nonexistent')).toBe(false)
  })

  it('应按 pluginName(__dev 后缀) 区分安装版与开发版', () => {
    expect(hasCommand(list, '/anywhere', 'translate', 'translate__dev')).toBe(true)
    expect(hasCommand(list, '/anywhere', 'translate', 'translate')).toBe(true)
    expect(hasCommand(list, '/anywhere', 'translate', 'nonexistent__dev')).toBe(false)
  })

  it('未传 name 时 direct/app 应降级为仅匹配 path', () => {
    expect(hasCommand(list, 'C:\\launcher.exe')).toBe(true)
    expect(hasCommand(list, 'C:\\nonexistent.exe')).toBe(false)
  })

  it('应兼容旧版 type: app 的 direct/app 记录', () => {
    expect(
      hasCommand(
        [{ name: '旧版记事本', path: 'C:\\notepad.exe', type: 'app' }],
        'C:\\notepad.exe',
        undefined,
        '旧版记事本'
      )
    ).toBe(true)
  })

  it('列表为空时应返回 false', () => {
    expect(hasCommand([], 'any', undefined, 'any')).toBe(false)
  })
})

describe('plugin variant matching', () => {
  const list = [
    {
      name: '优秀待办',
      path: '/Applications/ExcellentTodo',
      type: 'plugin',
      pluginName: 'excellent-todo',
      featureCode: 'open'
    },
    {
      name: '优秀待办',
      path: '/workspace/excellent-todo',
      type: 'plugin',
      pluginName: 'excellent-todo__dev',
      featureCode: 'open'
    }
  ]

  it('matches plugin commands by pluginName(_dev suffix)', () => {
    const index = findCommandIndex(list, '/anywhere', 'plugin', 'open', 'excellent-todo__dev')
    expect(index).toBe(1)
  })

  it('keeps old records readable when pluginName is missing', () => {
    expect(
      hasCommand(
        [{ path: '/Applications/ExcellentTodo', type: 'plugin', featureCode: 'open' }],
        '/Applications/ExcellentTodo',
        'open'
      )
    ).toBe(true)
  })

  it('matches plugin variants by pluginName when path changes', () => {
    expect(
      hasCommand(
        [
          {
            path: '/old/workspace/excellent-todo',
            type: 'plugin',
            pluginName: 'excellent-todo__dev',
            featureCode: 'open'
          }
        ],
        '/new/workspace/excellent-todo',
        'open',
        'excellent-todo__dev'
      )
    ).toBe(true)
  })
})
