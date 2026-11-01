/**
 * Client for the machine-link routes (PAN-4645 WI-20): the same routes
 * `pan machines link|list|unlink` call. Every fetcher returns `{ status, body }`
 * (see anywhereApi.ts) so the panel can show the server's error text.
 */
import type { LinkAccess, MachineLinkView, MachinesResponse } from '@overdeck/contracts';

import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import { apiError, type ApiResult, isOk } from './anywhereApi';

export type { InboundMachineView, LinkAccess, LinkState, MachineLinkView, MachinesResponse } from '@overdeck/contracts';

export const MACHINES_QUERY_KEY = ['anywhere-machines'] as const;

/** The server's `error` is a code for the link route; `message` carries the sentence. */
interface LinkErrorBody {
  error?: string;
  message?: string;
  detail?: string;
}

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  return { status: response.status, body };
}

export async function fetchMachines(): Promise<ApiResult<MachinesResponse>> {
  return readResult(await fetch('/api/machines'));
}

/** Query function for `['anywhere-machines']`: the machines response, or a thrown error. */
export async function loadMachines(): Promise<MachinesResponse> {
  const result = await fetchMachines();
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

export interface LinkMachineInput {
  pairingUrl: string;
  bothWays: boolean;
  access: LinkAccess;
}

export async function linkMachine(input: LinkMachineInput): Promise<ApiResult<MachineLinkView>> {
  return readResult(await fetch('/api/machines/link', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(input),
  }));
}

export async function unlinkMachine(id: string): Promise<ApiResult<{ ok: true; peerNotified: boolean }>> {
  return readResult(await fetch(`/api/machines/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

export async function removeInboundMachine(tokenId: string): Promise<ApiResult<{ ok: true }>> {
  return readResult(await fetch(`/api/machines/inbound/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

export async function reconnectMachine(id: string): Promise<ApiResult<{ ok: boolean; link: MachineLinkView }>> {
  return readResult(await fetch(`/api/machines/${encodeURIComponent(id)}/reconnect`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: '{}',
  }));
}

export async function addMachineRoute(id: string, url: string): Promise<ApiResult<MachineLinkView>> {
  return readResult(await fetch(`/api/machines/${encodeURIComponent(id)}/routes`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ url }),
  }));
}

const LINK_ERROR_TEXT: Record<string, string> = {
  'bad-pairing-url': 'That is not a pairing link. Paste the link the other machine printed.',
  'unreachable': 'Could not reach the other machine at the pairing address.',
  'pairing-refused': 'The other machine refused the pairing link. It expired or was already used; create a new one there.',
  'unsupported': 'The other machine runs an Overdeck version without machine links. Update it and try again.',
  'identity-mismatch': 'The machine that answered is not the one the pairing link names.',
  'exchange-failed': 'The other machine accepted the channel but the link exchange failed.',
};

/** The sentence to show for a failed link attempt: the server's message, else the code's text, else the status. */
export function linkErrorText(result: ApiResult<unknown>): string {
  const body = result.body as LinkErrorBody | null;
  if (typeof body?.message === 'string' && body.message !== '') return body.message;
  if (typeof body?.error === 'string' && LINK_ERROR_TEXT[body.error]) return LINK_ERROR_TEXT[body.error]!;
  return apiError(result);
}
