import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDashboardStore } from '../../lib/store'
import type { Issue } from '../../types'
import { issueRecordQueryKey, useIssueRecord } from './useIssueRecord'

function wrapper(client: QueryClient) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function issue(overrides: Partial<Issue> & Pick<Issue, 'id' | 'identifier' | 'title'>): Issue {
  return {
    status: 'open',
    priority: 0,
    labels: [],
    url: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Issue
}

beforeEach(() => {
  useDashboardStore.setState({ issuesRaw: [] } as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useIssueRecord (PAN-5171)', () => {
  it('returns the listed issue without calling fetch', () => {
    useDashboardStore.setState({ issuesRaw: [issue({ id: 'pan-1', identifier: 'PAN-1', title: 'Listed title' })] } as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useIssueRecord('PAN-1'), { wrapper: wrapper(queryClient()) })

    expect(result.current).toEqual({ issue: expect.objectContaining({ identifier: 'PAN-1' }), status: 'ready' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches and returns the row when the list is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => issue({ id: 'pan-2', identifier: 'PAN-2', title: 'Fetched title' }),
    }))

    const { result } = renderHook(() => useIssueRecord('PAN-2'), { wrapper: wrapper(queryClient()) })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.issue?.title).toBe('Fetched title')
  })

  it('returns loading while the fetch is unresolved', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    const { result } = renderHook(() => useIssueRecord('PAN-3'), { wrapper: wrapper(queryClient()) })

    expect(result.current.status).toBe('loading')
  })

  it('maps a 404 to not-found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Issue not found' }) }))

    const { result } = renderHook(() => useIssueRecord('PAN-4'), { wrapper: wrapper(queryClient()) })

    await waitFor(() => expect(result.current.status).toBe('not-found'))
    expect(result.current.issue).toBeNull()
  })

  it('maps a 503 to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Issue tracker unavailable' }) }))

    const { result } = renderHook(() => useIssueRecord('PAN-5'), { wrapper: wrapper(queryClient()) })

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.issue).toBeNull()
  })

  it('maps a malformed body to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }))

    const { result } = renderHook(() => useIssueRecord('PAN-6'), { wrapper: wrapper(queryClient()) })

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.issue).toBeNull()
  })

  it('prefers the list row once it arrives after the fetch answered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => issue({ id: 'pan-7', identifier: 'PAN-7', title: 'Fetched title' }),
    }))

    const { result } = renderHook(() => useIssueRecord('PAN-7'), { wrapper: wrapper(queryClient()) })

    await waitFor(() => expect(result.current.issue?.title).toBe('Fetched title'))

    act(() => {
      useDashboardStore.setState({ issuesRaw: [issue({ id: 'pan-7', identifier: 'PAN-7', title: 'List title' })] } as never)
    })

    await waitFor(() => expect(result.current.issue?.title).toBe('List title'))
    expect(result.current.status).toBe('ready')
  })

  it('builds the query key uppercased', () => {
    expect(issueRecordQueryKey('pan-1')).toEqual(['issue', 'PAN-1'])
  })
})
