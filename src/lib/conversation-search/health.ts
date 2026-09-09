/**
 * Runtime health for the conversation-search embedding pipeline (PAN-3771).
 *
 * Config-level availability (key configured, DB openable) is checked when the
 * provider and DB are constructed, but per-call failures — exhausted credits,
 * quota limits, network errors — only surface while an embed is actually
 * running. This module records the most recent outcome so the dashboard can
 * show a banner instead of silently returning zero search hits.
 */

export interface ConversationSearchHealth {
  /** ISO timestamp of the most recent failed embed/index call, if any. */
  lastErrorAt: string | null;
  /** Human-readable reason from the most recent failure. */
  lastErrorReason: string | null;
  /** ISO timestamp of the most recent successful embed/index call, if any. */
  lastSuccessAt: string | null;
}

interface ConversationSearchHealthState {
  lastErrorAt: string | null;
  lastErrorReason: string | null;
  lastSuccessAt: string | null;
}

const state: ConversationSearchHealthState = {
  lastErrorAt: null,
  lastErrorReason: null,
  lastSuccessAt: null,
};

export function recordConversationSearchFailure(reason: unknown): void {
  state.lastErrorAt = new Date().toISOString();
  state.lastErrorReason = reason instanceof Error ? reason.message : String(reason);
}

export function recordConversationSearchSuccess(): void {
  state.lastSuccessAt = new Date().toISOString();
}

/** Snapshot copy — callers must not mutate live state. */
export function getConversationSearchHealth(): ConversationSearchHealth {
  return { ...state };
}

export function resetConversationSearchHealthForTests(): void {
  state.lastErrorAt = null;
  state.lastErrorReason = null;
  state.lastSuccessAt = null;
}
