import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PanRpcError, type ExplorerReadFileResult } from '@overdeck/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspacePane } from '../../../../lib/panesStore'
import type { ReactNode } from 'react'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  editor: {
    setPosition: vi.fn(),
    revealLineInCenter: vi.fn(),
    focus: vi.fn(),
    saveViewState: vi.fn(() => null),
    restoreViewState: vi.fn(),
    hasTextFocus: vi.fn(() => false),
  },
}))

// PAN-5290: the header's root label reads the shared registry queries; no QueryClient in this test.
vi.mock('../../rootForConversation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../rootForConversation')>()),
  useRootLabel: (rootId: string | null) => rootId,
}))

vi.mock('../../explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer-rpc')>()),
  // The pane subscribes to the watch hub; no server stream in unit tests.
  subscribeWatchStream: () => () => {},
  readFile: mocks.readFile,
  // A test that types leaves an autosave armed; the unmount flush writes.
  writeFile: async () => ({ signature: 'saved', mtimeMs: 2 }),
}))

vi.mock('../MonacoCodeEditor', async () => {
  const React = await import('react')
  return {
    codeModelUri: (rootId: string, path: string) => `overdeck-explorer://${rootId}/${path}`,
    MonacoCodeEditor: (props: {
      value: string
      readOnly: boolean
      wordWrap: string
      onChange(text: string): void
      onMount(editor: unknown): void
    }) => {
      React.useEffect(() => props.onMount(mocks.editor), [])
      return (
        <textarea
          data-testid="monaco"
          data-wrap={props.wordWrap}
          value={props.value}
          readOnly={props.readOnly}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )
    },
  }
})

vi.mock('../../viewers/FileViewer', () => ({
  default: (props: { path: string; read: ExplorerReadFileResult }) => (
    <div data-testid="file-viewer" data-path={props.path} data-kind={props.read.kind} data-text={props.read.text} />
  ),
}))

const { CodePane } = await import('../CodePane')
const { CREATING_EDIT_NOTE, MAIN_CHECKOUT_SENTENCE } = await import('../../edit/EditorBar')
const { useEditWorkspaceStore } = await import('../../edit/edit-workspace-store')
const { draftKey, useCodeDrafts } = await import('../code-drafts')
const { CodePaneSlot } = await import('../CodePaneSlot')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { installStrictFetchMock } = await import('../../../../test-utils/strictFetchMock')

function withQueryClient(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
const { carryViewStates, registerCodeEditor, resetViewStateRegistryForTests } = await import('../view-state-registry')
const { StageDeckProvider } = await import('../../../Stage/StageDeckContext')
const { usePanesStore } = await import('../../../../lib/panesStore')
const { useWorkDockStore } = await import('../../../dock/workDockStore')

function pane(over: Partial<WorkspacePane> = {}): WorkspacePane {
  return {
    paneId: 'p1',
    paneType: 'code',
    label: 'a.ts',
    createdAt: 0,
    explorerRootId: 'issue:PAN-1',
    explorerPath: 'src/a.ts',
    ...over,
  } as WorkspacePane
}

const ctx = { workspaceId: 'PAN-1', openPane: () => {} }

function textRead(over: Partial<ExplorerReadFileResult> = {}): ExplorerReadFileResult {
  return { kind: 'text', text: 'const a = 1\n', size: 12, mtimeMs: 1, signature: 'sig-a', lang: 'ts', writable: true, ...over }
}

beforeEach(() => {
  useCodeDrafts.setState({ drafts: {} })
  useEditWorkspaceStore.setState({ creating: {}, active: {}, pending: {} })
  mocks.readFile.mockReset()
  mocks.editor.setPosition.mockReset()
  mocks.editor.revealLineInCenter.mockReset()
  mocks.editor.focus.mockReset()
  mocks.editor.restoreViewState.mockReset()
  resetViewStateRegistryForTests()
})

describe('CodePane', () => {
  it('renders the editor with the file text and loads the draft', async () => {
    mocks.readFile.mockResolvedValue(textRead())
    render(<CodePane pane={pane()} ctx={ctx} />)
    expect(screen.getByTestId('code-pane-loading')).toBeTruthy()
    const editor = (await screen.findByTestId('monaco')) as HTMLTextAreaElement
    expect(editor.value).toBe('const a = 1\n')
    expect(editor.readOnly).toBe(false)
    expect(mocks.readFile).toHaveBeenCalledWith('issue:PAN-1', 'src/a.ts')
    expect(useCodeDrafts.getState().drafts[draftKey('issue:PAN-1', 'src/a.ts')]).toEqual({
      text: 'const a = 1\n',
      baseText: 'const a = 1\n',
      baseSignature: 'sig-a',
    })
    // PAN-5290 C-D9: an issue root has no editor bar.
    expect(screen.queryByTestId('editor-bar')).toBeNull()
  })

  it('renders an editable editor and the editor bar on a project root', async () => {
    mocks.readFile.mockResolvedValue(textRead({ writable: false }))
    render(<CodePane pane={pane({ explorerRootId: 'project:overdeck' })} ctx={ctx} />)
    const editor = (await screen.findByTestId('monaco')) as HTMLTextAreaElement
    expect(editor.readOnly).toBe(false)
    expect(screen.getByTestId('editor-bar-sentence').textContent).toBe(MAIN_CHECKOUT_SENTENCE)
  })

  it('reads "Creating edit workspace…" while beginEdit runs for the project', async () => {
    mocks.readFile.mockResolvedValue(textRead({ writable: false }))
    useEditWorkspaceStore.getState().setCreating('overdeck', true)
    render(<CodePane pane={pane({ explorerRootId: 'project:overdeck' })} ctx={ctx} />)
    await screen.findByTestId('monaco')
    expect(screen.getByTestId('editor-bar-sentence').textContent).toBe(CREATING_EDIT_NOTE)
    act(() => useEditWorkspaceStore.getState().setCreating('overdeck', false))
    expect(screen.getByTestId('editor-bar-sentence').textContent).toBe(MAIN_CHECKOUT_SENTENCE)
  })

  it('shows unsaved draft text instead of the disk text', async () => {
    const key = draftKey('issue:PAN-1', 'src/a.ts')
    useCodeDrafts.getState().loaded(key, 'const a = 1\n', 'sig-a')
    useCodeDrafts.getState().edited(key, 'unsaved\n')
    mocks.readFile.mockResolvedValue(textRead())
    render(<CodePane pane={pane()} ctx={ctx} />)
    expect(((await screen.findByTestId('monaco')) as HTMLTextAreaElement).value).toBe('unsaved\n')
  })

  it('renders the PAN-5188 viewer host for a binary file', async () => {
    mocks.readFile.mockResolvedValue({ kind: 'binary', size: 2048, mtimeMs: 1, signature: 'sig-png', lang: '', writable: true })
    render(<CodePane pane={pane({ explorerPath: 'img/logo.png' })} ctx={ctx} />)
    const viewer = await screen.findByTestId('file-viewer')
    expect(viewer.getAttribute('data-path')).toBe('img/logo.png')
    expect(viewer.getAttribute('data-kind')).toBe('binary')
    expect(screen.queryByTestId('monaco')).toBeNull()
    expect(screen.queryByTestId('code-pane-header')).toBeNull()
  })

  it('opens a CSV in the table preview, and Edit switches to Monaco with the draft', async () => {
    mocks.readFile.mockResolvedValue(textRead({ text: 'a,b\n1,2\n' }))
    render(<CodePane pane={pane({ explorerPath: 'data/t.csv', label: 't.csv' })} ctx={ctx} />)
    const viewer = await screen.findByTestId('file-viewer')
    expect(viewer.getAttribute('data-text')).toBe('a,b\n1,2\n')
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }))
    expect(((await screen.findByTestId('monaco')) as HTMLTextAreaElement).value).toBe('a,b\n1,2\n')
    fireEvent.change(screen.getByTestId('monaco'), { target: { value: 'a,b\n3,4\n' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect((await screen.findByTestId('file-viewer')).getAttribute('data-text')).toBe('a,b\n3,4\n')
  })

  it('says the file no longer exists on NOT_FOUND', async () => {
    mocks.readFile.mockRejectedValue(new PanRpcError({ code: 'NOT_FOUND', message: 'gone' }))
    render(<CodePane pane={pane()} ctx={ctx} />)
    expect((await screen.findByTestId('code-pane-error')).textContent).toContain('This file no longer exists.')
  })

  it('shows the stale tab, not "Couldn’t open file", when the root is gone (PAN-5290 FR-13)', async () => {
    mocks.readFile.mockRejectedValue(new PanRpcError({ code: 'ROOT_NOT_FOUND', message: 'Explorer root workspace:w1 not found' }))
    const guard = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/registered-projects') return Response.json([{ key: 'PAN-1', name: 'Overdeck', path: '/p' }])
      if (method === 'GET' && url === '/api/workspace-registry') return Response.json({ workspaces: [] })
      return undefined
    })
    const { unmount } = render(withQueryClient(<CodePane pane={pane({ explorerRootId: 'workspace:w1' })} ctx={ctx} />))
    expect((await screen.findByTestId('code-pane-stale')).textContent).toContain('This edit workspace was merged or discarded.')
    expect(screen.queryByTestId('code-pane-error')).toBeNull()
    // Unmount before the stub goes: a root-label query that starts late must
    // still reach the stub, not the global fetch guard.
    unmount()
    await guard.assertNoUnexpectedRequests()
    vi.unstubAllGlobals()
  })

  it('shows the stale tab when the editor bar finds the edit workspace gone (PAN-5290 C-D13b)', async () => {
    mocks.readFile.mockResolvedValue(textRead())
    const guard = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url.startsWith('/api/explorer/edit-workspaces/w1')) {
        return Response.json({ error: 'Workspace w1 not found.', code: 'ROOT_NOT_FOUND' }, { status: 404 })
      }
      if (method === 'GET' && url === '/api/registered-projects') return Response.json([])
      if (method === 'GET' && url === '/api/workspace-registry') return Response.json({ workspaces: [] })
      return undefined
    })
    const { unmount } = render(withQueryClient(<CodePane pane={pane({ explorerRootId: 'workspace:w1' })} ctx={ctx} />))
    expect(await screen.findByTestId('code-pane-stale')).toBeInTheDocument()
    expect(screen.queryByTestId('monaco')).toBeNull()
    // Unmount before the stub goes: a root-label query that starts late must
    // still reach the stub, not the global fetch guard.
    unmount()
    await guard.assertNoUnexpectedRequests()
    vi.unstubAllGlobals()
  })

  it('renders "No file" without a path', () => {
    render(<CodePane pane={pane({ explorerPath: undefined })} ctx={ctx} />)
    expect(screen.getByTestId('code-pane-no-file')).toBeTruthy()
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it('restores a carried view state and focus when it mounts on the new root (PAN-5290 C-D12)', async () => {
    const viewState = { cursorState: [{ position: { lineNumber: 30, column: 2 } }] }
    registerCodeEditor(draftKey('project:overdeck', 'src/a.ts'), {
      saveViewState: () => viewState,
      restoreViewState: () => {},
      hasTextFocus: () => true,
      focus: () => {},
    } as unknown as Parameters<typeof registerCodeEditor>[1])
    carryViewStates('project:overdeck', 'issue:PAN-1')
    mocks.readFile.mockResolvedValue(textRead())

    render(<CodePane pane={pane()} ctx={ctx} />)
    await screen.findByTestId('monaco')

    await waitFor(() => expect(mocks.editor.restoreViewState).toHaveBeenCalledWith(viewState))
    expect(mocks.editor.focus).toHaveBeenCalled()
    expect(mocks.editor.restoreViewState.mock.invocationCallOrder[0]).toBeLessThan(mocks.editor.focus.mock.invocationCallOrder[0]!)
  })

  it('reveals the requested line on mount and again on a new nonce', async () => {
    mocks.readFile.mockResolvedValue(textRead())
    const { rerender } = render(
      <CodePane pane={pane({ explorerRevealLine: 40, explorerRevealColumn: 3, explorerRevealNonce: 1 })} ctx={ctx} />,
    )
    await screen.findByTestId('monaco')
    await waitFor(() => expect(mocks.editor.revealLineInCenter).toHaveBeenCalledWith(40))
    expect(mocks.editor.setPosition).toHaveBeenCalledWith({ lineNumber: 40, column: 3 })
    expect(mocks.editor.focus).toHaveBeenCalled()

    act(() => {
      rerender(<CodePane pane={pane({ explorerRevealLine: 40, explorerRevealColumn: 3, explorerRevealNonce: 2 })} ctx={ctx} />)
    })
    await waitFor(() => expect(mocks.editor.revealLineInCenter).toHaveBeenCalledTimes(2))
  })
})

describe('CodePane header', () => {
  it('previews a markdown file from the current draft text', async () => {
    const key = draftKey('issue:PAN-1', 'docs/README.md')
    mocks.readFile.mockResolvedValue(textRead({ text: '# Title\n' }))
    render(<CodePane pane={pane({ explorerPath: 'docs/README.md', label: 'README.md' })} ctx={ctx} />)
    await screen.findByTestId('monaco')
    act(() => useCodeDrafts.getState().edited(key, '# Draft heading\n'))
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    const preview = await screen.findByTestId('code-pane-markdown')
    expect(preview.textContent).toContain('Draft heading')
    expect(screen.queryByTestId('monaco')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }))
    expect(((await screen.findByTestId('monaco')) as HTMLTextAreaElement).value).toBe('# Draft heading\n')
  })

  it('wraps by default and the Wrap button turns it off for the editor', async () => {
    mocks.readFile.mockResolvedValue(textRead())
    render(<CodePane pane={pane()} ctx={ctx} />)
    const editor = await screen.findByTestId('monaco')
    expect(editor.getAttribute('data-wrap')).toBe('on')
    const wrap = screen.getByRole('button', { name: 'Wrap' })
    fireEvent.click(wrap)
    expect(wrap.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('monaco').getAttribute('data-wrap')).toBe('off')
  })

  it('shows the root label and path as a breadcrumb', async () => {
    mocks.readFile.mockResolvedValue(textRead())
    render(<CodePane pane={pane()} ctx={ctx} />)
    await screen.findByTestId('monaco')
    expect(screen.getByTestId('code-pane-breadcrumb').textContent).toBe('issue:PAN-1›src›a.ts')
  })

  it('has no Reveal in files outside a Stage', async () => {
    mocks.readFile.mockResolvedValue(textRead())
    render(<CodePane pane={pane()} ctx={ctx} />)
    await screen.findByTestId('monaco')
    expect(screen.queryByRole('button', { name: 'Reveal in files' })).toBeNull()
  })

  it('Reveal in files makes the pane active and opens the dock Files tab on this file', async () => {
    mocks.readFile.mockResolvedValue(textRead())
    const setActivePane = vi.spyOn(usePanesStore.getState(), 'setActivePane').mockImplementation(() => {})
    const openDock = vi.fn()
    render(
      <StageDeckProvider value={{ deckKey: 'PAN-1', openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), openDock }}>
        <CodePane pane={pane()} ctx={ctx} />
      </StageDeckProvider>,
    )
    await screen.findByTestId('monaco')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in files' }))
    expect(setActivePane).toHaveBeenCalledWith('PAN-1', 'p1')
    expect(openDock).toHaveBeenCalledWith({ tab: 'files', reveal: { rootId: 'issue:PAN-1', path: 'src/a.ts' } })
    setActivePane.mockRestore()
  })

  it('Reveal in files points a dock pinned to another root at this file first (CodeRabbit 4578715359)', async () => {
    mocks.readFile.mockResolvedValue(textRead())
    useWorkDockStore.setState({ byDeck: {} })
    useWorkDockStore.getState().setRootOverride('PAN-1', 'project:other')
    const openDock = vi.fn()
    render(
      <StageDeckProvider value={{ deckKey: 'PAN-1', openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), openDock }}>
        <CodePane pane={pane()} ctx={ctx} />
      </StageDeckProvider>,
    )
    await screen.findByTestId('monaco')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in files' }))
    expect(useWorkDockStore.getState().byDeck['PAN-1']).toMatchObject({ rootOverride: 'issue:PAN-1', rootOverrideAnchor: 'p1' })
    expect(openDock).toHaveBeenCalledWith({ tab: 'files', reveal: { rootId: 'issue:PAN-1', path: 'src/a.ts' } })
    useWorkDockStore.setState({ byDeck: {} })
  })
})

describe('CodePaneSlot', () => {
  it('mounts a fresh code pane that reads the new path when a preview tab is retargeted', async () => {
    mocks.readFile.mockImplementation(async (_rootId: string, path: string) =>
      textRead({ text: `text of ${path}\n`, signature: `sig-${path}` }),
    )
    const { rerender } = render(<CodePaneSlot pane={pane({ explorerPath: 'src/a.ts', explorerPreview: true })} ctx={ctx} />)
    expect(((await screen.findByTestId('monaco')) as HTMLTextAreaElement).value).toBe('text of src/a.ts\n')

    rerender(<CodePaneSlot pane={pane({ explorerPath: 'src/b.ts', label: 'b.ts', explorerPreview: true })} ctx={ctx} />)
    await waitFor(() =>
      expect((screen.getByTestId('monaco') as HTMLTextAreaElement).value).toBe('text of src/b.ts\n'),
    )
    expect(mocks.readFile.mock.calls.map((c) => c[1])).toEqual(['src/a.ts', 'src/b.ts'])
  })
})
