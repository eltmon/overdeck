/**
 * Companion terminal seam (PAN-3974, reused by PAN-3835).
 *
 * A companion terminal is a second terminal session, separate from the
 * conversation's own (owner) session, running a harness's native interactive
 * client attached to the owner's live runtime and exact session. Dashboard
 * delivery never goes through it; it exists so the operator can drive the
 * native CLI from the conversation TERMINAL view.
 *
 * This module is the shared vocabulary between the dashboard server lifecycle
 * (`src/lib/overdeck/companion-terminal/`) and the conversation UI
 * (`ConversationTerminalView.tsx`). Adding a harness means adding a kind here,
 * mapping it in `companionTerminalKindFor`, and registering a server adapter —
 * the lifecycle, routes, and UI stay unchanged.
 */

/** The native-client attach strategies Overdeck knows how to run. */
export type CompanionTerminalKind =
  /** `opencode attach <url> --session <id>` (PAN-3974). */
  | "opencode-attach"
  /** `codex resume --remote unix://<socket> <threadId>` (PAN-3835). */
  | "codex-resume-remote"

/** Why a companion cannot be opened right now. */
export type CompanionTerminalUnavailableReason =
  /** The conversation predates the recorded server port; restart it to attach. */
  | "restart-required"
  /** The owner conversation is not running. */
  | "owner-not-running"
  /** The owner is starting or its server is not answering yet. */
  | "owner-starting"
  /** The owner's server does not know the recorded session. */
  | "session-missing"
  /** The native client binary is not installed. */
  | "binary-missing"
  /** The installed CLI is too old to attach its native client. */
  | "cli-unsupported"
  /** The conversation has no saved harness session yet; send a message first. */
  | "session-not-started"
  /** The owner restarted while the companion was being opened. */
  | "owner-changed"
  /** This conversation's harness has no companion terminal. */
  | "unsupported"

export type CompanionTerminalState =
  | {
      readonly status: "attached"
      readonly kind: CompanionTerminalKind
      /** The terminal session to stream through `/ws/terminal?session=`. */
      readonly sessionName: string
      /** Owner generation the companion was created for; required by Close. */
      readonly generation: string
      /** True when an existing companion for this generation was reused. */
      readonly reused: boolean
    }
  | {
      readonly status: "closed"
      readonly kind: CompanionTerminalKind
    }
  | {
      readonly status: "unavailable"
      readonly kind: CompanionTerminalKind | null
      readonly reason: CompanionTerminalUnavailableReason
      readonly message: string
    }

/** The conversation fields the mapping reads. */
export interface CompanionTerminalOwnerShape {
  readonly harness?: string | null
}

/**
 * Which companion terminal a conversation gets, or `null` for "keep the
 * owner pane as TERMINAL". A Codex conversation still on the legacy
 * `codex.transport: tui` runs the native TUI in its owner pane; the server
 * adapter reports that as `unsupported` and points at the runtime pane.
 */
export function companionTerminalKindFor(
  conversation: CompanionTerminalOwnerShape,
): CompanionTerminalKind | null {
  if (conversation.harness === "opencode") return "opencode-attach"
  if (conversation.harness === "codex") return "codex-resume-remote"
  return null
}

/** Body keys each mutation accepts. Anything else is rejected as target injection. */
export const COMPANION_TERMINAL_OPEN_BODY_KEYS: ReadonlyArray<string> = []
export const COMPANION_TERMINAL_CLOSE_BODY_KEYS: ReadonlyArray<string> = ["generation"]
