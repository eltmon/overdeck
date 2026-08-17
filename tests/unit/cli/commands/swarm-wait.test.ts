import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  swarmStatusCommand,
  swarmWaitCommand,
  type SwarmStatusCommandDeps,
  type SwarmStatusSnapshot,
  type SwarmWaitCommandDeps,
} from '../../../../src/cli/commands/swarm.js';

function snapshot(lifecycle = 'running', sessionAlive = true): SwarmStatusSnapshot {
  return {
    issueId: 'PAN-3680',
    foreman: { agentId: 'agent-pan-3680', alive: true },
    hold: undefined,
    interventions: {},
    capacity: { used: 1, limit: 3 },
    slots: [{
      slotIndex: 1,
      itemId: 'wi-1',
      lifecycle,
      branch: 'feature/pan-3680-slot-1',
      branchMerged: false,
      sessionAlive,
    }],
  };
}

function waitDeps(getSnapshot: SwarmWaitCommandDeps['getSnapshot']): SwarmWaitCommandDeps {
  return {
    getSnapshot,
    delay: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    pollIntervalMs: 1_000,
    console: { log: vi.fn(), error: vi.fn() },
  };
}

describe('pan swarm wait', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns a delta when a completion marker changes the slot lifecycle', async () => {
    let current = snapshot();
    const deps = waitDeps(vi.fn(async () => current));
    const resultPromise = swarmWaitCommand('PAN-3680', { timeout: 30, json: true }, deps);

    await Promise.resolve();
    current = snapshot('ready-to-merge', false);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      timedOut: false,
      delta: { slots: [{ slotIndex: 1, before: 'running', after: 'ready-to-merge' }] },
    });
  });

  it('returns when a slot session exits without a lifecycle change', async () => {
    let current = snapshot();
    const deps = waitDeps(vi.fn(async () => current));
    const resultPromise = swarmWaitCommand('PAN-3680', { timeout: 30 }, deps);

    await Promise.resolve();
    current = snapshot('running', false);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      timedOut: false,
      delta: { slots: [{ slotIndex: 1, sessionExited: true }] },
    });
  });

  it('returns a delta when an observed slot disappears', async () => {
    let current = snapshot();
    const deps = waitDeps(vi.fn(async () => current));
    const resultPromise = swarmWaitCommand('PAN-3680', { timeout: 30 }, deps);

    await Promise.resolve();
    current = { ...snapshot(), slots: [] };
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      timedOut: false,
      delta: { slots: [{ slotIndex: 1, before: 'running', sessionExited: true }] },
    });
  });

  it('returns an empty delta with exit success at timeout', async () => {
    const deps = waitDeps(vi.fn(async () => snapshot()));
    const resultPromise = swarmWaitCommand('PAN-3680', { timeout: 2 }, deps);

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      timedOut: true,
      delta: { slots: [], holdChanged: false },
    });
  });

  it('status JSON includes foreman liveness, durable hold, and intervention counters', async () => {
    const log = vi.fn();
    const deps = {
      resolveProjectFromIssueSync: vi.fn(() => ({ projectName: 'overdeck', projectPath: '/repo' })),
      findSpecByIssue: vi.fn(() => Effect.succeed({
        path: '/repo/spec.json', filename: 'spec.json', issueId: 'PAN-3680', status: 'active',
        document: { status: 'active', xBRIEFInfo: { version: '0.8' }, plan: { id: 'PAN-3680', title: 'test', status: 'active', items: [], edges: [] } },
      })),
      reconcileSlotState: vi.fn(async () => ({ merged: [], inFlight: [], pending: [], branches: [], agents: [] })),
      classifyInFlightSlots: vi.fn(async () => []),
      getFailedMergeBlocks: vi.fn(() => []),
      getReviewStatusSync: vi.fn(() => null),
      readSwarmHold: vi.fn(() => ({ reason: 'inspect drift', setBy: 'foreman', at: '2026-08-13T00:00:00Z' })),
      readSwarmInterventions: vi.fn(() => ({ '1': { stalled: 2 } })),
      readStatusOverrides: vi.fn(() => undefined),
      listSessionNamesSync: vi.fn(() => ['agent-pan-3680']),
      getConcurrencyLimits: vi.fn(() => ({ reservedSwarmSlots: 3 })),
      countRunningSwarmSlotsForIssue: vi.fn(() => 0),
      console: { log, error: vi.fn() },
    } as unknown as SwarmStatusCommandDeps;

    const result = await swarmStatusCommand('PAN-3680', deps, { json: true });

    expect(result.snapshot).toMatchObject({
      foreman: { agentId: 'agent-pan-3680', alive: true },
      hold: { reason: 'inspect drift' },
      interventions: { '1': { stalled: 2 } },
    });
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ foreman: { alive: true } });
  });
});
