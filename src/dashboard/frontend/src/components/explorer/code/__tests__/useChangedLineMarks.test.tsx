import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ConversationChanges } from '@overdeck/contracts'

// The changes query watches the root; no watch stream in unit tests.
vi.mock('../../watch/explorer-watch-hub', () => ({ subscribeExplorerWatch: () => () => {} }))

import { useChangedLineMarks, CHANGED_LINE_CLASS, type ChangedLineMarksInput } from '../useChangedLineMarks'
import type { CodeEditorInstance } from '../MonacoCodeEditor'
import { useExplorerStore } from '../../explorerStore'
import { conversationChangesKey } from '../../../dock/useConversationChanges'
import type { Conversation } from '../../../CommandDeck/ConversationList'

const ROOT = 'project:p'
const REPO = '/home/u/Projects/p'

const CHANGES: ConversationChanges = {
  conversation: 'c1',
  repoRoot: REPO,
  rootId: ROOT,
  branch: 'main',
  scope: 'conversation',
  uncommitted: [{ path: 'docs/shared.md', status: 'M', additions: 6, deletions: 0, attribution: 'lines', turnIds: ['a1'] }],
  commits: [],
  totals: { files: 1, additions: 6, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 1 },
}

const conversation = { name: 'c1', isWorking: false } as Conversation

function fakeEditor() {
  const collection = { set: vi.fn(), clear: vi.fn() }
  const editor = { createDecorationsCollection: vi.fn(() => collection) } as unknown as CodeEditorInstance
  return { editor, collection }
}

let fetchMock: ReturnType<typeof vi.fn>

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function renderMarks(input: ChangedLineMarksInput) {
  return renderHook((props: ChangedLineMarksInput) => useChangedLineMarks(props), { initialProps: input, wrapper })
}

const linesCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/changes/lines'))

beforeEach(() => {
  useExplorerStore.setState({ roots: {} })
  // The root's listing gives its absolute path; the repo itself here.
  useExplorerStore.getState().setDir(ROOT, '', { status: 'ready', entries: [], truncated: false, absPath: REPO })
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/changes/lines')) return Response.json({ path: 'docs/shared.md', lines: [21, 22, 23, 24] })
    if (url.includes('/changes?')) return Response.json(CHANGES)
    throw new Error(`unexpected ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useChangedLineMarks (PAN-5290 FR-6)', () => {
  it('marks the lines the scoped conversation changed as whole-line gutter decorations', async () => {
    const { editor, collection } = fakeEditor()
    renderMarks({ editor, rootId: ROOT, path: 'docs/shared.md', conversation, dirty: false })

    await waitFor(() => expect(collection.set).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/c1/changes/lines?file=docs%2Fshared.md')
    expect(collection.set).toHaveBeenLastCalledWith(
      [21, 22, 23, 24].map((n) => ({
        range: { startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: 1 },
        options: { isWholeLine: true, linesDecorationsClassName: CHANGED_LINE_CLASS },
      })),
    )
    expect(CHANGED_LINE_CLASS).toBe('code-changed-line')
    expect(editor.createDecorationsCollection).toHaveBeenCalledTimes(1)
  })

  it('never requests lines for a file outside the conversation changes', async () => {
    const { editor, collection } = fakeEditor()
    renderMarks({ editor, rootId: ROOT, path: 'src/other.ts', conversation, dirty: false })

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/changes?'))).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(linesCalls()).toHaveLength(0)
    expect(collection.set).not.toHaveBeenCalled()
  })

  it('does not apply lines while the draft is dirty', async () => {
    const { editor, collection } = fakeEditor()
    renderMarks({ editor, rootId: ROOT, path: 'docs/shared.md', conversation, dirty: true })

    await waitFor(() => expect(linesCalls()).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(collection.set).not.toHaveBeenCalled()
  })

  it("clears the first conversation's marks while another conversation's lines load (CodeRabbit 4578715363)", async () => {
    const { editor, collection } = fakeEditor()
    // c2's changes are already cached (the dock read them), so only its lines are pending after the switch.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(conversationChangesKey('c2', 'conversation'), { ...CHANGES, conversation: 'c2' })
    const { rerender } = renderHook((props: ChangedLineMarksInput) => useChangedLineMarks(props), {
      initialProps: { editor, rootId: ROOT, path: 'docs/shared.md', conversation, dirty: false },
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    })
    await waitFor(() => expect(collection.set).toHaveBeenCalled())
    collection.clear.mockClear()
    collection.set.mockClear()
    // c2's lines never arrive.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/c2/changes/lines')) return new Promise<Response>(() => {})
      if (url.includes('/changes?')) return Response.json({ ...CHANGES, conversation: 'c2' })
      throw new Error(`unexpected ${url}`)
    })

    rerender({ editor, rootId: ROOT, path: 'docs/shared.md', conversation: { name: 'c2', isWorking: false } as Conversation, dirty: false })
    await waitFor(() => expect(linesCalls().some(([url]) => String(url).includes('/c2/'))).toBe(true))
    expect(collection.clear).toHaveBeenCalled()
    expect(collection.set).not.toHaveBeenCalled()
  })

  it('clears the marks when the conversation goes away', async () => {
    const { editor, collection } = fakeEditor()
    const { rerender } = renderMarks({ editor, rootId: ROOT, path: 'docs/shared.md', conversation, dirty: false })
    await waitFor(() => expect(collection.set).toHaveBeenCalled())
    collection.clear.mockClear()

    rerender({ editor, rootId: ROOT, path: 'docs/shared.md', conversation: null, dirty: false })
    expect(collection.clear).toHaveBeenCalled()
  })

  it('clears the marks on unmount', async () => {
    const { editor, collection } = fakeEditor()
    const { unmount } = renderMarks({ editor, rootId: ROOT, path: 'docs/shared.md', conversation, dirty: false })
    await waitFor(() => expect(collection.set).toHaveBeenCalled())
    collection.clear.mockClear()
    unmount()
    expect(collection.clear).toHaveBeenCalled()
  })
})
