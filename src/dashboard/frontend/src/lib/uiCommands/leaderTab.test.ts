import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installLeaderTracking, leaderRole, markFocused, releaseLeadership, TAB_ID } from './leaderTab'

const KEY = 'overdeck.ui.leaderTab'
const HOUR = 60 * 60 * 1000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-15T12:00:00Z'))
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('leaderRole', () => {
  it('is leader for the tab focused last and follower when another tab is fresher', () => {
    markFocused()
    expect(leaderRole()).toBe('leader')
    window.localStorage.setItem(KEY, JSON.stringify({ tabId: 'other-tab', at: Date.now() }))
    expect(leaderRole()).toBe('follower')
  })

  it('is fallback with no entry or an entry older than 24 hours', () => {
    expect(leaderRole()).toBe('fallback')
    markFocused()
    vi.advanceTimersByTime(25 * HOUR)
    expect(leaderRole()).toBe('fallback')
  })

  it('is fallback for an unparseable entry', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(leaderRole()).toBe('fallback')
  })

  it('is fallback without throwing when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => leaderRole()).not.toThrow()
    expect(leaderRole()).toBe('fallback')
  })
})

describe('releaseLeadership', () => {
  it('removes only this tab’s own entry', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ tabId: 'other-tab', at: Date.now() }))
    releaseLeadership()
    expect(window.localStorage.getItem(KEY)).not.toBeNull()
    markFocused()
    releaseLeadership()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})

describe('installLeaderTracking', () => {
  it('marks focus on window focus and releases on pagehide until cleaned up', () => {
    const cleanup = installLeaderTracking()
    window.localStorage.clear()
    window.dispatchEvent(new Event('focus'))
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}').tabId).toBe(TAB_ID)
    window.dispatchEvent(new Event('pagehide'))
    expect(window.localStorage.getItem(KEY)).toBeNull()
    cleanup()
    window.dispatchEvent(new Event('focus'))
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})
