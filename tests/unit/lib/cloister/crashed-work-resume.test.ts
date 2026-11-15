import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { AgentState } from '../../../../src/lib/agents/agent-state-read.js';
import {
  CRASH_CONFIRM_GAP_MS,
  CRASH_RESUME_MIN_INTERVAL_MS,
  __resetCrashedWorkResumeStateForTests,
  resumeCrashedWorkAgents,
  type CrashedWorkResumeDeps,
} from '../../../../src/lib/cloister/crashed-work-resume.js';

const T0 = Date.parse('2026-11-15T12:02:49.000Z');
const TICK = 60_000;

function workAgent(id: string, overrides: Partial<AgentState> = {}): AgentState {
  const issueId = id.replace(/^agent-/, '').toUpperCase();
  return {
    id,
    issueId,
    workspace: `/repo/workspaces/feature-${issueId.toLowerCase()}`,
    role: 'work',
    model: 'claude',
    status: 'running',
    startedAt: '2026-11-15T11:23:00.000Z',
    lastActivity: '2026-11-15T11:57:00.000Z',
    ...overrides,
  } as AgentState;
}

type MockDeps = { [K in keyof CrashedWorkResumeDeps]: Mock<CrashedWorkResumeDeps[K]> };

/** A host where every given agent is running in state.json and absent from the inventory (all dead). */
function deadHost(agents: AgentState[], overrides: Partial<CrashedWorkResumeDeps> = {}) {
  const states = new Map(agents.map((agent) => [agent.id, agent]));
  const deps = {
    isDeaconPaused: vi.fn(() => false),
    isNoResumeBoot: vi.fn(() => false),
    liveAgentInventory: vi.fn(async () => ({ backend: 'herdr', panes: [] as Array<{ agentId: string }> })),
    listRunningAgents: vi.fn(() => [...states.values()]),
    detectCrashedAgents: vi.fn(async (candidates: AgentState[]) => candidates),
    readAgentState: vi.fn((agentId: string) => states.get(agentId) ?? null),
    readRecordedStopAt: vi.fn((_agent: AgentState): number | null => null),
    isIssueClosed: vi.fn(async (_issueId: string) => false),
    isIssueMerged: vi.fn(async (_issueId: string) => ({ skip: false, reason: 'not merged' })),
    memoryAdmits: vi.fn(async () => ({ admits: true, detail: 'band ok' })),
    resumeAgent: vi.fn(async (_agentId: string) => ({ success: true })),
    surfaceNeedsYou: vi.fn(async (_issueId: string, _reason: string, _details?: Record<string, unknown>) => undefined),
    ...overrides,
  } as MockDeps;
  return { deps, states };
}

/** Run `count` ticks one deacon-lite interval apart, starting at `start`. Returns every action line. */
async function runTicks(deps: Partial<CrashedWorkResumeDeps>, count: number, start = T0): Promise<string[][]> {
  const lines: string[][] = [];
  for (let i = 0; i < count; i++) {
    vi.setSystemTime(start + i * TICK);
    lines.push(await resumeCrashedWorkAgents(start + i * TICK, deps));
  }
  return lines;
}

describe('resumeCrashedWorkAgents (PAN-5354)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    __resetCrashedWorkResumeStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resumes a work agent confirmed dead on two consecutive ticks', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')]);

    const [first, second] = await runTicks(deps, 2);

    expect(first).toEqual([expect.stringContaining('agent-pan-5337 is confirmed dead')]);
    expect(deps.resumeAgent).toHaveBeenCalledTimes(1);
    expect(deps.resumeAgent).toHaveBeenCalledWith('agent-pan-5337');
    expect(second).toContain('resumeCrashedWorkAgents: resumed agent-pan-5337');
    expect(TICK).toBeGreaterThanOrEqual(CRASH_CONFIRM_GAP_MS);
  });

  it('takes candidates from detectCrashedAgents filtered to the work role', async () => {
    const work = workAgent('agent-pan-1');
    const reviewer = workAgent('agent-pan-1-review', { role: 'review' });
    const liveWork = workAgent('agent-pan-2');
    const { deps } = deadHost([work, reviewer, liveWork], {
      liveAgentInventory: vi.fn(async () => ({ backend: 'herdr', panes: [{ agentId: 'agent-pan-2' }] })),
      // The crash door answers with a non-work agent too; the routine must filter it out.
      detectCrashedAgents: vi.fn(async () => [work, reviewer]),
    });

    await runTicks(deps, 3);

    // Only running work agents absent from the inventory are offered to the crash door.
    for (const call of deps.detectCrashedAgents.mock.calls) {
      expect(call[0].map((agent: AgentState) => agent.id)).toEqual(['agent-pan-1']);
    }
    expect(deps.resumeAgent).toHaveBeenCalledTimes(1);
    expect(deps.resumeAgent).toHaveBeenCalledWith('agent-pan-1');
  });

  it('does not resume after a single dead tick', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')]);

    await runTicks(deps, 1);

    expect(deps.resumeAgent).not.toHaveBeenCalled();
  });

  it('tolerates a second tick that runs a little under 60 s after the first', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')]);

    // A slow first tick: this routine ran 5 s into it, and 1 s into the next.
    await resumeCrashedWorkAgents(T0 + 5_000, deps);
    await resumeCrashedWorkAgents(T0 + TICK + 1_000, deps);

    expect(deps.resumeAgent).toHaveBeenCalledTimes(1);
  });

  it('does not resume when the second dead verdict comes sooner than the confirm gap', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')]);

    await resumeCrashedWorkAgents(T0, deps);
    await resumeCrashedWorkAgents(T0 + CRASH_CONFIRM_GAP_MS - 1, deps);

    expect(deps.resumeAgent).not.toHaveBeenCalled();
  });

  it('restarts the streak when the agent is seen alive between dead ticks', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')]);
    deps.liveAgentInventory
      .mockResolvedValueOnce({ backend: 'herdr', panes: [] })
      .mockResolvedValueOnce({ backend: 'herdr', panes: [{ agentId: 'agent-pan-5337' }] })
      .mockResolvedValueOnce({ backend: 'herdr', panes: [] });

    await runTicks(deps, 3);

    expect(deps.resumeAgent).not.toHaveBeenCalled();
  });

  it('honours paused, troubled and stopped-by-user gates', async () => {
    const paused = workAgent('agent-pan-1', { paused: true, pausedReason: 'operator' });
    const troubled = workAgent('agent-pan-2', { troubled: true, consecutiveFailures: 3 });
    const stoppedByUser = workAgent('agent-pan-3', { stoppedByUser: true });
    const backoff = workAgent('agent-pan-4', { consecutiveFailures: 1 });
    const { deps } = deadHost([paused, troubled, stoppedByUser, backoff]);

    const ticks = await runTicks(deps, 4);

    expect(deps.resumeAgent).not.toHaveBeenCalled();
    // Paused and troubled are decisions the operator already made: no Needs-you.
    const needsYouIssues = deps.surfaceNeedsYou.mock.calls.map((call) => call[0]);
    expect(needsYouIssues).not.toContain('PAN-1');
    expect(needsYouIssues).not.toContain('PAN-2');
    // Each hold is logged once, not once per tick.
    const holdLines = ticks.flat().filter((line) => line.includes('agent-pan-1 not resumed'));
    expect(holdLines).toHaveLength(1);
  });

  it('skips an agent whose stop is recorded for this launch generation', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')], {
      readRecordedStopAt: vi.fn(() => T0 - 10 * TICK),
    });

    const ticks = await runTicks(deps, 3);

    expect(deps.resumeAgent).not.toHaveBeenCalled();
    expect(ticks.flat().filter((line) => line.includes('its stop is recorded'))).toHaveLength(1);
  });

  it('does nothing while the deacon is paused or OVERDECK_NO_RESUME is set', async () => {
    const paused = deadHost([workAgent('agent-pan-5337')], { isDeaconPaused: vi.fn(() => true) });
    await runTicks(paused.deps, 3);
    expect(paused.deps.resumeAgent).not.toHaveBeenCalled();
    expect(paused.deps.liveAgentInventory).not.toHaveBeenCalled();

    __resetCrashedWorkResumeStateForTests();
    const noResume = deadHost([workAgent('agent-pan-5337')], { isNoResumeBoot: vi.fn(() => true) });
    await runTicks(noResume.deps, 3);
    expect(noResume.deps.resumeAgent).not.toHaveBeenCalled();
  });

  it('reads OVERDECK_NO_RESUME from the environment at fire time', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')]);
    const { isNoResumeBoot: _drop, ...withRealNoResumeCheck } = deps;
    vi.stubEnv('OVERDECK_NO_RESUME', '1');
    try {
      await runTicks(withRealNoResumeCheck, 3);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(deps.resumeAgent).not.toHaveBeenCalled();
  });

  it('resumes one agent per tick, oldest lastActivity first', async () => {
    const newest = workAgent('agent-pan-5339', { lastActivity: '2026-11-15T11:57:38.000Z' });
    const oldest = workAgent('agent-pan-5290', { lastActivity: '2026-11-15T11:55:37.000Z' });
    const middle = workAgent('agent-pan-5338', { lastActivity: '2026-11-15T11:56:10.000Z' });
    const { deps, states } = deadHost([newest, oldest, middle]);
    // A successful resume stamps a new launch generation and puts the pane back.
    const live: string[] = [];
    deps.liveAgentInventory.mockImplementation(async () => ({ backend: 'herdr', panes: live.map((agentId) => ({ agentId })) }));
    deps.resumeAgent.mockImplementation(async (agentId: string) => {
      live.push(agentId);
      states.set(agentId, { ...states.get(agentId)!, lastResumeAt: new Date().toISOString() });
      return { success: true };
    });

    // Tick 1 records the streaks; ticks 2-4 each resume one agent.
    await runTicks(deps, 2);
    expect(deps.resumeAgent.mock.calls.map((call) => call[0])).toEqual(['agent-pan-5290']);
    await runTicks(deps, 1, T0 + 2 * TICK);
    expect(deps.resumeAgent.mock.calls.map((call) => call[0])).toEqual(['agent-pan-5290', 'agent-pan-5338']);
    await runTicks(deps, 1, T0 + 3 * TICK);
    expect(deps.resumeAgent.mock.calls.map((call) => call[0])).toEqual(['agent-pan-5290', 'agent-pan-5338', 'agent-pan-5339']);
  });

  it('attempts at most once per minute even when a manual patrol runs between ticks', async () => {
    const { deps } = deadHost([workAgent('agent-pan-1'), workAgent('agent-pan-2')]);

    await runTicks(deps, 2);
    expect(deps.resumeAgent).toHaveBeenCalledTimes(1);
    await resumeCrashedWorkAgents(T0 + TICK + 5_000, deps);
    expect(deps.resumeAgent).toHaveBeenCalledTimes(1);
    await resumeCrashedWorkAgents(T0 + TICK + CRASH_RESUME_MIN_INTERVAL_MS, deps);
    expect(deps.resumeAgent).toHaveBeenCalledTimes(2);
    // The next scheduled tick, even a little early, is never held by the interval.
    expect(CRASH_RESUME_MIN_INTERVAL_MS).toBeLessThan(TICK);
  });

  it('waits while the memory governor does not admit', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')], {
      memoryAdmits: vi.fn(async () => ({ admits: false, detail: 'band soft' })),
    });

    const ticks = await runTicks(deps, 3);
    expect(deps.resumeAgent).not.toHaveBeenCalled();
    // The hold is reported once, not every tick.
    expect(ticks.flat().filter((line) => line.includes('memory governor does not admit'))).toHaveLength(1);

    // The candidate stays eligible: once memory admits, the next tick resumes it.
    deps.memoryAdmits.mockResolvedValue({ admits: true, detail: 'band ok' });
    await runTicks(deps, 1, T0 + 3 * TICK);
    expect(deps.resumeAgent).toHaveBeenCalledTimes(1);
  });

  it('waits while the memory governor cannot answer', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')], {
      memoryAdmits: vi.fn(async () => { throw new Error('/proc/meminfo unreadable'); }),
    });

    await runTicks(deps, 3);

    expect(deps.resumeAgent).not.toHaveBeenCalled();
  });

  it('attempts once per launch generation and raises one Needs-you item on failure', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')], {
      resumeAgent: vi.fn(async () => ({ success: false, error: 'workspace stack is unhealthy' })),
    });

    const ticks = await runTicks(deps, 6);

    expect(deps.resumeAgent).toHaveBeenCalledTimes(1);
    expect(deps.surfaceNeedsYou).toHaveBeenCalledTimes(1);
    const [issueId, reason] = deps.surfaceNeedsYou.mock.calls[0]!;
    expect(issueId).toBe('PAN-5337');
    expect(reason).toContain('agent-pan-5337');
    expect(reason).toContain('workspace stack is unhealthy');
    expect(ticks.flat()).toContain(
      'resumeCrashedWorkAgents: resume of agent-pan-5337 failed (workspace stack is unhealthy); raised a Needs-you item',
    );
  });

  it('treats a thrown resume as a failed attempt and never throws itself', async () => {
    const { deps } = deadHost([workAgent('agent-pan-5337')], {
      resumeAgent: vi.fn(async () => { throw new Error('herdr socket closed'); }),
    });

    await expect(runTicks(deps, 4)).resolves.toHaveLength(4);

    expect(deps.resumeAgent).toHaveBeenCalledTimes(1);
    expect(deps.surfaceNeedsYou).toHaveBeenCalledTimes(1);
    expect(deps.surfaceNeedsYou.mock.calls[0]![1]).toContain('herdr socket closed');
  });

  it('treats a null inventory and runtime-indeterminate as not dead', async () => {
    const nullInventory = deadHost([workAgent('agent-pan-5337')], {
      liveAgentInventory: vi.fn(async () => null),
    });
    await runTicks(nullInventory.deps, 3);
    expect(nullInventory.deps.resumeAgent).not.toHaveBeenCalled();
    expect(nullInventory.deps.detectCrashedAgents).not.toHaveBeenCalled();

    // detectCrashedAgents drops a runtime-indeterminate verdict, so the door returns nothing.
    __resetCrashedWorkResumeStateForTests();
    const indeterminate = deadHost([workAgent('agent-pan-5337')], {
      detectCrashedAgents: vi.fn(async () => [] as AgentState[]),
    });
    await runTicks(indeterminate.deps, 3);
    expect(indeterminate.deps.resumeAgent).not.toHaveBeenCalled();

    // A null inventory between two dead ticks breaks the streak.
    __resetCrashedWorkResumeStateForTests();
    const flapping = deadHost([workAgent('agent-pan-5337')]);
    flapping.deps.liveAgentInventory
      .mockResolvedValueOnce({ backend: 'herdr', panes: [] })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ backend: 'herdr', panes: [] });
    await runTicks(flapping.deps, 3);
    expect(flapping.deps.resumeAgent).not.toHaveBeenCalled();
  });

  it('skips closed and merged issues', async () => {
    const closed = workAgent('agent-pan-1');
    const merged = workAgent('agent-pan-2');
    const { deps } = deadHost([closed, merged], {
      isIssueClosed: vi.fn(async (issueId: string) => issueId === 'PAN-1'),
      isIssueMerged: vi.fn(async (issueId: string) => ({ skip: issueId === 'PAN-2', reason: 'PR #9 merged' })),
    });

    const ticks = await runTicks(deps, 4);

    expect(deps.resumeAgent).not.toHaveBeenCalled();
    // Each issue is asked about once: a settled generation is not re-checked every tick.
    expect(deps.isIssueClosed.mock.calls.filter((call) => call[0] === 'PAN-1')).toHaveLength(1);
    expect(ticks.flat()).toContain('resumeCrashedWorkAgents: agent-pan-1 not resumed: PAN-1 is closed');
    expect(ticks.flat()).toContain('resumeCrashedWorkAgents: agent-pan-2 not resumed: PAN-2 is merged (PR #9 merged)');
  });
});
