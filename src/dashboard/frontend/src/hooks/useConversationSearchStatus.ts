import { useQuery } from '@tanstack/react-query';

export interface ConversationSearchWatcherHealthState {
  /** `failed`: restarts stopped after repeated failures (circuit breaker). */
  state: 'running' | 'restarting' | 'failed';
  restarts: number;
  lastErrorAt: string | null;
  lastErrorReason: string | null;
  nextRestartAt: string | null;
}

export interface ConversationSearchHealthState {
  lastErrorAt: string | null;
  lastErrorReason: string | null;
  lastSuccessAt: string | null;
  /** Transcript watcher state (PAN-3915); null while no watcher runs. */
  watcher?: ConversationSearchWatcherHealthState | null;
}

export interface ConversationSearchStatus {
  enabled: boolean;
  available: boolean;
  unavailableReason?: string | null;
  dbPath: string;
  chunkCount: number;
  indexedFileCount: number;
  lastIndexedAt: string | null;
  health?: ConversationSearchHealthState;
}

export async function fetchConversationSearchStatus(): Promise<ConversationSearchStatus> {
  const res = await fetch('/api/settings/conversation-search/status');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch conversation search status (${res.status}): ${body}`);
  }
  return res.json();
}

export function useConversationSearchStatus() {
  return useQuery<ConversationSearchStatus>({
    queryKey: ['conversation-search-status'],
    queryFn: fetchConversationSearchStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
