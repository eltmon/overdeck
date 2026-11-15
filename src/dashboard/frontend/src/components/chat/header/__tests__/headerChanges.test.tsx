import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationChanges } from '@overdeck/contracts'

vi.mock('../../../explorer/watch/explorer-watch-hub', () => ({
  subscribeExplorerWatch: () => () => {},
}))

import { HeaderDockButtons, useHeaderChanges, type HeaderTotals } from '../headerChanges'
import type { Conversation } from '../../../CommandDeck/ConversationList'

const TOTALS: HeaderTotals = { files: 2, additions: 86, deletions: 1, commitsPushed: 2, commitsLocal: 1, uncommittedFiles: 1 }

const BODY: ConversationChanges = {
  conversation: 'conv-1',
  repoRoot: '/srv/repo',
  rootId: 'project:repo',
  branch: 'main',
  scope: 'conversation',
  uncommitted: [],
  commits: [],
  totals: TOTALS,
}

const CONVERSATION = {
  id: 7,
  name: 'conv-1',
  tmuxSession: 'conv-1',
  status: 'ended',
  cwd: '/srv/repo',
  issueId: null,
  createdAt: '2026-11-15T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: false,
} as unknown as Conversation

let client: QueryClient
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/registered-projects') return Response.json([])
    if (url === '/api/workspace-registry') return Response.json({ workspaces: [] })
    if (url.startsWith('/api/conversations/')) return Response.json(BODY)
    throw new Error(`Unexpected request ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.unstubAllGlobals()
})

const changesCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/conversations/'))

function Probe({ conversation }: { conversation: Conversation }) {
  const totals = useHeaderChanges(conversation)
  return <div data-testid="totals">{totals ? `${totals.additions}/${totals.deletions}` : 'none'}</div>
}

function renderProbe(conversation: Conversation) {
  return render(
    <QueryClientProvider client={client}>
      <Probe conversation={conversation} />
    </QueryClientProvider>,
  )
}

describe('useHeaderChanges', () => {
  it('requests the conversation scope and returns its totals', async () => {
    renderProbe(CONVERSATION)
    await waitFor(() => expect(screen.getByTestId('totals')).toHaveTextContent('86/1'))
    expect(changesCalls().map(([url]) => url)).toEqual(['/api/conversations/conv-1/changes?scope=conversation'])
  })

  it('sends no /changes request for a synthetic row (id < 0)', async () => {
    renderProbe({ ...CONVERSATION, id: -1 })
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/workspace-registry')).toBe(true))
    expect(changesCalls()).toEqual([])
    expect(screen.getByTestId('totals')).toHaveTextContent('none')
  })

  it('sends no /changes request for a linked conversation', async () => {
    renderProbe({ ...CONVERSATION, origin: 'linked' } as Conversation)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/workspace-registry')).toBe(true))
    expect(changesCalls()).toEqual([])
    expect(screen.getByTestId('totals')).toHaveTextContent('none')
  })
})

describe('HeaderDockButtons', () => {
  it('shows +additions and −deletions with a spoken label', () => {
    render(<HeaderDockButtons changes={{ totals: TOTALS, openDock: vi.fn() }} />)
    const changes = screen.getByRole('button', { name: 'Changes, 86 lines added, 1 removed' })
    expect(changes).toHaveTextContent('+86')
    expect(changes).toHaveTextContent('−1')
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument()
  })

  it('reads Changes with no numbers while totals are unknown', () => {
    render(<HeaderDockButtons changes={{ totals: null, openDock: vi.fn() }} />)
    const changes = screen.getByRole('button', { name: 'Changes' })
    expect(changes.textContent).toBe('Changes')
  })

  it('reads Changes with no numbers when no lines changed', () => {
    render(<HeaderDockButtons changes={{ totals: { ...TOTALS, additions: 0, deletions: 0 }, openDock: vi.fn() }} />)
    expect(screen.getByRole('button', { name: 'Changes' }).textContent).toBe('Changes')
  })

  it('opens the dock on Changes (this conversation) and on Files', () => {
    const openDock = vi.fn()
    render(<HeaderDockButtons changes={{ totals: TOTALS, openDock }} />)
    fireEvent.click(screen.getByRole('button', { name: /^Changes/ }))
    expect(openDock).toHaveBeenLastCalledWith({ tab: 'changes', changesScope: 'conversation' })
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(openDock).toHaveBeenLastCalledWith({ tab: 'files' })
  })

  it('names the dock shortcut in each title', () => {
    render(<HeaderDockButtons changes={{ totals: TOTALS, openDock: vi.fn() }} />)
    expect(screen.getByRole('button', { name: /^Changes/ }).getAttribute('title')).toMatch(/^Show what this conversation changed \(.+G\)$/)
    expect(screen.getByRole('button', { name: 'Files' }).getAttribute('title')).toMatch(/^Show this conversation's files \(.+E\)$/)
  })
})
