import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ActivitySection } from '../../CommandDeck/ZoneCOverviewTabs/queries'

const queryMocks = vi.hoisted(() => ({
  activityQuery: { data: { sections: [] as ActivitySection[] } },
  reviewStatusQuery: { data: null },
}))

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useActivityQuery: () => queryMocks.activityQuery,
  useReviewStatusQuery: () => queryMocks.reviewStatusQuery,
}))

import { HappenedFeed } from './HappenedFeed'

function renderHappenedFeed() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <HappenedFeed issueId="PAN-2598" />
    </QueryClientProvider>,
  )
}

describe('HappenedFeed', () => {
  beforeEach(() => {
    queryMocks.activityQuery.data = { sections: [] }
    queryMocks.reviewStatusQuery.data = null
    global.fetch = vi.fn(async (url) => {
      if (String(url).startsWith('/api/workspaces/')) {
        return Response.json({})
      }
      return Response.json({})
    }) as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders no "finished the plan" line for a live idle planning section', () => {
    queryMocks.activityQuery.data.sections = [
      {
        type: 'planning',
        sessionId: 'planning-pan-2598',
        model: 'claude-sonnet-5',
        startedAt: '2026-07-13T00:00:00Z',
        duration: null,
        status: 'running',
      },
    ]

    renderHappenedFeed()

    expect(screen.getByText(/started planning what to build/)).toBeTruthy()
    expect(screen.queryByText(/finished the plan/)).toBeNull()
  })

  it('renders the "finished the plan" line when planning ended and planningComplete is true', () => {
    queryMocks.activityQuery.data.sections = [
      {
        type: 'planning',
        sessionId: 'planning-pan-2598',
        model: 'claude-sonnet-5',
        startedAt: '2026-07-13T00:00:00Z',
        duration: 600,
        status: 'stopped',
        endedAt: '2026-07-13T00:10:00Z',
        planningComplete: true,
      },
    ]

    renderHappenedFeed()

    expect(screen.getByText(/finished the plan/)).toBeTruthy()
  })

  it('renders a "stopped planning" line when planning ended without planningComplete', () => {
    queryMocks.activityQuery.data.sections = [
      {
        type: 'planning',
        sessionId: 'planning-pan-2598',
        model: 'claude-sonnet-5',
        startedAt: '2026-07-13T00:00:00Z',
        duration: 120,
        status: 'stopped',
        endedAt: '2026-07-13T00:02:00Z',
        planningComplete: false,
      },
    ]

    renderHappenedFeed()

    expect(screen.getByText(/stopped planning/)).toBeTruthy()
    expect(screen.queryByText(/finished the plan/)).toBeNull()
  })

  it('renders a waiting-on-you line when a live section is awaitingInput', () => {
    queryMocks.activityQuery.data.sections = [
      {
        type: 'planning',
        sessionId: 'planning-pan-2598',
        model: 'claude-sonnet-5',
        startedAt: '2026-07-13T00:00:00Z',
        duration: null,
        status: 'running',
        awaitingInput: true,
      },
    ]

    renderHappenedFeed()

    expect(screen.getByText(/Waiting on you to answer a question/)).toBeTruthy()
  })

  it('still renders the done-line for a genuinely ended work session', () => {
    queryMocks.activityQuery.data.sections = [
      {
        type: 'work',
        sessionId: 'agent-pan-2598',
        model: 'gpt-5.5',
        startedAt: '2026-07-13T00:00:00Z',
        duration: 300,
        status: 'stopped',
        endedAt: '2026-07-13T00:05:00Z',
      },
    ]

    renderHappenedFeed()

    expect(screen.getByText(/finished its coding session/)).toBeTruthy()
  })
})
