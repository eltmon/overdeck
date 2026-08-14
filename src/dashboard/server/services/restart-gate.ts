/**
 * Restart Gate (PAN-3729) — operator approval for voluntary dashboard restarts.
 *
 * A *voluntary* restart is one a requester asks for: the post-merge deploy
 * script, `pan reload`, or bare `pan restart`. An *involuntary* restart (crash
 * recovery, watchdog respawn, the supervisor's own `POST /restart-dashboard`)
 * is never gated — gating it would deadlock the mechanism an approved restart
 * uses to actually restart.
 *
 * Requesters register through `POST /api/restart-gate/requests` every 5s and
 * block until the operator approves. One approval opens one *epoch*: the
 * snapshot of request ids taken at approval. Exactly one requester in that
 * epoch *claims* the restart; every other member is *satisfied* by it once the
 * fresh server boots.
 *
 * ── Doors ──────────────────────────────────────────────────────────────────
 * This module is the ONE read door and the ONE write door for gate state. No
 * route handler, CLI, or script reads or writes `restart-gate.json` directly.
 * The gate is runtime-plane state — the same plane as
 * `~/.overdeck/dashboard-restarting.json` — so it is NOT canonical, NOT
 * mirrored to git, and NOT persisted to the event log. It is a single JSON
 * file that survives exactly one restart, which is all the protocol needs.
 *
 * ── Expiry rules ───────────────────────────────────────────────────────────
 * - A pending request not refreshed for 20s expires (a poll IS the refresh).
 * - A claim not completed within 5 minutes lapses; the epoch falls back to
 *   `approved` and the next poller may claim it. This covers a claimant that
 *   died between claiming and restarting.
 * - An unclaimed epoch whose members have ALL expired is dropped, so the gate
 *   cannot wedge in `approved` forever with nobody left to claim it. This is
 *   the post-approval twin of "approve when every request has already expired
 *   → clear the gate, restart nothing". That drop records `lastOutcome` on the
 *   projection for 15s so the banner can say the approval restarted nothing
 *   instead of silently vanishing (PAN-3731).
 * - Satisfied ids are served to polls for 10 minutes after boot, then pruned.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  RestartGateKind,
  RestartGateOutcome,
  RestartGateRequest,
  RestartGateSnapshot,
} from '@overdeck/contracts';

import { OVERDECK_HOME } from '../../../lib/paths.js';

// ─── Constants (pinned by the PAN-3729 wire contract) ────────────────────────

/** A pending request not refreshed within this window expires. */
export const REQUEST_TTL_MS = 20_000;
/** A claim not completed within this window lapses back to `approved`. */
export const CLAIM_LAPSE_MS = 5 * 60_000;
/** Satisfied requester ids are served to late polls for this long. */
export const SATISFIED_TTL_MS = 10 * 60_000;
/** How often the server prunes expired requests so the banner self-clears. */
export const SWEEP_INTERVAL_MS = 5_000;
/**
 * How long the projection carries `lastOutcome` (PAN-3731 — not part of the
 * pinned PAN-3729 wire contract). Long enough for a browser to receive the
 * event and show its short notice, short enough that a late connect does not
 * see a stale one.
 */
export const OUTCOME_TTL_MS = 15_000;

export const RESTART_GATE_FILE = join(OVERDECK_HOME, 'restart-gate.json');

// ─── State shapes ────────────────────────────────────────────────────────────

/** A live request plus the refresh clock the wire contract does not carry. */
export interface StoredRestartRequest extends RestartGateRequest {
  /** Bumped by every poll; drives the 20s TTL. */
  lastSeenAt: string;
}

/** One approval cycle. At most one restart happens per epoch. */
export interface RestartGateEpoch {
  id: string;
  /** Request ids captured at approval — the set this restart will satisfy. */
  requesterIds: string[];
  approvedAt: string;
  claimedBy?: string;
  claimedAt?: string;
}

export interface RestartGateState {
  version: 1;
  pending: StoredRestartRequest[];
  epoch: RestartGateEpoch | null;
  satisfied: Array<{ requesterId: string; satisfiedAt: string }>;
  /** Set when an epoch ended without restarting anything (PAN-3731). */
  lastOutcome?: RestartGateOutcome;
}

export type RestartGateStatus = RestartGateSnapshot['status'];

/** What a poll (`POST /api/restart-gate/requests`) answers. */
export interface RestartGatePollResult {
  status: RestartGateStatus | 'satisfied';
  mayClaim: boolean;
  pendingCount: number;
}

export interface RestartGateClaimResult {
  granted: boolean;
  status: RestartGateStatus;
}

export interface RestartGateRequestInput {
  requesterId: string;
  kind: RestartGateKind;
  reason: string;
  builtSha?: string;
}

export function emptyRestartGateState(): RestartGateState {
  return { version: 1, pending: [], epoch: null, satisfied: [] };
}

// ─── Pure state machine (exported for tests) ─────────────────────────────────

function millis(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** True while the epoch's claim is held and has not lapsed. */
function hasLiveClaim(epoch: RestartGateEpoch | null, nowMs: number): boolean {
  if (!epoch?.claimedBy || !epoch.claimedAt) return false;
  return nowMs - millis(epoch.claimedAt) < CLAIM_LAPSE_MS;
}

/**
 * Drops everything the clock has invalidated. Called on EVERY read and every
 * mutation, so a caller never has to remember to prune first.
 */
export function pruneRestartGateState(state: RestartGateState, nowMs: number): RestartGateState {
  const pending = state.pending.filter((request) => nowMs - millis(request.lastSeenAt) < REQUEST_TTL_MS);
  const satisfied = state.satisfied.filter((entry) => nowMs - millis(entry.satisfiedAt) < SATISFIED_TTL_MS);

  let lastOutcome = state.lastOutcome;
  if (lastOutcome && nowMs - millis(lastOutcome.at) >= OUTCOME_TTL_MS) lastOutcome = undefined;

  let epoch = state.epoch;
  if (epoch && !hasLiveClaim(epoch, nowMs)) {
    // Every member of an unclaimed (or lapsed) epoch is gone — nobody is left
    // to claim it, so the epoch must not outlive them and block later requests.
    const livePending = new Set(pending.map((request) => request.requesterId));
    if (!epoch.requesterIds.some((id) => livePending.has(id))) {
      epoch = null;
      // An approval opened this epoch and it died with nobody to perform the
      // restart, so the operator's click restarted nothing. Record that, or
      // the banner would just vanish and read as a broken button (PAN-3731).
      lastOutcome = { type: 'pruned-unclaimed', at: new Date(nowMs).toISOString() };
    }
  }

  return {
    version: state.version,
    pending,
    satisfied,
    epoch,
    ...(lastOutcome === undefined ? {} : { lastOutcome }),
  };
}

/** The single place gate status is derived — used by every read and mutation. */
export function deriveRestartGateStatus(state: RestartGateState, nowMs: number): RestartGateStatus {
  if (state.epoch) return hasLiveClaim(state.epoch, nowMs) ? 'claimed' : 'approved';
  return state.pending.length > 0 ? 'pending' : 'idle';
}

/** The operator-facing projection — identical to the `GET /api/restart-gate` body. */
export function toRestartGateSnapshot(state: RestartGateState, nowMs: number): RestartGateSnapshot {
  return {
    status: deriveRestartGateStatus(state, nowMs),
    pending: state.pending.map((request) => ({
      requesterId: request.requesterId,
      kind: request.kind,
      reason: request.reason,
      ...(request.builtSha === undefined ? {} : { builtSha: request.builtSha }),
      requestedAt: request.requestedAt,
    })),
    ...(state.lastOutcome === undefined ? {} : { lastOutcome: state.lastOutcome }),
  };
}

/**
 * Upsert + poll + TTL refresh in one step.
 *
 * A requester already marked satisfied is answered without being re-added:
 * its restart happened, so it must exit rather than start a new cycle.
 */
export function upsertRestartRequest(
  state: RestartGateState,
  input: RestartGateRequestInput,
  nowMs: number,
): { state: RestartGateState; result: RestartGatePollResult } {
  const pruned = pruneRestartGateState(state, nowMs);
  const nowIso = new Date(nowMs).toISOString();

  if (pruned.satisfied.some((entry) => entry.requesterId === input.requesterId)) {
    return {
      state: pruned,
      result: { status: 'satisfied', mayClaim: false, pendingCount: pruned.pending.length },
    };
  }

  const existing = pruned.pending.find((request) => request.requesterId === input.requesterId);
  const upserted: StoredRestartRequest = {
    requesterId: input.requesterId,
    kind: input.kind,
    reason: input.reason,
    ...(input.builtSha === undefined ? {} : { builtSha: input.builtSha }),
    requestedAt: existing?.requestedAt ?? nowIso,
    lastSeenAt: nowIso,
  };
  const pending = existing
    ? pruned.pending.map((request) => (request.requesterId === input.requesterId ? upserted : request))
    : [...pruned.pending, upserted];
  const next: RestartGateState = { ...pruned, pending };

  const gateStatus = deriveRestartGateStatus(next, nowMs);
  const inEpoch = next.epoch?.requesterIds.includes(input.requesterId) ?? false;

  // A request that arrives after approval is NOT part of the open epoch — it
  // waits for the next cycle and reads as plain `pending`.
  if (!inEpoch) {
    return { state: next, result: { status: 'pending', mayClaim: false, pendingCount: pending.length } };
  }
  if (gateStatus === 'claimed') {
    return {
      state: next,
      result: {
        status: 'claimed',
        mayClaim: next.epoch?.claimedBy === input.requesterId,
        pendingCount: pending.length,
      },
    };
  }
  return { state: next, result: { status: 'approved', mayClaim: true, pendingCount: pending.length } };
}

/**
 * Operator approval. Opens one epoch over every live request.
 *
 * When every request has already expired there is nothing to restart for, so
 * the gate is simply cleared — approving must never trigger a bare restart.
 * Re-approving an open epoch is a no-op so a double-click cannot widen it.
 */
export function approveRestartGate(
  state: RestartGateState,
  nowMs: number,
): { state: RestartGateState; result: { approved: true; pendingCount: number } } {
  const pruned = pruneRestartGateState(state, nowMs);

  if (pruned.epoch) {
    return { state: pruned, result: { approved: true, pendingCount: pruned.pending.length } };
  }
  if (pruned.pending.length === 0) {
    return {
      state: { ...pruned, epoch: null },
      result: { approved: true, pendingCount: 0 },
    };
  }

  const nowIso = new Date(nowMs).toISOString();
  const epoch: RestartGateEpoch = {
    id: `epoch-${nowMs}`,
    requesterIds: pruned.pending.map((request) => request.requesterId),
    approvedAt: nowIso,
  };
  return { state: { ...pruned, epoch }, result: { approved: true, pendingCount: pruned.pending.length } };
}

/**
 * Grant the exclusive right to perform the restart.
 *
 * Atomic by construction: the state transition is synchronous, so two
 * concurrent claims are serialized by the event loop and exactly one wins.
 * A claimant re-claiming its own live claim is granted again, so a retry after
 * a dropped response is safe.
 */
export function claimRestartGate(
  state: RestartGateState,
  requesterId: string,
  nowMs: number,
): { state: RestartGateState; result: RestartGateClaimResult } {
  const pruned = pruneRestartGateState(state, nowMs);
  const epoch = pruned.epoch;

  if (!epoch || !epoch.requesterIds.includes(requesterId)) {
    return { state: pruned, result: { granted: false, status: deriveRestartGateStatus(pruned, nowMs) } };
  }
  if (hasLiveClaim(epoch, nowMs) && epoch.claimedBy !== requesterId) {
    return { state: pruned, result: { granted: false, status: 'claimed' } };
  }

  const claimed: RestartGateEpoch = {
    ...epoch,
    claimedBy: requesterId,
    claimedAt: new Date(nowMs).toISOString(),
  };
  return { state: { ...pruned, epoch: claimed }, result: { granted: true, status: 'claimed' } };
}

/**
 * The dashboard's own restart button is implicit approval (PAN-3729 §2.4).
 *
 * Every live request is folded into an epoch claimed by the UI, so the boot
 * that follows marks them satisfied and unblocks the requesters instead of
 * leaving them waiting for an approval that already happened.
 */
export function satisfyRestartGateForDirectRestart(
  state: RestartGateState,
  nowMs: number,
  claimedBy: string,
): RestartGateState {
  const pruned = pruneRestartGateState(state, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  return {
    ...pruned,
    epoch: {
      id: `epoch-${nowMs}`,
      requesterIds: pruned.pending.map((request) => request.requesterId),
      approvedAt: nowIso,
      claimedBy,
      claimedAt: nowIso,
    },
  };
}

/**
 * Boot-time epoch resolution: this process starting IS the restart completing.
 *
 * A persisted epoch in `claimed` state means the previous server died to
 * perform an approved restart, so every member of that epoch got what it asked
 * for. An approved-but-unclaimed epoch is left alone — nobody performed a
 * restart for it, so its members keep waiting and can still claim.
 */
export function resolveRestartGateBoot(
  state: RestartGateState,
  nowMs: number,
): { state: RestartGateState; satisfiedIds: string[] } {
  if (!state.epoch?.claimedBy) {
    return { state: pruneRestartGateState(state, nowMs), satisfiedIds: [] };
  }

  const satisfiedAt = new Date(nowMs).toISOString();
  const satisfiedIds = state.epoch.requesterIds;
  const satisfied = [
    ...state.satisfied.filter((entry) => !satisfiedIds.includes(entry.requesterId)),
    ...satisfiedIds.map((requesterId) => ({ requesterId, satisfiedAt })),
  ];
  return {
    state: pruneRestartGateState({ ...state, pending: [], epoch: null, satisfied }, nowMs),
    satisfiedIds,
  };
}

// ─── Service (the doors) ─────────────────────────────────────────────────────

export interface RestartGateDeps {
  /** Overridden in tests; production uses `~/.overdeck/restart-gate.json`. */
  filePath?: string;
  now?: () => number;
  /** Publishes the projection to the read model; defaults to the event store. */
  emit?: (snapshot: RestartGateSnapshot) => void;
}

export interface RestartGate {
  request(input: RestartGateRequestInput): Promise<RestartGatePollResult>;
  claim(requesterId: string): Promise<RestartGateClaimResult>;
  approve(): Promise<{ approved: true; pendingCount: number }>;
  read(): Promise<RestartGateSnapshot>;
  /** Implicit approval taken by the dashboard's own restart button. */
  satisfyForDirectRestart(claimedBy: string): Promise<void>;
  /** Prune expired requests and republish if the projection changed. */
  sweep(): Promise<RestartGateSnapshot>;
}

function emitThroughEventStore(snapshot: RestartGateSnapshot): void {
  void (async () => {
    try {
      const { getEventStore } = await import('../event-store.js');
      // emitOnly, never append: the gate is runtime-plane, so it fans out to
      // live subscribers without entering the durable event log.
      getEventStore().emitOnly({
        type: 'restart_gate.changed',
        timestamp: new Date().toISOString(),
        payload: snapshot,
      });
    } catch {
      // Event store not ready yet — the next mutation or sweep republishes.
    }
  })();
}

export function createRestartGate(deps: RestartGateDeps = {}): RestartGate {
  const filePath = deps.filePath ?? RESTART_GATE_FILE;
  const now = deps.now ?? (() => Date.now());
  const emit = deps.emit ?? emitThroughEventStore;

  let state: RestartGateState | null = null;
  let loading: Promise<void> | null = null;
  let writing: Promise<void> = Promise.resolve();
  let lastPublished: string | null = null;

  async function loadState(): Promise<void> {
    let parsed: RestartGateState;
    try {
      const raw = await readFile(filePath, 'utf-8');
      const candidate = JSON.parse(raw) as Partial<RestartGateState>;
      parsed = {
        version: 1,
        pending: Array.isArray(candidate.pending) ? candidate.pending : [],
        epoch: candidate.epoch ?? null,
        satisfied: Array.isArray(candidate.satisfied) ? candidate.satisfied : [],
        ...(candidate.lastOutcome === undefined ? {} : { lastOutcome: candidate.lastOutcome }),
      };
    } catch {
      // Missing or unreadable file — a fresh gate is the correct fallback,
      // never a reason to fail a restart request.
      parsed = emptyRestartGateState();
    }

    const resolved = resolveRestartGateBoot(parsed, now());
    state = resolved.state;
    if (resolved.satisfiedIds.length > 0) {
      console.log(
        `[restart-gate] Boot completed an approved restart — satisfied ${resolved.satisfiedIds.length} request(s): ${resolved.satisfiedIds.join(', ')}`,
      );
      await persist();
    }
  }

  function ensureLoaded(): Promise<void> {
    if (!loading) loading = loadState();
    return loading;
  }

  /** Atomic tmp+rename so a crash mid-write cannot leave a truncated gate. */
  async function persist(): Promise<void> {
    const current = state;
    if (!current) return;
    const body = JSON.stringify(current, null, 2);
    writing = writing.then(async () => {
      try {
        await mkdir(dirname(filePath), { recursive: true });
        const tmp = `${filePath}.tmp`;
        await writeFile(tmp, body, 'utf-8');
        await rename(tmp, filePath);
      } catch (error) {
        console.error('[restart-gate] Failed to persist gate state:', error);
      }
    });
    await writing;
  }

  function publish(): RestartGateSnapshot {
    const snapshot = toRestartGateSnapshot(state ?? emptyRestartGateState(), now());
    const serialized = JSON.stringify(snapshot);
    if (serialized !== lastPublished) {
      lastPublished = serialized;
      emit(snapshot);
    }
    return snapshot;
  }

  async function mutate<T>(
    apply: (current: RestartGateState, nowMs: number) => { state: RestartGateState; result: T },
  ): Promise<T> {
    await ensureLoaded();
    const { state: next, result } = apply(state ?? emptyRestartGateState(), now());
    state = next;
    await persist();
    publish();
    return result;
  }

  return {
    request: (input) => mutate((current, nowMs) => upsertRestartRequest(current, input, nowMs)),
    claim: (requesterId) => mutate((current, nowMs) => claimRestartGate(current, requesterId, nowMs)),
    approve: () => mutate((current, nowMs) => approveRestartGate(current, nowMs)),
    read: async () => {
      await ensureLoaded();
      state = pruneRestartGateState(state ?? emptyRestartGateState(), now());
      return publish();
    },
    satisfyForDirectRestart: (claimedBy) =>
      mutate((current, nowMs) => ({
        state: satisfyRestartGateForDirectRestart(current, nowMs, claimedBy),
        result: undefined,
      })),
    sweep: async () => {
      await ensureLoaded();
      const before = state ?? emptyRestartGateState();
      const after = pruneRestartGateState(before, now());
      state = after;
      if (after.pending.length !== before.pending.length || after.epoch !== before.epoch) {
        await persist();
      }
      return publish();
    },
  };
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let sharedGate: RestartGate | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** The one gate instance every route and boot step shares. */
export function getRestartGate(): RestartGate {
  if (!sharedGate) sharedGate = createRestartGate();
  return sharedGate;
}

/**
 * Prune expired requests on a timer.
 *
 * Reads alone cannot clear the banner: a requester that dies simply stops
 * polling, so without this nothing would ever re-publish the shrunken
 * projection to the dashboard.
 */
export function startRestartGateSweep(
  gate: RestartGate,
  deps: { setIntervalFn?: typeof setInterval } = {},
): ReturnType<typeof setInterval> {
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const timer = setIntervalFn(() => {
    void gate.sweep().catch((error: unknown) => {
      console.error('[restart-gate] Sweep failed:', error);
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

/**
 * Resolve the persisted epoch and start the sweep.
 *
 * Boot resolution is lazy inside the gate too, so a requester polling a
 * still-booting server gets the same answer this call produces — there is no
 * window where a poll races ahead of startup.
 */
export async function initRestartGate(
  deps: { setIntervalFn?: typeof setInterval } = {},
): Promise<void> {
  const gate = getRestartGate();
  await gate.read();
  if (sweepTimer) return;
  sweepTimer = startRestartGateSweep(gate, deps);
}
