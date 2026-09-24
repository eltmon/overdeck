/**
 * Herdr terminal backend adapter (PAN-3917 FR-4, FR-5, FR-17, W8).
 *
 * Drives the headless `herdr --session <instance>` server over its unix-socket
 * — `overdeck` for the default home, `overdeck-<hash>` for any other, exactly
 * as the managed tmux socket is derived (see `./select.ts`) —
 * NDJSON API (`./herdr-api.ts`) and bridges its terminal streams to the
 * dashboard's frame contract (`./herdr-stream.ts`). It never installs,
 * updates, stops, or replaces a server.
 *
 * One deliberate deviation from the PRD's sketch, proven live on 2026-09-18:
 * `startAgent` does NOT call `agent.start`. `agent.start {kind}` builds the
 * command line itself from Herdr's agent manifest, so it cannot run Overdeck's
 * generated launcher script — the script that carries the provider exports,
 * the system-prompt files, the session id, and every harness-specific launch
 * field. Instead the adapter splits a pane with the launch env and runs the
 * launcher in it with `pane.send_input` (text plus Enter in one ordered
 * submission).
 *
 * What happens next depends on the launch's DETECTION POLICY
 * (`detectionPolicyFor`, `./launch.ts`):
 *
 *  - `required` (claude-code): wait for Herdr's own agent detection and bind
 *    the agent name with `agent.rename`. Herdr then reports the pane as a
 *    first-class agent — `agent.prompt`, `agent.wait` and the
 *    `idle|working|blocked|done` states all work.
 *  - `not-required` (every harness Overdeck runs through a host process): the
 *    pane is stamped with its tokens (including `agentId`), the launcher is
 *    sent, and the pane reference is returned immediately. Herdr never
 *    detects an agent there — the foreground process is the host, not the
 *    harness — so the pane itself is the agent: the token keys the inventory
 *    and liveness reads, and delivery falls through to the harness's own
 *    transport. Waiting for a detection that cannot happen is what failed
 *    `agent-pan-3705-review` on 2026-09-19.
 *
 * Both paths run the identical launcher, and both stamp the same tokens.
 */

import { Effect } from 'effect';

import {
  getHerdrApiClient,
  HerdrApiClient,
  HerdrApiError,
} from './herdr-api.js';
import { controlTerminal, observeTerminal } from './herdr-stream.js';
import { checkPrompt } from './prompt-guard.js';
import { registerTerminalBackend } from './registry.js';
import {
  isUnsupported,
  TerminalBackendError,
  unsupported,
  type AgentPaneRef,
  type AgentState,
  type AgentTarget,
  type BackendAgentSnapshot,
  type BackendEvent,
  type BackendEventStream,
  type BackendResult,
  type BackendRef,
  type Ok,
  type PaneTokens,
  type PromptOptions,
  type PromptResult,
  type StartAgentSpec,
  type TerminalBackend,
  type TerminalControl,
  type TerminalObservation,
  type WaitResult,
  type WorkspaceRef,
} from './types.js';

const BACKEND = 'herdr' as const;

/** `pane.report_metadata` requires a source; every Overdeck stamp carries this one. */
const METADATA_SOURCE = 'overdeck';

/**
 * The metadata token that carries the Overdeck agent id (PAN-3917 W12).
 *
 * A DETECTED agent is addressable by name (`agent.rename`), but a pane-bound
 * agent has no Herdr agent record at all, and `PaneInfo` carries no name — so
 * the id has to live in the pane's own tokens. Every launch stamps it, on both
 * paths, so the inventory keys every agent the same way.
 */
export const AGENT_ID_TOKEN = 'agentId';

/** How long to wait for Herdr to recognize the harness in a freshly launched pane. */
const AGENT_DETECT_TIMEOUT_MS = 60_000;
const AGENT_DETECT_POLL_MS = 500;
/** How much pane output a detection failure carries so it is diagnosable. */
const DETECTION_FAILURE_LINES = 20;

interface HerdrPaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id?: string;
  agent?: string | null;
  agent_status?: string;
  cwd?: string | null;
  title?: string | null;
  terminal_title?: string | null;
  tokens?: Record<string, string>;
  name?: string | null;
}

interface HerdrWorkspaceInfo {
  workspace_id: string;
  label?: string;
  tokens?: Record<string, string>;
}

function fail(operation: string, cause: unknown): TerminalBackendError {
  const message = cause instanceof HerdrApiError
    ? `${cause.code}: ${cause.message}`
    : cause instanceof Error ? cause.message : String(cause);
  return new TerminalBackendError({ backend: BACKEND, operation, message, cause });
}

function attempt<T>(operation: string, run: () => Promise<T>): Effect.Effect<T, TerminalBackendError> {
  return Effect.tryPromise({ try: run, catch: (cause) => fail(operation, cause) });
}

/** Herdr's agent statuses are the contract's, with `exited` reserved for dead panes. */
export function toAgentState(status: string | undefined): AgentState {
  switch (status) {
    case 'idle':
    case 'working':
    case 'blocked':
    case 'done':
      return status;
    case 'exited':
      return 'exited';
    default:
      return 'unknown';
  }
}

/** Metadata tokens must be strings; drop the absent ones (an operator pane has no issue). */
export function tokenPayload(tokens: PaneTokens | Partial<PaneTokens>): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value === 'string' && value.length > 0) payload[key] = value;
  }
  return payload;
}

/** Single-quote an argv element for the shell Herdr types the command into. */
function shellQuote(argument: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)) return argument;
  return `'${argument.replaceAll("'", `'\\''`)}'`;
}

function targetHandle(target: AgentTarget): string {
  if ('paneId' in target && target.paneId) return target.paneId;
  if ('agentName' in target && target.agentName) return target.agentName;
  throw new Error('prompt target carries neither a pane id nor an agent name');
}

/**
 * Herdr event kinds the contract knows about. One record can carry more than
 * one contract event, so this returns a list.
 *
 * `pane_updated` is where agent state arrives: the global
 * `pane.agent_status_changed` subscription requires a pane id (it is per-pane),
 * but `pane_updated` carries the pane's `agent_status`, and a live run on
 * 2026-09-18 showed the `unknown → idle` transition arriving that way.
 */
export function toBackendEvents(kind: string, data: Record<string, unknown>): BackendEvent[] {
  switch (kind) {
    case 'pane_agent_status_changed':
      return [{
        kind: 'agent-state',
        paneId: String(data.pane_id ?? ''),
        state: toAgentState(typeof data.agent_status === 'string' ? data.agent_status : undefined),
      }];
    case 'pane_created': {
      const pane = data.pane as HerdrPaneInfo | undefined;
      if (!pane) return [];
      return [{ kind: 'pane-created', paneId: pane.pane_id, workspaceId: pane.workspace_id }];
    }
    case 'pane_exited':
      return [{ kind: 'pane-exited', paneId: String(data.pane_id ?? ''), code: null }];
    case 'pane_updated': {
      const pane = data.pane as HerdrPaneInfo | undefined;
      if (!pane) return [];
      const events: BackendEvent[] = [];
      if (pane.agent_status) {
        events.push({ kind: 'agent-state', paneId: pane.pane_id, state: toAgentState(pane.agent_status) });
      }
      if (pane.tokens) {
        events.push({ kind: 'metadata', paneId: pane.pane_id, tokens: pane.tokens as Partial<PaneTokens> });
      }
      return events;
    }
    case 'workspace_closed':
      return [{ kind: 'workspace-closed', workspaceId: String(data.workspace_id ?? '') }];
    default:
      return [];
  }
}

/** A routing probe must never hold up a delivery: give up and let tmux answer. */
const HERDR_PROBE_TIMEOUT_MS = 2_000;

/**
 * The pane stamped with this Overdeck agent id, or null when the session holds
 * none (PAN-3917 W12).
 *
 * This is how a PANE-BOUND agent is found: it has no Herdr agent record, so
 * `agent.get` cannot answer for it and the session snapshot is the only place
 * its identity lives. Throws on a transport failure — a caller that must not
 * confuse "no such pane" with "the socket did not answer" has to see it.
 */
async function findAgentIdPane(
  agentName: string,
  api: HerdrApiClient,
  timeoutMs: number = HERDR_PROBE_TIMEOUT_MS,
): Promise<HerdrPaneInfo | null> {
  const snapshot = await api.call<{ snapshot?: { panes?: HerdrPaneInfo[] } }>(
    'session.snapshot',
    {},
    { timeoutMs },
  );
  const wanted = agentName.toLowerCase();
  return (snapshot.snapshot?.panes ?? []).find(
    (pane) => pane.tokens?.[AGENT_ID_TOKEN]?.toLowerCase() === wanted,
  ) ?? null;
}

/**
 * Does the pane still run something, or has its shell returned to its prompt?
 *
 * A Herdr pane OUTLIVES the process typed into it: the launcher runs as a child
 * of the pane's shell, so a harness that exits leaves the pane sitting at `$`.
 * "The pane exists" is therefore not liveness — the pane's foreground process
 * is, exactly as the tmux oracle walks the pane's process subtree.
 *
 * Verified live on 2026-09-19 (herdr 0.9.1): an idle pane reports its own shell
 * (`foreground_processes = [bash]`, `pid === shell_pid`); a pane running a
 * command reports that command with a different pid and process group. So the
 * question is whether any foreground process is NOT the shell.
 */
async function paneProcessLiveness(
  paneId: string,
  api: HerdrApiClient,
): Promise<'running' | 'exited' | 'indeterminate'> {
  try {
    const info = await api.call<{
      process_info?: { shell_pid?: number | null; foreground_processes?: { pid: number }[] };
    }>('pane.process_info', { pane_id: paneId }, { timeoutMs: HERDR_PROBE_TIMEOUT_MS });
    const process_info = info.process_info;
    if (!process_info) return 'indeterminate';
    const shellPid = process_info.shell_pid ?? null;
    const foreground = process_info.foreground_processes ?? [];
    return foreground.some((process) => process.pid !== shellPid) ? 'running' : 'exited';
  } catch (cause) {
    // The server answering (`pane_not_found`) means the pane is gone; only a
    // transport failure leaves the question open.
    if (cause instanceof HerdrApiError && !HERDR_TRANSPORT_ERROR_CODES.has(cause.code)) return 'exited';
    return 'indeterminate';
  }
}

/** One Herdr-hosted agent, detected by Herdr or bound to a token-stamped pane. */
export interface HerdrAgentRef {
  readonly paneId: string;
  readonly terminalId: string;
  readonly workspaceId: string;
  readonly state: AgentState;
  readonly tokens: Partial<PaneTokens>;
  /** True when Herdr has no agent record for it — the pane itself is the agent. */
  readonly paneBound: boolean;
}

/**
 * The live Herdr agent behind an Overdeck agent id, or null when there is none.
 *
 * A detected agent carries the Overdeck agent id as Herdr's live agent name
 * (`agent.rename`), so one `agent.get` answers it. A pane-bound agent has no
 * agent record, so the fallback is the `agentId` token on its pane. A null
 * answer means the target is not on Herdr at all — a tmux session from before
 * the cut, or an id that no longer exists — and the caller keeps its tmux path.
 */
export async function findHerdrAgent(
  agentName: string,
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<HerdrAgentRef | null> {
  try {
    const info = await api.call<{ agent?: HerdrPaneInfo }>(
      'agent.get',
      { target: agentName },
      { timeoutMs: HERDR_PROBE_TIMEOUT_MS },
    );
    const agent = info.agent;
    if (agent) {
      return {
        paneId: agent.pane_id,
        terminalId: agent.terminal_id,
        workspaceId: agent.workspace_id,
        state: toAgentState(agent.agent_status),
        tokens: (agent.tokens ?? {}) as Partial<PaneTokens>,
        paneBound: false,
      };
    }
  } catch {
    // `agent.get` answers "no such agent" for every pane-bound agent; the token
    // scan below is the only read that can see one.
  }

  try {
    const pane = await findAgentIdPane(agentName, api);
    if (!pane) return null;
    // A pane whose shell is back at its prompt is residue, not an agent: a
    // caller that treated it as live would block a respawn and paste a message
    // into a dead shell.
    if (await paneProcessLiveness(pane.pane_id, api) !== 'running') return null;
    return {
      paneId: pane.pane_id,
      terminalId: pane.terminal_id,
      workspaceId: pane.workspace_id,
      state: toAgentState(pane.agent_status),
      tokens: (pane.tokens ?? {}) as Partial<PaneTokens>,
      paneBound: !pane.agent,
    };
  } catch {
    return null;
  }
}

/**
 * The Herdr pane an Overdeck agent id occupies, whether or not anything still
 * runs in it (PAN-3947).
 *
 * `findHerdrAgent` answers "is there a live agent" and so drops a pane whose
 * shell is back at its prompt. Stopping an agent must close that residue too —
 * otherwise the pane outlives every stop and blocks the next dispatch — so this
 * lookup returns the pane by live agent name, then by its `agentId` token, with
 * no foreground-process check. Null when Herdr holds no such pane or the socket
 * did not answer.
 */
export async function findHerdrAgentPane(
  agentName: string,
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<{ readonly paneId: string; readonly terminalId: string; readonly workspaceId: string } | null> {
  try {
    const info = await api.call<{ agent?: HerdrPaneInfo }>(
      'agent.get',
      { target: agentName },
      { timeoutMs: HERDR_PROBE_TIMEOUT_MS },
    );
    if (info.agent) {
      return { paneId: info.agent.pane_id, terminalId: info.agent.terminal_id, workspaceId: info.agent.workspace_id };
    }
  } catch {
    // Pane-bound agents have no Herdr agent record; the token scan finds them.
  }
  try {
    const pane = await findAgentIdPane(agentName, api);
    return pane ? { paneId: pane.pane_id, terminalId: pane.terminal_id, workspaceId: pane.workspace_id } : null;
  } catch {
    return null;
  }
}

/**
 * Transport codes: the request never reached a server answer. A probe that
 * hits one knows NOTHING about the agent — it must never report a death.
 */
const HERDR_TRANSPORT_ERROR_CODES: ReadonlySet<string> = new Set([
  'timeout',
  'socket_error',
  'disconnected',
  'write_failed',
  'invalid_json',
  'frame_too_large',
  'protocol_mismatch',
]);

/** What a Herdr liveness probe can conclude (PAN-3917 W12). */
export type HerdrLivenessProbe =
  | { readonly kind: 'alive'; readonly paneId: string; readonly state: AgentState }
  | { readonly kind: 'exited'; readonly paneId: string }
  | { readonly kind: 'absent' }
  /** The socket, not the agent, failed — the caller must treat this as "not dead". */
  | { readonly kind: 'indeterminate'; readonly reason: string };

/**
 * Ask Herdr whether an agent is live. Unlike `findHerdrAgent` (which folds
 * every failure into `null`), this SEPARATES "the server says there is no such
 * agent" from "the socket did not answer": a Herdr outage folded into `absent`
 * would make the liveness oracle confirm every agent dead at once and the
 * remediators would reap the whole fleet.
 */
export async function probeHerdrAgentLiveness(
  agentName: string,
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<HerdrLivenessProbe> {
  let info: { agent?: HerdrPaneInfo };
  try {
    info = await api.call<{ agent?: HerdrPaneInfo }>(
      'agent.get',
      { target: agentName },
      { timeoutMs: HERDR_PROBE_TIMEOUT_MS },
    );
  } catch (cause) {
    if (cause instanceof HerdrApiError && !HERDR_TRANSPORT_ERROR_CODES.has(cause.code)) {
      // The server answered — it does not know this agent BY NAME. A pane-bound
      // agent never has a name, so "no such agent" is not yet a death.
      return await probePaneBoundLiveness(agentName, api);
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { kind: 'indeterminate', reason };
  }
  const agent = info.agent;
  if (!agent) return await probePaneBoundLiveness(agentName, api);
  const state = toAgentState(agent.agent_status);
  if (state === 'exited') return { kind: 'exited', paneId: agent.pane_id };
  return { kind: 'alive', paneId: agent.pane_id, state };
}

/**
 * Liveness for an agent Herdr holds no record for: the pane stamped with its
 * `agentId` token, plus that pane's foreground process.
 *
 * `absent` once Herdr's snapshot no longer lists the pane, `exited` when the
 * pane is back at its shell prompt (the harness or its host died and left the
 * pane behind), `alive` while a process of its own is running, and
 * `indeterminate` whenever a probe itself failed — a pane-bound agent must
 * never be reported dead merely because Herdr holds no agent record for it, and
 * a detected agent that exits must still be confirmed dead.
 */
async function probePaneBoundLiveness(
  agentName: string,
  api: HerdrApiClient,
): Promise<HerdrLivenessProbe> {
  try {
    const pane = await findAgentIdPane(agentName, api);
    if (!pane) return { kind: 'absent' };
    const process = await paneProcessLiveness(pane.pane_id, api);
    if (process === 'exited') return { kind: 'exited', paneId: pane.pane_id };
    if (process === 'indeterminate') {
      return { kind: 'indeterminate', reason: `pane ${pane.pane_id} process probe failed` };
    }
    return { kind: 'alive', paneId: pane.pane_id, state: toAgentState(pane.agent_status) };
  } catch (cause) {
    // Same rule as the agent probe: only a SERVER answer can mean absence.
    if (cause instanceof HerdrApiError && !HERDR_TRANSPORT_ERROR_CODES.has(cause.code)) {
      return { kind: 'absent' };
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { kind: 'indeterminate', reason };
  }
}

/** One live Herdr agent, keyed by the Overdeck agent id (its `agentId` token). */
export interface HerdrLiveAgent {
  readonly agentId: string;
  readonly paneId: string;
  readonly terminalId: string;
  readonly state: AgentState;
  readonly tokens: Partial<PaneTokens>;
  /** True when Herdr has no agent record for it — the pane itself is the agent. */
  readonly paneBound: boolean;
}

/**
 * Every live Herdr agent, as the backend-aware inventory reads it.
 *
 * `BackendAgentSnapshot` carries no agent name, and on Herdr the Overdeck agent
 * id is a *token* on the pane (plus, for a detected agent, the live agent name
 * bound with `agent.rename`) — so the inventory needs this narrower read. It
 * takes both halves: every token-stamped pane, then every detected agent on
 * top, keyed by the same `agentId` token so a pane Herdr later detected does
 * not appear twice. Panes and agents Overdeck never stamped are skipped —
 * nothing can address them by agent id.
 */
export async function listHerdrAgents(
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<readonly HerdrLiveAgent[]> {
  const [listed, snapshot] = await Promise.all([
    api.call<{ agents?: HerdrPaneInfo[] }>('agent.list', {}),
    api.call<{ snapshot?: { panes?: HerdrPaneInfo[] } }>('session.snapshot', {}),
  ]);

  const byAgentId = new Map<string, HerdrLiveAgent>();
  const record = (info: HerdrPaneInfo, agentId: string, paneBound: boolean): void => {
    byAgentId.set(agentId, {
      agentId,
      paneId: info.pane_id,
      terminalId: info.terminal_id,
      state: toAgentState(info.agent_status),
      tokens: (info.tokens ?? {}) as Partial<PaneTokens>,
      paneBound,
    });
  };

  for (const pane of snapshot.snapshot?.panes ?? []) {
    const agentId = pane.tokens?.[AGENT_ID_TOKEN]?.trim();
    if (!agentId) continue;
    record(pane, agentId, !pane.agent);
  }
  for (const agent of listed.agents ?? []) {
    const agentId = agent.tokens?.[AGENT_ID_TOKEN]?.trim() ?? agent.name?.trim();
    if (!agentId) continue;
    record(agent, agentId, false);
  }
  return [...byAgentId.values()];
}

/** Overdeck agent id: the `agentId` token; Herdr's own agent name only on an Overdeck-tokened pane (PAN-3920). */
const agentIdOf = (pane: HerdrPaneInfo): string | undefined => pane.tokens?.[AGENT_ID_TOKEN]?.trim()
  || (pane.tokens?.role || pane.tokens?.issue ? pane.name?.trim() : undefined) || undefined;

/** The recent terminal text of a Herdr pane — the backend's `capture-pane`. */
export async function readHerdrPaneText(
  paneId: string,
  lines: number,
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<string> {
  const result = await api.call<{ text?: string }>('pane.read', {
    pane_id: paneId,
    source: 'recent',
    lines,
    strip_ansi: true,
  });
  return result.text ?? '';
}

/** Detection-wait knobs. Production uses the defaults; tests shorten them. */
export interface HerdrBackendOptions {
  readonly detectTimeoutMs?: number;
  readonly detectPollMs?: number;
}

export class HerdrBackend implements TerminalBackend {
  readonly name = BACKEND;

  private readonly detectTimeoutMs: number;
  private readonly detectPollMs: number;

  constructor(
    private readonly api: HerdrApiClient = getHerdrApiClient(),
    options: HerdrBackendOptions = {},
  ) {
    this.detectTimeoutMs = options.detectTimeoutMs ?? AGENT_DETECT_TIMEOUT_MS;
    this.detectPollMs = options.detectPollMs ?? AGENT_DETECT_POLL_MS;
  }

  /**
   * The issue's workspace. Looked up by the `issue` token first (a label can be
   * renamed in the TUI; the token is ours), created and stamped when missing.
   */
  workspaceFor(issueId: string, cwd: string): Effect.Effect<BackendResult<WorkspaceRef>, TerminalBackendError> {
    return attempt('workspaceFor', async () => {
      const listed = await this.api.call<{ workspaces?: HerdrWorkspaceInfo[] }>('workspace.list', {});
      const existing = (listed.workspaces ?? []).find(
        (workspace) => workspace.tokens?.issue?.toLowerCase() === issueId.toLowerCase(),
      );
      if (existing) {
        return { backend: BACKEND, workspaceId: existing.workspace_id, issueId, cwd };
      }
      const created = await this.api.call<{ workspace?: HerdrWorkspaceInfo }>('workspace.create', {
        cwd,
        label: issueId,
        focus: false,
      });
      const workspaceId = created.workspace?.workspace_id;
      if (!workspaceId) throw new Error('workspace.create returned no workspace id');
      await this.api.call('workspace.report_metadata', {
        workspace_id: workspaceId,
        source: METADATA_SOURCE,
        tokens: { issue: issueId },
      });
      return { backend: BACKEND, workspaceId, issueId, cwd };
    });
  }

  startAgent(
    workspace: WorkspaceRef,
    spec: StartAgentSpec,
  ): Effect.Effect<BackendResult<AgentPaneRef>, TerminalBackendError> {
    return attempt('startAgent', async () => {
      const split = await this.api.call<{ pane?: HerdrPaneInfo }>('pane.split', {
        workspace_id: workspace.workspaceId,
        direction: 'down',
        cwd: spec.cwd ?? workspace.cwd,
        env: spec.env,
        focus: false,
      });
      const pane = split.pane;
      if (!pane) throw new Error('pane.split returned no pane');
      const agentName = spec.name ?? `${spec.tokens.role}-${pane.pane_id.replace(':', '-')}`;

      if ((spec.detection ?? 'required') === 'not-required') {
        return await this.startPaneBoundAgent(workspace, spec, pane, agentName);
      }

      await this.api.call('pane.send_input', {
        pane_id: pane.pane_id,
        text: spec.argv.map(shellQuote).join(' '),
        keys: ['enter'],
      });

      // Detection is what makes the pane addressable: only a detected agent can
      // be renamed, and every caller addresses the pane by the Overdeck agent
      // id. A timeout therefore has to be a LAUNCH FAILURE — returning the
      // intended name for a pane that never took it hands the caller a
      // reference no prompt, wait or close can reach.
      if (!await this.waitForAgentDetection(pane.pane_id)) {
        // Diagnose BEFORE closing: the pane is the only witness. Herdr's
        // detector keys on the pane's FOREGROUND PROCESS, so the process line
        // is what names the cause outright — a wrapper (`node
        // pty-supervisor.js claude …`, PAN-3917 W12) hides the harness behind
        // its own pty and can never be detected, while a launcher that died
        // early leaves its error in the pane text.
        const diagnosis = await this.diagnoseDetectionFailure(pane.pane_id);
        await this.api.call('pane.close', { pane_id: pane.pane_id }).catch(() => {});
        throw new Error(
          `herdr detected no agent in pane ${pane.pane_id} within ${this.detectTimeoutMs}ms; `
          + `the pane could not be bound to ${agentName} and was closed.${diagnosis}`,
        );
      }
      // Bind the Overdeck agent id as the live agent name so `agent.prompt`
      // and `agent.wait` address it the way every caller already names it.
      await this.api.call('agent.rename', { target: pane.pane_id, name: agentName });

      await this.stampPaneIdentity(pane.pane_id, agentName, spec.tokens);

      return {
        backend: BACKEND,
        workspaceId: workspace.workspaceId,
        paneId: pane.pane_id,
        terminalId: pane.terminal_id,
        agentName,
      };
    });
  }

  /**
   * Launch a harness Herdr cannot detect (`detection: 'not-required'`).
   *
   * The tokens are stamped BEFORE the launcher is sent: a launcher that dies in
   * the first 100ms must still leave a pane that says what it was. Then the
   * launcher runs and the reference is returned — no detection wait, no
   * `agent.rename`, no failure. Herdr's own agent state for the pane stays
   * `unknown`, which is the truth; `title` and `display_agent` keep the Herdr
   * UI readable. If Herdr later detects something in the pane anyway, the
   * `agentId` token still keys it, so nothing double-counts.
   */
  private async startPaneBoundAgent(
    workspace: WorkspaceRef,
    spec: StartAgentSpec,
    pane: HerdrPaneInfo,
    agentName: string,
  ): Promise<AgentPaneRef> {
    try {
      await this.stampPaneIdentity(pane.pane_id, agentName, spec.tokens);
      await this.api.call('pane.send_input', {
        pane_id: pane.pane_id,
        text: spec.argv.map(shellQuote).join(' '),
        keys: ['enter'],
      });
    } catch (error) {
      // A pane whose launcher never started is residue: close it rather than
      // hand back a reference to an empty shell.
      await this.api.call('pane.close', { pane_id: pane.pane_id }).catch(() => {});
      throw error;
    }

    return {
      backend: BACKEND,
      workspaceId: workspace.workspaceId,
      paneId: pane.pane_id,
      terminalId: pane.terminal_id,
      agentName,
    };
  }

  /** Stamp the four pane tokens plus the `agentId` key, and label the pane for the UI. */
  private async stampPaneIdentity(paneId: string, agentName: string, tokens: PaneTokens): Promise<void> {
    await this.api.call('pane.report_metadata', {
      pane_id: paneId,
      source: METADATA_SOURCE,
      tokens: { ...tokenPayload(tokens), [AGENT_ID_TOKEN]: agentName },
      title: agentName,
      display_agent: tokens.harness,
    });
  }

  /**
   * Why did detection fail? Returns the pane's foreground process and its last
   * lines of output, formatted for the thrown message. Never throws: a probe
   * that fails must not replace the real failure with its own.
   */
  private async diagnoseDetectionFailure(paneId: string): Promise<string> {
    const parts: string[] = [];
    try {
      const info = await this.api.call<{
        process_info?: { foreground_processes?: { name?: string; cmdline?: string }[] };
      }>('pane.process_info', { pane_id: paneId });
      const foreground = info.process_info?.foreground_processes ?? [];
      if (foreground.length > 0) {
        parts.push(
          `Pane foreground process: ${foreground
            .map((p) => p.cmdline || p.name || '(unnamed)')
            .join(' | ')}`,
        );
      } else {
        parts.push('Pane foreground process: none (the launcher exited).');
      }
    } catch (err) {
      parts.push(`Pane foreground process unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const read = await this.api.call<{ text?: string }>('pane.read', {
        pane_id: paneId,
        source: 'recent_unwrapped',
        lines: DETECTION_FAILURE_LINES,
        strip_ansi: true,
      });
      const text = (read.text ?? '').trimEnd();
      parts.push(
        text
          ? `Last ${DETECTION_FAILURE_LINES} lines of pane output:\n${text}`
          : `Pane output is empty (a full-screen harness renders on the alternate screen).`,
      );
    } catch (err) {
      parts.push(`Pane output unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }

    return ` ${parts.join('\n')}`;
  }

  /**
   * The pane-bound pane behind a prompt target, or null when the target is not
   * one. A pane id (`w1:p1`) is read directly; an agent name can only be found
   * by its `agentId` token. A pane Overdeck never stamped is not ours, and
   * stays "metadata unavailable" for the guard.
   */
  private async findPaneBoundPane(handle: string): Promise<HerdrPaneInfo | null> {
    if (handle.includes(':')) {
      const got = await this.api.call<{ pane?: HerdrPaneInfo }>('pane.get', { pane_id: handle })
        .catch(() => ({ pane: undefined }));
      return got.pane?.tokens?.[AGENT_ID_TOKEN] ? got.pane : null;
    }
    return await findAgentIdPane(handle, this.api).catch(() => null);
  }

  /** Poll until Herdr's detector claims the pane, or give up and leave it a plain pane. */
  private async waitForAgentDetection(paneId: string): Promise<boolean> {
    const deadline = Date.now() + this.detectTimeoutMs;
    for (;;) {
      const info = await this.api.call<{ pane?: HerdrPaneInfo }>('pane.get', { pane_id: paneId });
      if (info.pane?.agent) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, this.detectPollMs));
    }
  }

  prompt(
    target: AgentTarget,
    text: string,
    options: PromptOptions,
  ): Effect.Effect<PromptResult, TerminalBackendError> {
    return attempt('prompt', async () => {
      const handle = targetHandle(target);
      // FR-17: a failed `agent.get` is NOT "this pane carries no tokens" — it is
      // "we do not know what this pane is". The guard has to be told which,
      // because an unknown target must not be treated as ungated.
      let metadataAvailable = true;
      const info = await this.api.call<{ agent?: HerdrPaneInfo }>('agent.get', { target: handle })
        .catch(() => { metadataAvailable = false; return { agent: undefined }; });
      if (!info.agent) metadataAvailable = false;
      const tokens = (info.agent?.tokens ?? {}) as Partial<PaneTokens>;

      if (!info.agent) {
        // A pane-bound agent (PAN-3917 W12) has no Herdr agent record, so
        // `agent.prompt` cannot reach it — the caller must use the harness's
        // own transport. This is `unsupported`, not a refusal: the target's
        // metadata is perfectly well known, and it is answered BEFORE the
        // guard so the fall-through delivery runs the guard itself.
        const paneBound = await this.findPaneBoundPane(handle);
        if (paneBound) {
          return unsupported(
            `herdr has no detected agent in pane ${paneBound.pane_id}`
            + ` (${paneBound.tokens?.harness ?? 'this harness'} runs through a host process);`
            + ' deliver through the harness transport instead',
          );
        }
      }

      const verdict = checkPrompt({
        targetId: info.agent?.pane_id ?? handle,
        targetTokens: tokens,
        targetTokensAvailable: metadataAvailable,
        sender: options.sender,
        messageId: options.messageId,
      });
      if ('refused' in verdict) return { refused: true, reason: verdict.reason };
      if ('dropped' in verdict) return { dropped: true, reason: verdict.reason };

      const wait = options.wait
        ? {
            ...(options.wait.until ? { until: options.wait.until } : {}),
            ...(options.wait.timeoutMs ? { timeout_ms: options.wait.timeoutMs } : {}),
          }
        : undefined;
      try {
        const result = await this.api.call<{ agent?: HerdrPaneInfo }>(
          'agent.prompt',
          { target: handle, text, ...(wait ? { wait } : {}) },
          { timeoutMs: (options.wait?.timeoutMs ?? 30_000) + 10_000 },
        );
        return {
          delivered: true,
          messageId: options.messageId,
          ...(result.agent ? { state: toAgentState(result.agent.agent_status) } : {}),
        };
      } catch (error) {
        // Herdr submits the text and Enter before it watches for activity, so a
        // stalled or timed-out WAIT is not proof the prompt never landed — its
        // own guide says never to re-send on one. Report it delivered, with the
        // state the agent is actually in. `agent_blocked` is different: Herdr
        // refuses a blocked agent before writing any input, so it stays an error.
        const settledWait = error instanceof HerdrApiError
          && (error.code === 'agent_prompt_stalled' || error.code === 'timeout');
        if (!settledWait) throw error;
        const current = await this.api.call<{ agent?: HerdrPaneInfo }>('agent.get', { target: handle })
          .catch(() => ({ agent: undefined }));
        return {
          delivered: true,
          messageId: options.messageId,
          ...(current.agent ? { state: toAgentState(current.agent.agent_status) } : {}),
        };
      }
    });
  }

  wait(
    target: AgentTarget,
    until: readonly AgentState[],
    timeoutMs: number,
  ): Effect.Effect<BackendResult<WaitResult>, TerminalBackendError> {
    return attempt('wait', async () => {
      const handle = targetHandle(target);
      try {
        const result = await this.api.call<{ agent?: HerdrPaneInfo }>(
          'agent.wait',
          { target: handle, until: until.filter((state) => state !== 'exited'), timeout_ms: timeoutMs },
          { timeoutMs: timeoutMs + 10_000 },
        );
        return { state: toAgentState(result.agent?.agent_status), timedOut: false };
      } catch (error) {
        if (error instanceof HerdrApiError && error.code === 'timeout') {
          const info = await this.api.call<{ agent?: HerdrPaneInfo }>('agent.get', { target: handle });
          return { state: toAgentState(info.agent?.agent_status), timedOut: true };
        }
        throw error;
      }
    });
  }

  observe(terminalId: string): Effect.Effect<BackendResult<TerminalObservation>, TerminalBackendError> {
    return attempt('observe', async () => observeTerminal(terminalId));
  }

  control(terminalId: string): Effect.Effect<BackendResult<TerminalControl>, TerminalBackendError> {
    return attempt('control', async () => controlTerminal(terminalId));
  }

  list(): Effect.Effect<BackendResult<readonly BackendAgentSnapshot[]>, TerminalBackendError> {
    return attempt('list', async () => {
      const [agents, snapshot] = await Promise.all([
        this.api.call<{ agents?: HerdrPaneInfo[] }>('agent.list', {}),
        this.api.call<{ snapshot?: { panes?: HerdrPaneInfo[] } }>('session.snapshot', {}),
      ]);
      const byPane = new Map<string, HerdrPaneInfo>();
      for (const pane of snapshot.snapshot?.panes ?? []) byPane.set(pane.pane_id, pane);
      for (const agent of agents.agents ?? []) byPane.set(agent.pane_id, { ...byPane.get(agent.pane_id), ...agent });

      return [...byPane.values()].map((pane) => ({
        backend: BACKEND,
        paneId: pane.pane_id,
        ...(agentIdOf(pane) ? { agentId: agentIdOf(pane) } : {}),
        terminalId: pane.terminal_id,
        workspaceId: pane.workspace_id,
        state: toAgentState(pane.agent_status),
        tokens: (pane.tokens ?? {}) as Partial<PaneTokens>,
        ...(pane.cwd ? { cwd: pane.cwd } : {}),
        ...(pane.title ?? pane.terminal_title ? { title: (pane.title ?? pane.terminal_title) as string } : {}),
      }));
    });
  }

  /**
   * Subscribe after a snapshot: the caller's `list()` is the state at time T,
   * and the stream carries everything after it.
   */
  events(): Effect.Effect<BackendResult<BackendEventStream>, TerminalBackendError> {
    return attempt('events', async () => {
      await this.api.call('session.snapshot', {});
      const queue: BackendEvent[] = [];
      const waiters: Array<(result: IteratorResult<BackendEvent>) => void> = [];
      let done = false;

      const push = (event: BackendEvent): void => {
        const waiter = waiters.shift();
        if (waiter) waiter({ value: event, done: false });
        else queue.push(event);
      };
      const finish = (): void => {
        done = true;
        while (waiters.length) waiters.shift()?.({ value: undefined as unknown as BackendEvent, done: true });
      };

      const stream = this.api.stream(
        'events.subscribe',
        {
          subscriptions: [
            { type: 'workspace.created' },
            { type: 'workspace.closed' },
            { type: 'pane.created' },
            { type: 'pane.updated' },
            { type: 'pane.exited' },
            { type: 'pane.agent_detected' },
          ],
        },
        {
          onEvent: (kind, data) => {
            for (const event of toBackendEvents(kind, data)) push(event);
          },
          onClose: finish,
        },
      );
      await stream.started;

      return {
        events: {
          [Symbol.asyncIterator]: (): AsyncIterator<BackendEvent> => ({
            next: async (): Promise<IteratorResult<BackendEvent>> => {
              const buffered = queue.shift();
              if (buffered) return { value: buffered, done: false };
              if (done) return { value: undefined as unknown as BackendEvent, done: true };
              return await new Promise((resolve) => waiters.push(resolve));
            },
          }),
        },
        close: () => {
          stream.close();
          finish();
        },
      };
    });
  }

  reportMetadata(
    pane: AgentPaneRef | { readonly paneId: string },
    tokens: PaneTokens,
  ): Effect.Effect<BackendResult<Ok>, TerminalBackendError> {
    return attempt('reportMetadata', async () => {
      await this.api.call('pane.report_metadata', {
        pane_id: pane.paneId,
        source: METADATA_SOURCE,
        tokens: tokenPayload(tokens),
      });
      return { ok: true };
    });
  }

  close(ref: BackendRef): Effect.Effect<BackendResult<Ok>, TerminalBackendError> {
    return attempt('close', async () => {
      if ('paneId' in ref) await this.api.call('pane.close', { pane_id: ref.paneId });
      else await this.api.call('workspace.close', { workspace_id: ref.workspaceId });
      return { ok: true };
    });
  }

  /**
   * Herdr v0.9.1 (protocol 22) exposes no agent-resume method — resuming a
   * harness is the TUI's own restore path, not an API call. Overdeck resumes by
   * launching the harness with its resume flag, which is `startAgent` again.
   */
  resume(_ref: BackendRef): Effect.Effect<BackendResult<AgentPaneRef>, TerminalBackendError> {
    return Effect.succeed(
      unsupported(
        'herdr protocol 22 has no agent resume method; relaunch the harness with its own resume flag via startAgent',
      ),
    );
  }
}

export const herdrBackend = new HerdrBackend();

registerTerminalBackend(herdrBackend);

export { isUnsupported };
