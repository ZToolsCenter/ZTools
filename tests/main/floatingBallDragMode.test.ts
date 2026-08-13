import { describe, expect, it } from 'vitest'
import { shouldShowFloatingBallMoveMenu } from '../../src/main/core/floatingBallDragMode'

describe('shouldShowFloatingBallMoveMenu', () => {
  it('Linux + Wayland + 已开启 CSS 拖拽时返回 true', () => {
    expect(shouldShowFloatingBallMoveMenu(true, true, true)).toBe(true)
  })

  it('任一条件缺失时返回 false', () => {
    // 非 Linux
    expect(shouldShowFloatingBallMoveMenu(false, true, true)).toBe(false)
    // 非 Wayland 会话（X11）
    expect(shouldShowFloatingBallMoveMenu(true, false, true)).toBe(false)
    // 设置中未开启 CSS 拖拽
    expect(shouldShowFloatingBallMoveMenu(true, true, false)).toBe(false)
    // 全部条件均不满足
    expect(shouldShowFloatingBallMoveMenu(false, false, false)).toBe(false)
  })
})
