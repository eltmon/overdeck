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

export const DirectoryEntry = Schema.Struct({
  id: Schema.String,
  kind: DirectoryEntryKind,
  label: Schema.String,
  location: DirectoryEntryLocation,
  /** projects.yaml key; `unassigned` when none (D5). */
  projectKey: Schema.String,
  /** Uppercase issue id, e.g. `PAN-3920`. */
  issueId: Schema.NullOr(Schema.String),
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
})
export type DirectoryEntry = typeof DirectoryEntry.Type

export const AgentDirectoryResponse = Schema.Struct({
  generatedAt: Schema.String,
  windowHours: Schema.Number,
  entries: Schema.Array(DirectoryEntry),
})
export type AgentDirectoryResponse = typeof AgentDirectoryResponse.Type
