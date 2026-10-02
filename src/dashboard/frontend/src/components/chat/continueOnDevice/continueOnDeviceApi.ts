import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import { requestSettingsSection } from '../../../lib/settingsSection';

/**
 * PAN-4455: the HTTP calls behind the "Continue on another device" dialog and
 * the vault rows' "Check for new conversations" entry.
 */

/** Mirrors `HandOffBody` in src/dashboard/server/services/vault-handoff.ts (PAN-4455 D-9). */
export type HandOffBody =
  | {
      result: 'saved';
      vaultId: string;
      version: number;
      savedAt: string;
      title: string;
      machineLabel: string;
      logLines: number;
      alreadySaved: boolean;
      forkedFrom: { vaultId: string; version: number } | null;
      wipProblem: { message: string; fix: string | null } | null;
    }
  | { result: 'blocked'; error: string; hits: Array<{ line: number; pattern: string }>; fixes: string[] }
  | { result: 'offline'; error: string; fix: string }
  | { result: 'not-saved'; reason: 'diverged' | 'excluded' | 'empty'; error: string }
  | { result: 'unsupported-harness'; error: string }
  | { result: 'vault-unavailable'; state: 'off' | 'rotation-pending' | 'key-missing' | 'key-mismatch'; error: string }
  | { result: 'not-found'; error: string };

/** Same key as Settings → Session Vault, so both read one cache entry. */
export const VAULT_STATUS_QUERY_KEY = ['vault-status'];

async function readBody(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/** FR-8: settle this conversation into the vault now. */
export async function handOffConversation(name: string): Promise<{ status: number; body: HandOffBody | { error?: string } | null }> {
  const res = await fetch(`/api/vault/sessions/by-conversation/${encodeURIComponent(name)}/settle`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: '{}',
  });
  return { status: res.status, body: (await readBody(res)) as HandOffBody | { error?: string } | null };
}

/** PAN-4446 Sync now: one queued sync on the primary dashboard. */
export async function syncVaultNow(): Promise<{ status: number; body: unknown }> {
  const res = await fetch('/api/vault/sync', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: '{}',
  });
  return { status: res.status, body: await readBody(res) };
}

export async function fetchVaultStatus(): Promise<{ running: boolean; state: string }> {
  const res = await fetch('/api/vault/status');
  if (!res.ok) throw new Error(`Failed to fetch vault status (${res.status})`);
  return res.json();
}

/** Navigate to Settings and scroll to the Session Vault section. */
export function openSessionVaultSettings(): void {
  requestSettingsSection('session-vault');
  window.history.pushState({ tab: 'settings' }, '', '/settings');
  window.dispatchEvent(new PopStateEvent('popstate'));
}
