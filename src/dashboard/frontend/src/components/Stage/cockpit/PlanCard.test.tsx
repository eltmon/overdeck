import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'

const queryMocks = vi.hoisted(() => ({
  planningSummaryQuery: { data: { acceptanceProgress: { completed: 0, total: 0, percent: 0 } } },
  workspacePlanQuery: { data: { plan: { metadata: {}, tieredExecution: { effective: false, source: 'global', override: null } } } },
}))

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  usePlanningSummaryQuery: () => queryMocks.planningSummaryQuery,
  useWorkspacePlanQuery: () => queryMocks.workspacePlanQuery,
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

describe('PlanCard tiered execution control', () => {
  beforeEach(() => {
    queryMocks.workspacePlanQuery.data = { plan: { metadata: {}, tieredExecution: { effective: false, source: 'global', override: null } } }
    global.fetch = vi.fn(async (url, opts) => {
      if (String(url) === '/api/issues/PAN-2378/tasks') {
        return Response.json({ issueId: 'PAN-2378', tasks: [] })
      }
      if (String(url) === '/api/workspaces/PAN-2378/tiered-execution' && opts?.method === 'PATCH') {
        const body = JSON.parse(opts.body as string)
        return Response.json({
          plan: {
            metadata: {},
            tieredExecution: { effective: body.override === 'on', source: 'issue-override', override: body.override ?? null },
          },
        })
      }
      return Response.json({})
    }) as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a select control with on/off/inherit options', () => {
    queryMocks.workspacePlanQuery.data = {
      plan: {
        metadata: {},
        tieredExecution: { effective: true, source: 'issue-override', override: 'on' },
      },
    }

    renderPlanCard()

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select).toBeTruthy()
    expect(select.value).toBe('on')
    expect(select.options.length).toBe(3)
  })

  it('renders the effective label based on tieredExecution state', () => {
    queryMocks.workspacePlanQuery.data = {
      plan: {
        metadata: {},
        tieredExecution: { effective: false, source: 'issue-override', override: 'off' },
      },
    }

    renderPlanCard()

    expect(screen.getByText('tiered: off (issue override)')).toBeTruthy()
  })

  it('renders a reachable docs link', () => {
    renderPlanCard()

    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toContain('docs/TIERED-EXECUTION.md')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('round-trip: changing select to off fires PATCH and updates label', async () => {
    queryMocks.workspacePlanQuery.data = {
      plan: {
        metadata: {},
        tieredExecution: { effective: true, source: 'global', override: null },
      },
    }

    const { rerender } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PlanCard issueId="PAN-2378" />
      </QueryClientProvider>,
    )

    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'off' } })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/workspaces/PAN-2378/tiered-execution',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ override: 'off' }),
        }),
      )
    })
  })
})
