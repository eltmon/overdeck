import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deepLinkedIssueId } from '../bootRequests'

function wrapper(client: QueryClient) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }
}

function pathOf(url: string): string {
  return new URL(url, 'http://localhost:3000').pathname
}

describe('startBootRequests', () => {
  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState(null, '', 'http://localhost:3000/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the session mint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')

    startBootRequests(new QueryClient(), { pathname: '/', search: '', hash: '' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(requestUrl.endsWith('/api/dashboard/session')).toBe(true)
    expect(init.method).toBe('POST')
  })

  it('shares the mint with later callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')
    const { ensureDashboardSession } = await import('../wsTransport')

    startBootRequests(new QueryClient(), { pathname: '/', search: '', hash: '' })
    await ensureDashboardSession()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends nothing on the shared-conversation route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')

    startBootRequests(new QueryClient(), { pathname: '/', search: '', hash: '#/shared/bcdf-ghjk' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a refused mint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    const { startBootRequests } = await import('../bootRequests')

    startBootRequests(new QueryClient(), { pathname: '/', search: '', hash: '' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    process.off('unhandledRejection', onUnhandledRejection)
    expect(unhandledRejections).toHaveLength(0)
  })
})

describe('deepLinkedIssueId', () => {
  it('reads the issue query param on any route', () => {
    expect(deepLinkedIssueId({ pathname: '/', search: '?issue=PAN-5170', hash: '' })).toBe('PAN-5170')
  })

  it('reads an /issues/<ID> path', () => {
    expect(deepLinkedIssueId({ pathname: '/issues/PAN-5170', search: '', hash: '' })).toBe('PAN-5170')
  })

  it('returns null for an unrelated path', () => {
    expect(deepLinkedIssueId({ pathname: '/pipeline', search: '', hash: '' })).toBeNull()
  })

  it('returns null for an empty issue param', () => {
    expect(deepLinkedIssueId({ pathname: '/', search: '?issue=', hash: '' })).toBeNull()
  })
})

describe('startBootRequests deep link (PAN-5178 WI-2)', () => {
  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState(null, '', 'http://localhost:3000/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefetches the deep-linked issue', async () => {
    const fetchMock = vi.fn((url: string) => {
      const path = pathOf(url)
      if (path === '/api/dashboard/session') return Promise.resolve(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
      if (path === '/api/issues/PAN-5170') return Promise.resolve(new Response(JSON.stringify({ identifier: 'PAN-5170', id: 'PAN-5170', title: 'Real title' }), { status: 200 }))
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')
    const { issueRecordQueryKey } = await import('../../components/issue-view/useIssueRecord')
    const client = new QueryClient()

    startBootRequests(client, { pathname: '/', search: '?issue=PAN-5170', hash: '' })

    await waitFor(() => {
      const data = client.getQueryData(issueRecordQueryKey('PAN-5170')) as { title?: string } | undefined
      expect(data?.title).toBe('Real title')
    })
  })

  it('the drawer hook reuses the prefetch', async () => {
    const issueCalls: string[] = []
    const fetchMock = vi.fn((url: string) => {
      const path = pathOf(url)
      if (path === '/api/dashboard/session') return Promise.resolve(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
      if (path === '/api/issues/PAN-5170') {
        issueCalls.push(path)
        return Promise.resolve(new Response(JSON.stringify({ identifier: 'PAN-5170', id: 'PAN-5170', title: 'Real title' }), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')
    const { useIssueRecord, issueRecordQueryKey } = await import('../../components/issue-view/useIssueRecord')
    const { useDashboardStore } = await import('../store')
    useDashboardStore.setState({ issuesRaw: [] } as never)
    const client = new QueryClient()

    startBootRequests(client, { pathname: '/', search: '?issue=PAN-5170', hash: '' })
    await waitFor(() => {
      const data = client.getQueryData(issueRecordQueryKey('PAN-5170')) as { title?: string } | undefined
      expect(data?.title).toBe('Real title')
    })

    const { result } = renderHook(() => useIssueRecord('PAN-5170'), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current).toEqual({ issue: expect.objectContaining({ title: 'Real title' }), status: 'ready' }))
    expect(issueCalls).toHaveLength(1)
  })

  it('a mounted drawer recovers after a pairing first visit', async () => {
    let resolveExchange!: (response: Response) => void
    const exchangePromise = new Promise<Response>((resolve) => { resolveExchange = resolve })
    let issueCallCount = 0
    const callOrder: string[] = []
    const fetchMock = vi.fn((url: string) => {
      const path = pathOf(url)
      callOrder.push(path)
      if (path === '/api/pairing/exchange') return exchangePromise
      if (path === '/api/dashboard/session') return Promise.resolve(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
      if (path === '/api/issues/PAN-5170') {
        issueCallCount += 1
        if (issueCallCount === 1) return Promise.resolve(new Response(null, { status: 401 }))
        return Promise.resolve(new Response(JSON.stringify({ identifier: 'PAN-5170', id: 'PAN-5170', title: 'Real title' }), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState(null, '', `/?issue=PAN-5170#pair=odp_${'a'.repeat(64)}`)
    const { startBootRequests } = await import('../bootRequests')
    const { useIssueRecord } = await import('../../components/issue-view/useIssueRecord')
    const { useDashboardStore } = await import('../store')
    useDashboardStore.setState({ issuesRaw: [] } as never)
    const client = new QueryClient()

    startBootRequests(client, window.location)
    const { result } = renderHook(() => useIssueRecord('PAN-5170'), { wrapper: wrapper(client) })

    await waitFor(() => expect(issueCallCount).toBe(1))
    expect(result.current.issue?.title).not.toBe('Real title')

    resolveExchange(new Response(null, { status: 200 }))

    await waitFor(() => expect(result.current.issue?.title).toBe('Real title'))
    expect(issueCallCount).toBe(2)
    const sessionIndex = callOrder.indexOf('/api/dashboard/session')
    const secondIssueIndex = callOrder.lastIndexOf('/api/issues/PAN-5170')
    expect(sessionIndex).toBeGreaterThanOrEqual(0)
    expect(secondIssueIndex).toBeGreaterThan(sessionIndex)
  })

  it('a refused prefetch before mount is refetched', async () => {
    let issueCallCount = 0
    const fetchMock = vi.fn((url: string) => {
      const path = pathOf(url)
      if (path === '/api/dashboard/session') return Promise.resolve(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
      if (path === '/api/issues/PAN-5170') {
        issueCallCount += 1
        if (issueCallCount === 1) return Promise.resolve(new Response(null, { status: 401 }))
        return Promise.resolve(new Response(JSON.stringify({ identifier: 'PAN-5170', id: 'PAN-5170', title: 'Real title' }), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')
    const { useIssueRecord, issueRecordQueryKey } = await import('../../components/issue-view/useIssueRecord')
    const { useDashboardStore } = await import('../store')
    useDashboardStore.setState({ issuesRaw: [] } as never)
    const client = new QueryClient()

    startBootRequests(client, { pathname: '/', search: '?issue=PAN-5170', hash: '' })

    await waitFor(() => expect(client.getQueryState(issueRecordQueryKey('PAN-5170'))?.isInvalidated).toBe(true))

    const { result } = renderHook(() => useIssueRecord('PAN-5170'), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.issue?.title).toBe('Real title'))
    expect(issueCallCount).toBe(2)
  })

  it('an authenticated tab reads once', async () => {
    let resolveSession!: (response: Response) => void
    const sessionPromise = new Promise<Response>((resolve) => { resolveSession = resolve })
    const issueCalls: string[] = []
    const fetchMock = vi.fn((url: string) => {
      const path = pathOf(url)
      if (path === '/api/dashboard/session') return sessionPromise
      if (path === '/api/issues/PAN-5170') {
        issueCalls.push(path)
        return Promise.resolve(new Response(JSON.stringify({ identifier: 'PAN-5170', id: 'PAN-5170', title: 'Real title' }), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')
    const client = new QueryClient()

    startBootRequests(client, { pathname: '/', search: '?issue=PAN-5170', hash: '' })

    // The issue read is already in flight while the session mint is still
    // pending (D-4): proves the two requests run in parallel, not chained.
    expect(issueCalls).toHaveLength(1)

    resolveSession(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
    await waitFor(() => expect(issueCalls).toHaveLength(1))
  })

  it('no deep link, no issue read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')
    const client = new QueryClient()

    startBootRequests(client, { pathname: '/', search: '', hash: '' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock.mock.calls.some(([url]) => pathOf(url as string).includes('/api/issues/'))).toBe(false)
  })

  it('shared route skips the prefetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ csrfToken: 't' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { startBootRequests } = await import('../bootRequests')
    const client = new QueryClient()

    startBootRequests(client, { pathname: '/', search: '?issue=PAN-5170', hash: '#/shared/bcdf-ghjk' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
