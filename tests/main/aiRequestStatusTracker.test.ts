import { describe, expect, it } from 'vitest'
import { AiRequestStatusTracker } from '../../src/main/core/aiRequestStatusTracker'
import { resolveVisibleAiRequestStatus } from '../../src/shared/aiRequestStatus'

describe('AiRequestStatusTracker', () => {
  it('按插件 WebContents 隔离请求状态', () => {
    const tracker = new AiRequestStatusTracker()

    expect(tracker.update(101, 'request-a', 'sending')).toBe('sending')
    expect(tracker.get(102)).toBe('idle')
    expect(tracker.update(102, 'request-b', 'receiving')).toBe('receiving')
    expect(tracker.get(101)).toBe('sending')
  })

  it('一个请求结束时保留同插件其他并发请求的动画', () => {
    const tracker = new AiRequestStatusTracker()

    tracker.update(101, 'request-a', 'receiving')
    tracker.update(101, 'request-b', 'sending')
    expect(tracker.update(101, 'request-a', 'idle')).toBe('sending')
    expect(tracker.update(101, 'request-b', 'idle')).toBe('idle')
  })

  it('只解析当前显示插件的状态', () => {
    const statuses = {
      '/plugins/a': 'receiving',
      '/plugins/b': 'sending'
    } as const

    expect(resolveVisibleAiRequestStatus(statuses, '/plugins/a')).toBe('receiving')
    expect(resolveVisibleAiRequestStatus(statuses, '/plugins/b')).toBe('sending')
    expect(resolveVisibleAiRequestStatus(statuses, '/plugins/c')).toBe('idle')
    expect(resolveVisibleAiRequestStatus(statuses, null)).toBe('idle')
  })
})
