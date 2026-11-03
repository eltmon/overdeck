/**
 * PAN-4849 WI-6: Deft data hooks. "Is Deft" comes only from the batched
 * summary list, and the per-issue state is fetched only for a Deft issue.
 */
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

import golden from '../../../../../lib/deft/__tests__/fixtures/deft-issue-state.golden.json';
import { useDeftIssueState, useDeftIssueSummary, useResolveEscalation } from './queries';

const SUMMARY = {
  issueId: 'PAN-1',
  scopeCounts: { proposed: 1, pending: 1, active: 1, completed: 1, cancelled: 1 },
  specDriftUnresolved: 1,
  installDrift: 0,
  handoffState: 'pr_open',
  openEscalations: 3,
};

const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url === '/api/deft/issues') return new Response(JSON.stringify({ issues: [SUMMARY] }));
  if (url === '/api/issues/PAN-1/deft') return new Response(JSON.stringify(golden));
  if (url.endsWith('/resolve')) return new Response(JSON.stringify({ resolved: true, delivered: true }));
  return new Response('{}', { status: 404 });
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useDeftIssueSummary', () => {
  it('finds a Deft issue case-insensitively', async () => {
    const { result } = renderHook(() => useDeftIssueSummary('pan-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isDeft).toBe(true));
    expect(result.current.summary).toEqual(SUMMARY);
  });

  it('reports isDeft false for an issue not in the list', async () => {
    const { result } = renderHook(() => useDeftIssueSummary('PAN-2'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ isDeft: false, summary: null });
  });

  it('reads a malformed list response as not Deft instead of throwing', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}'));
    const { result } = renderHook(() => useDeftIssueSummary('PAN-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isDeft).toBe(false);
  });
});

describe('useDeftIssueState', () => {
  it('fetches the state of a Deft issue', async () => {
    const { result } = renderHook(() => useDeftIssueState('PAN-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual(golden));
  });

  it('issues no state fetch for a non-Deft issue', async () => {
    const { result } = renderHook(() => ({ summary: useDeftIssueSummary('PAN-2'), state: useDeftIssueState('PAN-2') }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.summary.isLoading).toBe(false));
    expect(result.current.state.fetchStatus).toBe('idle');
    expect(fetchMock.mock.calls.map(call => call[0])).not.toContain('/api/issues/PAN-2/deft');
  });
});

describe('useResolveEscalation', () => {
  it('POSTs the decision to the resolve route', async () => {
    const { result } = renderHook(() => useResolveEscalation('PAN-1'), { wrapper: wrapper() });
    await result.current.mutateAsync({ escId: 'esc-20261102120000-aaaaaa', decision: 'approved' });
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/resolve'))!;
    expect(call[0]).toBe('/api/issues/PAN-1/deft/escalations/esc-20261102120000-aaaaaa/resolve');
    expect(call[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
  });
});
