import { describe, expect, it } from 'vitest'
import {
  matchesFilesInput,
  matchesOverText,
  matchesRegexText,
  matchesWindowInput,
  parseMatchPattern
} from '../../src/shared/commandContextShared'

describe('commandContextShared', () => {
  describe('parseMatchPattern', () => {
    it('保留 flags 解析标准正则字符串', () => {
      const regex = parseMatchPattern('/hello/gi', { preserveFlags: true })
      expect(regex?.flags).toBe('gi')
      expect(regex?.test('HELLO')).toBe(true)
    })

    it('可按需丢弃 flags', () => {
      const regex = parseMatchPattern('/hello/i', { preserveFlags: false })
      expect(regex?.flags).toBe('')
      expect(regex?.test('HELLO')).toBe(false)
      expect(regex?.test('hello')).toBe(true)
    })

    it('允许普通字符串回退为正则', () => {
      const regex = parseMatchPattern('\\.txt$', { allowPlainString: true })
      expect(regex?.test('readme.txt')).toBe(true)
    })

    it('无效正则返回 null', () => {
      expect(parseMatchPattern('/[a-/')).toBeNull()
    })
  })

  describe('matchesRegexText', () => {
    it('按最小长度和正则匹配文本', () => {
      expect(
        matchesRegexText('https://claude.ai', {
          type: 'regex',
          match: '/^https?:\\/\\//',
          minLength: 3
        })
      ).toBe(true)
    })

    it('preserveFlags=false 时保持当前 query 搜索语义', () => {
      expect(
        matchesRegexText('HELLO', {
          type: 'regex',
          match: '/hello/i',
          minLength: 1
        })
      ).toBe(false)
    })

    it('preserveFlags=true 时支持 flags', () => {
      expect(
        matchesRegexText(
          'HELLO',
          {
            type: 'regex',
            match: '/hello/i',
            minLength: 1
          },
          { preserveFlags: true }
        )
      ).toBe(true)
    })
  })

  describe('matchesOverText', () => {
    it('按长度范围匹配文本', () => {
      expect(
        matchesOverText('abc', {
          type: 'over',
          minLength: 1,
          maxLength: 5
        })
      ).toBe(true)
    })

    it('启用 exclude 时可排除命中', () => {
      expect(
        matchesOverText(
          'hello123',
          {
            type: 'over',
            minLength: 1,
            maxLength: 20,
            exclude: '/\\d+/'
          },
          { useExclude: true, preserveExcludeFlags: true, allowPlainExclude: true }
        )
      ).toBe(false)
    })

    it('不启用 exclude 时保持 searchTextCommands 现有语义', () => {
      expect(
        matchesOverText('hello123', {
          type: 'over',
          minLength: 1,
          maxLength: 20,
          exclude: '/\\d+/'
        })
      ).toBe(true)
    })
  })

  describe('matchesFilesInput', () => {
    const files = [
      { path: 'C:/demo/a.txt', name: 'a.txt', isDirectory: false },
      { path: 'C:/demo/b.txt', name: 'b.txt', isDirectory: false }
    ]

    it('按数量、类型与扩展名匹配文件', () => {
      expect(
        matchesFilesInput(files, {
          type: 'files',
          fileType: 'file',
          extensions: ['txt'],
          minLength: 2,
          maxLength: 2
        })
      ).toBe(true)
    })

    it('支持正则文件名匹配并保留 flags', () => {
      expect(
        matchesFilesInput(
          [{ path: 'C:/demo/README.TXT', name: 'README.TXT', isDirectory: false }],
          {
            type: 'files',
            match: '/\\.txt$/i',
            minLength: 1,
            maxLength: 1
          },
          { preserveFlags: true }
        )
      ).toBe(true)
    })

    it('非正则格式按需回退到 includes', () => {
      expect(
        matchesFilesInput(
          [{ path: 'C:/demo/plugin.zpx', name: 'plugin.zpx', isDirectory: false }],
          {
            type: 'files',
            match: '.zpx',
            minLength: 1,
            maxLength: 1
          },
          { allowPlainString: true }
        )
      ).toBe(true)
    })
  })

  describe('matchesWindowInput', () => {
    it('支持 app + className 匹配', () => {
      expect(
        matchesWindowInput(
          { app: 'explorer.exe', className: 'CabinetWClass' },
          {
            type: 'window',
            match: {
              app: ['explorer.exe'],
              className: ['CabinetWClass']
            }
          }
        )
      ).toBe(true)
    })

    it('支持 title 正则匹配', () => {
      expect(
        matchesWindowInput(
          { title: 'Claude Code - Workspace' },
          {
            type: 'window',
            match: {
              title: '/Claude\\s+Code/'
            }
          },
          {
            preserveTitleFlags: false
          }
        )
      ).toBe(true)
    })

    it('支持普通字符串 title 匹配', () => {
      expect(
        matchesWindowInput(
          { title: 'Project - Claude Code' },
          {
            type: 'window',
            match: {
              title: 'Claude Code'
            }
          }
        )
      ).toBe(true)
    })

    it('app 未命中时可由 title 命中', () => {
      expect(
        matchesWindowInput(
          { app: 'notepad.exe', title: 'Project - Claude Code' },
          {
            type: 'window',
            match: {
              app: ['explorer.exe'],
              title: '/Claude\\s+Code/'
            }
          }
        )
      ).toBe(true)
    })
  })
})
