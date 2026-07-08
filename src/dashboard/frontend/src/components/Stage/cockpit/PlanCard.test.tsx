import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryMocks = vi.hoisted(() => ({
  planningSummaryQuery: { data: { acceptanceProgress: { completed: 0, total: 0, percent: 0 } } },
  planResponse: {
    plan: { metadata: {} },
    tieredExecution: { effective: false, source: 'global', override: null },
  },
}))

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../CommandDeck/ZoneCOverviewTabs/queries')>()
  return {
    ...actual,
    usePlanningSummaryQuery: () => queryMocks.planningSummaryQuery,
  }
})

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
  return queryClient
}

describe('PlanCard tiered execution chip', () => {
  beforeEach(() => {
    queryMocks.planResponse = {
      plan: { metadata: {} },
      tieredExecution: { effective: false, source: 'global', override: null },
    }
    global.fetch = vi.fn(async (url, init) => {
      const href = String(url)
      if (href === '/api/workspaces/PAN-2378/plan') {
        return Response.json(queryMocks.planResponse)
      }
      if (href === '/api/workspaces/PAN-2378/tiered-execution' && init?.method === 'PATCH') {
        const { override } = JSON.parse(String(init.body)) as { override: 'on' | 'off' | null }
        queryMocks.planResponse = {
          plan: { metadata: {} },
          tieredExecution: {
            effective: override === 'off' ? false : true,
            source: override === null ? 'global' : 'issue-override',
            override,
          },
        }
        return Response.json(queryMocks.planResponse)
      }
      if (href === '/api/issues/PAN-2378/beads') {
        return Response.json({ issueId: 'PAN-2378', tasks: [] })
      }
      return Response.json({})
    }) as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the editable control with on, off, and inherit options', async () => {
    queryMocks.planResponse = {
      plan: { metadata: {} },
      tieredExecution: { effective: true, source: 'plan-metadata', override: null },
    }

    renderPlanCard()

    const control = await screen.findByRole('combobox', { name: 'Standing Crew override' })
    expect(control).toHaveValue('inherit')
    expect(screen.getByRole('option', { name: 'inherit' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'on' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'off' })).toBeTruthy()
    expect(await screen.findByText('tiered: on (plan metadata)')).toBeTruthy()
    expect(control).toBeEnabled()

    const docs = screen.getByRole('link', { name: 'Tiered execution documentation' })
    expect(docs.getAttribute('href')).toContain('docs/TIERED-EXECUTION.md')
  })

  it('renders the issue override state from the workspace plan payload', async () => {
    queryMocks.planResponse = {
      plan: { metadata: {} },
      tieredExecution: { effective: false, source: 'issue-override', override: 'off' },
    }

    renderPlanCard()

    expect(await screen.findByText('tiered: off (issue override)')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Standing Crew override' })).toHaveValue('off')
  })

  it.each([
    ['on', 'on'],
    ['inherit', null],
  ] as const)('patches %s selection as %s', async (value, override) => {
    queryMocks.planResponse = {
      plan: { metadata: {} },
      tieredExecution: { effective: false, source: 'issue-override', override: 'off' },
    }

    renderPlanCard()

    const control = await screen.findByRole('combobox', { name: 'Standing Crew override' })
    await waitFor(() => expect(control).toBeEnabled())
    fireEvent.change(control, { target: { value } })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/workspaces/PAN-2378/tiered-execution',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ override }),
        }),
      )
    })
  })

  it('patches the override and updates the workspace-plan cache from the mutation response', async () => {
    queryMocks.planResponse = {
      plan: { metadata: {} },
      tieredExecution: { effective: true, source: 'global', override: null },
    }

    const queryClient = renderPlanCard()

    const control = await screen.findByRole('combobox', { name: 'Standing Crew override' })
    fireEvent.change(control, { target: { value: 'off' } })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/workspaces/PAN-2378/tiered-execution',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ override: 'off' }),
        }),
      )
    })

    expect(await screen.findByText('tiered: off (issue override)')).toBeTruthy()
    expect(queryClient.getQueryData(['workspace-plan', 'PAN-2378'])).toMatchObject({
      tieredExecution: { effective: false, source: 'issue-override', override: 'off' },
    })
  })
})
