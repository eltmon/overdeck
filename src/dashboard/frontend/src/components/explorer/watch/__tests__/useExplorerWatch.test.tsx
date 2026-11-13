import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const hub = vi.hoisted(() => ({
  listener: null as null | ((signal: unknown) => void),
  stop: vi.fn(),
}))

vi.mock('../explorer-watch-hub', () => ({
  subscribeExplorerWatch: (_rootId: string, listener: (signal: unknown) => void) => {
    hub.listener = listener
    return hub.stop
  },
}))

import { changedDirs, useExplorerWatch } from '../useExplorerWatch'

beforeEach(() => {
  hub.listener = null
  hub.stop.mockReset()
})

describe('useExplorerWatch', () => {
  it('reports the parent directory of a created file', () => {
    const onDirsChanged = vi.fn()
    renderHook(() => useExplorerWatch('issue:PAN-1', { onDirsChanged, onResync: vi.fn() }))
    hub.listener?.({ kind: 'events', events: [{ kind: 'create', path: 'src/a.ts' }] })
    expect(onDirsChanged).toHaveBeenCalledWith(['src'])
  })

  it('reports both parents of a rename', () => {
    const onDirsChanged = vi.fn()
    renderHook(() => useExplorerWatch('issue:PAN-1', { onDirsChanged, onResync: vi.fn() }))
    hub.listener?.({ kind: 'events', events: [{ kind: 'rename', path: 'b/x.ts', oldPath: 'a/x.ts' }] })
    expect(onDirsChanged).toHaveBeenCalledWith(['b', 'a'])
  })

  it('calls onResync on a resync signal', () => {
    const onResync = vi.fn()
    renderHook(() => useExplorerWatch('issue:PAN-1', { onDirsChanged: vi.fn(), onResync }))
    hub.listener?.({ kind: 'resync' })
    expect(onResync).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on unmount and subscribes to nothing without a root', () => {
    const { unmount } = renderHook(() => useExplorerWatch('issue:PAN-1', { onDirsChanged: vi.fn(), onResync: vi.fn() }))
    unmount()
    expect(hub.stop).toHaveBeenCalledTimes(1)
    hub.listener = null
    renderHook(() => useExplorerWatch(undefined, { onDirsChanged: vi.fn(), onResync: vi.fn() }))
    expect(hub.listener).toBeNull()
  })
})

describe('changedDirs', () => {
  it('includes a deleted directory itself and dedupes parents', () => {
    expect(
      changedDirs([
        { kind: 'delete', path: 'src/old', isDirectory: true },
        { kind: 'update', path: 'src/a.ts' },
        { kind: 'create', path: 'top.ts' },
      ]),
    ).toEqual(['src', 'src/old', ''])
  })
})
