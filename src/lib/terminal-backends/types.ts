/**
 * Terminal backend contract (PAN-3917 FR-3, FR-17, D10).
 *
 * The terminal backend owns agent terminals: it creates the issue workspace,
 * starts agents in panes, delivers prompts, waits on agent state, streams
 * terminal output, and reports the live inventory. Two adapters implement it —
 * Herdr (default) and tmux — and they register themselves with the registry
 * (`./registry.js`).
 *
 * Every operation returns an Effect whose success value is either a typed
 * result or `{ unsupported: true, reason }`: an operation an adapter cannot
 * perform is a *value*, not a throw (FR-3). The error channel carries only
 * genuine failures (socket down, tmux command failed).
 */

import type { Effect } from 'effect';
import { Data } from 'effect';
import type {
  AgentRole,
  AgentState,
  BackendAgentSnapshot,
  PaneTokens,
  TerminalBackendName,
} from '@overdeck/contracts';

export type { AgentRole, AgentState, BackendAgentSnapshot, PaneTokens, TerminalBackendName };

/** A terminal backend operation failed for a reason that is not `unsupported`. */
export class TerminalBackendError extends Data.TaggedError('TerminalBackendError')<{
  readonly backend: TerminalBackendName;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** The adapter cannot perform this operation. A value, never a throw. */
export interface Unsupported {
  readonly unsupported: true;
  readonly reason: string;
}

/** Either a typed result or `Unsupported`. */
export type BackendResult<T> = T | Unsupported;

/** Success value for operations that carry no payload (`close`, `reportMetadata`). */
export interface Ok {
  readonly ok: true;
}

export function isUnsupported<T>(result: BackendResult<T>): result is Unsupported {
  return typeof result === 'object' && result !== null && (result as Unsupported).unsupported === true;
}

export function unsupported(reason: string): Unsupported {
  return { unsupported: true, reason };
}

/** The issue workspace: the Herdr workspace, or the tmux session-name prefix. */
export interface WorkspaceRef {
  readonly backend: TerminalBackendName;
  /** Backend-native workspace handle (Herdr `w1`, tmux session prefix). */
  readonly workspaceId: string;
  /** Issue the workspace hosts; absent for operator conversations. */
  readonly issueId?: string;
  readonly cwd: string;
}

/** One agent pane created by `startAgent`. */
export interface AgentPaneRef {
  readonly backend: TerminalBackendName;
  readonly workspaceId: string;
  /** Backend-native pane handle (Herdr `w1:p1`, tmux session name). */
  readonly paneId: string;
  /** Handle the terminal WebSocket attaches to via `observe`/`control`. */
  readonly terminalId: string;
  /** Live agent name on Herdr; the agent id on tmux. */
  readonly agentName: string;
}

/**
 * Whether the backend must recognize a harness in the pane for the launch to
 * count (PAN-3917 W12).
 *
 * `required` — the harness CLI is the pane's foreground process, so Herdr's
 * detector sees it and the pane becomes a first-class Herdr agent.
 * `not-required` — Overdeck runs the harness through a host/transport process
 * (the codex app-server host, the ACP host, kimi, ohmypi/muse), so the
 * foreground process is `node …-host.js` and Herdr's manifest can never fire.
 * The pane is then addressed by its own reference and its metadata tokens.
 */
export type AgentDetectionPolicy = 'required' | 'not-required';

/** What to launch in a pane. */
export interface StartAgentSpec {
  /** Harness kind (`claude-code`, `codex`, …) — Herdr's `agent.start.kind`. */
  readonly kind: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly tokens: PaneTokens;
  /** Live agent name; the adapter derives one when omitted. */
  readonly name?: string;
  readonly cwd?: string;
  /** Detection policy for this harness; adapters default to `required`. */
  readonly detection?: AgentDetectionPolicy;
}

/** A pane, an agent name, or a workspace-scoped role — whatever the caller holds. */
export type AgentTarget = AgentPaneRef | { readonly paneId: string } | { readonly agentName: string };

export interface PromptOptions {
  /** Idempotency key. A repeat for the same target inside the window is dropped (FR-17). */
  readonly messageId: string;
  /** Wait for a settled state after submission. */
  readonly wait?: { readonly until?: readonly AgentState[]; readonly timeoutMs?: number };
  /** Who is sending. The guard accepts the target issue's `work` pane or an operator conversation. */
  readonly sender: PromptSender;
}

/**
 * Sender identity for the FR-17 role check. Herdr reads it from the sender
 * pane's tokens; tmux derives it from `OVERDECK_AGENT_ID`. An operator
 * conversation has no `issue`.
 */
export interface PromptSender {
  /** `OVERDECK_AGENT_ID` or the conversation id (`conv-…`). */
  readonly id: string;
  readonly issue?: string;
  readonly role?: AgentRole;
}

export interface PromptDelivered {
  readonly delivered: true;
  readonly messageId: string;
  /** Present when the prompt waited for a settled state. */
  readonly state?: AgentState;
}

export interface PromptDropped {
  readonly dropped: true;
  readonly reason: string;
}

export interface PromptRefused {
  readonly refused: true;
  readonly reason: string;
}

export type PromptResult = PromptDelivered | PromptDropped | PromptRefused | Unsupported;

export function isPromptDropped(result: PromptResult): result is PromptDropped {
  return (result as PromptDropped).dropped === true;
}

export function isPromptRefused(result: PromptResult): result is PromptRefused {
  return (result as PromptRefused).refused === true;
}

export interface WaitResult {
  readonly state: AgentState;
  /** True when the wait ended on the timeout rather than a matching state. */
  readonly timedOut: boolean;
}

/** Terminal frames, matching the dashboard terminal WebSocket contract. */
export type TerminalFrame =
  | { readonly kind: 'snapshot'; readonly cols: number; readonly rows: number; readonly data: string }
  | { readonly kind: 'output'; readonly data: string }
  | { readonly kind: 'size'; readonly cols: number; readonly rows: number }
  | { readonly kind: 'exit'; readonly code: number | null };

/** Read-only attachment to a terminal. Many observers may attach at once. */
export interface TerminalObservation {
  readonly frames: AsyncIterable<TerminalFrame>;
  close(): void;
}

/** Write attachment to a terminal. One controller at a time. */
export interface TerminalControl {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/** Backend lifecycle events, normalized across adapters. */
export type BackendEvent =
  | { readonly kind: 'agent-state'; readonly paneId: string; readonly state: AgentState }
  | { readonly kind: 'pane-created'; readonly paneId: string; readonly workspaceId: string }
  | { readonly kind: 'pane-exited'; readonly paneId: string; readonly code: number | null }
  | { readonly kind: 'metadata'; readonly paneId: string; readonly tokens: Partial<PaneTokens> }
  | { readonly kind: 'workspace-closed'; readonly workspaceId: string };

export interface BackendEventStream {
  readonly events: AsyncIterable<BackendEvent>;
  close(): void;
}

/** Something the backend can close or resume: a pane or a whole workspace. */
export type BackendRef = AgentPaneRef | WorkspaceRef;

type BackendEffect<T> = Effect.Effect<BackendResult<T>, TerminalBackendError>;

/**
 * The contract both adapters implement. Nothing here persists state: the
 * backend is read live and matched to issues by workspace and metadata (D10).
 */
export interface TerminalBackend {
  readonly name: TerminalBackendName;

  /** The issue's workspace, created if it does not exist. */
  workspaceFor(issueId: string, cwd: string): BackendEffect<WorkspaceRef>;

  /** Place a pane in the workspace, launch the harness, stamp its tokens. */
  startAgent(workspace: WorkspaceRef, spec: StartAgentSpec): BackendEffect<AgentPaneRef>;

  /** Deliver text to an agent. Idempotent per `messageId` and role-checked (FR-17). */
  prompt(target: AgentTarget, text: string, options: PromptOptions): Effect.Effect<PromptResult, TerminalBackendError>;

  /** Wait until the agent settles into one of `until`. */
  wait(target: AgentTarget, until: readonly AgentState[], timeoutMs: number): BackendEffect<WaitResult>;

  /** Read-only stream of a terminal. */
  observe(terminalId: string): BackendEffect<TerminalObservation>;

  /** Write stream of a terminal. */
  control(terminalId: string): BackendEffect<TerminalControl>;

  /** Live inventory of agent panes. */
  list(): BackendEffect<readonly BackendAgentSnapshot[]>;

  /** Lifecycle event stream, opened after a snapshot. */
  events(): BackendEffect<BackendEventStream>;

  /** Stamp metadata tokens on a pane (FR-5). */
  reportMetadata(pane: AgentPaneRef | { readonly paneId: string }, tokens: PaneTokens): BackendEffect<Ok>;

  /** Close a pane or a workspace. */
  close(ref: BackendRef): BackendEffect<Ok>;

  /** Resume the agent in a pane natively (`claude --resume`, `codex resume`). */
  resume(ref: BackendRef): BackendEffect<AgentPaneRef>;
}
