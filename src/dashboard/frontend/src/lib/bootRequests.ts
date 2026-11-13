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

import { sharedRouteCode } from '../components/chat/sharing/joinApi'
import { ensureDashboardSession } from './wsTransport'

export interface BootLocation { readonly pathname: string; readonly search: string; readonly hash: string }

export function startBootRequests(_queryClient: QueryClient, location: BootLocation = window.location): void {
  if (sharedRouteCode(location.hash)) return
  void ensureDashboardSession().catch(() => {})
}
