/** Shared helpers for the Session Vault section and its setup and join forms (PAN-4307, PAN-4446). */
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';

/** POST to `/api/vault/<path>` with the dashboard session; returns the status and parsed body (null when not JSON). */
export async function postVault(path: string, body?: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  await ensureDashboardSession();
  const res = await fetch(`/api/vault/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(body ?? {}),
  });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

/** The message to show for a refused setup or join: the server's, or its `error` field, or a fallback. */
export function vaultErrorMessage(body: unknown, fallback: string): string {
  const record = body as { message?: unknown; error?: unknown } | null;
  if (typeof record?.message === 'string') return record.message;
  if (typeof record?.error === 'string') return record.error;
  return fallback;
}

export const INPUT_CLASS = 'mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm text-foreground';
export const BUTTON_CLASS = 'text-xs px-2 py-1 rounded-md border border-border bg-background hover:bg-muted/50 disabled:opacity-50';
