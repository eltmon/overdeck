import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ProjectCommit } from '@overdeck/contracts'
import type { AgentsWorking } from '../../../lib/selectors/agentsWorking'
import type { NeedsYouItem } from '../../../lib/selectors/needsYou'
import { HomeFacts, formatCost, landedSummary, type HomeFactsProps } from './HomeFacts'

function agents(byRole: Partial<AgentsWorking['byRole']> = {}): AgentsWorking {
  const full = { planning: 0, building: 0, review: 0, test: 0, conversation: 0, other: 0, ...byRole }
  return { count: Object.values(full).reduce((a, b) => a + b, 0), byRole: full, rows: [] }
}

function commit(subject: string, i: number): ProjectCommit {
  return { sha: `sha${i}`, shortSha: `s${i}`, subject, authoredAt: '2026-11-15T09:00:00.000Z', by: { kind: 'unattributed' } }
}

function needsYouItem(ask: string): NeedsYouItem {
  return { key: 'issue:WFX-1', kind: 'issue', title: 'WFX-1', ask, open: vi.fn() }
}

function renderFacts(props: Partial<HomeFactsProps> = {}) {
  const handlers = {
    onAgents: vi.fn(),
    onNeedsYou: vi.fn(),
    onInReview: vi.fn(),
    onLanded: vi.fn(),
    onSpend: vi.fn(),
  }
  render(
    <HomeFacts
      agents={agents()}
      needsYou={[]}
      inReview={{ count: 0, prNumbers: [] }}
      changes={{ data: { projectKey: 'wfx', branch: 'main', commits: [] }, isLoading: false, isError: false }}
      spend={{ week: 0, today: 0 }}
      spendUnavailable={false}
      spendError={false}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

function fact(label: string) {
  const el = screen.getByRole('button', { name: new RegExp(`^${label}`) })
  return {
    el,
    value: el.querySelector('[data-fact-value]') as HTMLElement,
    sub: el.querySelector('[data-fact-sub]') as HTMLElement,
  }
}

afterEach(() => {
  cleanup()
})

describe('HomeFacts (PAN-5294 G-D10)', () => {
  it('renders the five fact labels', () => {
    renderFacts()
    const group = screen.getByRole('group', { name: 'Project facts' })
    for (const label of ['Agents working', 'Needs you', 'In review', 'Landed this week', 'Spend this week']) {
      expect(within(group).getByText(label)).toBeInTheDocument()
    }
  })

  it('counts agents working per D-9', () => {
    renderFacts({ agents: agents({ planning: 1, building: 2 }) })
    expect(fact('Agents working').value).toHaveTextContent('3')
    expect(fact('Agents working').sub).toHaveTextContent('1 planning · 2 building')
  })

  it('names every working role and says none right now at zero', () => {
    renderFacts({ agents: agents({ review: 1, test: 2, conversation: 1, other: 1 }) })
    expect(fact('Agents working').sub).toHaveTextContent('1 reviewing · 2 testing · 1 conversation · 1 other')
    cleanup()

    renderFacts({ agents: agents({ conversation: 2 }) })
    expect(fact('Agents working').sub).toHaveTextContent('2 conversations')
    cleanup()

    renderFacts()
    expect(fact('Agents working').value).toHaveTextContent('0')
    expect(fact('Agents working').sub).toHaveTextContent('none right now')
  })

  it('shows the first needs-you ask, or nothing waiting', () => {
    renderFacts({ needsYou: [needsYouItem('Approve the plan'), needsYouItem('Answer the question')] })
    expect(fact('Needs you').value).toHaveTextContent('2')
    expect(fact('Needs you').sub).toHaveTextContent('Approve the plan')
    cleanup()

    renderFacts()
    expect(fact('Needs you').sub).toHaveTextContent('nothing waiting')
  })

  it('names the PRs in review', () => {
    renderFacts({ inReview: { count: 1, prNumbers: [5127] } })
    expect(fact('In review').sub).toHaveTextContent('PR #5127')
    cleanup()
    renderFacts({ inReview: { count: 2, prNumbers: [1, 2] } })
    expect(fact('In review').sub).toHaveTextContent('PR #1, #2')
    cleanup()
    renderFacts({ inReview: { count: 3, prNumbers: [1, 2, 3] } })
    expect(fact('In review').sub).toHaveTextContent('3 PRs')
    cleanup()
    renderFacts({ inReview: { count: 1, prNumbers: [] } })
    expect(fact('In review').value).toHaveTextContent('1')
    expect(fact('In review').sub).toHaveTextContent('—')
  })

  it('counts landed commits, caps at 500+ and counts those via PRs', () => {
    const commits = Array.from({ length: 500 }, (_, i) => commit(i < 3 ? `feat: thing (#${i + 1})` : `chore: direct ${i}`, i))
    renderFacts({ changes: { data: { projectKey: 'wfx', branch: 'main', commits }, isLoading: false, isError: false } })
    expect(fact('Landed this week').value).toHaveTextContent('500+')
    expect(fact('Landed this week').sub).toHaveTextContent('3 via PRs')
    cleanup()

    renderFacts({
      changes: { data: { projectKey: 'wfx', branch: 'main', commits: [commit('a', 1), commit('b', 2)] }, isLoading: false, isError: false },
    })
    expect(fact('Landed this week').value).toHaveTextContent('2')
    expect(fact('Landed this week').sub).toHaveTextContent('commits go to main')
    cleanup()

    renderFacts({ changes: { isLoading: false, isError: true } })
    expect(fact('Landed this week').value).toHaveTextContent('—')
    expect(fact('Landed this week').sub).toHaveTextContent('unavailable')
    cleanup()

    renderFacts({ changes: { isLoading: true, isError: false } })
    expect(fact('Landed this week').value).toHaveTextContent('…')
  })

  it('shows spend in the cyan money color with today below', () => {
    renderFacts({ spend: { week: 412, today: 43 } })
    expect(fact('Spend this week').value).toHaveTextContent('$412')
    expect(fact('Spend this week').value).toHaveClass('text-signal-cost-foreground')
    expect(fact('Spend this week').sub).toHaveTextContent('$43 today')
    cleanup()

    renderFacts({ spend: null, spendUnavailable: true })
    expect(fact('Spend this week').value).toHaveTextContent('—')
    expect(fact('Spend this week').value).not.toHaveClass('text-signal-cost-foreground')
    expect(fact('Spend this week').sub).toHaveTextContent('needs an issue prefix')
  })

  it('shows — and unavailable when spend fails, even over stale data (PAN-5370)', () => {
    renderFacts({ spend: null, spendError: true })
    expect(fact('Spend this week').value).toHaveTextContent('—')
    expect(fact('Spend this week').value).not.toHaveClass('text-signal-cost-foreground')
    expect(fact('Spend this week').sub).toHaveTextContent('unavailable')
    cleanup()

    renderFacts({ spend: { week: 412, today: 43 }, spendError: true })
    expect(fact('Spend this week').value).toHaveTextContent('—')
    expect(fact('Spend this week').sub).toHaveTextContent('unavailable')
    cleanup()

    renderFacts({ spend: null, spendUnavailable: true, spendError: true })
    expect(fact('Spend this week').sub).toHaveTextContent('needs an issue prefix')
    cleanup()

    renderFacts({ spend: null })
    expect(fact('Spend this week').value).toHaveTextContent('…')
  })

  it('calls each fact handler exactly once', () => {
    const h = renderFacts()
    fireEvent.click(fact('Agents working').el)
    fireEvent.click(fact('Needs you').el)
    fireEvent.click(fact('In review').el)
    fireEvent.click(fact('Landed this week').el)
    fireEvent.click(fact('Spend this week').el)
    expect(h.onAgents).toHaveBeenCalledTimes(1)
    expect(h.onNeedsYou).toHaveBeenCalledTimes(1)
    expect(h.onInReview).toHaveBeenCalledTimes(1)
    expect(h.onLanded).toHaveBeenCalledTimes(1)
    expect(h.onSpend).toHaveBeenCalledTimes(1)
  })
})

describe('landedSummary and formatCost', () => {
  it('counts subjects that end in a PR number', () => {
    expect(landedSummary([commit('fix (#12)', 1), commit('fix #12', 2), commit('(#3) first', 3)])).toEqual({
      count: 3,
      viaPrs: 1,
      capped: false,
    })
  })

  it('formats costs with precision that follows the size', () => {
    expect(formatCost(412)).toBe('$412')
    expect(formatCost(43)).toBe('$43.0')
    expect(formatCost(1.25)).toBe('$1.25')
    expect(formatCost(0)).toBe('$0')
  })
})
