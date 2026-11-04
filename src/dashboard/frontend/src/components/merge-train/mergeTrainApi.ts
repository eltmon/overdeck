/**
 * Thin fetch helpers for the merge-train view's `/api/merge-train/*` reads
 * and mutations (moved out of MergeTrainView.tsx, PAN-4970, no behavior
 * change — file-size extraction only).
 */
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * PAN-4970: a failed POST carries the door's HTTP status and, when the
 * server sent one, its machine-readable `reason` (e.g. `wrong-status`,
 * `not-found`, `merge-failed`) — so a caller can tell "this card is stale"
 * from "the merge itself failed" without parsing the message text.
 */
export class MergeTrainRequestError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) {
    super(message);
    this.name = 'MergeTrainRequestError';
  }
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: body === undefined ? '{}' : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; reason?: unknown };
  if (!res.ok) {
    throw new MergeTrainRequestError(
      payload.error ?? payload.message ?? `${url} → ${res.status}`,
      res.status,
      typeof payload.reason === 'string' ? payload.reason : undefined,
    );
  }
  return payload;
}

export function generationParam(name: string): string {
  return encodeURIComponent(name.replace(/^uat\//, ''));
}
