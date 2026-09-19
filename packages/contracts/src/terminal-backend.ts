// Terminal backend vocabulary (PAN-3917 FR-3, D10).
//
// The terminal backend owns agent terminals and their liveness. Two adapters
// exist: Herdr (default) and tmux. These are the names the dashboard, the CLI,
// and the adapters all speak, so they live in the shared contracts package.

/** Adapter that owns agent terminals. */
export type TerminalBackendName = "herdr" | "tmux"

/**
 * Agent lifecycle state. `idle | working | blocked | done | unknown` are
 * Herdr's states verbatim; `exited` is the tmux adapter's dead-pane state and
 * Herdr's `pane_exited`.
 */
export type AgentState = "idle" | "working" | "blocked" | "done" | "exited" | "unknown"

/** Pane role, stamped as a metadata token by every launcher (FR-5). */
export type AgentRole = "work" | "worker" | "review" | "test" | "uat" | "strike" | "plan"

/**
 * Metadata tokens stamped on every agent pane. An operator conversation
 * carries no `issue` token (FR-5), which is also what the prompt guard uses to
 * recognize an operator sender (FR-17).
 */
export interface PaneTokens {
  /** Issue id (e.g. `PAN-3917`); absent for operator conversations. */
  readonly issue?: string
  readonly role: AgentRole
  readonly harness: string
  readonly model: string
}

/** One agent pane as the backend reports it. */
export interface BackendAgentSnapshot {
  readonly backend: TerminalBackendName
  /** Backend-native pane handle (Herdr `w1:p1`, tmux session name). */
  readonly paneId: string
  /** Handle the terminal WebSocket attaches to. */
  readonly terminalId: string
  /** Issue workspace the pane belongs to. */
  readonly workspaceId: string
  readonly state: AgentState
  readonly tokens: Partial<PaneTokens>
  readonly cwd?: string
  readonly title?: string
}

export const TERMINAL_BACKEND_NAMES: readonly TerminalBackendName[] = ["herdr", "tmux"]

export const AGENT_ROLES: readonly AgentRole[] = ["work", "worker", "review", "test", "uat", "strike", "plan"]

export function isTerminalBackendName(value: unknown): value is TerminalBackendName {
  return typeof value === "string" && (TERMINAL_BACKEND_NAMES as readonly string[]).includes(value)
}

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (AGENT_ROLES as readonly string[]).includes(value)
}
