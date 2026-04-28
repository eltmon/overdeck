import { useQuery } from '@tanstack/react-query';

export interface CodexAuthStatus {
  status: 'valid' | 'expired' | 'burned' | 'missing' | 'unknown';
  email?: string;
  expiresAt?: string;
  message?: string;
}

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
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}
