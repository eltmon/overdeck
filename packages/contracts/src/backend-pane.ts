// Backend pane (PAN-3917 FR-5, FR-12).
//
// One live agent pane as the terminal backend reports it, folded into the
// dashboard read model. This replaces every persisted agent mirror: the
// inventory is read live from Herdr or tmux and matched to issues by the
// pane's metadata tokens.

import { Schema } from "effect"


export const BackendPane = Schema.Struct({
  /** Stable pane identity: the backend-native pane handle. */
  id: Schema.String,
  /** Overdeck agent id: Herdr `agentId` token or live agent name; tmux session name (PAN-3920). */
  agentId: Schema.optional(Schema.String),
  /** Issue the pane belongs to; absent for operator conversations. */
  issue: Schema.optional(Schema.String),
  role: Schema.Literals(["work", "worker", "review", "test", "uat", "strike", "plan"]),
  harness: Schema.String,
  model: Schema.String,
  state: Schema.Literals(["idle", "working", "blocked", "done", "exited", "unknown"]),
  /** Epoch millis the pane entered `state`; drives the `stuck` attention. */
  stateSince: Schema.optional(Schema.Number),
  /** Handle the terminal WebSocket attaches to. */
  terminalId: Schema.optional(Schema.String),
  /** Working directory of the pane (the issue workspace path). */
  workspace: Schema.optional(Schema.String),
})
export type BackendPane = typeof BackendPane.Type
