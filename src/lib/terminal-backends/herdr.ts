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
 * field. Instead the adapter splits a pane with the launch env, runs the
 * launcher in it with `pane.send_input` (text plus Enter in one ordered
 * submission), waits for Herdr's own agent detection, and binds the agent name
 * with `agent.rename`. Herdr then reports the pane as a first-class agent —
 * `agent.prompt`, `agent.wait` and the `idle|working|blocked|done` states all
 * work — and both backends run the identical launcher.
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
export const HERDR_PROBE_TIMEOUT_MS = 2_000;

/**
 * The live Herdr agent behind an Overdeck agent id, or null when there is none.
 *
 * The adapter binds the Overdeck agent id as Herdr's live agent name
 * (`agent.rename`), so one `agent.get` answers it. A null answer means the
 * target is not a Herdr agent — a tmux session from before the cut, or an id
 * that no longer exists — and the caller keeps its tmux path.
 */
export async function findHerdrAgent(
  agentName: string,
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<{ paneId: string; terminalId: string; workspaceId: string; state: AgentState; tokens: Partial<PaneTokens> } | null> {
  try {
    const info = await api.call<{ agent?: HerdrPaneInfo }>(
      'agent.get',
      { target: agentName },
      { timeoutMs: HERDR_PROBE_TIMEOUT_MS },
    );
    const agent = info.agent;
    if (!agent) return null;
    return {
      paneId: agent.pane_id,
      terminalId: agent.terminal_id,
      workspaceId: agent.workspace_id,
      state: toAgentState(agent.agent_status),
      tokens: (agent.tokens ?? {}) as Partial<PaneTokens>,
    };
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
      // The server answered — it simply does not know this agent.
      return { kind: 'absent' };
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { kind: 'indeterminate', reason };
  }
  const agent = info.agent;
  if (!agent) return { kind: 'absent' };
  const state = toAgentState(agent.agent_status);
  if (state === 'exited') return { kind: 'exited', paneId: agent.pane_id };
  return { kind: 'alive', paneId: agent.pane_id, state };
}

/** One live Herdr agent, keyed by the Overdeck agent id bound with `agent.rename`. */
export interface HerdrLiveAgent {
  readonly agentId: string;
  readonly paneId: string;
  readonly terminalId: string;
  readonly state: AgentState;
  readonly tokens: Partial<PaneTokens>;
}

/**
 * Every live Herdr agent, as the backend-aware inventory reads it.
 *
 * `BackendAgentSnapshot` carries no agent name, and on Herdr the Overdeck agent
 * id is the *live agent name* (`agent.rename`), not the `w1:p1` pane id — so
 * the inventory needs this narrower read. Agents Herdr detected but Overdeck
 * never named are skipped: nothing can address them by agent id.
 */
export async function listHerdrAgents(
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<readonly HerdrLiveAgent[]> {
  const listed = await api.call<{ agents?: HerdrPaneInfo[] }>('agent.list', {});
  const agents: HerdrLiveAgent[] = [];
  for (const agent of listed.agents ?? []) {
    const agentId = agent.name?.trim();
    if (!agentId) continue;
    agents.push({
      agentId,
      paneId: agent.pane_id,
      terminalId: agent.terminal_id,
      state: toAgentState(agent.agent_status),
      tokens: (agent.tokens ?? {}) as Partial<PaneTokens>,
    });
  }
  return agents;
}

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

      await this.api.call('pane.send_input', {
        pane_id: pane.pane_id,
        text: spec.argv.map(shellQuote).join(' '),
        keys: ['enter'],
      });

      const agentName = spec.name ?? `${spec.tokens.role}-${pane.pane_id.replace(':', '-')}`;
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

      await this.api.call('pane.report_metadata', {
        pane_id: pane.pane_id,
        source: METADATA_SOURCE,
        tokens: tokenPayload(spec.tokens),
      });

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
