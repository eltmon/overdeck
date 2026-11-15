import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const rpc = vi.hoisted(() => ({ searchFiles: vi.fn() }))
vi.mock('../../explorer/explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer/explorer-rpc')>()),
  searchFiles: rpc.searchFiles,
}))

import { useFileProviderActions } from '../fileProvider'
import { useActiveDock, type ActiveDock } from '../../dock/activeDock'

function dock(over: Partial<ActiveDock> = {}): ActiveDock {
  return { deckKey: 'p', activePaneId: 'a1', rootId: 'project:p', changedPaths: new Set(), openFile: vi.fn(), revealFile: vi.fn(), ...over }
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  rpc.searchFiles.mockReset()
  rpc.searchFiles.mockResolvedValue({ paths: ['a/foo.ts', 'b/foo.ts', 'foo'] })
  useActiveDock.setState({ current: null })
})

afterEach(() => {
  useActiveDock.setState({ current: null })
})

describe('useFileProviderActions', () => {
  it('lists nothing without a mounted dock or with an empty query', async () => {
    const noDock = renderHook(() => useFileProviderActions(true, 'foo'))
    await settle()
    expect(noDock.result.current).toEqual([])
    noDock.unmount()
    useActiveDock.getState().set(dock())
    const emptyQuery = renderHook(() => useFileProviderActions(true, '  '))
    await settle()
    expect(emptyQuery.result.current).toEqual([])
    expect(rpc.searchFiles).not.toHaveBeenCalled()
  })

  it('ranks the root files, tags changed paths and opens through the dock', async () => {
    const current = dock({ changedPaths: new Set(['b/foo.ts']) })
    useActiveDock.getState().set(current)
    const { result } = renderHook(() => useFileProviderActions(true, 'foo'))
    await settle()
    expect(rpc.searchFiles).toHaveBeenCalledWith('project:p', 'foo', 200)
    expect(result.current.map((a) => a.id)).toEqual(['file-foo', 'file-b/foo.ts', 'file-a/foo.ts'])
    expect(result.current[1]).toMatchObject({ label: 'foo.ts', description: 'b', group: 'Files', rank: 1, meta: [{ text: 'changed here', pill: true }] })
    expect(result.current[2].meta).toBeUndefined()
    result.current[1].onSelect()
    expect(current.openFile).toHaveBeenCalledWith('b/foo.ts')
  })

  it('drops an answer to an older query', async () => {
    useActiveDock.getState().set(dock())
    const pending: Array<(v: { paths: string[] }) => void> = []
    rpc.searchFiles.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const { result, rerender } = renderHook(({ q }) => useFileProviderActions(true, q), { initialProps: { q: 'old' } })
    await settle()
    rerender({ q: 'new' })
    await settle()
    await act(async () => {
      pending[1]({ paths: ['new.ts'] })
      pending[0]({ paths: ['old.ts'] })
    })
    expect(result.current.map((a) => a.label)).toEqual(['new.ts'])
  })

  it('lists nothing while the palette is closed', async () => {
    useActiveDock.getState().set(dock())
    const { result } = renderHook(() => useFileProviderActions(false, 'foo'))
    await settle()
    expect(result.current).toEqual([])
    expect(rpc.searchFiles).not.toHaveBeenCalled()
  })
})
