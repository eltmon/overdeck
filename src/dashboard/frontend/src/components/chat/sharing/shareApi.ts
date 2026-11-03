/**
 * Client for the Shared Sessions host routes (PAN-4473 WI-7): `GET/POST /api/shares`,
 * `POST /api/shares/:code/commands`, `POST /api/shares/:code/prompts` (PAN-4476), `DELETE /api/shares/:code`. The share dialog polls the list
 * once a second while it is open (D-6); the snapshot lives in the dashboard server's memory, so a
 * poll is a local read.
 */
import { useQuery } from '@tanstack/react-query';
import type { ListSharesResponse, SendSharePromptRequest, ShareCommand, ShareView } from '@overdeck/contracts';

import { fetchWithTimeout } from '../../../lib/apiFetch';
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';

export const SHARES_QUERY_KEY = ['shares'] as const;
export const SHARES_POLL_MS = 1_000;

/** A non-2xx answer from a share route, carrying the route's `error` code and `message`. */
export class ShareApiError extends Error {
  constructor(readonly status: number, readonly error: string, message: string) {
    super(message);
    this.name = 'ShareApiError';
  }
}

async function failure(response: Response): Promise<ShareApiError> {
  const body = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  const error = typeof body?.error === 'string' ? body.error : `http_${response.status}`;
  const message = typeof body?.message === 'string' ? body.message : error;
  return new ShareApiError(response.status, error, message);
}

export async function listShares(): Promise<ShareView[]> {
  const response = await fetchWithTimeout('/api/shares');
  if (!response.ok) throw await failure(response);
  return ((await response.json()) as ListSharesResponse).shares.slice();
}

export async function createShare(conversationName: string): Promise<ShareView> {
  const response = await fetch('/api/shares', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ conversationName }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as ShareView;
}

export async function sendShareCommand(shortCode: string, command: ShareCommand): Promise<void> {
  const response = await fetch(`/api/shares/${encodeURIComponent(shortCode)}/commands`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(command),
  });
  if (!response.ok) throw await failure(response);
}

/** Queues a controller send; resolves to its 1-based queue position. */
export async function sendSharePrompt(shortCode: string, body: SendSharePromptRequest): Promise<{ position: number }> {
  const response = await fetch(`/api/shares/${encodeURIComponent(shortCode)}/prompts`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  const answer = (await response.json()) as { position?: unknown };
  return { position: typeof answer.position === 'number' ? answer.position : 0 };
}

export async function endShare(shortCode: string): Promise<void> {
  const response = await fetch(`/api/shares/${encodeURIComponent(shortCode)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  });
  if (!response.ok) throw await failure(response);
}

export function useShares({ enabled }: { enabled: boolean }) {
  return useQuery({ queryKey: SHARES_QUERY_KEY, queryFn: listShares, enabled, refetchInterval: SHARES_POLL_MS });
}
