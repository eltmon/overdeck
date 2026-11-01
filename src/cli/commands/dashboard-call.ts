/**
 * Call the running dashboard from a CLI verb with this machine's internal token
 * (PAN-3762; moved out of `pair.ts` in PAN-4645 so `pan machines` and
 * `pan pair` share it without an import cycle). Imports only Commander-free
 * leaf code; config and the token module load inside the call.
 */
export class DashboardUnreachableError extends Error {}

/** Call the running dashboard with the internal token. Throws DashboardUnreachableError when nothing answers. */
export async function callDashboard(path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }): Promise<Response> {
  const { getDashboardApiUrl } = await import('../../lib/config.js');
  const { ensureInternalToken, INTERNAL_TOKEN_HEADER } = await import('../../lib/internal-token.js');
  try {
    return await fetch(`${getDashboardApiUrl()}${path}`, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', ...init.headers, [INTERNAL_TOKEN_HEADER]: ensureInternalToken() },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new DashboardUnreachableError((error as Error).message);
  }
}

export function isDashboardUnreachable(error: unknown): boolean {
  return error instanceof DashboardUnreachableError;
}

/** The dashboard's `{ error }` body, else the HTTP status. */
export async function errorText(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown; message?: unknown } | null;
  if (typeof body?.message === 'string') return body.message;
  return typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
}
