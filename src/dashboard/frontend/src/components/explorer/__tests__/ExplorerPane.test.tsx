import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { StageDeckProvider } from '../../Stage/StageDeckContext'
import { ExplorerPane, PREVIEW_OPEN_DELAY_MS } from '../ExplorerPane'
import { useExplorerStore } from '../explorerStore'
import { usePanesStore, selectPanesForWorkspace } from '../../../lib/panesStore'
import type { WorkspacePane } from '../../../lib/panesStore'
import type { StageContext } from '../../Stage/types'

const DECK = 'overdeck'
const ctx: StageContext = { workspaceId: DECK, openPane: () => {} }

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

function explorerPaneSpec(over: Partial<WorkspacePane> = {}): WorkspacePane {
  return { paneId: 'f1', paneType: 'files', label: 'Files', createdAt: 1, explorerRootId: 'issue:PAN-1', ...over }
}

function renderPane(pane = explorerPaneSpec()) {
  return render(
    <DialogProvider>
      <ExplorerPane pane={pane} ctx={ctx} />
    </DialogProvider>,
  )
}

beforeEach(() => {
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

describe('ExplorerPane', () => {
  it('lists the root on mount and renders its entries and the branch', async () => {
    renderPane()
    expect(await screen.findByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(rpc.listDir).toHaveBeenCalledWith('issue:PAN-1', '')
    expect(await screen.findByText('feature/pan-1')).toBeInTheDocument()
  })

  it('renders a sentence when the pane has no root', () => {
    renderPane(explorerPaneSpec({ explorerRootId: undefined }))
    expect(screen.getByText('This Files pane has no root. Close it and open Files again.')).toBeInTheDocument()
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

  it('opens a code pane on double click', async () => {
    renderPane()
    fireEvent.doubleClick(await screen.findByText('README.md'))
    const panes = selectPanesForWorkspace(DECK)(usePanesStore.getState())
    const code = panes.find((p) => p.paneType === 'code')
    expect(code).toMatchObject({ explorerRootId: 'issue:PAN-1', explorerPath: 'README.md', label: 'README.md' })
  })

  it('asks the deck to reveal an opened file beside the explorer', async () => {
    const revealPane = vi.fn()
    render(
      <StageDeckProvider value={{ deckKey: DECK, openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), revealPane }}>
        <DialogProvider>
          <ExplorerPane pane={explorerPaneSpec()} ctx={ctx} />
        </DialogProvider>
      </StageDeckProvider>,
    )
    fireEvent.doubleClick(await screen.findByText('README.md'))
    const code = selectPanesForWorkspace(DECK)(usePanesStore.getState()).find((p) => p.paneType === 'code')
    expect(revealPane).toHaveBeenCalledWith(code?.paneId, 'f1')
  })

  it('disables Changed on a non-git root', async () => {
    rpc.gitStatus.mockRejectedValue(new PanRpcError({ message: 'no git', code: 'NOT_A_GIT_REPO' }))
    renderPane(explorerPaneSpec({ explorerRootId: 'project:plain' }))
    await screen.findByText('README.md')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Changed' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Changed' })).toHaveAttribute('title', 'Not a git repository')
  })

  it('opens quick open on Ctrl+P and content search on Ctrl+Shift+F', async () => {
    renderPane()
    await screen.findByText('README.md')
    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'p', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Quick open' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Quick open' })).toBeNull()
    fireEvent.keyDown(tree, { key: 'F', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('textbox', { name: 'Search in files' })).toBeInTheDocument()
    expect(screen.getByRole('tree')).toBeInTheDocument()
  })

  it('opens content search scoped to a folder from Find in folder', async () => {
    renderPane()
    fireEvent.contextMenu(await screen.findByText('src'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find in folder' }))
    expect(screen.getByRole('textbox', { name: 'Search in files' })).toBeInTheDocument()
    expect(screen.getByText('src/')).toBeInTheDocument()
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
      renderPane(explorerPaneSpec({ explorerRootId: 'project:overdeck' }))
      await screen.findByText('README.md')
      expect(screen.getByRole('button', { name: 'New file' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New folder' })).toBeInTheDocument()
    })

    it('shows Rename and Delete but no Stage in a project-root context menu', async () => {
      renderPane(explorerPaneSpec({ explorerRootId: 'project:overdeck' }))
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
