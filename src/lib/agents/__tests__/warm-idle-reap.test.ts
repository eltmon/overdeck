/**
 * PAN-3966: the PAN-2579 warm-idle reap in `spawnRun` decides from the
 * backend-aware liveness oracle and reaps through `stopAgent`. It used to read
 * tmux's `#{pane_dead}`, which on a Herdr host always answered "not dead", so
 * every role-run re-dispatch was refused as "already running".
 *
 * PAN-3923 (and its review): a finished one-shot run on Herdr is a live
 * harness idle at its prompt. The reap takes it only for an allowlisted
 * one-shot role, with stale work activity, on two probes; it never takes a run
 * that is booting or has no state, and it waits for the pane to go.
 *
 * #4169: Herdr reads every non-Claude pane as `unknown`. For those, the run's
 * own transcript saying its newest turn ended stands in for Herdr's label,
 * under the same allowlist, stale-activity and two-probe rules.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptCandidate } from '../../session-history.js';
import type { LivenessVerdict } from '../liveness.js';
import {
  FINISHED_IDLE_MIN_AGE_MS,
  FINISHED_REPROBE_DELAY_MS,
  REAP_SETTLE_MS,
  reapWarmIdleRoleRun,
  type PriorRoleRun,
} from '../warm-idle-reap.js';

/** The transcript the resolver hands `roleRunTurnFinished`; set per test. */
let resolvedTranscript: TranscriptCandidate | null = null;
vi.mock('../transcript-resolver.js', () => ({
  resolveAgentTranscriptCandidate: vi.fn(async () => resolvedTranscript),
}));

// Captured before any test fakes timers: real transcript reads finish on the
// real event loop, so the drive loop below yields to it between fake ticks.
const realSetImmediate = globalThis.setImmediate;

const AGENT = 'agent-pan-3966-review';
const SEQUENCER = 'sequencer-runner';
const STALE = FINISHED_IDLE_MIN_AGE_MS + 1_000;
const FRESH = 5_000;

const IDLE: LivenessVerdict = { alive: true, paneAlive: true, backendState: 'idle' };
const DONE: LivenessVerdict = { alive: true, paneAlive: true, backendState: 'done' };
const WORKING: LivenessVerdict = { alive: true, paneAlive: true, backendState: 'working' };
const UNKNOWN: LivenessVerdict = { alive: true, paneAlive: true, backendState: 'unknown' };

interface DepsInput {
  verdicts: ReadonlyArray<LivenessVerdict | Error>;
  run?: PriorRoleRun | undefined;
  idleAge?: number | null;
  /** How many settle polls report the pane before it is gone. */
  paneLingers?: number;
  /** Successive transcript turn-finished answers (#4169); the last one repeats. */
  turns?: ReadonlyArray<boolean | Error>;
}

function deps(input: DepsInput) {
  const { verdicts, idleAge = STALE, paneLingers = 0, turns = [false] } = input;
  // `run: undefined` means "no state.json", so only an absent key takes the default.
  const run = 'run' in input ? input.run : { role: 'review', status: 'running' };
  let call = 0;
  const isAlive = vi.fn(async () => {
    const verdict = verdicts[Math.min(call++, verdicts.length - 1)]!;
    if (verdict instanceof Error) throw verdict;
    return verdict;
  });
  let polls = 0;
  const paneExists = vi.fn(async () => polls++ < paneLingers);
  let turnCall = 0;
  const turnFinished = vi.fn(async () => {
    const turn = turns[Math.min(turnCall++, turns.length - 1)]!;
    if (turn instanceof Error) throw turn;
    return turn;
  });
  return {
    isAlive,
    turnFinished,
    stop: vi.fn(async () => undefined),
    readRun: vi.fn(() => run),
    idleAgeMs: vi.fn(() => idleAge),
    paneExists,
    // Real setTimeout under fake timers: the test advances the clock.
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

/** Run the reap to completion, advancing fake time through the reprobe and the settle wait. */
async function reap(agentId: string, d: ReturnType<typeof deps>): Promise<boolean> {
  const pending = reapWarmIdleRoleRun(agentId, d);
  await vi.advanceTimersByTimeAsync(FINISHED_REPROBE_DELAY_MS + REAP_SETTLE_MS + 1_000);
  return pending;
}

describe('reapWarmIdleRoleRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reaps a leftover whose pane process exited, through the stop path', async () => {
    const d = deps({ verdicts: [{ alive: false, reason: 'pane-dead' }] });
    await expect(reap(AGENT, d)).resolves.toBe(true);
    expect(d.isAlive).toHaveBeenCalledWith(AGENT);
    expect(d.isAlive).toHaveBeenCalledTimes(1);
    expect(d.stop).toHaveBeenCalledWith(AGENT);
  });

  it('reaps a pane with no live harness in it, not only a dead pane', async () => {
    for (const reason of ['runtime-missing', 'no-session'] as const) {
      const d = deps({ verdicts: [{ alive: false, reason }] });
      await expect(reap(AGENT, d)).resolves.toBe(true);
      expect(d.stop).toHaveBeenCalledWith(AGENT);
    }
  });

  it('keeps a live harness on tmux: it is an active run', async () => {
    const d = deps({ verdicts: [{ alive: true, paneAlive: true }] });
    await expect(reap(AGENT, d)).resolves.toBe(false);
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('treats an unprobeable pane as active', async () => {
    for (const verdict of [
      { alive: false, reason: 'runtime-indeterminate' } as const,
      new Error('herdr socket down'),
    ]) {
      const d = deps({ verdicts: [verdict] });
      await expect(reap(AGENT, d)).resolves.toBe(false);
      expect(d.stop).not.toHaveBeenCalled();
    }
  });

  // Review F1: a pane reads runtime-missing while launcher.sh runs its
  // prologue, before the harness execs. spawnRun has already written `starting`.
  it('never reaps a booting run, even when its pane shows no harness yet', async () => {
    for (const reason of ['runtime-missing', 'no-session', 'pane-dead'] as const) {
      const d = deps({ verdicts: [{ alive: false, reason }], run: { role: 'review', status: 'starting' } });
      await expect(reap(AGENT, d)).resolves.toBe(false);
      expect(d.stop).not.toHaveBeenCalled();
    }
  });

  // Review F4: a missing state.json (wiped, or lost) also makes tmux read a
  // live codex/kimi/pi pane as a missing claude-code harness.
  it('never reaps a run whose status is undefined or whose state.json is missing', async () => {
    for (const run of [{ role: 'review' }, undefined] as const) {
      for (const verdict of [{ alive: false, reason: 'runtime-missing' } as const, IDLE]) {
        const d = deps({ verdicts: [verdict], run });
        await expect(reap(AGENT, d)).resolves.toBe(false);
        expect(d.stop).not.toHaveBeenCalled();
      }
    }
  });

  it('keeps a sequencer that is working, blocked, unknown, or idle before its prompt landed', async () => {
    const cases = [
      ['working', 'running'],
      ['blocked', 'running'],
      ['unknown', 'running'],
      ['idle', 'starting'],
      ['done', 'starting'],
    ] as const;
    for (const [backendState, status] of cases) {
      const d = deps({ verdicts: [{ alive: true, paneAlive: true, backendState }], run: { role: 'sequencer', status } });
      await expect(reap(SEQUENCER, d)).resolves.toBe(false);
      expect(d.stop).not.toHaveBeenCalled();
    }
  });

  it('keeps an idle sequencer whose work activity is fresh (the label alone never counts)', async () => {
    for (const idleAge of [FRESH, null]) {
      const d = deps({ verdicts: [IDLE, IDLE], run: { role: 'sequencer', status: 'running' }, idleAge });
      await expect(reap(SEQUENCER, d)).resolves.toBe(false);
      expect(d.stop).not.toHaveBeenCalled();
    }
  });

  it('keeps an idle, stale sequencer whose second probe reads working', async () => {
    const d = deps({ verdicts: [IDLE, WORKING], run: { role: 'sequencer', status: 'running' } });
    await expect(reap(SEQUENCER, d)).resolves.toBe(false);
    expect(d.isAlive).toHaveBeenCalledTimes(2);
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('reaps a sequencer idle or done with stale activity on both probes, then waits for the pane to go', async () => {
    for (const verdict of [IDLE, DONE]) {
      const d = deps({ verdicts: [verdict, verdict], run: { role: 'sequencer', status: 'running' }, paneLingers: 3 });
      const pending = reapWarmIdleRoleRun(SEQUENCER, d);
      await vi.advanceTimersByTimeAsync(FINISHED_REPROBE_DELAY_MS - 1);
      expect(d.isAlive).toHaveBeenCalledTimes(1);
      expect(d.stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(d.isAlive).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(REAP_SETTLE_MS);
      await expect(pending).resolves.toBe(true);
      expect(d.stop).toHaveBeenCalledWith(SEQUENCER);
      // The pane lingered for three polls: the reap waited until it was gone.
      expect(d.paneExists).toHaveBeenCalledTimes(4);
    }
  });

  it('waits no longer than the settle bound when the pane never goes', async () => {
    const d = deps({ verdicts: [{ alive: false, reason: 'pane-dead' }], paneLingers: Number.POSITIVE_INFINITY });
    const pending = reapWarmIdleRoleRun(AGENT, d);
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(REAP_SETTLE_MS - 500);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBe(true);
  });

  // Review F2: both roles sit idle at their prompt while their work is in
  // progress. A re-dispatch of their role must still be refused.
  it('never reaps the review synthesis parent idle on Herdr while it waits for its reviewers', async () => {
    const parent = { role: 'review', status: 'running' };
    const d = deps({ verdicts: [IDLE, IDLE], run: parent });
    await expect(reap('agent-pan-3966-review', d)).resolves.toBe(false);
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('never reaps the resident tier supervisor idle on Herdr between commit deliveries', async () => {
    const supervisor = { role: 'review', status: 'running', reviewSubRole: 'supervisor' };
    const d = deps({ verdicts: [DONE, DONE], run: supervisor });
    await expect(reap('agent-pan-3966-review-supervisor', d)).resolves.toBe(false);
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('never reaps an idle work, plan, test, knowledge, worker or review-lane run', async () => {
    const runs: PriorRoleRun[] = [
      { role: 'work', status: 'running' },
      { role: 'plan', status: 'running' },
      { role: 'test', status: 'running' },
      { role: 'knowledge', status: 'running' },
      { role: 'worker', status: 'running' },
      { role: 'review', status: 'running', reviewSubRole: 'security' },
    ];
    for (const run of runs) {
      const d = deps({ verdicts: [IDLE, IDLE], run });
      await expect(reap(AGENT, d)).resolves.toBe(false);
      expect(d.stop).not.toHaveBeenCalled();
    }
  });

  it('still lets the dispatch proceed when the stop itself fails', async () => {
    const d = deps({ verdicts: [{ alive: false, reason: 'pane-dead' }] });
    d.stop.mockRejectedValueOnce(new Error('close failed'));
    await expect(reap(AGENT, d)).resolves.toBe(true);
  });
});

describe('reapWarmIdleRoleRun on a pane Herdr does not track (#4169)', () => {
  const SEQUENCER_RUN: PriorRoleRun = { role: 'sequencer', status: 'running' };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reaps a sequencer reading unknown when its transcript says the turn ended, on both probes with stale activity', async () => {
    const d = deps({ verdicts: [UNKNOWN, UNKNOWN], run: SEQUENCER_RUN, turns: [true, true] });
    const pending = reapWarmIdleRoleRun(SEQUENCER, d);
    await vi.advanceTimersByTimeAsync(FINISHED_REPROBE_DELAY_MS - 1);
    expect(d.turnFinished).toHaveBeenCalledTimes(1);
    expect(d.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1 + REAP_SETTLE_MS);
    await expect(pending).resolves.toBe(true);
    expect(d.turnFinished).toHaveBeenCalledTimes(2);
    expect(d.turnFinished).toHaveBeenCalledWith(SEQUENCER, SEQUENCER_RUN);
    expect(d.stop).toHaveBeenCalledWith(SEQUENCER);
  });

  it('keeps it when the transcript shows the turn still running, or cannot be read', async () => {
    for (const turn of [false, new Error('transcript unreadable')]) {
      const d = deps({ verdicts: [UNKNOWN, UNKNOWN], run: SEQUENCER_RUN, turns: [turn] });
      await expect(reap(SEQUENCER, d)).resolves.toBe(false);
      expect(d.isAlive).toHaveBeenCalledTimes(1);
      expect(d.stop).not.toHaveBeenCalled();
    }
  });

  it('keeps it when work activity is fresh or missing, even with a finished turn', async () => {
    for (const idleAge of [FRESH, null]) {
      const d = deps({ verdicts: [UNKNOWN, UNKNOWN], run: SEQUENCER_RUN, turns: [true], idleAge });
      await expect(reap(SEQUENCER, d)).resolves.toBe(false);
      expect(d.stop).not.toHaveBeenCalled();
    }
  });

  it('keeps it when a new turn started before the second probe', async () => {
    const d = deps({ verdicts: [UNKNOWN, UNKNOWN], run: SEQUENCER_RUN, turns: [true, false] });
    await expect(reap(SEQUENCER, d)).resolves.toBe(false);
    expect(d.turnFinished).toHaveBeenCalledTimes(2);
    expect(d.stop).not.toHaveBeenCalled();
  });

  it('never asks the transcript for a run outside the allowlist, a booting run, a tmux pane, or a working pane', async () => {
    const cases: Array<[LivenessVerdict, PriorRoleRun]> = [
      [UNKNOWN, { role: 'work', status: 'running' }],
      [UNKNOWN, { role: 'review', status: 'running' }],
      [UNKNOWN, { role: 'sequencer', status: 'running', reviewSubRole: 'security' }],
      [UNKNOWN, { role: 'sequencer', status: 'starting' }],
      [{ alive: true, paneAlive: true }, SEQUENCER_RUN],
      [WORKING, SEQUENCER_RUN],
    ];
    for (const [verdict, run] of cases) {
      const d = deps({ verdicts: [verdict, verdict], run, turns: [true] });
      await expect(reap(SEQUENCER, d)).resolves.toBe(false);
      expect(d.turnFinished).not.toHaveBeenCalled();
      expect(d.stop).not.toHaveBeenCalled();
    }
  });
});

/**
 * End to end through the default `roleRunTurnFinished`: the resolver (mocked)
 * hands back a real transcript file in each harness's format.
 */
describe('reapWarmIdleRoleRun reading each harness transcript (#4169)', () => {
  let dir: string;
  const startedAt = () => new Date(Date.now() - 10 * 60_000).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'pan-4169-reap-'));
  });
  afterEach(() => {
    vi.useRealTimers();
    resolvedTranscript = null;
    rmSync(dir, { recursive: true, force: true });
  });

  function transcript(kind: TranscriptCandidate['kind'], records: ReadonlyArray<unknown>): string {
    const path = join(dir, `${kind}.jsonl`);
    writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    resolvedTranscript = { kind, path };
    return path;
  }

  /** Drive fake time while letting the real transcript reads complete. */
  async function settle(pending: Promise<boolean>): Promise<boolean> {
    let done = false;
    void pending.then(() => { done = true; }, () => { done = true; });
    while (!done) {
      await new Promise<void>((resolve) => realSetImmediate(resolve));
      await vi.advanceTimersByTimeAsync(500);
    }
    return pending;
  }

  /** The reap with the default transcript reader (no `turnFinished` seam). */
  function reapWithRealTranscript(run: PriorRoleRun) {
    const d = deps({ verdicts: [UNKNOWN, UNKNOWN], run });
    const { turnFinished: _seam, ...withoutSeam } = d;
    return { d, pending: reapWarmIdleRoleRun(SEQUENCER, withoutSeam) };
  }

  const harnesses: Array<[TranscriptCandidate['kind'], ReadonlyArray<unknown>, ReadonlyArray<unknown>]> = [
    [
      'codex',
      [{ type: 'event_msg', payload: { type: 'task_started' } }, { type: 'event_msg', payload: { type: 'task_complete' } }],
      [{ type: 'event_msg', payload: { type: 'task_started' } }],
    ],
    [
      'kimi',
      [
        { type: 'turn.prompt', input: [] },
        { type: 'context.append_loop_event', event: { type: 'step.begin', step: 1 } },
        { type: 'context.append_loop_event', event: { type: 'step.end', step: 1, finishReason: 'end_turn' } },
        { type: 'usage.record', usageScope: 'turn' },
      ],
      [
        { type: 'turn.prompt', input: [] },
        { type: 'context.append_loop_event', event: { type: 'step.end', step: 1, finishReason: 'tool_use' } },
      ],
    ],
    [
      'pi',
      [{ type: 'message', message: { role: 'user' } }, { type: 'message', message: { role: 'assistant', stopReason: 'stop' } }],
      [{ type: 'message', message: { role: 'user' } }, { type: 'message', message: { role: 'assistant', stopReason: 'toolUse' } }],
    ],
    [
      // OpenCode runs under the ACP host and writes this same transcript.
      'acp',
      [{ role: 'user', content: 'rank', promptId: 'p1' }, { role: 'system', content: '', event: 'turn_completed', promptId: 'p1' }],
      [{ role: 'user', content: 'rank', promptId: 'p1' }, { role: 'assistant', content: 'working' }],
    ],
  ];

  for (const [kind, finished, midTurn] of harnesses) {
    it(`reaps a finished ${kind} sequencer and keeps one mid-turn`, async () => {
      transcript(kind, finished);
      const done = reapWithRealTranscript({ role: 'sequencer', status: 'running', startedAt: startedAt() });
      await expect(settle(done.pending)).resolves.toBe(true);
      expect(done.d.isAlive).toHaveBeenCalledTimes(2);
      expect(done.d.stop).toHaveBeenCalledWith(SEQUENCER);

      transcript(kind, midTurn);
      const working = reapWithRealTranscript({ role: 'sequencer', status: 'running', startedAt: startedAt() });
      await expect(settle(working.pending)).resolves.toBe(false);
      expect(working.d.stop).not.toHaveBeenCalled();
    });
  }

  it("ignores a finished transcript last written before the run started (an earlier run's)", async () => {
    const path = transcript('codex', harnesses[0]![1]);
    const old = new Date(Date.now() - 60 * 60_000);
    utimesSync(path, old, old);
    const run = reapWithRealTranscript({ role: 'sequencer', status: 'running', startedAt: startedAt() });
    await expect(settle(run.pending)).resolves.toBe(false);
    expect(run.d.stop).not.toHaveBeenCalled();
  });

  it('ignores a run with no recorded start time, and a Claude Code transcript', async () => {
    transcript('codex', harnesses[0]![1]);
    const noStart = reapWithRealTranscript({ role: 'sequencer', status: 'running' });
    await expect(settle(noStart.pending)).resolves.toBe(false);

    transcript('claude', [{ type: 'assistant', message: { stop_reason: 'end_turn' } }]);
    const claude = reapWithRealTranscript({ role: 'sequencer', status: 'running', startedAt: startedAt() });
    await expect(settle(claude.pending)).resolves.toBe(false);
  });
});
