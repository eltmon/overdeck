// Agents Directory (PAN-3920). One row per agent-like thing the dashboard can show.
//
// Derived on every read from state files, the pane inventory, conversations and
// transcripts; never stored (D1). `GET /api/agent-directory` answers with an
// `AgentDirectoryResponse`; the dashboard's three-pane Agents Directory renders it.

import { Schema } from "effect"

export const DirectoryEntryKind = Schema.Literals(["agent", "conversation", "subagent", "external"])
export type DirectoryEntryKind = typeof DirectoryEntryKind.Type

export const DirectoryEntryState = Schema.Literals(["working", "idle", "blocked", "done", "stopped", "unknown"])
export type DirectoryEntryState = typeof DirectoryEntryState.Type

export const DirectoryEntrySource = Schema.Literals([
  "overdeck", // state.json agent (incl. workers)
  "pane", // pane-only (pan spawn)
  "conversation", // overdeck.db conversation row
  "claude-subagent",
  "codex-subagent",
  "registered", // pan worker register / POST /api/workers/register (Phase C)
  "codex-plugin", // Codex-plugin job adapter (Phase C)
])
export type DirectoryEntrySource = typeof DirectoryEntrySource.Type

export const DirectoryTranscriptRef = Schema.Union([
  Schema.Struct({ route: Schema.Literal("agent"), agentId: Schema.String }),
  Schema.Struct({ route: Schema.Literal("agent-subagent"), agentId: Schema.String, subagentId: Schema.String }),
  Schema.Struct({ route: Schema.Literal("conversation"), conversationName: Schema.String }),
  Schema.Struct({
    route: Schema.Literal("conversation-subagent"),
    conversationName: Schema.String,
    subagentId: Schema.String,
  }),
])
export type DirectoryTranscriptRef = typeof DirectoryTranscriptRef.Type

export const DirectoryEntryLocation = Schema.Literals(["local", "remote"])
export type DirectoryEntryLocation = typeof DirectoryEntryLocation.Type

export const DirectoryPauseBy = Schema.Literals(["operator", "scheduler", "machine"])
export type DirectoryPauseBy = typeof DirectoryPauseBy.Type

export const DirectoryPause = Schema.Struct({
  by: DirectoryPauseBy,
  reason: Schema.NullOr(Schema.String),
  since: Schema.NullOr(Schema.String),
})
export type DirectoryPause = typeof DirectoryPause.Type

export const DirectoryEntry = Schema.Struct({
  id: Schema.String,
  kind: DirectoryEntryKind,
  label: Schema.String,
  location: DirectoryEntryLocation,
  /** projects.yaml key; `unassigned` when none (D5). */
  projectKey: Schema.String,
  /** Uppercase issue id, e.g. `PAN-3920`. */
  issueId: Schema.NullOr(Schema.String),
  /** The issue's title from the dashboard's tracker cache; null when unknown. */
  issueTitle: Schema.NullOr(Schema.String),
  parentId: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
  /** `unknown` when not known. */
  harness: Schema.String,
  /** `unknown` when not known. */
  model: Schema.String,
  state: DirectoryEntryState,
  startedAt: Schema.NullOr(Schema.String),
  lastActivityAt: Schema.NullOr(Schema.String),
  costUsd: Schema.NullOr(Schema.Number),
  source: DirectoryEntrySource,
  transcript: Schema.NullOr(DirectoryTranscriptRef),
  /** The pause gate from state.json, native agents only (PAN-4197). */
  pause: Schema.optional(DirectoryPause),
  /** PAN-4223: gauntlet lane facts; conversation entries that are lanes only. */
  lane: Schema.optional(Schema.Struct({
    run: Schema.String,
    key: Schema.String,
    role: Schema.String,
    iteration: Schema.Number,
    reportStatus: Schema.NullOr(Schema.Literals(["done", "blocked", "failed"])),
    /** Critic/verifier: its verdict (or `pending`); builder: the newest critic verdict. */
    verdict: Schema.optional(Schema.NullOr(Schema.String)),
    /** Critic/verifier: the judged builder's legacy conversation id. */
    criticOf: Schema.optional(Schema.Number),
  })),
  /** PAN-4223: the predecessor's legacy conversation id; successors only (links to /conv/<id>). */
  continuesFrom: Schema.optional(Schema.Number),
})
export type DirectoryEntry = typeof DirectoryEntry.Type

/**
 * `window`: live entries plus finished ones active inside `windowHours`.
 * `live` (PAN-4197): what is running or waiting now; `windowHours` is 0.
 */
export const DirectoryScope = Schema.Literals(["window", "live"])
export type DirectoryScope = typeof DirectoryScope.Type

export const AgentDirectoryResponse = Schema.Struct({
  generatedAt: Schema.String,
  windowHours: Schema.Number,
  scope: Schema.optional(DirectoryScope),
  entries: Schema.Array(DirectoryEntry),
})
export type AgentDirectoryResponse = typeof AgentDirectoryResponse.Type
