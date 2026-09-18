/**
 * Backend inventory (PAN-3917 FR-12, W6).
 *
 * The live list of agent panes, folded into the dashboard read model as
 * `BackendPane[]`. This replaces every persisted agent mirror: nothing here is
 * written to disk or to SQLite, and nothing is read from an agent state
 * directory. The terminal backend owns session liveness and state (D10), so we
 * read it and keep the answer in memory only.
 *
 * Two sources, in order:
 *   1. The registered terminal backend (`list()` for the snapshot, `events()`
 *      folded on top of it). Herdr is the default.
 *   2. The tmux fallback, which reads the same inventory today's
 *      `src/lib/agents/liveness.ts` reads: the managed tmux server's sessions
 *      and their panes. Issue and role come from the session name; the tmux
 *      adapter reports no metadata tokens (FR-3), so harness and model are
 *      `unknown` there.
 */

import { Effect } from 'effect';
import type {
  AgentRole,
  AgentState,
  BackendAgentSnapshot,
  BackendPane,
} from '@overdeck/contracts';
import { isUnsupported, type BackendEvent, type TerminalBackend } from '../../../lib/terminal-backends/types.js';
import { resolveTerminalBackend } from '../../../lib/terminal-backends/registry.js';
import { selectTerminalBackend, type TerminalBackendConfig } from '../../../lib/terminal-backends/select.js';

/** How long a pane may sit without output before the tmux fallback calls it idle. */
export const TMUX_IDLE_THRESHOLD_MS = 5 * 60_000;

/** One tmux session as the fallback probe sees it. */
export interface TmuxPaneProbe {
  /** Session name, e.g. `agent-pan-3917-review`. */
  readonly session: string;
  readonly dead: boolean;
  /** Epoch millis of the pane's last output; null when tmux did not report it. */
  readonly activityMs: number | null;
  readonly cwd?: string;
}

export interface BackendInventoryDeps {
  /**
   * Adapter to read. Pass `null` to force the tmux fallback. Omitted in
   * production: the inventory selects and resolves the adapter itself.
   */
  readonly backend?: TerminalBackend | null;
  readonly listTmuxPanes?: () => Promise<readonly TmuxPaneProbe[]>;
  readonly now?: () => number;
  readonly idleThresholdMs?: number;
  readonly config?: TerminalBackendConfig;
}

// ─── session-name parsing (tmux fallback) ────────────────────────────────────

/**
 * `agent-pan-3917-review` → issue `PAN-3917`, role `review`. An operator
 * conversation (`conv-…`) carries no issue and no role (FR-5).
 */
const ROLE_SUFFIXES: ReadonlyArray<readonly [string, AgentRole]> = [
  ['-review', 'review'],
  ['-test', 'test'],
  ['-uat', 'uat'],
];

export interface ParsedSessionName {
  readonly issue?: string;
  readonly role: AgentRole;
}

/** Issue and role from a managed tmux session name. `null` for non-agent sessions. */
export function parseAgentSessionName(session: string): ParsedSessionName | null {
  const name = session.toLowerCase();
  if (name.startsWith('conv-')) return null;

  if (name.startsWith('strike-')) {
    return { issue: name.slice('strike-'.length).toUpperCase(), role: 'strike' };
  }
  if (name.startsWith('planning-')) {
    return { issue: name.slice('planning-'.length).toUpperCase(), role: 'plan' };
  }
  if (!name.startsWith('agent-')) return null;

  let rest = name.slice('agent-'.length);
  if (!rest) return null;

  // `agent-pan-3917-slot-2` is an item pane created by `pan spawn` (FR-5 `worker`).
  const slot = /^(.*)-slot-\d+$/.exec(rest);
  if (slot?.[1]) return { issue: slot[1].toUpperCase(), role: 'worker' };

  for (const [suffix, role] of ROLE_SUFFIXES) {
    if (rest.endsWith(suffix)) {
      rest = rest.slice(0, -suffix.length);
      return rest ? { issue: rest.toUpperCase(), role } : null;
    }
  }
  return { issue: rest.toUpperCase(), role: 'work' };
}

// ─── mapping ─────────────────────────────────────────────────────────────────

function snapshotToPane(snapshot: BackendAgentSnapshot, now: number): BackendPane {
  const tokens = snapshot.tokens;
  const pane: {
    -readonly [K in keyof BackendPane]: BackendPane[K];
  } = {
    id: snapshot.paneId,
    role: tokens.role ?? 'work',
    harness: tokens.harness ?? 'unknown',
    model: tokens.model ?? 'unknown',
    state: snapshot.state,
    stateSince: now,
    terminalId: snapshot.terminalId,
  };
  if (tokens.issue) pane.issue = tokens.issue;
  if (snapshot.cwd) pane.workspace = snapshot.cwd;
  return pane;
}

function tmuxProbeToPane(
  probe: TmuxPaneProbe,
  now: number,
  idleThresholdMs: number,
): BackendPane | null {
  const parsed = parseAgentSessionName(probe.session);
  if (!parsed) return null;

  let state: AgentState;
  let stateSince = probe.activityMs ?? now;
  if (probe.dead) {
    state = 'exited';
  } else if (probe.activityMs !== null && now - probe.activityMs > idleThresholdMs) {
    state = 'idle';
  } else {
    state = 'working';
    stateSince = probe.activityMs ?? now;
  }

  const pane: { -readonly [K in keyof BackendPane]: BackendPane[K] } = {
    id: probe.session,
    role: parsed.role,
    // FR-3: the tmux adapter reports no metadata tokens.
    harness: 'unknown',
    model: 'unknown',
    state,
    stateSince,
    terminalId: probe.session,
  };
  if (parsed.issue) pane.issue = parsed.issue;
  if (probe.cwd) pane.workspace = probe.cwd;
  return pane;
}

// ─── tmux fallback probe ─────────────────────────────────────────────────────

/** Today's liveness inventory: every managed tmux session and its first pane. */
async function probeTmuxPanes(): Promise<readonly TmuxPaneProbe[]> {
  // Imported here, not at module load: the dashboard reads the inventory
  // through the backend adapter, and only the fallback needs tmux.
  const { listPaneValuesSync, listSessionsSync } = await import('../../../lib/tmux.js');
  const probes: TmuxPaneProbe[] = [];
  for (const session of listSessionsSync()) {
    const rows = listPaneValuesSync(session.name, '#{pane_dead}\t#{pane_activity}\t#{pane_current_path}');
    const [first] = rows;
    if (first === undefined) {
      probes.push({ session: session.name, dead: true, activityMs: null });
      continue;
    }
    const [deadRaw = '', activityRaw = '', cwd = ''] = first.split('\t');
    const activitySeconds = Number.parseInt(activityRaw.trim(), 10);
    const probe: TmuxPaneProbe = {
      session: session.name,
      dead: deadRaw.trim() === '1',
      activityMs: Number.isFinite(activitySeconds) ? activitySeconds * 1000 : null,
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
    };
    probes.push(probe);
  }
  return probes;
}

// ─── the inventory ───────────────────────────────────────────────────────────

/**
 * The adapter to read, or `null` when none is registered (nothing imported
 * `src/lib/terminal-backends/herdr.js`) — then the tmux fallback answers.
 */
async function resolveBackend(deps: BackendInventoryDeps): Promise<TerminalBackend | null> {
  if (deps.backend !== undefined) return deps.backend;
  const selection = await selectTerminalBackend(deps.config ?? {});
  try {
    return resolveTerminalBackend(selection.backend);
  } catch {
    return null;
  }
}

/** Every live agent pane, from the backend if it answers and from tmux otherwise. */
export async function listBackendPanes(deps: BackendInventoryDeps = {}): Promise<readonly BackendPane[]> {
  const now = (deps.now ?? Date.now)();
  const backend = await resolveBackend(deps);

  if (backend) {
    const result = await Effect.runPromise(
      backend.list().pipe(Effect.catch(() => Effect.succeed(null))),
    );
    if (result !== null && !isUnsupported(result)) {
      return result.map((snapshot) => snapshotToPane(snapshot, now));
    }
  }

  const probes = await (deps.listTmuxPanes ?? probeTmuxPanes)();
  const idleThresholdMs = deps.idleThresholdMs ?? TMUX_IDLE_THRESHOLD_MS;
  return probes
    .map((probe) => tmuxProbeToPane(probe, now, idleThresholdMs))
    .filter((pane): pane is BackendPane => pane !== null);
}

/**
 * The snapshot plus the event stream folded on top of it. Events only ever
 * change the in-memory map — the whole point of FR-12 is that no copy of this
 * is written down.
 */
export class BackendPaneCache {
  private readonly panes = new Map<string, BackendPane>();

  constructor(initial: readonly BackendPane[] = []) {
    for (const pane of initial) this.panes.set(pane.id, pane);
  }

  list(): readonly BackendPane[] {
    return [...this.panes.values()];
  }

  forIssue(issueId: string): readonly BackendPane[] {
    const wanted = issueId.toUpperCase();
    return this.list().filter((pane) => pane.issue === wanted);
  }

  get(paneId: string): BackendPane | undefined {
    return this.panes.get(paneId);
  }

  apply(event: BackendEvent, now = Date.now()): void {
    switch (event.kind) {
      case 'agent-state': {
        const pane = this.panes.get(event.paneId);
        if (!pane) return;
        if (pane.state === event.state) return;
        this.panes.set(event.paneId, { ...pane, state: event.state, stateSince: now });
        return;
      }
      case 'pane-created': {
        if (this.panes.has(event.paneId)) return;
        this.panes.set(event.paneId, {
          id: event.paneId,
          role: 'work',
          harness: 'unknown',
          model: 'unknown',
          state: 'unknown',
          stateSince: now,
          terminalId: event.paneId,
        });
        return;
      }
      case 'pane-exited': {
        const pane = this.panes.get(event.paneId);
        if (!pane) return;
        this.panes.set(event.paneId, { ...pane, state: 'exited', stateSince: now });
        return;
      }
      case 'metadata': {
        const pane = this.panes.get(event.paneId);
        if (!pane) return;
        const next: { -readonly [K in keyof BackendPane]: BackendPane[K] } = { ...pane };
        if (event.tokens.issue) next.issue = event.tokens.issue;
        if (event.tokens.role) next.role = event.tokens.role;
        if (event.tokens.harness) next.harness = event.tokens.harness;
        if (event.tokens.model) next.model = event.tokens.model;
        this.panes.set(event.paneId, next);
        return;
      }
      case 'workspace-closed': {
        for (const [id, pane] of this.panes) {
          if (pane.workspace === event.workspaceId) {
            this.panes.set(id, { ...pane, state: 'exited', stateSince: now });
          }
        }
        return;
      }
    }
  }
}

// ─── process-wide read door ──────────────────────────────────────────────────

let cache: BackendPaneCache | null = null;
let refreshedAt = 0;
let inFlight: Promise<readonly BackendPane[]> | null = null;
let eventStreamClose: (() => void) | null = null;

/** How long a snapshot is served before another `list()` is issued. */
export const INVENTORY_TTL_MS = 5_000;

/**
 * The read door every route and service uses. Serves the cached snapshot until
 * it ages out, then re-reads the backend. Concurrent callers share one read.
 */
export async function getBackendPanes(deps: BackendInventoryDeps = {}): Promise<readonly BackendPane[]> {
  const now = (deps.now ?? Date.now)();
  if (cache && now - refreshedAt < INVENTORY_TTL_MS) return cache.list();
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const panes = await listBackendPanes(deps);
      cache = new BackendPaneCache(panes);
      refreshedAt = now;
      return panes;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Panes whose `issue` token names this issue. */
export async function getBackendPanesForIssue(
  issueId: string,
  deps: BackendInventoryDeps = {},
): Promise<readonly BackendPane[]> {
  const wanted = issueId.toUpperCase();
  return (await getBackendPanes(deps)).filter((pane) => pane.issue === wanted);
}

/** True when a pane for this issue is live (not `exited`). */
export async function hasLiveBackendPane(issueId: string, deps: BackendInventoryDeps = {}): Promise<boolean> {
  return (await getBackendPanesForIssue(issueId, deps)).some((pane) => pane.state !== 'exited');
}

/**
 * Open the backend event stream and fold it into the cache. Idempotent; a
 * backend that cannot stream events is left to the TTL refresh.
 */
export async function startBackendInventory(deps: BackendInventoryDeps = {}): Promise<void> {
  if (eventStreamClose) return;
  await getBackendPanes(deps);

  const backend = await resolveBackend(deps);
  if (!backend) return;

  const stream = await Effect.runPromise(
    backend.events().pipe(Effect.catch(() => Effect.succeed(null))),
  );
  if (stream === null || isUnsupported(stream)) return;

  eventStreamClose = () => stream.close();
  void (async () => {
    try {
      for await (const event of stream.events) {
        cache?.apply(event);
      }
    } catch (error) {
      console.warn(`[backend-inventory] event stream ended: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
}

export function stopBackendInventory(): void {
  eventStreamClose?.();
  eventStreamClose = null;
}

/** Test seam: drop the process-wide cache. */
export function _resetBackendInventoryForTests(): void {
  cache = null;
  refreshedAt = 0;
  inFlight = null;
  eventStreamClose = null;
}
