// Backend pane (PAN-3917 FR-5, FR-12).
//
// One live agent pane as the terminal backend reports it, folded into the
// dashboard read model. This replaces every persisted agent mirror: the
// inventory is read live from Herdr or tmux and matched to issues by the
// pane's metadata tokens.

import type { AgentRole, AgentState } from "./terminal-backend"

export interface BackendPane {
  /** Stable pane identity: the backend-native pane handle. */
  readonly id: string
  /** Issue the pane belongs to; absent for operator conversations. */
  readonly issue?: string
  readonly role: AgentRole
  readonly harness: string
  readonly model: string
  readonly state: AgentState
  /** Epoch millis the pane entered `state`; drives the `stuck` attention. */
  readonly stateSince?: number
  /** Handle the terminal WebSocket attaches to. */
  readonly terminalId?: string
  /** Working directory of the pane (the issue workspace path). */
  readonly workspace?: string
}
