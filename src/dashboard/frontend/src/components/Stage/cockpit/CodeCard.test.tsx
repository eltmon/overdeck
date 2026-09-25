import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// PAN-3822: the issue cockpit's Code card lists the conversations linked to
// the issue's PR (reverse index), and refetches when links change.

const PR_URL = 'https://github.com/eltmon/overdeck/pull/4067'

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  usePrQuery: () => ({
    isLoading: false,
    data: {
      pr: {
        number: 4067, url: PR_URL, state: 'OPEN', isDraft: false, additions: 10, deletions: 2,
        changedFiles: 3, reviewDecision: null, files: [],
      },
    },
  }),
}))

import { CodeCard } from './CodeCard'
import { useDashboardStore } from '../../../lib/store'

const fetchMock = vi.fn()

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CodeCard issueId="PAN-3822" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CodeCard linked conversations (PAN-3822)', () => {
  it('lists each linked conversation with a /conv link and its source', async () => {
    fetchMock.mockResolvedValue(Response.json({
      conversations: [
        { id: 12, name: 'agent-pan-3822', title: 'Work on PAN-3822', source: 'created', linkedAt: '2026-09-24T00:00:00.000Z' },
        { id: 13, name: 'chat', title: null, source: 'manual', linkedAt: '2026-09-24T00:00:00.000Z' },
      ],
    }))
    renderCard()

    const first = await screen.findByRole('link', { name: /Work on PAN-3822/ })
    expect(first).toHaveAttribute('href', '/conv/12')
    expect(first).toHaveTextContent('opened by the pipeline')
    expect(screen.getByRole('link', { name: /chat/ })).toHaveAttribute('href', '/conv/13')
    expect(fetchMock).toHaveBeenCalledWith(`/api/pull-requests/conversations?url=${encodeURIComponent(PR_URL)}`)
  })

  it('renders nothing extra when no conversation is linked, and refetches on a link change', async () => {
    fetchMock.mockResolvedValue(Response.json({ conversations: [] }))
    renderCard()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByLabelText('Linked conversations')).not.toBeInTheDocument()

    fetchMock.mockResolvedValue(Response.json({
      conversations: [{ id: 14, name: 'late', title: 'Late link', source: 'agent', linkedAt: '2026-09-24T00:00:00.000Z' }],
    }))
    act(() => {
      useDashboardStore.setState((state) => ({ conversationsListRevision: state.conversationsListRevision + 1 }))
    })

    expect(await screen.findByRole('link', { name: /Late link/ })).toHaveAttribute('href', '/conv/14')
  })
})
