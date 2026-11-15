import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ExplorerGitStatusResult } from '@overdeck/contracts'

const git = vi.hoisted(() => ({ result: null as ExplorerGitStatusResult | null }))
vi.mock('../../explorer/git/useExplorerGitStatus', () => ({
  useExplorerGitStatus: () => ({ result: git.result, decorations: { files: new Map(), folders: new Map() }, errorCode: undefined, errorMessage: undefined, refresh: () => {} }),
}))

import { localDayStartIso, ProjectMainChangesList } from '../changes/ProjectMainChangesList'
import { useWorkDockStore } from '../workDockStore'
import { StageDeckProvider } from '../../Stage/StageDeckContext'

const DECK = 'p'
const CHANGES = {
  projectKey: 'p',
  branch: 'main',
  commits: [
    { sha: 'aaaa1111', shortSha: 'aaaa111', subject: 'fix the gate', authoredAt: '2026-11-14T10:00:00Z', by: { kind: 'conversation', id: 'c1', title: 'Fix the gate chat' } },
    { sha: 'bbbb2222', shortSha: 'bbbb222', subject: 'chore: deps', authoredAt: '2026-11-14T09:00:00Z', by: { kind: 'unattributed' } },
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <StageDeckProvider value={{ deckKey: DECK, openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), openBeside: vi.fn(() => 'c') }}>
        <ProjectMainChangesList deckKey={DECK} projectKey="p" />
      </StageDeckProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  useWorkDockStore.setState({ byDeck: {} })
  git.result = { entries: [], committed: [], branch: 'main', truncated: false }
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/registered-projects') return Response.json([{ key: 'p', name: 'P', path: '/home/u/p' }])
    if (url === '/api/workspace-registry') return Response.json({ workspaces: [] })
    if (url.startsWith('/api/projects/p/changes')) return Response.json(CHANGES)
    if (url.startsWith('/api/diffs/compare')) return Response.json({ files: [{ path: 'src/gate.ts', additions: 4, deletions: 1 }, { path: 'README.md', additions: 1, deletions: 0 }] })
    return Response.json({ error: `unexpected ${url}` }, { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const urls = () => fetchMock.mock.calls.map(([u]) => String(u))

describe('ProjectMainChangesList', () => {
  it("asks for today's commits since local midnight and shows sha, subject and who", async () => {
    renderList()
    await screen.findByText('fix the gate')
    const changesUrl = urls().find((u) => u.startsWith('/api/projects/p/changes'))
    expect(changesUrl).toBe(`/api/projects/p/changes?since=${encodeURIComponent(localDayStartIso())}`)
    const start = new Date(localDayStartIso())
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0])
    const groups = screen.getAllByRole('group')
    expect(groups[0]).toHaveTextContent('aaaa111')
    expect(groups[0]).toHaveTextContent('Fix the gate chat')
    expect(groups[1]).toHaveTextContent('unattributed')
  })

  it('lists a commit files from compare when it opens', async () => {
    renderList()
    const group = await screen.findByRole('group', { name: 'aaaa111 fix the gate' })
    expect(urls().some((u) => u.startsWith('/api/diffs/compare'))).toBe(false)
    await waitFor(() => expect(urls()).toContain('/api/registered-projects'))
    fireEvent.click(within(group).getByRole('button', { expanded: false }))
    await waitFor(() => expect(group.querySelectorAll('[data-change-path]')).toHaveLength(2))
    expect(urls().find((u) => u.startsWith('/api/diffs/compare'))).toBe('/api/diffs/compare?repo=%2Fhome%2Fu%2Fp&base=aaaa1111%5E&head=aaaa1111')
    fireEvent.click(within(group.querySelector('[data-change-path="src/gate.ts"]') as HTMLElement).getByRole('button', { name: 'Open diff' }))
    expect(useWorkDockStore.getState().byDeck[DECK].diff).toEqual({ path: 'src/gate.ts', sha: 'aaaa1111' })
  })

  it('lists uncommitted files of the main checkout first', async () => {
    git.result = { entries: [{ path: 'wip.ts', status: 'modified', staged: false }], committed: [], branch: 'main', truncated: false }
    renderList()
    await screen.findByText('fix the gate')
    expect(screen.getAllByRole('group')[0]).toHaveAttribute('aria-label', 'Not committed yet')
  })
})
