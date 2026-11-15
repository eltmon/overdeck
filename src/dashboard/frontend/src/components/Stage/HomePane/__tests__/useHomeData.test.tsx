import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ProjectChanges } from '@overdeck/contracts'
import { installStrictFetchMock } from '../../../../test-utils/strictFetchMock'
import { useProjectChanges, useProjectSpend } from '../useHomeData'

const CHANGES: ProjectChanges = {
  projectKey: 'my proj',
  branch: 'main',
  commits: [{
    sha: 'abc1234def',
    shortSha: 'abc1234',
    subject: 'fix: a thing (#12)',
    authoredAt: '2026-11-15T09:00:00.000Z',
    by: { kind: 'conversation', id: 'conv-1', title: 'Fix a thing' },
  }],
}

let fetchControl: ReturnType<typeof installStrictFetchMock>

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function requestedUrls(): string[] {
  return fetchControl.fetchMock.mock.calls.map(([url]) => String(url))
}

beforeEach(() => {
  fetchControl = installStrictFetchMock(({ method, url }) => {
    if (method !== 'GET') return undefined
    if (url === '/api/projects/my%20proj/changes?since=7d') return Response.json(CHANGES)
    if (url === '/api/costs/summary?project=PAN') {
      return Response.json({ today: { totalCost: 43 }, week: { totalCost: 412 }, month: { totalCost: 900 } })
    }
    return undefined
  })
})

afterEach(async () => {
  cleanup()
  await fetchControl.assertNoUnexpectedRequests()
  vi.unstubAllGlobals()
})

describe('useProjectChanges (PAN-5294 G-D13)', () => {
  it('asks for seven days of changes under the encoded project key', async () => {
    const { result } = renderHook(() => useProjectChanges('my proj'), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(CHANGES))
    expect(requestedUrls()).toEqual(['/api/projects/my%20proj/changes?since=7d'])
  })

  it('turns a response without a commit list into an error, not data', async () => {
    fetchControl = installStrictFetchMock(({ url }) => (url === '/api/projects/bare/changes?since=7d' ? Response.json({}) : undefined))
    const { result } = renderHook(() => useProjectChanges('bare'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('sends no request without a project key', () => {
    const { result } = renderHook(() => useProjectChanges(undefined), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(requestedUrls()).toEqual([])
  })
})

describe('useProjectSpend (PAN-5294 G-D13)', () => {
  it('maps the project cost summary to this week and today', async () => {
    const { result } = renderHook(() => useProjectSpend('PAN'), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual({ week: 412, today: 43 }))
    expect(requestedUrls()).toEqual(['/api/costs/summary?project=PAN'])
  })

  it('sends no request without an issue prefix', () => {
    const { result } = renderHook(() => useProjectSpend(null), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(requestedUrls()).toEqual([])
  })
})
