import { describe, expect, it } from 'vitest'
import { isZToolsCliWake } from '../../src/main/core/cliWake'

describe('isZToolsCliWake', () => {
  it('参数列表中单独出现 --ztools-wake 时返回 true', () => {
    expect(isZToolsCliWake(['--ztools-wake'])).toBe(true)
  })

  it('--ztools-wake 出现在任意位置都返回 true', () => {
    expect(isZToolsCliWake(['/opt/ZTools/ztools', '--ztools-wake'])).toBe(true)
    expect(isZToolsCliWake(['--ztools-wake', '/path/to/plugin.zpx'])).toBe(true)
    expect(isZToolsCliWake(['/project', '--foo', '--ztools-wake', '--bar'])).toBe(true)
  })

  it('大小写敏感，其他相近参数不会被误判', () => {
    expect(isZToolsCliWake(['--ZTOOLS-WAKE'])).toBe(false)
    expect(isZToolsCliWake(['--ztools-wake=1'])).toBe(false)
  })

  it('不包含唤醒参数（含 .zpx 路径）时返回 false', () => {
    expect(isZToolsCliWake(['/project', '/path/to/plugin.zpx'])).toBe(false)
    expect(isZToolsCliWake([])).toBe(false)
  })
})
