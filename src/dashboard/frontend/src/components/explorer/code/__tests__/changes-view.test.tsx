import { fireEvent, render, screen } from '@testing-library/react'
import type { ExplorerReadFileResult } from '@overdeck/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspacePane } from '../../../../lib/panesStore'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => ({ signature: 'saved', mtimeMs: 2 })),
  plainSetPosition: vi.fn(),
  diffSetPosition: vi.fn(),
}))

vi.mock('../../explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer-rpc')>()),
  // The pane subscribes to the watch hub; no server stream in unit tests.
  subscribeWatchStream: () => () => {},
  readFile: mocks.readFile,
  // The pane unmounts after each test with an autosave armed; its close flush writes.
  writeFile: mocks.writeFile,
}))

vi.mock('../MonacoCodeEditor', async () => {
  const React = await import('react')
  return {
    codeModelUri: (rootId: string, path: string) => `overdeck-explorer://${rootId}/${path}`,
    codeLanguageForPath: () => 'typescript',
    MonacoCodeEditor: (props: { value: string; onChange(text: string): void; onMount(editor: unknown): void }) => {
      React.useEffect(
        () =>
          props.onMount({
            getPosition: () => ({ lineNumber: 3, column: 5 }),
            setPosition: mocks.plainSetPosition,
            revealPositionInCenter: () => {},
            revealLineInCenter: () => {},
            focus: () => {},
          }),
        [],
      )
      return <textarea data-testid="monaco" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    },
  }
})

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  return {
    DiffEditor: (props: {
      original: string
      modified: string
      originalModelPath: string
      modifiedModelPath: string
      options: { originalEditable?: boolean }
      onMount(diffEditor: unknown, monaco: unknown): void
    }) => {
      const listeners = React.useRef<Array<() => void>>([])
      const value = React.useRef(props.modified)
      React.useEffect(() => {
        const modifiedEditor = {
          onDidChangeModelContent: (listener: () => void) => listeners.current.push(listener),
          onDidBlurEditorText: () => {},
          addAction: () => {},
          getValue: () => value.current,
          getPosition: () => ({ lineNumber: 9, column: 1 }),
          setPosition: mocks.diffSetPosition,
          revealPositionInCenter: () => {},
          focus: () => {},
        }
        props.onMount({ getModifiedEditor: () => modifiedEditor }, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 } })
      }, [])
      return (
        <div data-testid="diff" data-original-path={props.originalModelPath} data-modified-path={props.modifiedModelPath}>
          <pre data-testid="diff-original" data-editable={String(props.options.originalEditable)}>
            {props.original}
          </pre>
          <textarea
            data-testid="diff-modified"
            value={props.modified}
            onChange={(e) => {
              value.current = e.target.value
              listeners.current.forEach((listener) => listener())
            }}
          />
        </div>
      )
    },
  }
})

const { CodePane } = await import('../CodePane')
const { draftKey, useCodeDrafts } = await import('../code-drafts')

const ROOT = 'issue:PAN-1'
const PATH = 'src/a.ts'
const ctx = { workspaceId: 'PAN-1', openPane: () => {} }
const pane = { paneId: 'p1', paneType: 'code', label: 'a.ts', createdAt: 0, explorerRootId: ROOT, explorerPath: PATH } as WorkspacePane

function read(text: string, over: Partial<ExplorerReadFileResult> = {}): ExplorerReadFileResult {
  return { kind: 'text', text, size: text.length, mtimeMs: 1, signature: `sig:${text}`, lang: 'ts', writable: true, ...over }
}

beforeEach(() => {
  useCodeDrafts.setState({ drafts: {} })
  mocks.readFile.mockReset()
  mocks.readFile.mockImplementation(async (_rootId: string, _path: string, ref?: string) =>
    ref === 'HEAD' ? read('committed\n', { writable: false }) : read('on disk\n'),
  )
  mocks.plainSetPosition.mockReset()
  mocks.diffSetPosition.mockReset()
})

async function openChanges() {
  render(<CodePane pane={pane} ctx={ctx} />)
  await screen.findByTestId('monaco')
  fireEvent.change(screen.getByTestId('monaco'), { target: { value: 'my draft\n' } })
  fireEvent.click(screen.getByRole('button', { name: 'Changes' }))
  return screen.findByTestId('diff')
}

describe('Changes view', () => {
  it('reads HEAD and diffs it against the draft, original side read-only', async () => {
    const diff = await openChanges()
    expect(mocks.readFile).toHaveBeenCalledWith(ROOT, PATH, 'HEAD')
    expect(screen.getByTestId('diff-original').textContent).toBe('committed\n')
    expect(screen.getByTestId('diff-original').getAttribute('data-editable')).toBe('false')
    expect((screen.getByTestId('diff-modified') as HTMLTextAreaElement).value).toBe('my draft\n')
    expect(diff.getAttribute('data-original-path')).toBe(`overdeck-explorer://${ROOT}/${PATH}?ref=HEAD`)
    expect(diff.getAttribute('data-modified-path')).toBe(`overdeck-explorer://${ROOT}/${PATH}?diff`)
    expect(screen.queryByTestId('monaco')).toBeNull()
    expect(mocks.diffSetPosition).toHaveBeenCalledWith({ lineNumber: 3, column: 5 })
  })

  it('updates the draft from an edit on the modified side', async () => {
    await openChanges()
    fireEvent.change(screen.getByTestId('diff-modified'), { target: { value: 'edited in diff\n' } })
    expect(useCodeDrafts.getState().drafts[draftKey(ROOT, PATH)]?.text).toBe('edited in diff\n')
  })

  it('goes back to the plain editor with the draft and the cursor preserved', async () => {
    await openChanges()
    fireEvent.change(screen.getByTestId('diff-modified'), { target: { value: 'edited in diff\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Changes' }))
    const editor = (await screen.findByTestId('monaco')) as HTMLTextAreaElement
    expect(editor.value).toBe('edited in diff\n')
    expect(screen.queryByTestId('diff')).toBeNull()
    expect(mocks.plainSetPosition).toHaveBeenCalledWith({ lineNumber: 9, column: 1 })
  })

  it('reads HEAD again each time the view opens', async () => {
    await openChanges()
    fireEvent.click(screen.getByRole('button', { name: 'Changes' }))
    await screen.findByTestId('monaco')
    fireEvent.click(screen.getByRole('button', { name: 'Changes' }))
    await screen.findByTestId('diff')
    expect(mocks.readFile.mock.calls.filter((c) => c[2] === 'HEAD')).toHaveLength(2)
  })
})
