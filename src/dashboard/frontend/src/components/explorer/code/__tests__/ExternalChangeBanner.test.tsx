import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ExplorerReadFileResult } from '@overdeck/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePanesStore, type WorkspacePane } from '../../../../lib/panesStore'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listener: null as ((signal: unknown) => void) | null,
}))

vi.mock('../../explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer-rpc')>()),
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}))

vi.mock('../../watch/explorer-watch-hub', () => ({
  subscribeExplorerWatch: (_rootId: string, listener: (signal: unknown) => void) => {
    mocks.listener = listener
    return () => {}
  },
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('../MonacoCodeEditor', () => ({
  codeModelUri: (rootId: string, path: string) => `overdeck-explorer://${rootId}/${path}`,
  codeLanguageForPath: () => 'typescript',
  MonacoCodeEditor: (props: { value: string; onChange(text: string): void }) => (
    <textarea data-testid="monaco" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
  ),
}))

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: (props: { original: string; modified: string }) => (
    <div data-testid="diff">
      <pre data-testid="diff-original">{props.original}</pre>
      <pre data-testid="diff-modified">{props.modified}</pre>
    </div>
  ),
}))

const { ExternalChangeBanner, CHANGED_TEXT, DELETED_TEXT } = await import('../ExternalChangeBanner')
const { CodePane } = await import('../CodePane')
const { PanRpcError } = await import('@overdeck/contracts')
const { draftKey, useCodeDrafts } = await import('../code-drafts')

describe('ExternalChangeBanner', () => {
  const handlers = () => ({
    comparing: false,
    onCompare: vi.fn(),
    onReload: vi.fn(),
    onKeepMine: vi.fn(),
    onOverwrite: vi.fn(),
    onOpen: vi.fn(),
  })

  it('renders nothing when clean', () => {
    const { container } = render(<ExternalChangeBanner state={{ kind: 'clean' }} {...handlers()} />)
    expect(container.textContent).toBe('')
  })

  it('offers Compare, Reload from disk, Keep my edits and Overwrite when changed', () => {
    const h = handlers()
    render(<ExternalChangeBanner state={{ kind: 'changed', diskText: 'd', diskSignature: 's' }} {...h} />)
    expect(screen.getByTestId('external-change-banner').textContent).toContain(CHANGED_TEXT)
    for (const [name, fn] of [
      ['Compare', h.onCompare],
      ['Reload from disk', h.onReload],
      ['Keep my edits', h.onKeepMine],
      ['Overwrite', h.onOverwrite],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(fn).toHaveBeenCalledTimes(1)
    }
  })

  it('says a deleted file is recreated by saving, with no buttons', () => {
    render(<ExternalChangeBanner state={{ kind: 'deleted' }} {...handlers()} />)
    expect(screen.getByTestId('external-change-banner').textContent).toBe(DELETED_TEXT)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('names the new path of a renamed file and opens it', () => {
    const h = handlers()
    render(<ExternalChangeBanner state={{ kind: 'renamed', newPath: 'lib/a.ts' }} {...h} />)
    expect(screen.getByTestId('external-change-banner').textContent).toContain('This file was renamed on disk to lib/a.ts.')
    fireEvent.click(screen.getByRole('button', { name: 'Open lib/a.ts' }))
    expect(h.onOpen).toHaveBeenCalledWith('lib/a.ts')
  })
})

const WS = 'PAN-5187'
const ROOT = 'issue:PAN-1'
const PATH = 'src/a.ts'
const key = draftKey(ROOT, PATH)
const ctx = { workspaceId: WS, openPane: () => {} }
const draft = () => useCodeDrafts.getState().drafts[key]

function diskRead(text: string, signature: string): ExplorerReadFileResult {
  return { kind: 'text', text, size: text.length, mtimeMs: 1, signature, lang: 'ts', writable: true }
}

function openPane(): WorkspacePane {
  const id = usePanesStore.getState().addPane(WS, { paneType: 'code', label: 'a.ts', explorerRootId: ROOT, explorerPath: PATH })
  return usePanesStore.getState().panesByWorkspace[WS]!.find((p) => p.paneId === id)!
}

/** A pane whose unsaved draft disagrees with disk, so it opens with the changed banner. */
async function renderChanged() {
  useCodeDrafts.getState().loaded(key, 'base\n', 'sig-base')
  useCodeDrafts.getState().edited(key, 'mine\n')
  mocks.readFile.mockResolvedValue(diskRead('theirs\n', 'sig-theirs'))
  render(<CodePane pane={openPane()} ctx={ctx} />)
  await screen.findByTestId('external-change-banner')
}

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(WS)
  useCodeDrafts.setState({ drafts: {} })
  mocks.readFile.mockReset()
  mocks.writeFile.mockReset()
  mocks.writeFile.mockResolvedValue({ signature: 'sig-written', mtimeMs: 2 })
  mocks.listener = null
})

describe('CodePane external-change actions', () => {
  it('Compare diffs the disk text against the draft', async () => {
    await renderChanged()
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getByTestId('diff-original').textContent).toBe('theirs\n')
    expect(screen.getByTestId('diff-modified').textContent).toBe('mine\n')
    expect(mocks.readFile).toHaveBeenCalledTimes(1)
  })

  it('Reload from disk resets the draft to the disk text and clears the banner', async () => {
    await renderChanged()
    fireEvent.click(screen.getByRole('button', { name: 'Reload from disk' }))
    expect(draft()).toEqual({ text: 'theirs\n', baseText: 'theirs\n', baseSignature: 'sig-theirs' })
    expect(screen.queryByTestId('external-change-banner')).toBeNull()
  })

  it('Keep my edits keeps the text with the disk content as base', async () => {
    await renderChanged()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my edits' }))
    expect(draft()).toEqual({ text: 'mine\n', baseText: 'theirs\n', baseSignature: 'sig-theirs' })
    expect(screen.queryByTestId('external-change-banner')).toBeNull()
  })

  it('Overwrite saves the draft without a precondition', async () => {
    await renderChanged()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    })
    expect(mocks.writeFile).toHaveBeenCalledWith({
      rootId: ROOT,
      path: PATH,
      text: 'mine\n',
      expectedSignature: null,
      allowMissing: true,
    })
    expect(screen.queryByTestId('external-change-banner')).toBeNull()
  })

  it('a refused save whose re-read lands after Reload from disk raises no banner', async () => {
    await renderChanged()
    let resolveRead!: (result: ExplorerReadFileResult) => void
    mocks.readFile.mockImplementationOnce(
      () => new Promise<ExplorerReadFileResult>((resolve) => {
        resolveRead = resolve
      }),
    )
    mocks.writeFile.mockRejectedValueOnce(new PanRpcError({ code: 'DISK_CONFLICT', message: 'changed' }))
    // The pending autosave of the unsaved edit is refused while the banner shows.
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('code-pane'), { key: 's', ctrlKey: true })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reload from disk' }))
    expect(screen.queryByTestId('external-change-banner')).toBeNull()
    await act(async () => {
      resolveRead(diskRead('theirs\n', 'sig-theirs'))
    })
    expect(screen.queryByTestId('external-change-banner')).toBeNull()
    expect(draft()).toEqual({ text: 'theirs\n', baseText: 'theirs\n', baseSignature: 'sig-theirs' })
  })

  it('a rename on disk offers Open, which opens the new path', async () => {
    mocks.readFile.mockResolvedValue(diskRead('base\n', 'sig-base'))
    render(<CodePane pane={openPane()} ctx={ctx} />)
    await screen.findByTestId('monaco')
    act(() => mocks.listener!({ kind: 'events', events: [{ kind: 'rename', path: 'lib/a.ts', oldPath: PATH }] }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open lib/a.ts' }))
    const paths = usePanesStore.getState().panesByWorkspace[WS]!.filter((p) => p.paneType === 'code').map((p) => p.explorerPath)
    expect(paths).toEqual([PATH, 'lib/a.ts'])
  })
})
