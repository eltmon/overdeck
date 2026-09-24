/**
 * Launch path shared by every spawner (PAN-3917 FR-5, W8).
 *
 * `pan start`, `pan spawn`, the review and test specialists, `pan strike`,
 * planning (`pan plan` and the dashboard's planning continuation), resume,
 * restart, crash recovery, and the message-triggered fallback relaunch place
 * their pane in the issue's workspace and stamp the same four metadata
 * tokens: `issue`, `role`, `harness`, `model` (PAN-3960). A resume or restart
 * relaunches on the backend the host selects now, never the one the agent's
 * previous pane used. This module is the one place
 * that resolves the backend (D10 selection), finds or creates the workspace,
 * and starts the pane — so a launcher is three lines and cannot forget the
 * tokens. Conversations, forks and handoffs, and `pan flywheel start` route
 * through `launchAgentPane` too (PAN-3921): the pane is named `conv-<name>`
 * and stamped with role `conversation` unless `pan handoff --role` says
 * otherwise, so a handoff started with `--issue X --role review` is X's
 * Review row.
 *
 * Importing it registers both adapters.
 */

import { homedir } from 'node:os';

import { Effect } from 'effect';

import { AGENT_ID_TOKEN } from './herdr.js';
import './tmux.js';
import { resolveTerminalBackend } from './registry.js';
import { hostTerminalBackendName, probeHerdrAvailability } from './select.js';
import {
  isUnsupported,
  TerminalBackendUnavailableError,
  type AgentDetectionPolicy,
  type AgentPaneRef,
  type AgentRole,
  type BackendAgentSnapshot,
  type PaneTokens,
  type TerminalBackend,
  type TerminalBackendName,
} from './types.js';

/** Workspace that hosts operator conversations — panes with no `issue` token. */
const CONVERSATIONS_WORKSPACE = 'conversations';

/**
 * Per-harness detection policy (PAN-3917 W12).
 *
 * Herdr's agent detector reads the pane's FOREGROUND PROCESS and matches it
 * against its own agent manifest. That works for `claude-code`, whose launcher
 * execs the real `claude` binary (proven live: detected in ~2s). It can never
 * work for a harness Overdeck runs through a host/transport process — the codex
 * app-server (`node dist/codex-app-server-host.js`), the ACP host, kimi-code,
 * ohmypi/muse — because the foreground process is node, not the harness. On
 * 2026-09-19 `agent-pan-3705-review` (codex, gpt-5.6-sol) went
 * `starting → error` exactly 61s after launch for that reason: the app-server
 * host had connected fine, and the adapter closed its pane anyway.
 *
 * Those harnesses are therefore launched PANE-BOUND: the pane is stamped,
 * launched and returned immediately, and everything that used to go through
 * Herdr's agent record (liveness, delivery) goes through the pane and the
 * harness's own transport instead.
 *
 * Codex with `codex.transport: tui` runs the codex TUI, which Herdr could
 * detect — it is still launched pane-bound, which costs it only `agent.prompt`
 * (delivery falls through to `codex-exec-resume`, the tmux path).
 */
export function detectionPolicyFor(harness: string): AgentDetectionPolicy {
  return harness === 'claude-code' ? 'required' : 'not-required';
}

/**
 * The backend this host launches into, with both adapters registered.
 *
 * PAN-3956 FR-3: when the policy is Herdr and Herdr cannot serve (no binary, or
 * no session socket for this home), this throws
 * `TerminalBackendUnavailableError` naming `pan install` — it never resolves
 * the tmux adapter from a `herdr` policy. The probe runs on every call (never
 * memoized), so a session server started after boot is picked up at once.
 */
export async function resolveLaunchBackend(): Promise<TerminalBackend> {
  const name = await hostTerminalBackendName();
  if (name === 'herdr') {
    const probe = await probeHerdrAvailability();
    if (!probe.available) throw new TerminalBackendUnavailableError('herdr', probe.reason ?? 'unknown');
  }
  return resolveTerminalBackend(name);
}

/**
 * Close a pane a launch already created (PAN-3917 FR-3). `stopAgent` and
 * `killSession` reach a tmux session; on Herdr there is none, so the pane is
 * closed through the reference `launchAgentPane` returned. A tmux pane (or a
 * launch that never got a reference) falls through to the tmux path the caller
 * already runs.
 */
export async function closeBackendPane(pane: AgentPaneRef | null): Promise<void> {
  if (!pane || pane.backend === 'tmux') return;
  const { resolveTerminalBackend: resolve } = await import('./registry.js');
  await Effect.runPromise(resolve(pane.backend).close(pane)).catch(() => {});
}

export interface LaunchPaneRequest {
  /** Issue the pane belongs to; absent for an operator conversation. */
  readonly issueId?: string;
  /** Working directory for the pane (the workspace checkout). */
  readonly cwd: string;
  /** Agent id — the tmux session name, and the Herdr live agent name. */
  readonly agentId: string;
  /** Command line to run in the pane (Overdeck's generated launcher). */
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly tokens: PaneTokens;
}

/**
 * Place a pane in the issue workspace, run the launcher in it, and stamp its
 * tokens. Behaves exactly as `createSession` did on tmux.
 */
export async function launchAgentPane(
  request: LaunchPaneRequest,
  backend?: TerminalBackend,
): Promise<AgentPaneRef> {
  const resolved = backend ?? (await resolveLaunchBackend());
  const workspace = await Effect.runPromise(
    resolved.workspaceFor(request.issueId ?? CONVERSATIONS_WORKSPACE, request.cwd),
  );
  if (isUnsupported(workspace)) {
    throw new Error(`${resolved.name} cannot host an issue workspace: ${workspace.reason}`);
  }
  const pane = await Effect.runPromise(
    resolved.startAgent(workspace, {
      kind: request.tokens.harness,
      argv: request.argv,
      env: request.env,
      tokens: request.tokens,
      name: request.agentId,
      cwd: request.cwd,
      detection: detectionPolicyFor(request.tokens.harness),
    }),
  );
  if (isUnsupported(pane)) {
    throw new Error(`${resolved.name} could not start ${request.agentId}: ${pane.reason}`);
  }
  return pane;
}

/**
 * Keep a tmux agent session open after its clients detach and after its
 * harness exits (`destroy-unattached off`, `remain-on-exit on`), exactly as the
 * spawners always did on tmux. A no-op for any other backend: Herdr owns its
 * panes' lifetime itself, and a Herdr pane already outlives its process.
 */
export async function keepTmuxSessionOpen(pane: AgentPaneRef | null): Promise<void> {
  if (pane?.backend !== 'tmux') return;
  const { exactPaneTarget, setOption } = await import('../tmux.js');
  await Effect.runPromise(setOption(pane.paneId, 'destroy-unattached', 'off'));
  await Effect.runPromise(setOption(exactPaneTarget(pane.paneId), 'remain-on-exit', 'on'));
}

/**
 * Prepare the tmux server before a launch on it (PAN-3960, moved here from the
 * planning spawner so no launcher imports tmux directly).
 *
 * Starts the server with a parked `overdeck-init` session when none is running,
 * then removes `unsetGlobalEnv` from the server's global environment. The tmux
 * server inherits the environment of whatever process first started it (the
 * dashboard carries all of `~/.overdeck.env`), and every session inherits the
 * server's; `-e` overrides can set a variable but never unset one.
 *
 * A no-op for any backend other than tmux. Never throws.
 */
export async function prepareTmuxServer(
  backend: TerminalBackend,
  unsetGlobalEnv: readonly string[],
): Promise<void> {
  if (backend.name !== 'tmux') return;
  const { createSession, sessionExists, tmuxExecAsync } = await import('../tmux.js');
  try {
    if (!(await Effect.runPromise(sessionExists('overdeck-init')))) {
      await Effect.runPromise(createSession('overdeck-init', homedir(), undefined));
    }
  } catch (cause) {
    console.error('[launch] Failed to start the tmux server:', cause);
  }
  for (const name of unsetGlobalEnv) {
    await tmuxExecAsync(['set-environment', '-g', '-u', name]).catch(() => {
      // Variable was not set — fine.
    });
  }
}

/**
 * Does a pane for this agent id already exist on the host's backend? On tmux
 * that is a live session; on Herdr, a live agent with that name. The spawn
 * guards use it so a second dispatch cannot stomp a running agent on either
 * backend.
 */
export async function agentPaneExists(agentId: string, backend?: TerminalBackend): Promise<boolean> {
  const resolved = backend ?? (await resolveLaunchBackend());
  if (resolved.name === 'herdr') {
    const { findHerdrAgent } = await import('./herdr.js');
    return (await findHerdrAgent(agentId)) !== null;
  }
  const { sessionExists } = await import('../tmux.js');
  return await Effect.runPromise(sessionExists(agentId));
}

/** True when a backend `close` reported success (not `unsupported`, not a failure). */
async function closeThrough(backend: TerminalBackend, pane: AgentPaneRef): Promise<boolean> {
  try {
    const result = await Effect.runPromise(backend.close(pane));
    return !isUnsupported(result);
  } catch {
    return false;
  }
}

function tmuxSessionRef(agentId: string): AgentPaneRef {
  return { backend: 'tmux', workspaceId: agentId, paneId: agentId, terminalId: agentId, agentName: agentId };
}

/**
 * What `closeAgentPaneDetailed` did: `closed` a pane or session, found nothing
 * running (`absent`), or could not stop it (`failed`, with the reason).
 */
export type CloseAgentPaneResult =
  | { readonly outcome: 'closed' }
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'failed'; readonly reason: string };

/**
 * Terminate an agent's terminal through the host's terminal backend (PAN-3947).
 *
 * This is the one termination primitive every stop path uses (`stopAgent`,
 * `pan kill`/`pan stop`, the dashboard Stop and Pause routes, the post-merge
 * lifecycle, close-out teardown). A stop that only rewrote `state.json` — or
 * only ran `tmux kill-session` — left a Herdr pane and the idle harness in it
 * alive, so every liveness reader still saw the agent and the next start was
 * refused as "already running".
 *
 * - **Herdr:** the agent's pane — live, or residue whose shell is back at its
 *   prompt — is closed with `pane.close`. A tmux session of the same name (an
 *   agent launched before the host moved to Herdr) is killed too.
 * - **tmux:** the agent's session is killed through the tmux adapter's `close`.
 *
 * Never throws. Unlike `closeAgentPane`, it tells "nothing was running" apart
 * from "the close failed" (review of #3992, L2): a caller that reports the stop
 * to an operator must not call a failed close "already stopped". On Herdr,
 * `absent` inherits `findHerdrAgentPane`'s answer, which cannot tell "no such
 * pane" from "the socket did not answer the lookup".
 */
export async function closeAgentPaneDetailed(
  agentId: string,
  backend?: TerminalBackend,
): Promise<CloseAgentPaneResult> {
  const { sessionExists } = await import('../tmux.js');
  const tmuxSessionLive = (): Promise<boolean> =>
    Effect.runPromise(sessionExists(agentId)).catch(() => false);
  const closeTmuxSession = async (): Promise<CloseAgentPaneResult> =>
    (await closeThrough(resolveTerminalBackend('tmux'), tmuxSessionRef(agentId)))
      ? { outcome: 'closed' }
      : { outcome: 'failed', reason: `tmux could not kill session ${agentId}` };

  let resolved: TerminalBackend;
  try {
    resolved = backend ?? (await resolveLaunchBackend());
  } catch (error) {
    // PAN-3956: Herdr is selected but down. Its panes cannot be reached, but a
    // legacy tmux session of this name still can — stop must not regress to a
    // no-op on the host that most needs it.
    const reason = error instanceof Error ? error.message : String(error);
    if (!(error instanceof TerminalBackendUnavailableError)) return { outcome: 'failed', reason };
    if (await tmuxSessionLive()) return await closeTmuxSession();
    return { outcome: 'failed', reason };
  }

  if (resolved.name === 'tmux') {
    if (!(await tmuxSessionLive())) return { outcome: 'absent' };
    return (await closeThrough(resolved, tmuxSessionRef(agentId)))
      ? { outcome: 'closed' }
      : { outcome: 'failed', reason: `tmux could not kill session ${agentId}` };
  }

  const failures: string[] = [];
  let closed = false;
  const { findHerdrAgentPane } = await import('./herdr.js');
  const ref = await findHerdrAgentPane(agentId);
  if (ref) {
    const ok = await closeThrough(resolved, {
      backend: resolved.name,
      workspaceId: ref.workspaceId,
      paneId: ref.paneId,
      terminalId: ref.terminalId,
      agentName: agentId,
    });
    if (ok) closed = true;
    else failures.push(`${resolved.name} could not close pane ${ref.paneId}`);
  }

  if (await tmuxSessionLive()) {
    const legacy = await closeTmuxSession();
    if (legacy.outcome === 'closed') closed = true;
    else if (legacy.outcome === 'failed') failures.push(legacy.reason);
  }
  if (failures.length > 0) return { outcome: 'failed', reason: failures.join('; ') };
  return closed ? { outcome: 'closed' } : { outcome: 'absent' };
}

/**
 * `closeAgentPaneDetailed` for callers that only need a boolean. Never throws.
 * Returns true only when a pane or session was closed and no close failed.
 */
export async function closeAgentPane(agentId: string, backend?: TerminalBackend): Promise<boolean> {
  return (await closeAgentPaneDetailed(agentId, backend)).outcome === 'closed';
}

export interface CloseIssuePanesOptions {
  /** Only close panes whose `role` token is one of these. Omit to close every role. */
  readonly roles?: readonly AgentRole[];
}

/**
 * Close every Herdr pane stamped for an issue (PAN-3947).
 *
 * The post-merge lifecycle and close-out teardown find an issue's review, test
 * and strike terminals by tmux session name. A Herdr pane has no session name —
 * it carries the issue in its `issue` token — so on Herdr those name scans find
 * nothing and every pane survives. This reads the backend's live inventory and
 * closes the panes whose `issue` token matches (optionally filtered by `role`).
 *
 * Herdr only: on tmux the callers' existing session-name scans already reach
 * every session, and a tmux pane carries no stamped tokens. Operator
 * conversation panes (`conv-*`) are never closed. Returns the agent id
 * (or pane id when the pane carries none) of every pane it closed.
 */
export async function closeIssuePanes(
  issueId: string,
  options: CloseIssuePanesOptions = {},
  backend?: TerminalBackend,
): Promise<string[]> {
  let resolved: TerminalBackend;
  let inventory: readonly BackendAgentSnapshot[];
  try {
    resolved = backend ?? (await resolveLaunchBackend());
    if (resolved.name !== 'herdr') return [];
    inventory = await listInventory(resolved);
  } catch {
    return [];
  }
  const wanted = issueId.toLowerCase();
  const closed: string[] = [];
  for (const pane of inventory) {
    if (pane.tokens.issue?.toLowerCase() !== wanted) continue;
    if (options.roles && (!pane.tokens.role || !options.roles.includes(pane.tokens.role))) continue;
    const agentName = (pane.tokens as Record<string, string | undefined>)[AGENT_ID_TOKEN] ?? pane.paneId;
    // An operator conversation is never an issue's agent, even if a pane were
    // ever stamped with an issue: the tmux sweeps this mirrors never match `conv-*`.
    if (agentName.toLowerCase().startsWith('conv-')) continue;
    const ok = await closeThrough(resolved, {
      backend: resolved.name,
      workspaceId: pane.workspaceId,
      paneId: pane.paneId,
      terminalId: pane.terminalId,
      agentName,
    });
    if (ok) closed.push(agentName);
  }
  return closed;
}

async function listInventory(backend: TerminalBackend): Promise<readonly BackendAgentSnapshot[]> {
  const result = await Effect.runPromise(backend.list());
  return isUnsupported(result) ? [] : result;
}
