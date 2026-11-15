import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { UiCommand } from '@overdeck/contracts'

let listener: ((value: unknown) => void) | null = null
vi.mock('../wsTransport', () => ({
  getTransport: () => ({
    subscribe: (_connect: unknown, onValue: (value: unknown) => void) => {
      listener = onValue
      return () => {
        listener = null
      }
    },
  }),
}))

const role = vi.fn<() => 'leader' | 'follower' | 'fallback'>()
vi.mock('./leaderTab', () => ({ leaderRole: () => role(), installLeaderTracking: () => () => {} }))

const openPathInDeck = vi.fn()
vi.mock('./openPathInDeck', () => ({ openPathInDeck: (...args: unknown[]) => openPathInDeck(...args) }))

import { FOLLOWER_WAIT_MS, useUiCommands } from './useUiCommands'

/** A BroadcastChannel stand-in: tests read `posted` and deliver with `receive`. */
class FakeChannel {
  static last: FakeChannel | null = null
  posted: unknown[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor(readonly name: string) {
    FakeChannel.last = this
  }
  postMessage(data: unknown) {
    this.posted.push(data)
  }
  receive(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
  close() {}
}

let visibility: DocumentVisibilityState = 'visible'
const command: UiCommand = {
  id: 'cmd-1',
  type: 'open-path',
  resolution: { projectKey: 'demo', rootId: 'project:demo', relPath: 'docs', kind: 'dir' },
}
const navigation = { openInDeck: vi.fn() }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  visibility = 'visible'
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(window, 'focus').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useUiCommands', () => {
  it('acts at once in the leader tab and posts handled', () => {
    role.mockReturnValue('leader')
    const raiseWindow = vi.fn()
    window.overdeckBridge = { raiseWindow } as unknown as Window['overdeckBridge']
    renderHook(() => useUiCommands(navigation))
    listener?.(command)
    expect(openPathInDeck).toHaveBeenCalledWith(command.resolution, navigation)
    expect(FakeChannel.last?.posted).toEqual([{ handled: 'cmd-1' }])
    expect(window.focus).toHaveBeenCalled()
    expect(raiseWindow).toHaveBeenCalled()
    delete window.overdeckBridge
  })

  it('a follower that hears handled within the wait never acts', async () => {
    role.mockReturnValue('follower')
    renderHook(() => useUiCommands(navigation))
    listener?.(command)
    await vi.advanceTimersByTimeAsync(FOLLOWER_WAIT_MS - 100)
    FakeChannel.last?.receive({ handled: 'cmd-1' })
    await vi.advanceTimersByTimeAsync(200)
    expect(openPathInDeck).not.toHaveBeenCalled()
  })

  it('a visible follower with no handled message acts after the wait', async () => {
    role.mockReturnValue('follower')
    renderHook(() => useUiCommands(navigation))
    listener?.(command)
    await vi.advanceTimersByTimeAsync(FOLLOWER_WAIT_MS - 1)
    expect(openPathInDeck).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(openPathInDeck).toHaveBeenCalledTimes(1)
  })

  it('a hidden fallback tab does not act; a visible one does', () => {
    role.mockReturnValue('fallback')
    visibility = 'hidden'
    renderHook(() => useUiCommands(navigation))
    listener?.(command)
    expect(openPathInDeck).not.toHaveBeenCalled()
    visibility = 'visible'
    listener?.({ ...command, id: 'cmd-2' })
    expect(openPathInDeck).toHaveBeenCalledTimes(1)
  })

  it('stops listening on unmount', () => {
    role.mockReturnValue('leader')
    const { unmount } = renderHook(() => useUiCommands(navigation))
    unmount()
    expect(listener).toBeNull()
  })
})
