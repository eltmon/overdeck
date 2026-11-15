import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ConversationChanges } from '@overdeck/contracts'

const watch = vi.hoisted(() => ({ listeners: new Map<string, (signal: { kind: 'resync' } | { kind: 'events'; events: unknown[] }) => void>() }))
vi.mock('../../explorer/watch/explorer-watch-hub', () => ({
  subscribeExplorerWatch: (rootId: string, listener: (signal: { kind: 'resync' }) => void) => {
    watch.listeners.set(rootId, listener)
    return () => watch.listeners.delete(rootId)
  },
}))
const rpc = vi.hoisted(() => ({ listDir: vi.fn() }))
vi.mock('../../explorer/explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer/explorer-rpc')>()),
  listDir: rpc.listDir,
}))

import { useConversationChanges, useScopeChangedPaths } from '../useConversationChanges'
import { useExplorerStore } from '../../explorer/explorerStore'
import type { DockScope } from '../dockScope'
import type { Conversation } from '../../CommandDeck/ConversationList'

const BODY: ConversationChanges = {
  conversation: 'c 1',
  repoRoot: '/r',
  rootId: 'project:r',
  branch: 'main',
  scope: 'conversation',
  uncommitted: [{ path: 'app/x.ts', status: 'M', additions: 1, deletions: 0, attribution: 'file', turnIds: [] }],
  commits: [],
  totals: { files: 1, additions: 1, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 1 },
}

let fetchMock: ReturnType<typeof vi.fn>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
let client: QueryClient

beforeEach(() => {
  vi.useFakeTimers()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchMock = vi.fn(async () => Response.json(BODY))
  vi.stubGlobal('fetch', fetchMock)
  watch.listeners.clear()
  rpc.listDir.mockReset()
  useExplorerStore.setState({ roots: {} })
})

afterEach(() => {
  client.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const changesCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/conversations/'))

describe('useConversationChanges', () => {
  it('polls every 5 s while the conversation works and encodes name, scope and turnId', async () => {
    renderHook(() => useConversationChanges({ name: 'c 1', isWorking: true }, 'turn', { rootId: null, enabled: true, turnId: 'msg/1' }), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(changesCalls()).toHaveLength(3)
    expect(changesCalls()[0][0]).toBe('/api/conversations/c%201/changes?scope=turn&turnId=msg%2F1')
  })

  it('fetches once while the conversation is idle', async () => {
    renderHook(() => useConversationChanges({ name: 'c1', isWorking: false }, 'conversation', { rootId: null, enabled: true }), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(changesCalls()).toHaveLength(1)
    expect(changesCalls()[0][0]).toBe('/api/conversations/c1/changes?scope=conversation')
  })

  it('refetches on an explorer watch batch for the root', async () => {
    renderHook(() => useConversationChanges({ name: 'c1', isWorking: false }, 'conversation', { rootId: 'project:r', enabled: true }), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(changesCalls()).toHaveLength(1)
    await act(async () => {
      watch.listeners.get('project:r')?.({ kind: 'resync' })
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(changesCalls()).toHaveLength(2)
  })

  it('throws the server error on a non-2xx answer', async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: 'No transcript' }, { status: 404 }))
    const { result } = renderHook(() => useConversationChanges({ name: 'c1', isWorking: false }, 'conversation', { rootId: null, enabled: true }), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(result.current.error?.message).toBe('No transcript')
  })
})

describe('useScopeChangedPaths', () => {
  const conversation = { name: 'c1', isWorking: false, cwd: '/r', issueId: null } as unknown as Conversation
  const scope: DockScope = {
    rootId: 'project:r',
    changes: { kind: 'conversation', conversation },
    header: { kind: 'conversation', title: 'x', branch: null },
    deckRootId: 'project:r',
    overridden: false,
  }

  it('fetches nothing and returns an empty set while closed', async () => {
    const { result } = renderHook(() => useScopeChangedPaths(scope, { open: false }), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rpc.listDir).not.toHaveBeenCalled()
    expect(result.current.size).toBe(0)
  })

  it('maps the changed paths through the root listing it loads once', async () => {
    rpc.listDir.mockResolvedValue({ entries: [], truncated: false, absPath: '/r/app' })
    const { result } = renderHook(() => useScopeChangedPaths(scope, { open: true }), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(rpc.listDir).toHaveBeenCalledTimes(1)
    expect([...result.current]).toEqual(['x.ts'])
  })

  it('returns an empty set for a scope without a conversation', async () => {
    const rootScope: DockScope = { ...scope, changes: { kind: 'root', rootId: 'issue:X' } }
    const { result } = renderHook(() => useScopeChangedPaths(rootScope, { open: true }), { wrapper })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.size).toBe(0)
  })
})
