import type { DomainEvent } from '@overdeck/contracts';
import { Effect } from 'effect';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendAsync: vi.fn(),
  getLatestSequence: vi.fn(),
  messageAgent: vi.fn(),
  queryByTypesSince: vi.fn(),
}));

vi.mock('../../dashboard/server/event-store.js', () => ({
  initEventStore: vi.fn(async () => ({
    appendAsync: mocks.appendAsync,
    getLatestSequence: mocks.getLatestSequence,
    queryByTypesSince: mocks.queryByTypesSince,
  })),
}));

vi.mock('../agents/messaging.js', () => ({
  messageAgentWithOutcome: mocks.messageAgent,
}));

import { handleCloisterDomainEvent } from '../cloister/service-reactive.js';
import { AmbiguousKeyedDeliveryError } from '../agents/delivery.js';
import { KeyedMarkerVerificationError, KeyedSubmitBlockedMenuError, KeyedSubmitTargetDeadError } from '../tmux-dedup.js';
import {
  LINEAR_MCP_AUTH_WAKE_COPY,
  _resetLinearMcpAuthProjectionCacheForTests,
  processLinearMcpAuthWake,
} from '../linear-mcp-auth.js';

interface TestEvent {
  sequence: number;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

interface OutboxEntryFixture {
  lifecycleId: string;
  agentId: string;
  message: string;
  state: 'pending' | 'acknowledged';
  outcome?: string;
  createdAt: string;
  acknowledgedAt?: string;
}

let events: TestEvent[] = [];
let overdeckHome: string;
let previousHome: string | undefined;

function required(sequence: number, agentId: string, issueId: string): TestEvent {
  return {
    sequence,
    type: 'linear_mcp_auth.required',
    timestamp: `2026-07-21T12:00:0${sequence}.000Z`,
    payload: { agentId, issueId, authUrl: null, expiresAt: null },
  };
}

function healthy(sequence: number): TestEvent {
  return {
    sequence,
    type: 'linear_mcp_auth.healthy',
    timestamp: `2026-07-21T12:00:0${sequence}.000Z`,
    payload: { agentId: 'operator', issueId: null, source: 'operator' },
  };
}

function notifiedEvents(): TestEvent[] {
  return events.filter(event => event.type === 'linear_mcp_auth.notified');
}

function outboxPath(agentId: string, lifecycleId: string): string {
  return join(overdeckHome, 'agents', agentId, 'linear-mcp-wake', `${lifecycleId}.json`);
}

function seedOutbox(agentId: string, entry: OutboxEntryFixture): void {
  const path = outboxPath(agentId, entry.lifecycleId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entry), 'utf-8');
}

function readOutbox(agentId: string, lifecycleId: string): OutboxEntryFixture {
  return JSON.parse(readFileSync(outboxPath(agentId, lifecycleId), 'utf-8')) as OutboxEntryFixture;
}

function pendingEntry(lifecycleId: string, agentId: string): OutboxEntryFixture {
  return {
    lifecycleId,
    agentId,
    message: LINEAR_MCP_AUTH_WAKE_COPY,
    state: 'pending',
    createdAt: '2026-07-21T12:00:10.000Z',
  };
}

function acknowledgedEntry(lifecycleId: string, agentId: string, outcome: string): OutboxEntryFixture {
  return {
    ...pendingEntry(lifecycleId, agentId),
    state: 'acknowledged',
    outcome,
    acknowledgedAt: '2026-07-21T12:00:11.000Z',
  };
}

describe('Linear MCP auth wake processor', () => {
  beforeEach(() => {
    events = [];
    _resetLinearMcpAuthProjectionCacheForTests();
    previousHome = process.env.OVERDECK_HOME;
    overdeckHome = mkdtempSync(join(tmpdir(), 'overdeck-linear-wake-'));
    process.env.OVERDECK_HOME = overdeckHome;

    mocks.messageAgent.mockReset();
    mocks.messageAgent.mockResolvedValue('delivered');
    mocks.queryByTypesSince.mockReset();
    mocks.queryByTypesSince.mockImplementation((types: string[], afterSequence: number) => (
      events
        .filter(event => event.sequence > afterSequence && types.includes(event.type))
        .sort((a, b) => a.sequence - b.sequence)
    ));
    mocks.getLatestSequence.mockReset();
    mocks.getLatestSequence.mockImplementation(() => (
      events.reduce((max, candidate) => Math.max(max, candidate.sequence), 0)
    ));
    mocks.appendAsync.mockReset();
    mocks.appendAsync.mockImplementation(async (event: Omit<DomainEvent, 'sequence'>) => {
      const sequence = events.reduce((max, candidate) => Math.max(max, candidate.sequence), 0) + 1;
      events.push({
        ...(event as unknown as Omit<TestEvent, 'sequence'>),
        sequence,
      });
      return sequence;
    });
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = previousHome;
    }
    rmSync(overdeckHome, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('reacts to healthy by delivering one wake and recording its outcome and receipt', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    await Effect.runPromise(handleCloisterDomainEvent({ type: 'linear_mcp_auth.healthy' }));

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
      { dedupKey: 'linear-mcp-auth-wake:seq-1' },
    );
    expect(notifiedEvents()).toHaveLength(1);
    expect(notifiedEvents()[0]?.payload).toEqual({
      agentId: 'agent-min-852',
      issueId: 'MIN-852',
      outcome: 'delivered',
      lifecycleId: 'seq-1',
    });
    // The keyed outbox receipt is acknowledged with the same outcome.
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({
      state: 'acknowledged',
      outcome: 'delivered',
    });
  });

  it('wakes every agent in the completed lifecycle exactly once', async () => {
    events.push(
      required(1, 'agent-min-852', 'MIN-852'),
      required(2, 'agent-pan-2997', 'PAN-2997'),
      healthy(3),
    );

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.messageAgent.mock.calls.map(call => call[0])).toEqual([
      'agent-min-852',
      'agent-pan-2997',
    ]);
    expect(notifiedEvents().map(event => event.payload['outcome'])).toEqual([
      'delivered',
      'delivered',
    ]);
    expect(notifiedEvents().every(event => event.payload['lifecycleId'] === 'seq-1')).toBe(true);
  });

  it('records queued when messageAgent routes a stopped or gated agent to mail', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.messageAgent.mockResolvedValue('queued');

    await processLinearMcpAuthWake();

    expect(notifiedEvents()[0]?.payload['outcome']).toBe('queued');
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({
      state: 'acknowledged',
      outcome: 'queued',
    });
  });

  it('records failed when the agent no longer exists', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.messageAgent.mockRejectedValue(new Error('Agent agent-min-852 not running'));

    await expect(processLinearMcpAuthWake()).resolves.toBeUndefined();
    expect(notifiedEvents()[0]?.payload['outcome']).toBe('failed');
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({
      state: 'acknowledged',
      outcome: 'failed',
    });
  });

  it('does not send another wake after notified events have been recorded', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    await processLinearMcpAuthWake();
    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(notifiedEvents()).toHaveLength(1);
  });

  it('recovers pending wake work recorded before server boot', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
      { dedupKey: 'linear-mcp-auth-wake:seq-1' },
    );
    expect(notifiedEvents()).toHaveLength(1);
  });

  it('delivers exactly once when the process died after the claim but before the send', async () => {
    // Crash state: a pending outbox entry exists (the claim) but the send
    // never ran. Recovery must drive it — zero deliveries strands the agent.
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    seedOutbox('agent-min-852', pendingEntry('seq-1', 'agent-min-852'));

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({
      state: 'acknowledged',
      outcome: 'delivered',
    });
    expect(notifiedEvents()).toHaveLength(1);
    expect(notifiedEvents()[0]?.payload['outcome']).toBe('delivered');
  });

  it('resumes an unacknowledged entry after a post-send/pre-receipt crash', async () => {
    // Crash state: the send happened but the ack write never landed, so the
    // entry is still pending. That send was never acknowledged — replaying
    // it once is the defined recovery semantic.
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    seedOutbox('agent-min-852', pendingEntry('seq-1', 'agent-min-852'));

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({
      state: 'acknowledged',
      outcome: 'delivered',
    });
    expect(notifiedEvents()).toHaveLength(1);
  });

  it('does not replay an acknowledged wake when the process died before the completion event landed', async () => {
    // Crash state: acknowledged receipt exists, but the completion DomainEvent
    // was never appended. Recovery completes the ledger WITHOUT re-sending.
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    seedOutbox('agent-min-852', acknowledgedEntry('seq-1', 'agent-min-852', 'delivered'));

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(notifiedEvents()).toHaveLength(1);
    expect(notifiedEvents()[0]?.payload).toEqual({
      agentId: 'agent-min-852',
      issueId: 'MIN-852',
      outcome: 'delivered',
      lifecycleId: 'seq-1',
    });
  });

  it('replays the recorded queued outcome on recovery instead of upgrading it to delivered', async () => {
    // Crash state: the send was queued for a stopped agent and acknowledged,
    // but the completion event never landed. Recovery must record 'queued',
    // not a falsified 'delivered'.
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    seedOutbox('agent-min-852', acknowledgedEntry('seq-1', 'agent-min-852', 'queued'));

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(notifiedEvents()[0]?.payload['outcome']).toBe('queued');
  });

  it('never suppresses a new lifecycle behind an identical acknowledged wake from the previous one', async () => {
    // Lifecycle A is fully done (acknowledged receipt + completion event).
    // Lifecycle B needs the same wake copy. The receipts are keyed per
    // lifecycle, so A's acknowledgment must not mark B handled.
    events.push(
      required(1, 'agent-min-852', 'MIN-852'),
      healthy(2),
      required(3, 'agent-min-852', 'MIN-852'),
      healthy(4),
    );
    seedOutbox('agent-min-852', acknowledgedEntry('seq-1', 'agent-min-852', 'delivered'));
    events.push({
      sequence: 5,
      type: 'linear_mcp_auth.notified',
      timestamp: '2026-07-21T12:00:12.000Z',
      payload: { agentId: 'agent-min-852', issueId: 'MIN-852', outcome: 'delivered', lifecycleId: 'seq-1' },
    });

    await processLinearMcpAuthWake();

    // Exactly one send — for lifecycle seq-3. A's receipt suppressed nothing.
    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(readOutbox('agent-min-852', 'seq-3')).toMatchObject({
      state: 'acknowledged',
      outcome: 'delivered',
    });
    expect(notifiedEvents().map(event => event.payload['lifecycleId'])).toEqual(['seq-1', 'seq-3']);
  });

  it('skips delivery when the outbox receipt cannot be written', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    // The agent dir is a FILE, so mkdir of the outbox dir fails every pass.
    mkdirSync(join(overdeckHome, 'agents'), { recursive: true });
    writeFileSync(join(overdeckHome, 'agents', 'agent-min-852'), 'not a directory');

    await expect(processLinearMcpAuthWake()).resolves.toBeUndefined();

    // No receipt, no delivery — an unreceipted send could replay after a crash.
    expect(mocks.messageAgent).not.toHaveBeenCalled();
  });

  it('backs off follow-up runs when the wake set never stabilizes', async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(global, 'setTimeout');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    // Completion appends always fail, so the agent never leaves the wake set.
    // The acknowledged receipt means the door is still only called once.
    mocks.appendAsync.mockRejectedValue(new Error('database is locked'));

    await processLinearMcpAuthWake();
    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    const callsAfterFirstRun = mocks.appendAsync.mock.calls.length;
    expect(callsAfterFirstRun).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(1000);
    // The scheduled follow-up is in flight behind real fs I/O; join it
    // through the coalescer (same promise if running, a fresh identical run
    // if it already settled) so the assertions see a completed pass.
    await processLinearMcpAuthWake();
    expect(mocks.appendAsync.mock.calls.length).toBeGreaterThan(callsAfterFirstRun);
    expect(mocks.messageAgent).toHaveBeenCalledOnce();

    const delays = timeoutSpy.mock.calls.map(call => call[1]);
    expect(delays.slice(0, 2)).toEqual([1000, 2000]);
  });

  it('retries the same key within the run after an AMBIGUOUS keyed delivery failure, never recording a terminal failed (cycle 8)', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    // The first attempt's outcome is UNKNOWN (e.g. the supervisor's answer was
    // lost): the outbox entry must stay pending, not terminal 'failed'.
    mocks.messageAgent.mockRejectedValueOnce(
      new AmbiguousKeyedDeliveryError('agent-min-852', 'linear-mcp-auth-wake', 'socket POST timeout'),
    );

    await processLinearMcpAuthWake();

    // A later pass in the same run re-drove the SAME keyed wake — the door
    // deduplicates it if the first attempt did in fact land.
    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.messageAgent.mock.calls[1]).toEqual([
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
      { dedupKey: 'linear-mcp-auth-wake:seq-1' },
    ]);
    // Exactly one completion was recorded, with the real outcome — 'failed'
    // never appears for an ambiguous attempt.
    expect(notifiedEvents()).toHaveLength(1);
    expect(notifiedEvents()[0]?.payload['outcome']).toBe('delivered');
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({
      state: 'acknowledged',
      outcome: 'delivered',
    });
  });

  it('leaves the wake pending with no completion record while the keyed delivery stays ambiguous (cycle 8)', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.messageAgent.mockRejectedValue(
      new AmbiguousKeyedDeliveryError('agent-min-852', 'linear-mcp-auth-wake', 'socket POST timeout'),
    );

    await processLinearMcpAuthWake();

    // No terminal outcome was recorded on any of the bounded retries, and the
    // outbox entry is still pending — boot recovery or a later healthy event
    // will re-drive the same key.
    expect(notifiedEvents()).toHaveLength(0);
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({ state: 'pending' });
    expect(mocks.messageAgent.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.messageAgent.mock.calls.every(call => call[3]?.dedupKey === 'linear-mcp-auth-wake:seq-1')).toBe(true);
  });

  it('leaves the wake pending and retries after the tmux target dies mid-delivery (cycle 9)', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    // The pane died between paste and submit: NO Enter was sent and the key
    // was deliberately left non-terminal — this must not become terminal
    // 'failed' any more than it may become 'delivered'.
    mocks.messageAgent.mockRejectedValueOnce(
      new KeyedSubmitTargetDeadError('agent-min-852', 'linear-mcp-auth-wake:seq-1'),
    );

    await processLinearMcpAuthWake();

    // A later pass in the same run re-drove the same keyed wake (by then the
    // agent has resumed) and exactly one completion was recorded.
    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.messageAgent.mock.calls[1]).toEqual([
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
      { dedupKey: 'linear-mcp-auth-wake:seq-1' },
    ]);
    expect(notifiedEvents()).toHaveLength(1);
    expect(notifiedEvents()[0]?.payload['outcome']).toBe('delivered');
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({
      state: 'acknowledged',
      outcome: 'delivered',
    });
  });

  it('leaves the wake pending and re-drives the same key after a blocking menu clears', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.messageAgent.mockRejectedValueOnce(
      new KeyedSubmitBlockedMenuError(
        'agent-min-852',
        'linear-mcp-auth-wake:seq-1',
        'Resume from summary\nEnter to confirm',
      ),
    );

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.messageAgent.mock.calls[1]).toEqual([
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
      { dedupKey: 'linear-mcp-auth-wake:seq-1' },
    ]);
    expect(notifiedEvents()).toHaveLength(1);
    expect(notifiedEvents()[0]?.payload['outcome']).toBe('delivered');
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({
      state: 'acknowledged',
      outcome: 'delivered',
    });
  });

  it('leaves the wake pending and retries when marker verification fails mid-recovery (cycle 13)', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    // A safety-critical marker read failed during repair/rollback: the marker
    // state is unproven, the breadcrumb stays authoritative, and the outbox
    // must stay pending — never terminal 'failed', never 'delivered'.
    mocks.messageAgent.mockRejectedValueOnce(
      new KeyedMarkerVerificationError('agent-min-852', 'rollback verification of key "linear-mcp-auth-wake:seq-1"'),
    );

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.messageAgent.mock.calls[1]).toEqual([
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
      { dedupKey: 'linear-mcp-auth-wake:seq-1' },
    ]);
    expect(notifiedEvents()).toHaveLength(1);
    expect(notifiedEvents()[0]?.payload['outcome']).toBe('delivered');
    expect(readOutbox('agent-min-852', 'seq-1')).toMatchObject({
      state: 'acknowledged',
      outcome: 'delivered',
    });
  });

  it('drains a lifecycle that completes while an earlier wake pass is still delivering', async () => {
    // Review repro: lifecycle A closes and its wake pass starts; lifecycle B
    // for the same agent opens and closes while A's delivery is in flight.
    // The pass must not swallow B's healthy — it drains until stable and
    // wakes B too, and A's completion records may not mark B handled.
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    mocks.messageAgent.mockImplementation(async () => {
      // Mid-delivery, the agent fails again and the operator re-auths:
      // lifecycle B opens and closes behind the in-flight pass.
      if (events.some(event => event.type === 'linear_mcp_auth.required' && event.sequence >= 3) === false) {
        events.push(required(3, 'agent-min-852', 'MIN-852'), healthy(4));
      }
      return 'delivered';
    });

    await processLinearMcpAuthWake();

    // Two wake rounds: one for lifecycle seq-1, one for lifecycle seq-3.
    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    const completionLifecycleIds = notifiedEvents().map(event => event.payload['lifecycleId']);
    expect(completionLifecycleIds).toEqual(['seq-1', 'seq-3']);
  });
});
