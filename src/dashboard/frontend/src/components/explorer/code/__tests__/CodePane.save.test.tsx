import { act, fireEvent, render, screen } from '@testing-library/react'
import { PanRpcError, type ExplorerReadFileResult } from '@overdeck/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePanesStore, type WorkspacePane } from '../../../../lib/panesStore'

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), ensureEditRoot: vi.fn() }))

vi.mock('../../explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer-rpc')>()),
  // The pane subscribes to the watch hub; no server stream in unit tests.
  subscribeWatchStream: () => () => {},
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('../../edit/edit-workspace-switch', () => ({ ensureEditRoot: mocks.ensureEditRoot }))
// The edit-root note reads the status route; these tests cover saving only.
vi.mock('../../edit/EditWorkspaceBanner', () => ({ EditWorkspaceNote: () => null }))

vi.mock('../MonacoCodeEditor', () => ({
  codeModelUri: (rootId: string, path: string) => `overdeck-explorer://${rootId}/${path}`,
  MonacoCodeEditor: (props: { value: string; readOnly: boolean; onChange(text: string): void; onBlur(): void }) => (
    <textarea
      data-testid="monaco"
      value={props.value}
      readOnly={props.readOnly}
      onChange={(e) => props.onChange(e.target.value)}
      onBlur={() => props.onBlur()}
    />
  ),
}))

const { CodePane } = await import('../CodePane')
const { CHANGED_TEXT } = await import('../ExternalChangeBanner')
const { PaneBar } = await import('../../../Stage/PaneBar')
const { draftKey, useCodeDrafts } = await import('../code-drafts')
const { clearSelfWrites, isRecentSelfWrite } = await import('../self-write-registry')
const { useEditWorkspaceStore } = await import('../../edit/edit-workspace-store')

const WS = 'PAN-5187'
const ROOT = 'issue:PAN-1'
let pathSeq = 0
let path = ''

function textRead(over: Partial<ExplorerReadFileResult> = {}): ExplorerReadFileResult {
  return { kind: 'text', text: 'one\n', size: 4, mtimeMs: 1, signature: 'sig-one', lang: 'ts', writable: true, ...over }
}

function openPane(preview = false): WorkspacePane {
  const id = usePanesStore.getState().addPane(WS, {
    paneType: 'code',
    label: path.split('/').pop() ?? path,
    explorerRootId: ROOT,
    explorerPath: path,
    explorerPreview: preview,
  })
  return usePanesStore.getState().panesByWorkspace[WS]!.find((p) => p.paneId === id)!
}

function currentPane(id: string): WorkspacePane {
  return usePanesStore.getState().panesByWorkspace[WS]!.find((p) => p.paneId === id)!
}

const ctx = { workspaceId: WS, openPane: () => {} }
const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0)
})
const key = () => draftKey(ROOT, path)
const type = (text: string) => fireEvent.change(screen.getByTestId('monaco'), { target: { value: text } })

beforeEach(() => {
  vi.useFakeTimers()
  // Each test uses its own file, so the app-wide save queue never carries a
  // write from one test into the next.
  path = `src/file-${++pathSeq}.ts`
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(WS)
  useCodeDrafts.setState({ drafts: {} })
  clearSelfWrites()
  mocks.readFile.mockReset()
  mocks.readFile.mockResolvedValue(textRead())
  mocks.ensureEditRoot.mockReset()
  mocks.ensureEditRoot.mockResolvedValue('workspace:w1')
  useEditWorkspaceStore.setState({ creating: {}, active: {}, pending: {} })
  mocks.writeFile.mockReset()
  mocks.writeFile.mockImplementation(async ({ text }: { text: string }) => ({ signature: `sig-${text.trim()}`, mtimeMs: 2 }))
})

afterEach(() => {
  vi.useRealTimers()
})

async function renderPane(preview = false) {
  const pane = openPane(preview)
  const view = render(<CodePane pane={pane} ctx={ctx} />)
  await flush()
  return { pane, ...view }
}

describe('CodePane saving', () => {
  it('autosaves once, 1,000 ms after typing, with the loaded signature', async () => {
    await renderPane()
    type('two\n')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999)
    })
    expect(mocks.writeFile).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile).toHaveBeenCalledWith({
      rootId: ROOT,
      path,
      text: 'two\n',
      expectedSignature: 'sig-one',
      allowMissing: false,
    })
    await flush()
    expect(useCodeDrafts.getState().drafts[key()]).toEqual({ text: 'two\n', baseText: 'two\n', baseSignature: 'sig-two' })
    expect(isRecentSelfWrite(key(), 'sig-two')).toBe(true)
  })

  it('saves at once with allowMissing on Ctrl+S on the pane root', async () => {
    await renderPane()
    type('two\n')
    fireEvent.keyDown(screen.getByTestId('code-pane'), { key: 's', ctrlKey: true })
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile.mock.calls[0]![0]).toMatchObject({ text: 'two\n', allowMissing: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
  })

  it('saves on blur', async () => {
    await renderPane()
    type('two\n')
    fireEvent.blur(screen.getByTestId('monaco'))
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
  })

  it('pins a preview pane on the first edit, and the tab shows the dirty dot until the save lands', async () => {
    const { pane } = await renderPane(true)
    const bar = render(
      <PaneBar panes={[currentPane(pane.paneId)]} activePaneId={pane.paneId} onSelect={() => {}} onClose={() => {}} onAdd={() => {}} />,
    )
    expect(bar.getByText(pane.label).className).toContain('italic')
    expect(bar.queryByLabelText('Unsaved changes')).toBeNull()

    type('two\n')
    expect(currentPane(pane.paneId).explorerPreview).toBe(false)
    bar.rerender(
      <PaneBar panes={[currentPane(pane.paneId)]} activePaneId={pane.paneId} onSelect={() => {}} onClose={() => {}} onAdd={() => {}} />,
    )
    expect(bar.getByText(pane.label).className).not.toContain('italic')
    expect(bar.getByLabelText('Unsaved changes')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(bar.queryByLabelText('Unsaved changes')).toBeNull()
  })

  it('records a DISK_CONFLICT answer and keeps the draft dirty', async () => {
    mocks.writeFile.mockRejectedValue(new PanRpcError({ code: 'DISK_CONFLICT', message: 'changed' }))
    await renderPane()
    type('two\n')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await flush()
    // The refused save re-reads disk and raises the changed banner.
    expect(screen.getByTestId('external-change-banner').textContent).toContain(CHANGED_TEXT)
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeTruthy()
    expect(useCodeDrafts.getState().drafts[key()]).toMatchObject({ text: 'two\n', baseText: 'one\n' })
  })

  it('sends the pending autosave when the pane unmounts with the timer armed', async () => {
    const { unmount } = await renderPane()
    type('two\n')
    unmount()
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile.mock.calls[0]![0]).toMatchObject({ text: 'two\n', allowMissing: false })
  })

  it('drops a clean draft on unmount and keeps a dirty one', async () => {
    const clean = await renderPane()
    expect(useCodeDrafts.getState().drafts[key()]).toBeDefined()
    clean.unmount()
    expect(useCodeDrafts.getState().drafts[key()]).toBeUndefined()

    mocks.writeFile.mockRejectedValue(new Error('disk full'))
    const dirty = await renderPane()
    type('unsaved\n')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    dirty.unmount()
    await flush()
    expect(useCodeDrafts.getState().drafts[key()]?.text).toBe('unsaved\n')
  })

  it('never saves a read-only file', async () => {
    mocks.readFile.mockResolvedValue(textRead({ writable: false }))
    await renderPane()
    fireEvent.keyDown(screen.getByTestId('code-pane'), { key: 's', ctrlKey: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('Keep open makes a preview pane permanent', async () => {
    const { pane } = await renderPane(true)
    fireEvent.click(screen.getByRole('button', { name: 'Keep open' }))
    expect(currentPane(pane.paneId).explorerPreview).toBe(false)
  })
})

describe('CodePane saving on project and edit roots (PAN-5191)', () => {
  function mountOn(rootId: string) {
    const id = usePanesStore.getState().addPane(WS, {
      paneType: 'code',
      label: path.split('/').pop() ?? path,
      explorerRootId: rootId,
      explorerPath: path,
    })
    const pane = usePanesStore.getState().panesByWorkspace[WS]!.find((p) => p.paneId === id)!
    return render(<CodePane pane={pane} ctx={ctx} />)
  }

  function dirtyDraftOn(rootId: string) {
    const k = draftKey(rootId, path)
    useCodeDrafts.getState().loaded(k, 'one\n', 'sig-one')
    useCodeDrafts.getState().edited(k, 'two\n')
    return k
  }

  it('asks for an edit root instead of writing when a project-root edit autosaves', async () => {
    mocks.readFile.mockResolvedValue(textRead({ writable: false }))
    mountOn('project:p')
    await flush()
    type('two\n')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mocks.ensureEditRoot).toHaveBeenCalledWith('project:p')
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('saves a pending draft once when its pane mounts on the edit root', async () => {
    const k = dirtyDraftOn('workspace:w1')
    useEditWorkspaceStore.getState().markPendingSave(k)
    mountOn('workspace:w1')
    await flush()
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile.mock.calls[0]![0]).toMatchObject({ rootId: 'workspace:w1', path, text: 'two\n', allowMissing: false })
    expect(useEditWorkspaceStore.getState().pending[k]).toBeUndefined()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
  })

  it('saves once when a pending save is marked for a pane already mounted on the edit root', async () => {
    mountOn('workspace:w1')
    await flush()
    expect(mocks.writeFile).not.toHaveBeenCalled()
    const k = draftKey('workspace:w1', path)
    act(() => {
      useCodeDrafts.getState().edited(k, 'two\n')
      useEditWorkspaceStore.getState().markPendingSave(k)
    })
    await flush()
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile.mock.calls[0]![0]).toMatchObject({ rootId: 'workspace:w1', text: 'two\n', allowMissing: false })
  })
})

describe('closing the last project-root pane with unsaved text (PAN-5191)', () => {
  it('saves the moved draft on the edit root although no pane mounts there', async () => {
    mocks.readFile.mockResolvedValue(textRead({ writable: false }))
    // Like the real ensureEditRoot: move the draft to the edit root and mark it for a pending save.
    mocks.ensureEditRoot.mockImplementation(async () => {
      const from = draftKey('project:p', path)
      const to = draftKey('workspace:w1', path)
      useCodeDrafts.getState().rekey(from, to)
      useEditWorkspaceStore.getState().markPendingSave(to)
      return 'workspace:w1'
    })
    const id = usePanesStore.getState().addPane(WS, { paneType: 'code', label: 'f', explorerRootId: 'project:p', explorerPath: path })
    const pane = usePanesStore.getState().panesByWorkspace[WS]!.find((p) => p.paneId === id)!
    const view = render(<CodePane pane={pane} ctx={ctx} />)
    await flush()
    type('two\n')
    view.unmount()
    await flush()
    expect(mocks.ensureEditRoot).toHaveBeenCalledWith('project:p')
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile.mock.calls[0]![0]).toMatchObject({ rootId: 'workspace:w1', path, text: 'two\n', allowMissing: false })
  })
})
