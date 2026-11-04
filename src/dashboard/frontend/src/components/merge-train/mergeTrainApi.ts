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

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: body === undefined ? '{}' : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(payload.error ?? payload.message ?? `${url} → ${res.status}`);
  return payload;
}

export function generationParam(name: string): string {
  return encodeURIComponent(name.replace(/^uat\//, ''));
}
