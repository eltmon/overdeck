import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { EffortSource } from '@overdeck/contracts';
import { fetchWithTimeout } from '../../lib/apiFetch';
import type { ChatMessage, CompactBoundary, ContextUsage, ConversationWindow, ProposedPlan, SubagentSummary, WorkLogEntry } from './chat-types';
import { mergeWindowIntoCache, type HistoryRows } from './conversationHistory';

/** The messages read shared by the conversation panel, subagent transcripts and the simple feed. */

export interface MessagesResponse {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  streaming: boolean;
  discovering?: boolean;
  totalCost?: number;
  proposedPlan?: ProposedPlan;
  compactBoundaries?: CompactBoundary[];
  compacting?: boolean;
  contextUsage?: ContextUsage | null;
  subagents?: SubagentSummary[];
  /** PAN-4255 (agent reads): transcript-observed effort and the launch/pinned resolution. */
  observedEffort?: string | null;
  effortResolution?: { effort: string; source: EffortSource } | null;
  /** Server-side resolution failure to surface in the panel (e.g. the live
   * session could not be resolved from the launcher). Rendered as a banner. */
  error?: string;
  checked?: string[];
  /** PAN-4558: set on a windowed response; merged into `history` before it reaches the cache. */
  window?: ConversationWindow;
  /** PAN-4558: cursor and transcript id of the cached window; older rows page in from `history.cursor`. */
  history?: ConversationWindow;
}

export async function fetchMessages(name: string, signal?: AbortSignal, agentId?: string): Promise<MessagesResponse> {
  // PAN-1705: timeout + React Query's abort signal so a request in flight
  // during a server restart rejects (and retries) instead of pinning the
  // panel on "Loading…" forever, and switching conversations cancels the
  // previous conversation's fetch.
  // PAN-4558: both reads return the newest window; older rows page in on scroll.
  const path = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/conversation?window=initial`
    : `/api/conversations/${encodeURIComponent(name)}/messages`;
  const res = await fetchWithTimeout(path, { signal });
  if (res.status === 404 && agentId) {
    const missing = await res.json() as { error?: string; checked?: string[] };
    return {
      messages: [],
      workLog: [],
      streaming: false,
      error: missing.error ?? `No transcript found for ${agentId}.`,
      checked: missing.checked ?? [],
    };
  }
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

/**
 * PAN-4558 FR-16: the whole transcript, unwindowed and unprojected, for export.
 * Agent panels read the agents route without params, which stays full.
 */
export async function fetchFullTranscript(name: string, agentId?: string): Promise<MessagesResponse> {
  const path = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/conversation`
    : `/api/conversations/${encodeURIComponent(name)}/messages?window=all`;
  const res = await fetchWithTimeout(path);
  if (!res.ok) throw new Error('Failed to fetch transcript');
  return res.json();
}

/**
 * PAN-4558: fold an HTTP read into the cache with the same cursor-aware merge
 * as WS snapshots, so a poll or fallback read never drops paged-in older rows
 * or rows a stream delta delivered while the read was in flight.
 */
export function mergeFetchedMessages<T extends HistoryRows>(
  cached: T | undefined,
  fetched: T & { window?: ConversationWindow },
): T {
  const { window: _window, ...body } = fetched;
  return { ...body, ...mergeWindowIntoCache(cached, fetched) } as T;
}

/** The messages query function: read over HTTP, then merge into whatever the cache already holds. */
export function buildMessagesQueryFn(queryClient: QueryClient, queryKey: QueryKey, name: string, agentId?: string) {
  return async ({ signal }: { signal?: AbortSignal }): Promise<MessagesResponse> => {
    const fetched = await fetchMessages(name, signal, agentId);
    return mergeFetchedMessages(queryClient.getQueryData<MessagesResponse>(queryKey), fetched);
  };
}
