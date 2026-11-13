import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PanRpcError, type ExplorerReadFileResult } from '@overdeck/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspacePane } from '../../../../lib/panesStore'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  editor: {
    setPosition: vi.fn(),
    revealLineInCenter: vi.fn(),
    focus: vi.fn(),
  },
}))

vi.mock('../../explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer-rpc')>()),
  // The pane subscribes to the watch hub; no server stream in unit tests.
  subscribeWatchStream: () => () => {},
  readFile: mocks.readFile,
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

const { CodePane, READ_ONLY_NOTE } = await import('../CodePane')
const { draftKey, useCodeDrafts } = await import('../code-drafts')
const { CodePaneSlot } = await import('../CodePaneSlot')

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
  mocks.readFile.mockReset()
  mocks.editor.setPosition.mockReset()
  mocks.editor.revealLineInCenter.mockReset()
  mocks.editor.focus.mockReset()
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
    expect(screen.queryByText(READ_ONLY_NOTE)).toBeNull()
  })

  it('renders a read-only editor and the note for a file that is not writable', async () => {
    mocks.readFile.mockResolvedValue(textRead({ writable: false }))
    render(<CodePane pane={pane({ explorerRootId: 'project:overdeck' })} ctx={ctx} />)
    const editor = (await screen.findByTestId('monaco')) as HTMLTextAreaElement
    expect(editor.readOnly).toBe(true)
    expect(screen.getByText(READ_ONLY_NOTE)).toBeTruthy()
  })

  it('shows unsaved draft text instead of the disk text', async () => {
    const key = draftKey('issue:PAN-1', 'src/a.ts')
    useCodeDrafts.getState().loaded(key, 'const a = 1\n', 'sig-a')
    useCodeDrafts.getState().edited(key, 'unsaved\n')
    mocks.readFile.mockResolvedValue(textRead())
    render(<CodePane pane={pane()} ctx={ctx} />)
    expect(((await screen.findByTestId('monaco')) as HTMLTextAreaElement).value).toBe('unsaved\n')
  })

  it('renders the non-text fallback for a binary file', async () => {
    mocks.readFile.mockResolvedValue({ kind: 'binary', size: 2048, mtimeMs: 1, signature: '', lang: '', writable: true })
    render(<CodePane pane={pane({ explorerPath: 'img/logo.png' })} ctx={ctx} />)
    const fallback = await screen.findByTestId('code-pane-non-text')
    expect(fallback.textContent).toContain('logo.png')
    expect(fallback.textContent).toContain('2.0 KiB')
    expect(screen.queryByTestId('monaco')).toBeNull()
  })

  it('says the file no longer exists on NOT_FOUND', async () => {
    mocks.readFile.mockRejectedValue(new PanRpcError({ code: 'NOT_FOUND', message: 'gone' }))
    render(<CodePane pane={pane()} ctx={ctx} />)
    expect((await screen.findByTestId('code-pane-error')).textContent).toContain('This file no longer exists.')
  })

  it('renders "No file" without a path', () => {
    render(<CodePane pane={pane({ explorerPath: undefined })} ctx={ctx} />)
    expect(screen.getByTestId('code-pane-no-file')).toBeTruthy()
    expect(mocks.readFile).not.toHaveBeenCalled()
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
