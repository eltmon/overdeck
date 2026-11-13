import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { PanRpcError } from '@overdeck/contracts'

const rpc = vi.hoisted(() => ({ gitStatus: vi.fn() }))
const hub = vi.hoisted(() => ({ listeners: [] as Array<(signal: unknown) => void> }))

vi.mock('../../explorer-rpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../explorer-rpc')>()
  return { ...actual, gitStatus: rpc.gitStatus }
})
vi.mock('../../watch/explorer-watch-hub', () => ({
  subscribeExplorerWatch: (_rootId: string, listener: (signal: unknown) => void) => {
    hub.listeners.push(listener)
    return () => {
      hub.listeners = hub.listeners.filter((l) => l !== listener)
    }
  },
}))

import { useExplorerGitStatus } from '../useExplorerGitStatus'

const STATUS = {
  entries: [{ path: 'src/a.ts', status: 'modified' as const, staged: false }],
  committed: [],
  branch: 'feature/x',
  truncated: false,
}

const signal = () => hub.listeners.forEach((l) => l({ kind: 'events', events: [] }))

beforeEach(() => {
  vi.useFakeTimers()
  hub.listeners = []
  rpc.gitStatus.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useExplorerGitStatus', () => {
  it('fetches on mount and builds decorations', async () => {
    rpc.gitStatus.mockResolvedValue(STATUS)
    const { result } = renderHook(() => useExplorerGitStatus('issue:PAN-1'))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(rpc.gitStatus).toHaveBeenCalledWith('issue:PAN-1')
    expect(result.current.result?.branch).toBe('feature/x')
    expect(result.current.decorations.folders.get('src')?.status).toBe('modified')
  })

  it('refetches 125 ms after a watch signal once the minimum gap has passed', async () => {
    rpc.gitStatus.mockResolvedValue(STATUS)
    renderHook(() => useExplorerGitStatus('issue:PAN-1'))
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(rpc.gitStatus).toHaveBeenCalledTimes(1)
    act(() => signal())
    await act(() => vi.advanceTimersByTimeAsync(124))
    expect(rpc.gitStatus).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(rpc.gitStatus).toHaveBeenCalledTimes(2)
  })

  it('stops on NOT_A_GIT_REPO until refresh is called', async () => {
    rpc.gitStatus.mockRejectedValue(new PanRpcError({ message: 'not a repo', code: 'NOT_A_GIT_REPO' }))
    const { result } = renderHook(() => useExplorerGitStatus('project:plain'))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.errorCode).toBe('NOT_A_GIT_REPO')
    expect(result.current.decorations.files.size).toBe(0)

    act(() => signal())
    await act(() => vi.advanceTimersByTimeAsync(70_000))
    expect(rpc.gitStatus).toHaveBeenCalledTimes(1)

    rpc.gitStatus.mockResolvedValue(STATUS)
    act(() => result.current.refresh())
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(rpc.gitStatus).toHaveBeenCalledTimes(2)
    expect(result.current.errorCode).toBeUndefined()
  })
})
