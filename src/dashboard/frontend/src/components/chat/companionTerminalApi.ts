/**
 * Companion terminal API (PAN-3974). The browser names only the conversation;
 * the server resolves everything that runs. Bodies carry nothing but the
 * generation Close must match.
 */
import type { CompanionTerminalState } from '@overdeck/contracts';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';

export type CompanionCloseResult =
  | CompanionTerminalState
  | { status: 'stale-generation'; message: string };

async function post<T>(name: string, action: 'open' | 'close', body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/companion-terminal/${action}`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null) as ({ status?: string; error?: string } & Record<string, unknown>) | null;
  // Unavailable/stale states come back with 4xx codes but a readable state body.
  if (payload && typeof payload.status === 'string') return payload as T;
  throw new Error(payload?.error || `Terminal ${action} failed (${res.status})`);
}

export function openCompanionTerminal(name: string): Promise<CompanionTerminalState> {
  return post<CompanionTerminalState>(name, 'open', {});
}

export function closeCompanionTerminal(name: string, generation: string): Promise<CompanionCloseResult> {
  return post<CompanionCloseResult>(name, 'close', { generation });
}
