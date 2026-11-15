import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PanRpcError, type ExplorerEntry, type ExplorerListDirResult, type ExplorerWatchBatch } from '@overdeck/contracts'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 22, size: 22 })),
    getTotalSize: () => count * 22,
    scrollToIndex: () => {},
  }),
}))

const rpc = vi.hoisted(() => ({
  listDir: vi.fn(),
  gitStatus: vi.fn(),
  gitStage: vi.fn(),
  createEntry: vi.fn(),
  subscribeWatchStream: vi.fn(),
  stream: null as null | { onBatch: (b: ExplorerWatchBatch) => void; onReconnect: () => void },
}))
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('../explorer-rpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../explorer-rpc')>()
  return {
    ...actual,
    listDir: rpc.listDir,
    gitStatus: rpc.gitStatus,
    gitStage: rpc.gitStage,
    createEntry: rpc.createEntry,
    subscribeWatchStream: rpc.subscribeWatchStream,
  }
})

import { DialogProvider } from '../../DialogProvider'
import { StageDeckProvider, type StageDeckContextValue } from '../../Stage/StageDeckContext'
import { ExplorerFiles, PREVIEW_OPEN_DELAY_MS, type ExplorerFilesProps } from '../ExplorerPane'
import { resetShortcutsForTests, useShortcutList } from '../../../lib/shortcuts/registry'
import { useExplorerStore } from '../explorerStore'
import { usePanesStore, selectPanesForWorkspace } from '../../../lib/panesStore'
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock'

const DECK = 'overdeck'

function entry(path: string, kind: ExplorerEntry['kind'] = 'file'): ExplorerEntry {
  return { name: path.split('/').pop() ?? path, path, kind, mtimeMs: 0, ignored: false }
}

const LISTINGS: Record<string, ExplorerEntry[]> = {
  '': [entry('src', 'dir'), entry('README.md')],
  src: [entry('src/a.ts')],
}

function listing(path: string): ExplorerListDirResult {
  return { entries: LISTINGS[path] ?? [], truncated: false, absPath: path ? `/ws/${path}` : '/ws' }
}

// PAN-5289: ExplorerFiles is the Files tab body; it labels its root through the
// project registry, so each test answers that request.
let registeredProjects: Array<{ key: string; name?: string; path: string }> = []
let fetchGuard: ReturnType<typeof installStrictFetchMock>

function filesProps(over: Partial<ExplorerFilesProps> = {}): ExplorerFilesProps {
  return { rootId: 'issue:PAN-1', deckKey: DECK, changedPaths: new Set(), conversationScope: false, onFindInFolder: vi.fn(), ...over }
}

function renderPane(props: Partial<ExplorerFilesProps> = {}, deck: StageDeckContextValue | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const files = (
    <DialogProvider>
      <ExplorerFiles {...filesProps(props)} />
    </DialogProvider>
  )
  return render(<QueryClientProvider client={qc}>{deck ? <StageDeckProvider value={deck}>{files}</StageDeckProvider> : files}</QueryClientProvider>)
}

function deckWith(over: Partial<StageDeckContextValue> = {}): StageDeckContextValue {
  return { deckKey: DECK, openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), ...over }
}

beforeEach(() => {
  registeredProjects = []
  fetchGuard = installStrictFetchMock(({ method, url }) => {
    if (method === 'GET' && url === '/api/registered-projects') return Response.json(registeredProjects)
    if (method === 'GET' && url === '/api/workspace-registry') return Response.json({ workspaces: [] })
    return undefined
  })
  localStorage.clear()
  useExplorerStore.setState({ roots: {} })
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  rpc.listDir.mockReset()
  rpc.listDir.mockImplementation(async (_root: string, path: string) => listing(path))
  rpc.gitStatus.mockReset()
  rpc.gitStatus.mockResolvedValue({ entries: [], committed: [], branch: 'feature/pan-1', truncated: false })
  rpc.gitStage.mockReset()
  rpc.createEntry.mockReset()
  rpc.createEntry.mockResolvedValue({ entry: entry('x.ts') })
  rpc.stream = null
  rpc.subscribeWatchStream.mockReset()
  rpc.subscribeWatchStream.mockImplementation((_root: string, onBatch: (b: ExplorerWatchBatch) => void, onReconnect: () => void) => {
    rpc.stream = { onBatch, onReconnect }
    return () => {}
  })
  toastMock.mockReset()
})

afterEach(async () => {
  await fetchGuard.assertNoUnexpectedRequests()
  vi.unstubAllGlobals()
})

describe('ExplorerFiles', () => {
  it('lists the root on mount and renders its entries and the branch', async () => {
    renderPane()
    expect(await screen.findByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(rpc.listDir).toHaveBeenCalledWith('issue:PAN-1', '')
    expect(await screen.findByText('feature/pan-1')).toBeInTheDocument()
  })

  it('lists the root it is given and labels it with the project name', async () => {
    // PAN-5289: a Files tab without a root is the WorkDock FR-13 case; ExplorerFiles always has one.
    registeredProjects = [{ key: 'overdeck', name: 'Overdeck', path: '/ws' }]
    renderPane({ rootId: 'project:overdeck' })
    expect(await screen.findByText('README.md')).toBeInTheDocument()
    expect(rpc.listDir).toHaveBeenCalledWith('project:overdeck', '')
    expect(await screen.findByText('Overdeck')).toBeInTheDocument()
    expect(screen.queryByText('overdeck')).toBeNull()
    expect(screen.getByRole('tree', { name: 'Files in Overdeck' })).toBeInTheDocument()
  })

  it('explains a missing issue workspace', async () => {
    rpc.listDir.mockRejectedValue(new PanRpcError({ message: 'no root', code: 'ROOT_NOT_FOUND' }))
    renderPane()
    expect(await screen.findByText('No workspace on disk for PAN-1. Start the issue to create one.')).toBeInTheDocument()
  })

  it('offers Retry when the root listing fails', async () => {
    rpc.listDir.mockRejectedValueOnce(new PanRpcError({ message: 'disk on fire', code: 'EXPLORER_FAILED' }))
    renderPane()
    expect(await screen.findByText("Couldn't list files: disk on fire")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('README.md')).toBeInTheDocument()
  })

  it('shows a deleted file from git status under the Changed filter', async () => {
    rpc.gitStatus.mockResolvedValue({
      entries: [{ path: 'src/gone.ts', status: 'deleted', staged: false }],
      committed: [],
      branch: 'feature/pan-1',
      truncated: false,
    })
    renderPane()
    await screen.findByText('README.md')
    await waitFor(() => expect(rpc.gitStatus).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Changed' }))
    expect(await screen.findByText('gone.ts')).toBeInTheDocument()
    expect(screen.queryByText('README.md')).toBeNull()
    expect(screen.getByRole('button', { name: 'Changed' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('re-lists every loaded directory on a watch resync', async () => {
    renderPane()
    await screen.findByText('README.md')
    fireEvent.click(screen.getByText('src'))
    expect(await screen.findByText('a.ts')).toBeInTheDocument()
    rpc.listDir.mockClear()
    act(() => rpc.stream?.onReconnect())
    await waitFor(() => expect(rpc.listDir).toHaveBeenCalledTimes(2))
    expect(rpc.listDir.mock.calls.map((c) => c[1]).sort()).toEqual(['', 'src'])
  })

  it('re-lists the parent of a created file', async () => {
    renderPane()
    await screen.findByText('README.md')
    rpc.listDir.mockClear()
    act(() => rpc.stream?.onBatch({ events: [{ kind: 'create', path: 'new.ts' }] }))
    await waitFor(() => expect(rpc.listDir).toHaveBeenCalledWith('issue:PAN-1', ''))
  })

  it('opens a code pane on double click when there is no deck', async () => {
    renderPane()
    fireEvent.doubleClick(await screen.findByText('README.md'))
    const panes = selectPanesForWorkspace(DECK)(usePanesStore.getState())
    const code = panes.find((p) => p.paneType === 'code')
    expect(code).toMatchObject({ explorerRootId: 'issue:PAN-1', explorerPath: 'README.md', label: 'README.md' })
  })

  it('opens a file with openBeside', async () => {
    const openBeside = vi.fn(() => 'code-1')
    renderPane({}, deckWith({ openBeside }))
    fireEvent.doubleClick(await screen.findByText('README.md'))
    expect(openBeside).toHaveBeenCalledTimes(1)
    expect(openBeside).toHaveBeenCalledWith({ rootId: 'issue:PAN-1', path: 'README.md' })
    expect((openBeside.mock.calls[0] as unknown[])[0]).not.toMatchObject({ preview: true })
    // The deck opens the pane; ExplorerFiles does not add one itself.
    expect(selectPanesForWorkspace(DECK)(usePanesStore.getState()).some((p) => p.paneType === 'code')).toBe(false)
  })

  it('disables Changed on a non-git root', async () => {
    rpc.gitStatus.mockRejectedValue(new PanRpcError({ message: 'no git', code: 'NOT_A_GIT_REPO' }))
    renderPane({ rootId: 'project:plain' })
    await screen.findByText('README.md')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Changed' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Changed' })).toHaveAttribute('title', 'Not a git repository')
  })

  it('registers no explorer-scoped shortcuts', async () => {
    // PAN-5289: the dock owns Ctrl+P and Ctrl+Shift+F; the pane registers neither.
    onTestFinished(() => resetShortcutsForTests())
    renderPane()
    await screen.findByText('README.md')
    const { result } = renderHook(() => useShortcutList())
    const ids = result.current.map((d) => d.id)
    expect(ids).not.toContain('explorer.quick-open')
    expect(ids).not.toContain('explorer.content-search')
  })

  it('reveals and selects the revealPath file (PAN-5289)', async () => {
    renderPane({ revealPath: 'src/a.ts' })
    expect(await screen.findByText('a.ts')).toBeInTheDocument()
    expect(useExplorerStore.getState().roots['issue:PAN-1'].selection).toEqual(['src/a.ts'])
  })

  it('Find in folder calls onFindInFolder with the folder path', async () => {
    const onFindInFolder = vi.fn()
    renderPane({ onFindInFolder })
    fireEvent.contextMenu(await screen.findByText('src'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find in folder' }))
    expect(onFindInFolder).toHaveBeenCalledWith('src')
    expect(screen.queryByRole('textbox', { name: 'Search in files' })).toBeNull()
  })

  it('drops a collapsed folder’s cached listing on remount so it re-lists when opened', async () => {
    const first = renderPane()
    await screen.findByText('README.md')
    fireEvent.click(screen.getByText('src'))
    expect(await screen.findByText('a.ts')).toBeInTheDocument()
    fireEvent.click(screen.getByText('src'))
    first.unmount()

    renderPane()
    await screen.findByText('README.md')
    expect(useExplorerStore.getState().roots['issue:PAN-1'].dirs.src).toBeUndefined()
    rpc.listDir.mockClear()
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(rpc.listDir).toHaveBeenCalledWith('issue:PAN-1', 'src'))
  })

  it('removes a persisted expanded folder that is gone', async () => {
    localStorage.setItem('overdeck.explorer.issue:PAN-1', JSON.stringify({ expanded: ['old'], showDotfiles: true }))
    rpc.listDir.mockImplementation(async (_root: string, path: string) => {
      if (path === 'old') throw new PanRpcError({ message: 'gone', code: 'NOT_FOUND' })
      return listing(path)
    })
    renderPane()
    await screen.findByText('README.md')
    await waitFor(() => expect(useExplorerStore.getState().roots['issue:PAN-1'].expanded).toEqual([]))
  })

  describe('opening files from the tree (PAN-5187)', () => {
    const codePanes = () => selectPanesForWorkspace(DECK)(usePanesStore.getState()).filter((p) => p.paneType === 'code')

    it('a single click opens the preview pane once the double-click interval passes', async () => {
      renderPane()
      const row = await screen.findByText('README.md')
      vi.useFakeTimers()
      try {
        fireEvent.click(row)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(PREVIEW_OPEN_DELAY_MS - 1)
        })
        expect(codePanes()).toHaveLength(0)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1)
        })
        expect(codePanes().map((p) => [p.explorerPath, p.explorerPreview])).toEqual([['README.md', true]])
      } finally {
        vi.useRealTimers()
      }
    })

    it('a double click opens one permanent pane and no preview', async () => {
      renderPane()
      const row = await screen.findByText('README.md')
      vi.useFakeTimers()
      try {
        fireEvent.click(row)
        fireEvent.click(row)
        fireEvent.doubleClick(row)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(PREVIEW_OPEN_DELAY_MS * 2)
        })
        expect(codePanes().map((p) => [p.explorerPath, p.explorerPreview])).toEqual([['README.md', false]])
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('create and rename (PAN-5190)', () => {
    it('creates a file from the header New file button and opens it', async () => {
      renderPane()
      await screen.findByText('README.md')
      fireEvent.click(screen.getByRole('button', { name: 'New file' }))
      const input = screen.getByRole('textbox', { name: 'New file name' })
      fireEvent.change(input, { target: { value: 'x.ts' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(rpc.createEntry).toHaveBeenCalledWith('issue:PAN-1', 'x.ts', 'file'))
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'New file name' })).toBeNull())
      const panes = selectPanesForWorkspace(DECK)(usePanesStore.getState())
      expect(panes.find((p) => p.paneType === 'code')).toMatchObject({ explorerRootId: 'issue:PAN-1', explorerPath: 'x.ts' })
    })

    it('creates inside the selected folder', async () => {
      renderPane()
      await screen.findByText('README.md')
      act(() => useExplorerStore.getState().select('issue:PAN-1', 'src', 'replace', ['src']))
      fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
      const input = screen.getByRole('textbox', { name: 'New folder name' })
      fireEvent.change(input, { target: { value: 'lib' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(rpc.createEntry).toHaveBeenCalledWith('issue:PAN-1', 'src/lib', 'dir'))
    })

    it('keeps the row open with the message when the name already exists on the server', async () => {
      rpc.createEntry.mockRejectedValueOnce(new PanRpcError({ message: 'exists', code: 'ALREADY_EXISTS' }))
      renderPane()
      await screen.findByText('README.md')
      fireEvent.click(screen.getByRole('button', { name: 'New file' }))
      const input = screen.getByRole('textbox', { name: 'New file name' })
      fireEvent.change(input, { target: { value: 'x.ts' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(await screen.findByRole('alert')).toHaveTextContent('x.ts already exists here.')
      expect(screen.getByRole('textbox', { name: 'New file name' })).toBeInTheDocument()
    })

    it('shows the New buttons on a project root (PAN-5191: writes go to an edit workspace)', async () => {
      renderPane({ rootId: 'project:overdeck' })
      await screen.findByText('README.md')
      expect(screen.getByRole('button', { name: 'New file' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New folder' })).toBeInTheDocument()
    })

    it('shows Rename and Delete but no Stage in a project-root context menu', async () => {
      renderPane({ rootId: 'project:overdeck' })
      fireEvent.contextMenu(await screen.findByText('README.md'))
      expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /^Delete/ })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Stage' })).toBeNull()
    })

    it('shows no New buttons while the Changed filter is on', async () => {
      renderPane()
      await screen.findByText('README.md')
      await waitFor(() => expect(rpc.gitStatus).toHaveBeenCalled())
      fireEvent.click(screen.getByRole('button', { name: 'Changed' }))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'New file' })).toBeNull())
      expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull()
    })

    it('opens the menu with New file and New folder on an empty root', async () => {
      rpc.listDir.mockImplementation(async () => ({ entries: [], truncated: false, absPath: '/ws' }))
      renderPane()
      const empty = await screen.findByText('This folder is empty.')
      fireEvent.contextMenu(empty)
      expect(await screen.findByRole('menuitem', { name: 'New file' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'New folder' })).toBeInTheDocument()
    })
  })
})
