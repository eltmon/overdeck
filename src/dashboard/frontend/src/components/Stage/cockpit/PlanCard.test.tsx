import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryMocks = vi.hoisted(() => ({
  planningSummaryQuery: { data: { acceptanceProgress: { completed: 0, total: 0, percent: 0 } } },
  workspacePlanQuery: { data: { plan: { metadata: {} } } },
  settingsQuery: { data: { tiered_execution: { enabled: false } } },
}))

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  usePlanningSummaryQuery: () => queryMocks.planningSummaryQuery,
  useWorkspacePlanQuery: () => queryMocks.workspacePlanQuery,
  useSettingsQuery: () => queryMocks.settingsQuery,
}))

import { PlanCard } from './PlanCard'

function renderPlanCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <PlanCard issueId="PAN-2378" />
    </QueryClientProvider>,
  )
}

describe('PlanCard tiered execution chip', () => {
  beforeEach(() => {
    queryMocks.workspacePlanQuery.data = { plan: { metadata: {} } }
    queryMocks.settingsQuery.data = { tiered_execution: { enabled: false } }
    global.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/issues/PAN-2378/beads') {
        return Response.json({ issueId: 'PAN-2378', tasks: [] })
      }
      return Response.json({})
    }) as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the on override chip as read-only with the docs link', () => {
    queryMocks.workspacePlanQuery.data = { plan: { metadata: { tiered_execution: 'on' } } }

    renderPlanCard()

    const chip = screen.getByRole('link', { name: 'tiered: on (issue override)' })
    expect(chip.getAttribute('href')).toContain('docs/TIERED-EXECUTION.md')
    expect(screen.queryByRole('button', { name: /tiered:/ })).toBeNull()
  })

  it('renders the off override chip', () => {
    queryMocks.workspacePlanQuery.data = { plan: { metadata: { tiered_execution: 'off' } } }
    queryMocks.settingsQuery.data = { tiered_execution: { enabled: true } }

    renderPlanCard()

    expect(screen.getByRole('link', { name: 'tiered: off (issue override)' })).toBeTruthy()
  })

  it('renders the inherited global chip when no issue override exists', () => {
    queryMocks.settingsQuery.data = { tiered_execution: { enabled: true } }

    renderPlanCard()

    expect(screen.getByRole('link', { name: 'tiered: on (global)' })).toBeTruthy()
  })
})
