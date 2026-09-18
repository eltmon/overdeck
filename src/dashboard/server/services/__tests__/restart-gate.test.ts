import { join } from 'node:path';

import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DomainEvent,
  INITIAL_READ_MODEL_STATE,
  applyEvent,
  syncSnapshot,
  type DashboardSnapshot,
  type RestartGateSnapshot,
} from '@overdeck/contracts';

import {
  CLAIM_LAPSE_MS,
  OUTCOME_TTL_MS,
  REQUEST_TTL_MS,
  SATISFIED_TTL_MS,
  SWEEP_INTERVAL_MS,
  approveRestartGate,
  claimRestartGate,
  createRestartGate,
  deriveRestartGateStatus,
  emptyRestartGateState,
  pruneRestartGateState,
  satisfyRestartGateForDirectRestart,
  startRestartGateSweep,
  toRestartGateSnapshot,
  upsertRestartRequest,
  type RestartGate,
  type RestartGateState,
} from '../restart-gate.js';

const T0 = Date.parse('2026-08-14T12:00:00.000Z');

function deployRequest(requesterId: string, reason: string) {
  return { requesterId, kind: 'deploy' as const, reason };
}

describe('restart gate state machine', () => {
  it('lists every pending request and satisfies them all with one approve + one claim (AC-1)', () => {
    let state = emptyRestartGateState();
    state = upsertRestartRequest(state, deployRequest('deploy:PAN-1:11', 'post-merge deploy PAN-1'), T0).state;
    state = upsertRestartRequest(state, deployRequest('reload:22', 'pan reload'), T0).state;

    const listed = toRestartGateSnapshot(state, T0);
    expect(listed.status).toBe('pending');
    expect(listed.pending.map((request) => request.requesterId)).toEqual([
      'deploy:PAN-1:11',
      'reload:22',
    ]);

    const approved = approveRestartGate(state, T0);
    expect(approved.result).toEqual({ approved: true, pendingCount: 2 });
    state = approved.state;
    expect(deriveRestartGateStatus(state, T0)).toBe('approved');

    // Both members are told they may claim; only one actually gets it.
    expect(upsertRestartRequest(state, deployRequest('deploy:PAN-1:11', 'x'), T0).result.mayClaim).toBe(true);
    expect(upsertRestartRequest(state, deployRequest('reload:22', 'x'), T0).result.mayClaim).toBe(true);

    const claimed = claimRestartGate(state, 'deploy:PAN-1:11', T0);
    expect(claimed.result).toEqual({ granted: true, status: 'claimed' });
    state = claimed.state;

    expect(claimRestartGate(state, 'reload:22', T0).result).toEqual({ granted: false, status: 'claimed' });

    // The claimant restarts the server. PAN-3917 D2: the gate is in memory, so
    // the fresh process starts empty and every requester simply re-registers.
    for (const requesterId of ['deploy:PAN-1:11', 'reload:22']) {
      const poll = upsertRestartRequest(emptyRestartGateState(), deployRequest(requesterId, 'x'), T0 + 5_000);
      expect(poll.result.status).toBe('pending');
      expect(poll.result.mayClaim).toBe(false);
    }
  });

  it('drops a request that has not been refreshed for 20s (AC-2)', () => {
    let state = upsertRestartRequest(emptyRestartGateState(), deployRequest('reload:22', 'pan reload'), T0).state;

    // One poll short of the TTL keeps it alive.
    state = pruneRestartGateState(state, T0 + REQUEST_TTL_MS - 1);
    expect(toRestartGateSnapshot(state, T0 + REQUEST_TTL_MS - 1).pending).toHaveLength(1);

    const expired = pruneRestartGateState(state, T0 + REQUEST_TTL_MS);
    expect(expired.pending).toEqual([]);
    expect(toRestartGateSnapshot(expired, T0 + REQUEST_TTL_MS).status).toBe('idle');
  });

  it('refreshes lastSeenAt on every poll but keeps the original requestedAt', () => {
    let state = upsertRestartRequest(emptyRestartGateState(), deployRequest('reload:22', 'pan reload'), T0).state;
    state = upsertRestartRequest(state, deployRequest('reload:22', 'pan reload'), T0 + 15_000).state;

    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]?.requestedAt).toBe(new Date(T0).toISOString());
    // 25s after the first poll, but only 10s after the refresh — still live.
    expect(pruneRestartGateState(state, T0 + 25_000).pending).toHaveLength(1);
  });

  it('grants exactly one claim when two requesters claim at the same instant', () => {
    let state = emptyRestartGateState();
    state = upsertRestartRequest(state, deployRequest('a', 'a'), T0).state;
    state = upsertRestartRequest(state, deployRequest('b', 'b'), T0).state;
    state = approveRestartGate(state, T0).state;

    const first = claimRestartGate(state, 'a', T0);
    const second = claimRestartGate(first.state, 'b', T0);
    expect([first.result.granted, second.result.granted]).toEqual([true, false]);

    // The winner re-claiming its own live claim is granted again, so a retry
    // after a dropped response cannot strand the restart.
    expect(claimRestartGate(second.state, 'a', T0).result.granted).toBe(true);
  });

  it('lets the next poller claim after a claim lapses at 5 minutes', () => {
    let state = upsertRestartRequest(emptyRestartGateState(), deployRequest('a', 'a'), T0).state;
    state = upsertRestartRequest(state, deployRequest('b', 'b'), T0).state;
    state = approveRestartGate(state, T0).state;
    state = claimRestartGate(state, 'a', T0).state;

    const beforeLapse = T0 + CLAIM_LAPSE_MS - 1;
    expect(deriveRestartGateStatus(state, beforeLapse)).toBe('claimed');
    expect(claimRestartGate(state, 'b', beforeLapse).result.granted).toBe(false);

    // Keep both requests alive across the lapse window — the claimant died,
    // the requesters did not.
    const afterLapse = T0 + CLAIM_LAPSE_MS;
    let refreshed = upsertRestartRequest(state, deployRequest('a', 'a'), afterLapse - 1).state;
    refreshed = upsertRestartRequest(refreshed, deployRequest('b', 'b'), afterLapse - 1).state;

    expect(deriveRestartGateStatus(refreshed, afterLapse)).toBe('approved');
    expect(claimRestartGate(refreshed, 'b', afterLapse).result).toEqual({ granted: true, status: 'claimed' });
  });

  it('clears the gate when approve is pressed after every request expired', () => {
    const state = upsertRestartRequest(emptyRestartGateState(), deployRequest('reload:22', 'pan reload'), T0).state;
    const approved = approveRestartGate(state, T0 + REQUEST_TTL_MS);

    expect(approved.result).toEqual({ approved: true, pendingCount: 0 });
    expect(approved.state.epoch).toBeNull();
    expect(deriveRestartGateStatus(approved.state, T0 + REQUEST_TTL_MS)).toBe('idle');
  });

  it('drops an unclaimed epoch once every one of its members has expired', () => {
    let state = upsertRestartRequest(emptyRestartGateState(), deployRequest('a', 'a'), T0).state;
    state = approveRestartGate(state, T0).state;
    expect(state.epoch).not.toBeNull();

    // Nobody claimed and the requester died: the epoch must not outlive it,
    // or the gate would sit in `approved` forever and the banner would never
    // return for later requests.
    const swept = pruneRestartGateState(state, T0 + REQUEST_TTL_MS);
    expect(swept.epoch).toBeNull();
    expect(deriveRestartGateStatus(swept, T0 + REQUEST_TTL_MS)).toBe('idle');

    // A request arriving afterwards gets a fresh cycle and shows in the banner.
    const next = upsertRestartRequest(swept, deployRequest('b', 'b'), T0 + REQUEST_TTL_MS);
    expect(next.result.status).toBe('pending');
    expect(deriveRestartGateStatus(next.state, T0 + REQUEST_TTL_MS)).toBe('pending');
  });

  it('records the dead-requester outcome on that drop and forgets it after the window (PAN-3731)', () => {
    let state = upsertRestartRequest(emptyRestartGateState(), deployRequest('a', 'a'), T0).state;
    state = approveRestartGate(state, T0).state;

    // The operator approved and nobody claimed. Without this the banner would
    // just vanish, so the approval would read as a broken button.
    const droppedAt = T0 + REQUEST_TTL_MS;
    const dropped = pruneRestartGateState(state, droppedAt);
    const outcome = { type: 'pruned-unclaimed', at: new Date(droppedAt).toISOString() };
    expect(dropped.lastOutcome).toEqual(outcome);
    expect(toRestartGateSnapshot(dropped, droppedAt)).toEqual({
      status: 'idle',
      pending: [],
      lastOutcome: outcome,
    });

    // The notice is a short window, not a permanent flag on the projection.
    const stillShown = pruneRestartGateState(dropped, droppedAt + OUTCOME_TTL_MS - 1);
    expect(stillShown.lastOutcome).toEqual(outcome);
    const forgotten = pruneRestartGateState(dropped, droppedAt + OUTCOME_TTL_MS);
    expect(forgotten.lastOutcome).toBeUndefined();
    expect(toRestartGateSnapshot(forgotten, droppedAt + OUTCOME_TTL_MS)).not.toHaveProperty('lastOutcome');
  });

  it('records no outcome when nothing was approved or when the restart actually happened', () => {
    // A request that expires before any approval is an ordinary timeout — the
    // operator never clicked anything, so there is nothing to explain.
    const neverApproved = pruneRestartGateState(
      upsertRestartRequest(emptyRestartGateState(), deployRequest('a', 'a'), T0).state,
      T0 + REQUEST_TTL_MS,
    );
    expect(neverApproved.lastOutcome).toBeUndefined();

    // A claimed epoch is cleared by the boot that completes it, so the prune
    // never sees it die and the notice must not fire.
    let claimed = upsertRestartRequest(emptyRestartGateState(), deployRequest('a', 'a'), T0).state;
    claimed = approveRestartGate(claimed, T0).state;
    claimed = claimRestartGate(claimed, 'a', T0).state;
    expect(pruneRestartGateState(claimed, T0 + 3_000).lastOutcome).toBeUndefined();
  });

  it('keeps a live claim alive even when the claimant stops polling', () => {
    let state = upsertRestartRequest(emptyRestartGateState(), deployRequest('a', 'a'), T0).state;
    state = approveRestartGate(state, T0).state;
    state = claimRestartGate(state, 'a', T0).state;

    // The claimant is restarting, not polling — its pending row expires, but
    // the epoch it holds must survive so the boot can satisfy it.
    const swept = pruneRestartGateState(state, T0 + REQUEST_TTL_MS);
    expect(swept.pending).toEqual([]);
    expect(swept.epoch?.claimedBy).toBe('a');
    expect(deriveRestartGateStatus(swept, T0 + REQUEST_TTL_MS)).toBe('claimed');
  });

  it('queues a request that arrives after approval for the next cycle', () => {
    let state = upsertRestartRequest(emptyRestartGateState(), deployRequest('a', 'a'), T0).state;
    state = approveRestartGate(state, T0).state;

    const late = upsertRestartRequest(state, deployRequest('late', 'arrived after approval'), T0 + 1_000);
    expect(late.result).toEqual({ status: 'pending', mayClaim: false, pendingCount: 2 });
    expect(claimRestartGate(late.state, 'late', T0 + 1_000).result.granted).toBe(false);
  });



  it('folds every waiting request into a claimed epoch for the dashboard restart button', () => {
    let state = upsertRestartRequest(emptyRestartGateState(), deployRequest('a', 'a'), T0).state;
    state = upsertRestartRequest(state, deployRequest('b', 'b'), T0).state;

    const direct = satisfyRestartGateForDirectRestart(state, T0, 'dashboard-ui:99');
    expect(direct.epoch?.claimedBy).toBe('dashboard-ui:99');
    expect(direct.epoch?.requesterIds.sort()).toEqual(['a', 'b']);
    // The restart happens next; the in-memory gate dies with the process and
    // every member re-registers against the fresh server (PAN-3917 D2).
    expect(deriveRestartGateStatus(direct, T0)).toBe('claimed');
  });
});

describe('restart gate service', () => {
  let clock: number;
  let emitted: RestartGateSnapshot[];

  beforeEach(() => {
    clock = T0;
    emitted = [];
  });

  function makeGate() {
    return createRestartGate({
      now: () => clock,
      emit: (snapshot) => emitted.push(snapshot),
    });
  }



  it('serializes concurrent claims so exactly one is granted', async () => {
    const gate = makeGate();
    await gate.request(deployRequest('a', 'a'));
    await gate.request(deployRequest('b', 'b'));
    await gate.approve();

    const results = await Promise.all([gate.claim('a'), gate.claim('b')]);
    expect(results.filter((result) => result.granted)).toHaveLength(1);
  });

  it('emits the projection on change and republishes when a sweep expires a request', async () => {
    const gate = makeGate();
    await gate.request(deployRequest('reload:22', 'pan reload'));
    expect(emitted.at(-1)).toEqual({
      status: 'pending',
      pending: [
        {
          requesterId: 'reload:22',
          kind: 'deploy',
          reason: 'pan reload',
          requestedAt: new Date(T0).toISOString(),
        },
      ],
    });

    const emitCountBeforeNoop = emitted.length;
    await gate.read();
    expect(emitted).toHaveLength(emitCountBeforeNoop); // unchanged projection → no re-emit

    clock = T0 + REQUEST_TTL_MS;
    await gate.sweep();
    expect(emitted.at(-1)).toEqual({ status: 'idle', pending: [] });
  });

  it('publishes the dead-requester outcome when a sweep drops an approved epoch (PAN-3731)', async () => {
    const gate = makeGate();
    await gate.request(deployRequest('reload:22', 'pan reload'));
    await gate.approve();

    // The requester died between the approval and its next poll.
    clock = T0 + REQUEST_TTL_MS;
    const swept = await gate.sweep();
    expect(swept).toEqual({
      status: 'idle',
      pending: [],
      lastOutcome: { type: 'pruned-unclaimed', at: new Date(clock).toISOString() },
    });
    expect(emitted.at(-1)).toEqual(swept);

    // Past its window the projection carries the notice no more, and the
    // cleared projection is published so a stale banner cannot linger.
    clock = T0 + REQUEST_TTL_MS + OUTCOME_TTL_MS;
    const cleared = await gate.sweep();
    expect(cleared.lastOutcome).toBeUndefined();
    expect(emitted.at(-1)).toEqual({ status: 'idle', pending: [] });
  });

  it('sweeps on the 5s interval so a dead requester leaves the banner', async () => {
    // Fake timers only — the stub gate does no I/O, so nothing real is gated
    // behind the fake clock.
    vi.useFakeTimers();
    try {
      const sweep = vi.fn(async () => ({ status: 'idle' as const, pending: [] }));
      const timer = startRestartGateSweep({ sweep } as unknown as RestartGate);

      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS - 1);
      expect(sweep).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 2);
      expect(sweep).toHaveBeenCalledTimes(2);
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('restart gate read-model exposure', () => {
  const isDomainEvent = Schema.is(DomainEvent);

  /** An approved epoch whose only requester died — the PAN-3731 projection. */
  function prunedUnclaimedProjection() {
    let state = upsertRestartRequest(emptyRestartGateState(), deployRequest('reload:22', 'pan reload'), T0).state;
    state = approveRestartGate(state, T0).state;
    const droppedAt = T0 + REQUEST_TTL_MS;
    return toRestartGateSnapshot(pruneRestartGateState(state, droppedAt), droppedAt);
  }

  it('emits a restart_gate.changed event the ws-rpc schema filter accepts', () => {
    // emitOnly stamps sequence -1 (in-memory only). ws-rpc drops any event that
    // fails DomainEvent validation, which would silently starve the banner.
    const state = upsertRestartRequest(emptyRestartGateState(), deployRequest('reload:22', 'pan reload'), T0).state;
    expect(isDomainEvent({
      type: 'restart_gate.changed',
      sequence: -1,
      timestamp: new Date(T0).toISOString(),
      payload: toRestartGateSnapshot(state, T0),
    })).toBe(true);
  });

  it('accepts a payload carrying the PAN-3731 outcome field', () => {
    const projection = prunedUnclaimedProjection();
    expect(projection.lastOutcome?.type).toBe('pruned-unclaimed');
    expect(isDomainEvent({
      type: 'restart_gate.changed',
      sequence: -1,
      timestamp: new Date(T0).toISOString(),
      payload: projection,
    })).toBe(true);
  });

  it('carries the outcome through the reducer to read-model state', () => {
    const projection = prunedUnclaimedProjection();
    const applied = applyEvent(INITIAL_READ_MODEL_STATE, {
      type: 'restart_gate.changed',
      sequence: -1,
      timestamp: new Date(T0).toISOString(),
      payload: projection,
    });
    // The reducer rebuilds the projection field by field, so an unlisted field
    // is dropped silently and the banner never learns the requester died.
    expect(applied.restartGate).toEqual(projection);
  });

  it('lands the gate in read-model state from an event and from a snapshot', () => {
    const state = upsertRestartRequest(emptyRestartGateState(), deployRequest('reload:22', 'pan reload'), T0).state;
    const projection = toRestartGateSnapshot(state, T0);

    expect(INITIAL_READ_MODEL_STATE.restartGate).toBeNull();

    const afterEvent = applyEvent(INITIAL_READ_MODEL_STATE, {
      type: 'restart_gate.changed',
      sequence: -1,
      timestamp: new Date(T0).toISOString(),
      payload: projection,
    });
    expect(afterEvent.restartGate).toEqual(projection);

    // A browser that reloads gets the same gate from the connect snapshot.
    const snapshot = {
      sequence: 1,
      agents: [],
      specialists: [],
      reviewStatuses: [],
      issues: [],
      restartGate: projection,
      timestamp: new Date(T0).toISOString(),
    } as unknown as DashboardSnapshot;
    expect(syncSnapshot(INITIAL_READ_MODEL_STATE, snapshot).restartGate).toEqual(projection);
  });
});
