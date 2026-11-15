import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ProjectChanges, ProjectCommit } from '@overdeck/contracts'
import type { Conversation } from '../../CommandDeck/ConversationList'
import type { ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import { RecentChanges, type RecentChangesProps } from './RecentChanges'

const mocks = vi.hoisted(() => ({ navigateToIssue: vi.fn(), toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('../../AgentPillPopoverRow', () => ({ navigateToIssue: mocks.navigateToIssue }))
vi.mock('sonner', () => ({ toast: mocks.toast }))

// Local noon; "today" is everything since local midnight.
const NOW = new Date(2026, 10, 15, 12, 0, 0)

function at(hoursAgo: number): string {
  return new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString()
}

function commit(i: number, authoredAt: string, by: ProjectCommit['by'] = { kind: 'unattributed' }): ProjectCommit {
  return { sha: `${i}`.padStart(40, 'a'), shortSha: `sha${i}`, subject: `commit ${i}`, authoredAt, by }
}

function changes(commits: ProjectCommit[]): RecentChangesProps['changes'] {
  const data: ProjectChanges = { projectKey: 'wfx', branch: 'main', commits }
  return { data, isLoading: false, isError: false }
}

const CONVERSATION = { name: 'fixture-1', title: 'Fix the login page' } as Conversation
const FEATURE = { issueId: 'WFX-1', title: 'Feature one' } as ProjectFeature

function renderChanges(props: Partial<RecentChangesProps> = {}) {
  const handlers = { onOpenConversation: vi.fn(), onSelectFeature: vi.fn(), onAllChanges: vi.fn() }
  render(
    <RecentChanges changes={changes([])} conversations={[CONVERSATION]} features={[FEATURE]} {...handlers} {...props} />,
  )
  return handlers
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('RecentChanges (PAN-5294 G-D11)', () => {
  it("lists only today's commits when there are at least 10 of them", () => {
    const today = Array.from({ length: 12 }, (_, i) => commit(i, at(i * 0.5)))
    const older = Array.from({ length: 5 }, (_, i) => commit(100 + i, at(24 + i)))
    renderChanges({ changes: changes([...today, ...older]) })

    expect(screen.getAllByTestId('recent-change-row')).toHaveLength(12)
    expect(screen.getByText('who changed what, today')).toBeInTheDocument()
    expect(screen.getAllByTestId('recent-change-row')[0]).toHaveTextContent('12:00')
  })

  it('falls back to the newest 10 commits on a quiet day', () => {
    const today = Array.from({ length: 3 }, (_, i) => commit(i, at(i)))
    const older = Array.from({ length: 20 }, (_, i) => commit(100 + i, at(48 + i)))
    renderChanges({ changes: changes([...today, ...older]) })

    const rows = screen.getAllByTestId('recent-change-row')
    expect(rows).toHaveLength(10)
    expect(screen.getByText('the last 10 commits')).toBeInTheDocument()
    expect(rows[9]).toHaveTextContent('Nov 13')
  })

  it('opens a listed conversation with its current title', () => {
    const h = renderChanges({
      changes: changes([commit(1, at(1), { kind: 'conversation', id: 'fixture-1', title: 'Old title' })]),
    })

    const row = screen.getByTestId('recent-change-row')
    expect(row).toHaveTextContent('Fix the login page')
    fireEvent.click(row)
    expect(h.onOpenConversation).toHaveBeenCalledWith('fixture-1', 'Fix the login page')
  })

  it('makes a row for an unlisted conversation inert and says why', () => {
    const h = renderChanges({
      changes: changes([commit(1, at(1), { kind: 'conversation', id: 'gone-1', title: 'Archived work' })]),
    })

    const row = screen.getByTestId('recent-change-row')
    expect(row).toHaveTextContent('Archived work')
    expect(row).not.toHaveAttribute('role', 'button')
    expect(row).toHaveAttribute('title', 'This conversation is not in the list (archived or on another machine)')
    fireEvent.click(row)
    expect(h.onOpenConversation).not.toHaveBeenCalled()
  })

  it("opens an agent commit's issue, or navigates to it when no feature matches", () => {
    const h = renderChanges({
      changes: changes([
        commit(1, at(1), { kind: 'agent', id: 'agent-wfx-1', title: 'WFX-1' }),
        commit(2, at(2), { kind: 'agent', id: 'agent-wfx-9', title: 'WFX-9' }),
      ]),
    })

    const [first, second] = screen.getAllByTestId('recent-change-row')
    fireEvent.click(first!)
    expect(h.onSelectFeature).toHaveBeenCalledWith(FEATURE)
    fireEvent.click(second!)
    expect(mocks.navigateToIssue).toHaveBeenCalledWith('WFX-9')
  })

  it('shows unattributed commits as inert rows', () => {
    renderChanges({ changes: changes([commit(1, at(1))]) })
    const row = screen.getByTestId('recent-change-row')
    expect(row).toHaveTextContent('unattributed')
    expect(row).not.toHaveAttribute('role', 'button')
  })

  it('copies the full sha from the short sha button without opening the row', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const h = renderChanges({
      changes: changes([commit(7, at(1), { kind: 'conversation', id: 'fixture-1' })]),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy sha7' }))
    await act(async () => {})
    expect(writeText).toHaveBeenCalledWith('7'.padStart(40, 'a'))
    expect(mocks.toast).toHaveBeenCalledWith('Copied sha7')
    expect(h.onOpenConversation).not.toHaveBeenCalled()
  })

  it('says so when main has no commits in the window, and when the read failed', () => {
    renderChanges()
    expect(screen.getByText('No commits on main in the last 7 days.')).toBeInTheDocument()
    cleanup()

    renderChanges({ changes: { isLoading: false, isError: true, error: new Error('HTTP 500') } })
    expect(screen.getByText('Recent changes are unavailable: HTTP 500')).toBeInTheDocument()
  })

  it('opens the changes dock from All changes', () => {
    const h = renderChanges()
    fireEvent.click(screen.getByRole('button', { name: 'All changes' }))
    expect(h.onAllChanges).toHaveBeenCalledTimes(1)
  })
})
