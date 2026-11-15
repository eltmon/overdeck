import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationChanges } from '@overdeck/contracts'

vi.mock('../../explorer/watch/explorer-watch-hub', () => ({ subscribeExplorerWatch: () => () => {} }))

import { ConversationChangesList } from '../changes/ConversationChangesList'
import { useWorkDockStore } from '../workDockStore'
import { useExplorerStore } from '../../explorer/explorerStore'
import { StageDeckProvider, type StageDeckContextValue } from '../../Stage/StageDeckContext'
import type { Conversation } from '../../CommandDeck/ConversationList'
import type { DockScope } from '../dockScope'

const DECK = 'p'
const conversation = { name: 'c1', tmuxSession: 'conv-20261111-8078', isWorking: false, cwd: '/r', issueId: null } as unknown as Conversation
const scope: DockScope = {
  rootId: 'project:p',
  changes: { kind: 'conversation', conversation },
  header: { kind: 'conversation', title: 'x', branch: 'main' },
  deckRootId: 'project:p',
  overridden: false,
}

const file = (path: string, additions = 3, deletions = 1) => ({ path, status: 'M' as const, additions, deletions })

function body(over: Partial<ConversationChanges> = {}): ConversationChanges {
  return {
    conversation: 'c1',
    repoRoot: '/r',
    rootId: 'project:p',
    branch: 'main',
    scope: 'conversation',
    uncommitted: [{ ...file('src/a.ts'), attribution: 'lines', turnIds: [], otherLines: 612, otherConversations: [{ name: 'f23', title: 'Fort #23 Overseer' }, { name: 'f20', title: 'Fort #20 Manager' }] }],
    commits: [
      { sha: 'aaaa1111', shortSha: 'aaaa111', subject: 'fix the walk cycle', authoredAt: '2026-11-14T10:00:00Z', pushed: true, attribution: 'trailer', files: [file('src/b.ts')] },
      { sha: 'bbbb2222', shortSha: 'bbbb222', subject: 'docs: quicksaves', authoredAt: '2026-11-14T11:00:00Z', pushed: false, attribution: 'trailer', files: [file('docs/q.md')] },
    ],
    totals: { files: 3, additions: 9, deletions: 3, commitsPushed: 1, commitsLocal: 1, uncommittedFiles: 1 },
    ...over,
  }
}

let fetchMock: ReturnType<typeof vi.fn>
let deck: StageDeckContextValue

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <StageDeckProvider value={deck}>
        <ConversationChangesList deckKey={DECK} scope={scope} conversation={conversation} />
      </StageDeckProvider>
    </QueryClientProvider>,
  )
}

const groupLabels = () => screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
const lastUrl = () => String(fetchMock.mock.calls.at(-1)?.[0])

beforeEach(() => {
  localStorage.clear()
  useWorkDockStore.setState({ byDeck: {} })
  useExplorerStore.setState({ roots: {} })
  // The root's listing gives its absolute path: the repo root itself here.
  useExplorerStore.getState().setDir('project:p', '', { status: 'ready', entries: [], truncated: false, absPath: '/r' })
  deck = { deckKey: DECK, openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), openBeside: vi.fn(() => 'code-1') }
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes('scope=main')) {
      return Response.json(
        body({
          scope: 'main',
          uncommitted: [],
          commits: [
            { ...body().commits[0], by: { kind: 'conversation', id: 'c1', isThisConversation: true } },
            { ...body().commits[1], by: { kind: 'agent', id: 'agent-pan-7', title: 'Fort #20 Manager' } },
            { ...body().commits[1], sha: 'cccc', shortSha: 'cccc333', by: { kind: 'unattributed' } },
          ],
        }),
      )
    }
    return Response.json(body())
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ConversationChangesList', () => {
  it('lists Not committed yet first, then one group per commit with sha, subject and push state', async () => {
    renderList()
    await waitFor(() => expect(groupLabels()).toEqual(['Not committed yet', 'aaaa111 fix the walk cycle', 'bbbb222 docs: quicksaves']))
    const [, pushed, local] = screen.getAllByRole('group')
    expect(pushed).toHaveTextContent('aaaa111')
    expect(pushed).toHaveTextContent('pushed')
    expect(local).toHaveTextContent('not pushed')
    expect(lastUrl()).toBe('/api/conversations/c1/changes?scope=conversation')
  })

  it('requests the chip scope: Last turn asks scope=turn, All of main today asks scope=main and names who', async () => {
    renderList()
    await screen.findByText('fix the walk cycle')
    fireEvent.click(screen.getByRole('radio', { name: 'Last turn' }))
    await waitFor(() => expect(lastUrl()).toBe('/api/conversations/c1/changes?scope=turn'))
    fireEvent.click(screen.getByRole('radio', { name: 'All of main today' }))
    await waitFor(() => expect(lastUrl()).toBe('/api/conversations/c1/changes?scope=main'))
    const own = await screen.findByRole('group', { name: 'aaaa111 fix the walk cycle' })
    expect(own).toHaveTextContent('this chat')
    expect(screen.getByRole('group', { name: 'bbbb222 docs: quicksaves' })).toHaveTextContent('Fort #20 Manager')
    expect(screen.getByRole('group', { name: 'cccc333 docs: quicksaves' })).toHaveTextContent('unattributed')
    // Commits in main are closed until expanded.
    expect(within(own).queryByText('b.ts')).toBeNull()
    fireEvent.click(within(own).getByRole('button', { expanded: false }))
    expect(within(own).getByText('b.ts')).toBeInTheDocument()
  })

  it('opens on the store changesScope chip', async () => {
    useWorkDockStore.getState().openDock(DECK, { tab: 'changes', changesScope: 'uncommitted' })
    renderList()
    await waitFor(() => expect(lastUrl()).toBe('/api/conversations/c1/changes?scope=uncommitted'))
    expect(screen.getByRole('radio', { name: 'Not committed' })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the shared-file note with the other conversations, and the edit-records sentence', async () => {
    renderList()
    const note = await screen.findByText(/other uncommitted lines/)
    expect(note.closest('p')).toHaveTextContent(
      "Shared file. 612 other uncommitted lines come from Fort #23 Overseer and Fort #20 Manager. Only this conversation's lines are counted.",
    )
  })

  it('says only the file is known when there are no edit records', async () => {
    fetchMock.mockImplementation(async () => Response.json(body({ uncommitted: [{ ...file('src/a.ts'), attribution: 'file', turnIds: [] }] })))
    renderList()
    expect(await screen.findByText('Edited by this conversation. Line attribution needs edit records, which only Claude Code writes.')).toBeInTheDocument()
  })

  it('runs Open diff, Open beside and Reveal on the root path, and names the tmux session in the footnote', async () => {
    useExplorerStore.getState().setDir('project:p', '', { status: 'ready', entries: [], truncated: false, absPath: '/r/src' })
    renderList()
    const row = await waitFor(() => {
      const el = document.querySelector('[data-change-path="b.ts"]')
      if (!el) throw new Error('row not rendered')
      return el as HTMLElement
    })
    fireEvent.click(within(row).getByRole('button', { name: 'Open diff' }))
    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ tab: 'changes', diff: { path: 'b.ts', sha: 'aaaa1111' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Open the file beside the chat' }))
    expect(deck.openBeside).toHaveBeenCalledWith({ rootId: 'project:p', path: 'b.ts' })
    fireEvent.click(within(row).getByRole('button', { name: 'Reveal in files' }))
    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ tab: 'files', reveal: { rootId: 'project:p', path: 'b.ts' } })
    // docs/q.md is outside the src root: no open beside or reveal.
    const outside = document.querySelector('[data-change-path="docs/q.md"]') as HTMLElement
    expect(within(outside).getByRole('button', { name: 'Reveal in files' })).toBeDisabled()
    expect(screen.getByTestId('changes-footnote')).toHaveTextContent('Overdeck-Conversation: conv-20261111-8078')
    expect(screen.getByTestId('changes-footnote')).toHaveTextContent("Other conversations' work on main is left out.")
  })

  it('reports a failed load in words', async () => {
    fetchMock.mockImplementation(async () => Response.json({ error: 'No transcript for c1' }, { status: 404 }))
    renderList()
    expect(await screen.findByText("Couldn't load changes: No transcript for c1")).toBeInTheDocument()
  })
})
