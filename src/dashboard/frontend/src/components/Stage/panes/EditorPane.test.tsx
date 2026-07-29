import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PanRpcError, WS_METHODS } from '@overdeck/contracts'
import { EditorPane } from './EditorPane'
import type { StageContext } from '../types'
import type { WorkspacePane } from '../../../lib/panesStore'

const wsTransportMock = vi.hoisted(() => ({
  request: vi.fn(),
  readFileAtPath: vi.fn(),
  writeFileAtPath: vi.fn(),
  getAvailableEditors: vi.fn(),
  shellOpenInEditor: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
}))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/MarkdownTab', () => ({
  MarkdownTab: ({ body }: { body?: string | null }) => <div data-testid="md">{body}</div>,
}))
// The Stage self-heal test below mounts the full Stage (index.tsx), which
// statically imports AgentPane/TerminalDrawer — stub them out (same as
// Stage.test.tsx) so this file stays focused on editor-pane persistence.
vi.mock('./AgentPane', () => ({
  AgentPane: () => <div data-testid="agent-pane" />,
}))
vi.mock('../../terminal/TerminalDrawer', () => ({
  TerminalDrawer: () => <div data-testid="terminal-drawer" />,
}))

const ctx: StageContext = { workspaceId: 'overdeck', openPane: () => {} }
const pane = (over: Partial<WorkspacePane> = {}): WorkspacePane => ({
  paneId: 'e1',
  paneType: 'editor',
  label: 'Editor',
  createdAt: 1,
  editorFilePath: '/repo/docs/flywheel-brief.md',
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  toastMock.error.mockReset()
  toastMock.success.mockReset()
  wsTransportMock.readFileAtPath.mockReset()
  wsTransportMock.writeFileAtPath.mockReset()
  wsTransportMock.getAvailableEditors.mockReset()
  wsTransportMock.shellOpenInEditor.mockReset()
  wsTransportMock.getAvailableEditors.mockResolvedValue({ editors: ['vscode'] })
  wsTransportMock.shellOpenInEditor.mockResolvedValue({ success: true })
  wsTransportMock.request.mockReset()
  wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) =>
    connect({
      [WS_METHODS.readFileAtPath]: wsTransportMock.readFileAtPath,
      [WS_METHODS.writeFileAtPath]: wsTransportMock.writeFileAtPath,
      [WS_METHODS.getAvailableEditors]: wsTransportMock.getAvailableEditors,
      [WS_METHODS.shellOpenInEditor]: wsTransportMock.shellOpenInEditor,
    }),
  )
})

describe('EditorPane', () => {
  it('renders the loaded text in Edit and renders the draft as markdown in Preview', async () => {
    wsTransportMock.readFileAtPath.mockResolvedValue({ text: '# Hello', lang: 'markdown', mtimeMs: 100, totalLines: 1 })

    render(<EditorPane pane={pane()} ctx={ctx} />)

    await waitFor(() => {
      expect(screen.getByTestId('editor-pane-textarea')).toHaveValue('# Hello')
    })
    expect(wsTransportMock.readFileAtPath).toHaveBeenCalledWith({ path: '/repo/docs/flywheel-brief.md' })

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByTestId('md')).toHaveTextContent('# Hello')
  })

  it('saves the draft with the last-read expectedMtimeMs and clears the dirty indicator', async () => {
    wsTransportMock.readFileAtPath.mockResolvedValue({ text: 'original', lang: 'markdown', mtimeMs: 100, totalLines: 1 })
    wsTransportMock.writeFileAtPath.mockResolvedValue({ mtimeMs: 200 })

    render(<EditorPane pane={pane()} ctx={ctx} />)
    await waitFor(() => expect(screen.getByTestId('editor-pane-textarea')).toHaveValue('original'))

    fireEvent.change(screen.getByTestId('editor-pane-textarea'), { target: { value: 'edited' } })
    expect(screen.getByTestId('editor-pane-dirty')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('editor-pane-save'))

    await waitFor(() => {
      expect(wsTransportMock.writeFileAtPath).toHaveBeenCalledWith({
        path: '/repo/docs/flywheel-brief.md',
        content: 'edited',
        expectedMtimeMs: 100,
      })
    })
    await waitFor(() => expect(screen.queryByTestId('editor-pane-dirty')).not.toBeInTheDocument())
    expect(toastMock.success).toHaveBeenCalledWith('Saved')
  })

  it('saves on Ctrl/Cmd+S', async () => {
    wsTransportMock.readFileAtPath.mockResolvedValue({ text: 'original', lang: 'markdown', mtimeMs: 100, totalLines: 1 })
    wsTransportMock.writeFileAtPath.mockResolvedValue({ mtimeMs: 200 })

    render(<EditorPane pane={pane()} ctx={ctx} />)
    await waitFor(() => expect(screen.getByTestId('editor-pane-textarea')).toHaveValue('original'))
    fireEvent.change(screen.getByTestId('editor-pane-textarea'), { target: { value: 'edited via shortcut' } })

    fireEvent.keyDown(window, { key: 's', metaKey: true })

    await waitFor(() => {
      expect(wsTransportMock.writeFileAtPath).toHaveBeenCalledWith({
        path: '/repo/docs/flywheel-brief.md',
        content: 'edited via shortcut',
        expectedMtimeMs: 100,
      })
    })
  })

  it('shows Reload-from-disk and Overwrite on WRITE_CONFLICT; Overwrite resaves without expectedMtimeMs', async () => {
    wsTransportMock.readFileAtPath.mockResolvedValue({ text: 'original', lang: 'markdown', mtimeMs: 100, totalLines: 1 })
    wsTransportMock.writeFileAtPath.mockRejectedValueOnce(new PanRpcError({ message: 'conflict', code: 'WRITE_CONFLICT' }))

    render(<EditorPane pane={pane()} ctx={ctx} />)
    await waitFor(() => expect(screen.getByTestId('editor-pane-textarea')).toHaveValue('original'))
    fireEvent.change(screen.getByTestId('editor-pane-textarea'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByTestId('editor-pane-save'))

    await waitFor(() => expect(screen.getByTestId('editor-pane-conflict')).toBeInTheDocument())

    wsTransportMock.writeFileAtPath.mockResolvedValue({ mtimeMs: 300 })
    fireEvent.click(screen.getByTestId('editor-pane-overwrite'))

    await waitFor(() => {
      expect(wsTransportMock.writeFileAtPath).toHaveBeenLastCalledWith({
        path: '/repo/docs/flywheel-brief.md',
        content: 'edited',
      })
    })
  })

  it('Reload from disk discards the draft and re-reads the file', async () => {
    wsTransportMock.readFileAtPath.mockResolvedValue({ text: 'original', lang: 'markdown', mtimeMs: 100, totalLines: 1 })
    wsTransportMock.writeFileAtPath.mockRejectedValueOnce(new PanRpcError({ message: 'conflict', code: 'WRITE_CONFLICT' }))

    render(<EditorPane pane={pane()} ctx={ctx} />)
    await waitFor(() => expect(screen.getByTestId('editor-pane-textarea')).toHaveValue('original'))
    fireEvent.change(screen.getByTestId('editor-pane-textarea'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByTestId('editor-pane-save'))
    await waitFor(() => expect(screen.getByTestId('editor-pane-conflict')).toBeInTheDocument())

    wsTransportMock.readFileAtPath.mockResolvedValue({ text: 'fresh from disk', lang: 'markdown', mtimeMs: 400, totalLines: 1 })
    fireEvent.click(screen.getByTestId('editor-pane-reload'))

    await waitFor(() => expect(screen.getByTestId('editor-pane-textarea')).toHaveValue('fresh from disk'))
    expect(screen.queryByTestId('editor-pane-conflict')).not.toBeInTheDocument()
  })

  it('renders an error state with Open externally for FILE_TOO_LARGE', async () => {
    wsTransportMock.readFileAtPath.mockRejectedValue(
      new PanRpcError({ message: 'File exceeds 1048576 bytes', code: 'FILE_TOO_LARGE' }),
    )

    render(<EditorPane pane={pane()} ctx={ctx} />)

    await waitFor(() => expect(screen.getByTestId('editor-pane-error')).toBeInTheDocument())
    const openExternally = screen.getByRole('button', { name: 'Open externally' })
    fireEvent.click(openExternally)

    await waitFor(() => {
      expect(wsTransportMock.shellOpenInEditor).toHaveBeenCalledWith({
        cwd: '/repo/docs/flywheel-brief.md',
        editor: 'vscode',
      })
    })
  })

  it('renders an error state without an Open-externally action for other read errors', async () => {
    wsTransportMock.readFileAtPath.mockRejectedValue(
      new PanRpcError({ message: 'Path is outside the allowed project roots', code: 'PATH_NOT_ALLOWED' }),
    )

    render(<EditorPane pane={pane()} ctx={ctx} />)

    await waitFor(() => expect(screen.getByTestId('editor-pane-error')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Open externally' })).not.toBeInTheDocument()
  })

  it('renders an explicit error state without throwing when editorFilePath is missing', () => {
    render(<EditorPane pane={pane({ editorFilePath: undefined })} ctx={ctx} />)

    expect(screen.getByTestId('editor-pane-missing-path')).toBeInTheDocument()
    expect(wsTransportMock.readFileAtPath).not.toHaveBeenCalled()
  })
})

// PAN-3260 editor-pane.ac5 — the Stage self-heal effect (index.tsx's
// ISSUE_SCOPED set) must not drop 'editor' panes that carry no issueId, the
// way it drops files/commits/plan/docs panes created without one. An editor
// pane's identity is its editorFilePath, not an issue.
describe('editor pane survives the Stage self-heal effect', () => {
  it('keeps a workspace-less editor pane open across a deck mount', async () => {
    wsTransportMock.readFileAtPath.mockResolvedValue({ text: 'brief body', lang: 'markdown', mtimeMs: 1, totalLines: 1 })

    const [{ Stage }, { usePanesStore }, { useTerminalStateStore }, reactQuery] = await Promise.all([
      import('../index'),
      import('../../../lib/panesStore'),
      import('../../terminal/terminalStateStore'),
      import('@tanstack/react-query'),
    ])

    localStorage.clear()
    usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
    useTerminalStateStore.setState({ terminalStateByThreadId: {} })

    const DECK = 'overdeck'
    usePanesStore.getState().ensureHome(DECK)
    usePanesStore.getState().addPane(DECK, {
      paneType: 'editor',
      label: 'flywheel-brief.md',
      editorFilePath: '/repo/docs/flywheel-brief.md',
    })

    const qc = new reactQuery.QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <reactQuery.QueryClientProvider client={qc}>
        <Stage
          deckKey={DECK}
          renderHome={() => <div data-testid="home" />}
          renderIssue={(issueId: string) => <div data-testid="issue-overview">{issueId}</div>}
        />
      </reactQuery.QueryClientProvider>,
    )

    const tabs = screen.getAllByRole('tab')
    expect(tabs.some((t) => t.textContent?.startsWith('flywheel-brief.md'))).toBe(true)
    expect(usePanesStore.getState().panesByWorkspace[DECK].some((p) => p.paneType === 'editor')).toBe(true)

    // addPane makes the new pane active, so EditorPane mounted and started its
    // load already — wait for it to settle instead of leaving a dangling promise.
    await waitFor(() => expect(wsTransportMock.readFileAtPath).toHaveBeenCalledWith({ path: '/repo/docs/flywheel-brief.md' }))
  })
})
