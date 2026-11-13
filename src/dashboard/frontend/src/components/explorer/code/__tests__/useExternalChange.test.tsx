import { act, renderHook } from '@testing-library/react'
import { PanRpcError } from '@overdeck/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  listener: null as ((signal: unknown) => void) | null,
  unsubscribe: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock('../../explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer-rpc')>()),
  readFile: mocks.readFile,
}))

vi.mock('../../watch/explorer-watch-hub', () => ({ subscribeExplorerWatch: mocks.subscribe }))

const { useExternalChange } = await import('../useExternalChange')
const { draftKey, useCodeDrafts } = await import('../code-drafts')

const ROOT = 'issue:PAN-1'
const PATH = 'src/a.ts'
const key = draftKey(ROOT, PATH)
const draft = () => useCodeDrafts.getState().drafts[key]
const deliver = (signal: unknown) => act(() => mocks.listener!(signal))
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => {
  vi.useFakeTimers()
  useCodeDrafts.setState({ drafts: {} })
  useCodeDrafts.getState().loaded(key, 'one\n', 'sig-one')
  mocks.readFile.mockReset()
  mocks.readFile.mockResolvedValue({ kind: 'text', text: 'two\n', size: 4, mtimeMs: 2, signature: 'sig-two', lang: 'ts', writable: true })
  mocks.listener = null
  mocks.unsubscribe.mockReset()
  mocks.subscribe.mockReset()
  mocks.subscribe.mockImplementation((_rootId: string, listener: (signal: unknown) => void) => {
    mocks.listener = listener
    return mocks.unsubscribe
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useExternalChange', () => {
  it('subscribes to the root through the watch hub', () => {
    renderHook(() => useExternalChange(ROOT, PATH))
    expect(mocks.subscribe).toHaveBeenCalledWith(ROOT, expect.any(Function))
  })

  it('reloads a clean draft 250 ms after an update event for its path', async () => {
    const { result } = renderHook(() => useExternalChange(ROOT, PATH))
    deliver({ kind: 'events', events: [{ kind: 'update', path: PATH }] })
    await advance(249)
    expect(mocks.readFile).not.toHaveBeenCalled()
    await advance(1)
    expect(mocks.readFile).toHaveBeenCalledWith(ROOT, PATH)
    expect(draft()).toEqual({ text: 'two\n', baseText: 'two\n', baseSignature: 'sig-two' })
    expect(result.current.state).toEqual({ kind: 'clean' })
  })

  it('marks a dirty draft changed instead of reloading it', async () => {
    useCodeDrafts.getState().edited(key, 'mine\n')
    const { result } = renderHook(() => useExternalChange(ROOT, PATH))
    deliver({ kind: 'events', events: [{ kind: 'update', path: PATH }] })
    await advance(250)
    expect(draft()?.text).toBe('mine\n')
    expect(result.current.state).toEqual({ kind: 'changed', diskText: 'two\n', diskSignature: 'sig-two' })
  })

  it('re-reads on a resync signal', async () => {
    renderHook(() => useExternalChange(ROOT, PATH))
    deliver({ kind: 'resync' })
    await advance(250)
    expect(mocks.readFile).toHaveBeenCalledTimes(1)
  })

  it('reads NOT_FOUND as a deleted file', async () => {
    mocks.readFile.mockRejectedValue(new PanRpcError({ code: 'NOT_FOUND', message: 'gone' }))
    const { result } = renderHook(() => useExternalChange(ROOT, PATH))
    deliver({ kind: 'events', events: [{ kind: 'delete', path: PATH }] })
    await advance(500)
    expect(result.current.state).toEqual({ kind: 'deleted' })
  })

  it('unsubscribes on unmount, and no re-read runs afterwards', async () => {
    const { unmount } = renderHook(() => useExternalChange(ROOT, PATH))
    deliver({ kind: 'events', events: [{ kind: 'update', path: PATH }] })
    unmount()
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
    mocks.listener!({ kind: 'events', events: [{ kind: 'update', path: PATH }] })
    await advance(1000)
    expect(mocks.readFile).not.toHaveBeenCalled()
  })
})
