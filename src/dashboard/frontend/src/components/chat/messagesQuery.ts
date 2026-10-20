import type { EffortSource } from '@overdeck/contracts';
import { fetchWithTimeout } from '../../lib/apiFetch';
import type { ChatMessage, CompactBoundary, ContextUsage, ProposedPlan, SubagentSummary, WorkLogEntry } from './chat-types';

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
}

export async function fetchMessages(name: string, signal?: AbortSignal, agentId?: string): Promise<MessagesResponse> {
  // PAN-1705: timeout + React Query's abort signal so a request in flight
  // during a server restart rejects (and retries) instead of pinning the
  // panel on "Loading…" forever, and switching conversations cancels the
  // previous conversation's fetch.
  const path = agentId
    ? `/api/agents/${encodeURIComponent(agentId)}/conversation`
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
