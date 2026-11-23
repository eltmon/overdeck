import { Schema } from "effect"

export const ConversationSearchActivityKind = Schema.Literals(["startup", "catch-up", "incremental", "full-reindex"])
export type ConversationSearchActivityKind = typeof ConversationSearchActivityKind.Type

/**
 * PAN-5609 — conversation-search indexing activity. The dashboard's activity
 * tracker derives it and emits it in memory only
 * (`conversation_search.activity_changed`): never stored, never replayed.
 */
export const ConversationSearchActivitySnapshot = Schema.Struct({
  active: Schema.Boolean,
  /** The running run's kind, or the last finished run's when idle; null before any run. */
  kind: Schema.NullOr(ConversationSearchActivityKind),
  filesScanned: Schema.Number,
  filesIndexed: Schema.Number,
  chunksIndexed: Schema.Number,
  /** Basename of the file being indexed; null when none. */
  currentFile: Schema.NullOr(Schema.String),
  /** Watcher queue: files waiting, and files being indexed now. */
  queued: Schema.Number,
  inFlight: Schema.Number,
  startedAt: Schema.NullOr(Schema.String),
  endedAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  lastErrorAt: Schema.NullOr(Schema.String),
})
export type ConversationSearchActivitySnapshot = typeof ConversationSearchActivitySnapshot.Type
