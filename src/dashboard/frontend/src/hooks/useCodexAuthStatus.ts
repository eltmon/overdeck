import { useQuery } from '@tanstack/react-query';

export interface CodexAuthStatus {
  status: 'valid' | 'expired' | 'burned' | 'missing' | 'unknown';
  email?: string;
  expiresAt?: string;
  message?: string;
  /** Which store the status came from: 'native' (~/.codex) or 'cliproxy'. PAN-2285. */
  source?: 'native' | 'cliproxy';
  /** Session ids whose newest Codex turn failed on sign-in. PAN-5633. */
  affectedAgents?: string[];
}

/**
 * PAN-5633: poll every 30 s. The server caches its live-session scan for 15 s,
 * so the banner appears within about 45 s of a failed turn.
 */
export const CODEX_AUTH_REFETCH_MS = 30_000;
export const CODEX_AUTH_STALE_MS = 15_000;

export async function fetchCodexAuthStatus(): Promise<CodexAuthStatus> {
  const res = await fetch('/api/settings/codex-auth');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch Codex auth status (${res.status}): ${body}`);
  }
  return res.json();
}

export function useCodexAuthStatus() {
  return useQuery<CodexAuthStatus>({
    queryKey: ['codex-auth-status'],
    queryFn: fetchCodexAuthStatus,
    refetchInterval: CODEX_AUTH_REFETCH_MS,
    staleTime: CODEX_AUTH_STALE_MS,
  });
}
