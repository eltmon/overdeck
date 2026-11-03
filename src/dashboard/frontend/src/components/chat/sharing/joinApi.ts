/**
 * Client for the Shared Sessions viewer routes (PAN-4475 WI-9): `/api/joins*` on the viewer's own
 * dashboard server. The join intent (`createJoin`) is a same-origin, CSRF-protected POST sent only
 * after the user clicks Join (D-1). Events arrive over one `EventSource` per page (D-2, D-4).
 */
import type { IceServer, JoinEvent, JoinIceServersResponse, JoinView, SignalData } from '@overdeck/contracts';

import { fetchWithTimeout } from '../../../lib/apiFetch';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';

const SHORT_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

/** `'#/shared/bcdf-ghjk'` → `'BCDFGHJK'`; null unless the hash is a shared route with 8 alphabet symbols. */
export function sharedRouteCode(hash: string): string | null {
  const match = /^#\/shared\/([^/?#]+)\/?$/.exec(hash);
  if (!match?.[1]) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const code = raw.toUpperCase().replace(/[\s-]+/g, '');
  if (code.length !== 8) return null;
  for (const ch of code) if (!SHORT_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** A non-2xx answer from a join route, carrying the route's `error` code and `message`. */
export class JoinApiError extends Error {
  constructor(readonly status: number, readonly error: string, message: string) {
    super(message);
    this.name = 'JoinApiError';
  }
}

async function failure(response: Response): Promise<JoinApiError> {
  const body = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  const error = typeof body?.error === 'string' ? body.error : `http_${response.status}`;
  const message = typeof body?.message === 'string' ? body.message : error;
  return new JoinApiError(response.status, error, message);
}

function joinPath(code: string, suffix = ''): string {
  return `/api/joins/${encodeURIComponent(code)}${suffix}`;
}

/** Mints the session cookie first: the standalone route reads the join before anything else does. */
export async function getJoin(code: string): Promise<JoinView | null> {
  await ensureDashboardSession();
  const response = await fetchWithTimeout(joinPath(code));
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(response);
  return (await response.json()) as JoinView;
}

export async function createJoin(code: string): Promise<JoinView> {
  const response = await fetch('/api/joins', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ code }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as JoinView;
}

export async function postSignal(code: string, data: SignalData): Promise<void> {
  const response = await fetch(joinPath(code, '/signal'), {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) throw await failure(response);
}

export async function fetchJoinIceServers(code: string): Promise<IceServer[]> {
  const response = await fetch(joinPath(code, '/ice-servers'), {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
  });
  if (!response.ok) throw await failure(response);
  return [...((await response.json()) as JoinIceServersResponse).iceServers];
}

export async function leaveJoin(code: string): Promise<void> {
  const response = await fetch(joinPath(code), {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  });
  if (!response.ok && response.status !== 404) throw await failure(response);
}

export interface JoinEventHandlers {
  onEvent(event: JoinEvent): void;
  /** `closed` is true when the stream will not retry (for example a 404 after a server restart). */
  onError(closed: boolean): void;
}

function parseData(event: Event): unknown {
  try {
    return JSON.parse((event as MessageEvent<string>).data);
  } catch {
    return null;
  }
}

/** Opens the join's event stream; `close()` ends it. */
export function openJoinEvents(code: string, handlers: JoinEventHandlers): { close(): void } {
  const source = new EventSource(joinPath(code, '/events'));
  source.addEventListener('state', (event) => {
    const view = parseData(event);
    if (view && typeof view === 'object') handlers.onEvent({ type: 'state', view: view as JoinView });
  });
  source.addEventListener('signal', (event) => {
    const data = parseData(event);
    if (data && typeof data === 'object') handlers.onEvent({ type: 'signal', data: data as SignalData });
  });
  source.addEventListener('replaced', () => handlers.onEvent({ type: 'replaced' }));
  source.addEventListener('error', () => handlers.onError(source.readyState === EventSource.CLOSED));
  return { close: () => source.close() };
}
