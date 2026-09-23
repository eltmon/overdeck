/**
 * Backend inventory (PAN-3917 FR-12, W6).
 *
 * The live list of agent panes, folded into the dashboard read model as
 * `BackendPane[]`. This replaces every persisted agent mirror: nothing here is
 * written to disk or to SQLite, and nothing is read from an agent state
 * directory. The terminal backend owns session liveness and state (D10), so we
 * read it and keep the answer in memory only.
 *
 * One source, chosen by the host's backend POLICY (PAN-3956 D8):
 *   - Herdr (the default): the adapter's `list()` for the snapshot, `events()`
 *     folded on top of it. When `list()` fails or reports unsupported, the
 *     last-known panes are served (or `[]` with no cache) and one warning is
 *     logged per failure streak — a Herdr host NEVER reads tmux, so a Herdr
 *     outage cannot make every agent look dead or alive by accident.
 *   - tmux (explicit policy, or no adapter registered): the tmux probe IS the
 *     inventory. It reads what `src/lib/agents/liveness.ts` reads: the managed
 *     tmux server's sessions and their panes. Issue and role come from the
 *     session name; the tmux adapter reports no metadata tokens (FR-3), so
 *     harness and model are `unknown` there.
 */

import { Effect } from 'effect';
import type {
  AgentRole,
  AgentState,
  BackendPane,
} from '@overdeck/contracts';
import { isUnsupported, type BackendEvent, type TerminalBackend, type Unsupported } from '../../../lib/terminal-backends/types.js';
import { resolveTerminalBackend } from '../../../lib/terminal-backends/registry.js';
import {
  hostTerminalBackendName,
  selectTerminalBackend,
  type TerminalBackendConfig,
} from '../../../lib/terminal-backends/select.js';
import { paneFromBackendSnapshot } from '../../../lib/overdeck/derived-issue-state.js';

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
   * Adapter to read. Pass `null` to force the tmux probe. Omitted in
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
 * `src/lib/terminal-backends/herdr.js`) — then the tmux probe answers. The
 * name is the host POLICY (`hostTerminalBackendName`: env → config.yaml →
 * default herdr), never an availability probe; tests may pass `config`.
 */
async function resolveBackend(deps: BackendInventoryDeps): Promise<TerminalBackend | null> {
  if (deps.backend !== undefined) return deps.backend;
  const name = deps.config
    ? (await selectTerminalBackend(deps.config)).backend
    : await hostTerminalBackendName();
  try {
    return resolveTerminalBackend(name);
  } catch {
    return null;
  }
}

/** True while the Herdr inventory is failing — one warning per failure streak. */
let inventoryDegraded = false;

/**
 * Every live agent pane. Under a Herdr policy the adapter is the only source:
 * a failed read serves the last-known panes, never tmux (PAN-3956 D8). Under a
 * tmux policy (or with no adapter registered) the tmux probe is the inventory.
 */
export async function listBackendPanes(
  deps: BackendInventoryDeps = {},
  previous?: BackendPaneCache,
): Promise<readonly BackendPane[]> {
  const now = (deps.now ?? Date.now)();
  const backend = await resolveBackend(deps);

  if (backend?.name === 'herdr') {
    const result = await Effect.runPromise(
      backend.list().pipe(Effect.catch((error) => Effect.succeed({ failed: String(error) }))),
    );
    if (!('failed' in result) && !isUnsupported(result)) {
      if (inventoryDegraded) {
        inventoryDegraded = false;
        console.log('[backend-inventory] herdr inventory restored');
      }
      return result.map((snapshot) => paneFromBackendSnapshot(snapshot, now, previous?.get(snapshot.paneId)));
    }
    const reason = 'failed' in result ? result.failed : (result as Unsupported).reason;
    if (!inventoryDegraded) {
      inventoryDegraded = true;
      console.warn(`[backend-inventory] herdr inventory unavailable (${reason}); serving last-known panes`);
    }
    return previous?.list() ?? [];
  }

  if (backend) {
    // An explicit non-herdr adapter that can list answers first.
    const result = await Effect.runPromise(
      backend.list().pipe(Effect.catch(() => Effect.succeed(null))),
    );
    if (result !== null && !isUnsupported(result)) {
      return result.map((snapshot) => paneFromBackendSnapshot(snapshot, now, previous?.get(snapshot.paneId)));
    }
  }

  // tmux policy (or no adapter registered): the tmux probe is the inventory.
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
let paneListener: ((delta: BackendPaneDelta) => void) | null = null;

/** Panes that appeared or changed, and panes that left the inventory. */
export interface BackendPaneDelta {
  readonly changed: readonly BackendPane[];
  readonly removed: readonly string[];
}

/**
 * Subscribe to inventory changes (PAN-3917 FR-12). The read model fans these
 * out as `backend_pane.changed` / `backend_pane.removed`; nothing is stored.
 */
export function onBackendPanesChanged(fn: (delta: BackendPaneDelta) => void): void {
  paneListener = fn;
}

function publishDelta(previous: BackendPaneCache | null, next: BackendPaneCache): void {
  if (!paneListener) return;
  const before = new Map((previous?.list() ?? []).map((pane) => [pane.id, pane]));
  const changed: BackendPane[] = [];
  for (const pane of next.list()) {
    const prior = before.get(pane.id);
    before.delete(pane.id);
    if (!prior || JSON.stringify(prior) !== JSON.stringify(pane)) changed.push(pane);
  }
  const removed = [...before.keys()];
  if (changed.length === 0 && removed.length === 0) return;
  try {
    paneListener({ changed, removed });
  } catch (error) {
    console.warn(`[backend-inventory] pane listener failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
      const panes = await listBackendPanes(deps, cache ?? undefined);
      const next = new BackendPaneCache(panes);
      publishDelta(cache, next);
      cache = next;
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

/** First delay before re-opening a failed or ended event stream; doubles per failure. */
export const EVENT_STREAM_RETRY_MIN_MS = 1_000;
/** Ceiling for the re-open backoff. The retry never gives up. */
export const EVENT_STREAM_RETRY_MAX_MS = 30_000;

let inventoryStarted = false;
let streamGeneration = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = EVENT_STREAM_RETRY_MIN_MS;
let streamRetryWarned = false;

/**
 * Re-open the stream after `retryDelayMs` (1 s, 2 s, 4 s … capped at 30 s).
 * One warning per failure streak.
 */
function scheduleResubscribe(deps: BackendInventoryDeps, why: string): void {
  if (!inventoryStarted || retryTimer) return;
  const delay = retryDelayMs;
  retryDelayMs = Math.min(retryDelayMs * 2, EVENT_STREAM_RETRY_MAX_MS);
  if (!streamRetryWarned) {
    streamRetryWarned = true;
    console.warn(`[backend-inventory] pane event stream ${why}; re-opening with backoff (up to every `
      + `${EVENT_STREAM_RETRY_MAX_MS / 1000}s)`);
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void openEventStream(deps, true).catch((error: unknown) => {
      scheduleResubscribe(deps, `could not be re-opened (${error instanceof Error ? error.message : String(error)})`);
    });
  }, delay);
  retryTimer.unref?.();
}

/**
 * Open the event stream and fold it into the cache. A stream that cannot be
 * opened (Herdr not up yet at dashboard boot) or that ends (Herdr restarted)
 * is re-opened with backoff; a backend that cannot stream at all is left to
 * the TTL refresh (PAN-3956 review finding 8).
 */
async function openEventStream(deps: BackendInventoryDeps, reopening: boolean): Promise<void> {
  if (!inventoryStarted) return;
  const backend = await resolveBackend(deps);
  if (!backend || !inventoryStarted) return;

  const stream = await Effect.runPromise(
    backend.events().pipe(Effect.catch(() => Effect.succeed(null))),
  );
  if (stream !== null && isUnsupported(stream)) return;
  if (!inventoryStarted) {
    stream?.close();
    return;
  }
  if (stream === null) {
    scheduleResubscribe(deps, 'could not be opened');
    return;
  }

  const generation = ++streamGeneration;
  eventStreamClose = () => stream.close();
  if (reopening) {
    // Events were missed while the stream was down: fold onto a fresh snapshot.
    refreshedAt = 0;
    await getBackendPanes(deps);
  }
  void (async () => {
    try {
      for await (const event of stream.events) {
        retryDelayMs = EVENT_STREAM_RETRY_MIN_MS;
        streamRetryWarned = false;
        if (!cache) continue;
        const before = cache.list();
        cache.apply(event);
        publishDelta(new BackendPaneCache(before), cache);
      }
    } catch (error) {
      console.warn(`[backend-inventory] event stream ended: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Stopped, or superseded by a newer stream: nothing to re-open.
    if (generation !== streamGeneration || !inventoryStarted) return;
    eventStreamClose = null;
    scheduleResubscribe(deps, 'ended');
  })();
}

/**
 * Take the first snapshot and open the backend event stream. Idempotent; a
 * backend that cannot stream events is left to the TTL refresh.
 */
export async function startBackendInventory(deps: BackendInventoryDeps = {}): Promise<void> {
  if (inventoryStarted) return;
  inventoryStarted = true;
  await getBackendPanes(deps);
  await openEventStream(deps, false);
}

export function stopBackendInventory(): void {
  inventoryStarted = false;
  streamGeneration++;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelayMs = EVENT_STREAM_RETRY_MIN_MS;
  streamRetryWarned = false;
  eventStreamClose?.();
  eventStreamClose = null;
}

/** Test seam: drop the process-wide cache. */
export function _resetBackendInventoryForTests(): void {
  cache = null;
  inventoryDegraded = false;
  refreshedAt = 0;
  inFlight = null;
  stopBackendInventory();
  paneListener = null;
}
