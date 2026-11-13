/**
 * Requests that must leave the browser before React mounts (PAN-5178).
 *
 * A tab open sends about 45 REST requests in one React commit. On an
 * HTTP/1.1 origin Chromium sends 6 at a time, so a request issued late
 * waits 1 to 2 s in the browser; on HTTP/2 it reaches a busy server last.
 * The session mint gates every /ws/rpc call (WsTransport awaits it), so it
 * is sent here, first. Callers that need it later share the same promise.
 */
import type { QueryClient } from '@tanstack/react-query'

import { getIssueIdFromPath } from '../App/routes'
import { sharedRouteCode } from '../components/chat/sharing/joinApi'
import { fetchIssueRecord, issueRecordQueryKey } from '../components/issue-view/useIssueRecord'
import { ensureDashboardSession } from './wsTransport'

export interface BootLocation { readonly pathname: string; readonly search: string; readonly hash: string }

/** The issue a page load names: `?issue=<ID>` on any route, else `/issues/<ID>`. */
export function deepLinkedIssueId(location: BootLocation): string | null {
  const fromQuery = new URLSearchParams(location.search).get('issue')?.trim()
  if (fromQuery) return fromQuery
  const fromPath = getIssueIdFromPath(location.pathname)?.trim()
  return fromPath ? fromPath : null
}

export function startBootRequests(queryClient: QueryClient, location: BootLocation = window.location): void {
  if (sharedRouteCode(location.hash)) return
  const session = ensureDashboardSession()
  void session.catch(() => {})
  const issueId = deepLinkedIssueId(location)
  if (!issueId) return
  const queryKey = issueRecordQueryKey(issueId)
  const prefetch = queryClient.prefetchQuery({
    queryKey,
    queryFn: () => fetchIssueRecord(issueId),
    staleTime: 30_000,
  })
  // D-4a: a first visit (#pair=, #overdeck_token=) has no credential until the
  // session settles, so the early read may answer 401. Refetch it then.
  void Promise.allSettled([prefetch, session]).then(([, sessionResult]) => {
    if (sessionResult.status !== 'fulfilled') return
    if (queryClient.getQueryState(queryKey)?.status !== 'error') return
    void queryClient.invalidateQueries({ queryKey, exact: true })
  })
}
